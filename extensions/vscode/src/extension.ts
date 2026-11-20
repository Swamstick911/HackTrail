import * as vscode from 'vscode';
import { createHash, randomUUID } from 'node:crypto';
import { ActivityClock, type ActivityInterval } from '../../../src/shared/activity-clock.js';
import { CollectorError, LocalClient } from '../../../src/shared/local-client.js';
import type { TimeSample } from '../../../src/shared/tracking.js';
import type { Project } from '../../../src/shared/events.js';

interface Connection {
  projectId: string;
  projectName: string;
  url: string;
}

export function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) return;
  let connection = context.workspaceState.get<Connection>('connection');
  let enabled = context.workspaceState.get('enabled', false);
  let queue = context.workspaceState.get<TimeSample[]>('queue', []);
  let clientId = context.workspaceState.get<string>('clientId');
  if (!clientId) {
    clientId = randomUUID();
    void context.workspaceState.update('clientId', clientId);
  }
  let client = connection ? new LocalClient(connection.url) : null;
  let clock = new ActivityClock(Date.now());
  let flushing = false;
  let online = false;
  let globallyPaused = false;
  let storageWrites = Promise.resolve();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.command = 'hacktrail.toggleTracking';
  context.subscriptions.push(status);
  status.show();

  function editorInWorkspace() {
    const document = vscode.window.activeTextEditor?.document;
    return Boolean(document && vscode.workspace.getWorkspaceFolder(document.uri));
  }

  function remember(interval: ActivityInterval | null) {
    if (!interval || !connection) return;
    queue.push({
      id: randomUUID(),
      projectId: connection.projectId,
      startedAt: new Date(interval.start).toISOString(),
      endedAt: new Date(interval.end).toISOString(),
      signal: interval.signal,
    });
    persist();
  }

  function persist() {
    queue = queue
      .filter((sample) => Date.parse(sample.startedAt) >= Date.now() - 7 * 86_400_000)
      .slice(-5000);
    const snapshot = [...queue];
    storageWrites = storageWrites
      .then(() => context.workspaceState.update('queue', snapshot))
      .catch(() => {
        status.tooltip = 'HackTrail could not save its offline queue.';
      });
  }

  function setFocus() {
    remember(
      clock.focus(
        Date.now(),
        Boolean(enabled && connection && vscode.window.state.focused && editorInWorkspace()),
      ),
    );
    render();
  }

  function render() {
    const state = !connection
      ? 'Connect'
      : !enabled || globallyPaused
        ? 'Paused'
        : !online
          ? 'Offline'
          : clock.active(Date.now())
            ? 'Tracking'
            : 'Idle';
    status.text = '$(watch) HackTrail: ' + state;
    status.tooltip = connection
      ? connection.projectName +
        '\n' +
        queue.length +
        ' samples waiting to sync. Click to pause or resume.'
      : 'Connect a project to begin.';
    status.command = connection ? 'hacktrail.toggleTracking' : 'hacktrail.connect';
  }

  async function flush() {
    if (!client || !connection || flushing) return;
    flushing = true;
    const requestClient = client;
    const selected = connection;
    try {
      await storageWrites;
      const projectIds = [
        ...new Set([selected.projectId, ...queue.map((sample) => sample.projectId)]),
      ];
      for (const projectId of projectIds) {
        const samples = queue.filter((sample) => sample.projectId === projectId).slice(0, 500);
        const result = await requestClient
          .request<{ paused: boolean }>('/tracking/heartbeat', {
            clientId:
              clientId + '-' + createHash('sha256').update(projectId).digest('hex').slice(0, 16),
            projectId,
            label: vscode.env.appName.slice(0, 80),
            state:
              projectId !== selected.projectId || !enabled
                ? 'paused'
                : clock.active(Date.now())
                  ? 'active'
                  : 'idle',
            samples,
          })
          .catch(async (error) => {
            if (!(error instanceof CollectorError) || error.status !== 404) throw error;
            queue = queue.filter((sample) => sample.projectId !== projectId);
            persist();
            if (connection?.projectId === projectId) {
              enabled = false;
              connection = undefined;
              client = null;
              clock.focus(Date.now(), false);
              await context.workspaceState.update('connection', undefined);
              await context.workspaceState.update('enabled', false);
              void vscode.window.showInformationMessage(
                'This HackTrail project was removed. Connect another project to resume tracking.',
              );
            }
            return null;
          });
        if (!result) continue;
        globallyPaused = result.paused;
        const sent = new Set(samples.map((sample) => sample.id));
        queue = queue.filter((sample) => !sent.has(sample.id));
        persist();
      }
      online = true;
    } catch {
      online = false;
    } finally {
      flushing = false;
      render();
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('hacktrail.connect', async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showInformationMessage('Open a project folder first.');
        return;
      }
      const url = await vscode.window.showInputBox({
        title: 'Connect to HackTrail',
        prompt: 'Local collector address',
        value: connection?.url ?? 'http://127.0.0.1:47654',
        ignoreFocusOut: true,
      });
      if (!url) return;
      try {
        const nextClient = new LocalClient(url);
        const projects = (await nextClient.request<Project[]>('/projects')).filter(
          (project) => !project.isExample,
        );
        if (!projects.length) {
          void vscode.window.showInformationMessage(
            'Create a project in the HackTrail dashboard first.',
          );
          return;
        }
        const chosen = await vscode.window.showQuickPick(
          projects.map((project) => ({ label: project.name, project })),
          { title: 'Which project is this workspace?', ignoreFocusOut: true },
        );
        if (!chosen) return;
        remember(clock.focus(Date.now(), false));
        await flush();
        connection = {
          projectId: chosen.project.id,
          projectName: chosen.project.name,
          url: nextClient.baseUrl,
        };
        client = nextClient;
        enabled = true;
        clock = new ActivityClock(Date.now());
        await context.workspaceState.update('connection', connection);
        await context.workspaceState.update('enabled', true);
        setFocus();
        await flush();
        void vscode.window.showInformationMessage(
          'HackTrail is connected. Editor activity will be estimated locally; code and file names stay out of the tracker.',
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Could not connect to HackTrail.',
        );
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hacktrail.toggleTracking', async () => {
      if (!connection) {
        await vscode.commands.executeCommand('hacktrail.connect');
        return;
      }
      remember(clock.focus(Date.now(), false));
      enabled = !enabled;
      await context.workspaceState.update('enabled', enabled);
      setFocus();
      await flush();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('hacktrail.openDashboard', () =>
      vscode.env.openExternal(vscode.Uri.parse(connection?.url ?? 'http://127.0.0.1:47654')),
    ),
  );
  context.subscriptions.push(vscode.window.onDidChangeWindowState(setFocus));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(setFocus));
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (
        !enabled ||
        !connection ||
        !vscode.window.state.focused ||
        event.textEditor !== vscode.window.activeTextEditor ||
        !editorInWorkspace()
      )
        return;
      if (event.kind === vscode.TextEditorSelectionChangeKind.Keyboard)
        clock.input(Date.now(), 'keyboard');
      if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse)
        clock.input(Date.now(), 'mouse');
      render();
    }),
  );
  const timer = setInterval(() => {
    remember(clock.tick(Date.now()));
    void flush();
    render();
  }, 15_000);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
      remember(clock.focus(Date.now(), false));
    },
  });
  persist();
  setFocus();
  void flush();
}

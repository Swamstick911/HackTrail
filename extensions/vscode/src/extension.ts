import * as vscode from 'vscode';
import { createHash, randomUUID } from 'node:crypto';
import { ActivityClock, type ActivityInterval } from '../../../src/shared/activity-clock.js';
import { CollectorError, LocalClient } from '../../../src/shared/local-client.js';
import type { TimeSample } from '../../../src/shared/tracking.js';
import type { Project } from '../../../src/shared/events.js';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { connectClaude } from '../../../src/integrations/claude.js';
import { CollectorManager, defaultCollectorUrl } from './collector.js';

interface Connection {
  projectId: string;
  projectName: string;
  url: string;
  workspaceUri?: string;
  workspacePath?: string;
}

export function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) return;
  const collector = new CollectorManager(context.extensionPath, context.globalStorageUri?.fsPath);
  let settingUp = false;
  let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRestartAttempt = 0;
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
    const folder = document && vscode.workspace.getWorkspaceFolder(document.uri);
    return Boolean(
      folder && (!connection?.workspaceUri || folder.uri.toString() === connection.workspaceUri),
    );
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
      ? 'Enable tracking'
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
      : 'Enable tracking for this workspace.';
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

  async function setup(projectId?: string, url = connection?.url ?? defaultCollectorUrl) {
    if (settingUp) return;
    settingUp = true;
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!vscode.workspace.isTrusted || !folders?.length) {
        void vscode.window.showInformationMessage('Open a trusted project folder first.');
        return;
      }
      const folder =
        folders.length === 1
          ? folders[0]
          : await vscode.window.showWorkspaceFolderPick({
              placeHolder: 'Which folder should HackTrail track?',
            });
      if (!folder) return;
      if (folder.uri.scheme !== 'file')
        throw new Error('Open a folder on the extension host to track it.');
      const choice = await vscode.window.showInformationMessage(
        'Enable HackTrail for ' + folder.name + '?',
        {
          modal: true,
          detail:
            'HackTrail starts a local collector and records editor activity timestamps. Including Claude adds local hooks for tool names, outcomes, and agent runtime. No code, prompt text, tool arguments, or output is collected. Setup may download a runtime from nodejs.org once.',
        },
        'Enable tracking',
        'Editor only',
      );
      await context.workspaceState.update('setupSeen', true);
      if (!choice) return;
      let claudeReady = false;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Setting up HackTrail' },
        async (progress) => {
          const report = (message: string) => progress.report({ message });
          await collector.ensure(url, report);
          const nextClient = new LocalClient(url);
          const workspacePath = await realpath(folder.uri.fsPath);
          const identity =
            process.platform === 'win32' ? workspacePath.toLowerCase() : workspacePath;
          const project = await nextClient.request<Project>('/workspaces/resolve', {
            key: createHash('sha256').update(identity).digest('hex'),
            name: folder.name.replace(/[\u0000-\u001f]/g, '').slice(0, 80) || 'My project',
            projectId:
              projectId ??
              (!connection?.workspaceUri || connection.workspaceUri === folder.uri.toString()
                ? connection?.projectId
                : undefined),
          });
          remember(clock.focus(Date.now(), false));
          await flush();
          connection = {
            projectId: project.id,
            projectName: project.name,
            url: nextClient.baseUrl,
            workspaceUri: folder.uri.toString(),
            workspacePath,
          };
          client = nextClient;
          enabled = true;
          clock = new ActivityClock(Date.now());
          await context.workspaceState.update('connection', connection);
          await context.workspaceState.update('enabled', true);
          await context.workspaceState.update('claudeEnabled', choice === 'Enable tracking');
          if (choice === 'Enable tracking') {
            try {
              await installClaude(report);
              claudeReady = true;
            } catch (error) {
              void vscode.window.showWarningMessage(
                'Editor tracking is ready, but Claude setup needs attention: ' +
                  message(error) +
                  ' Run HackTrail: Enable Tracking to retry.',
              );
            }
          } else {
            await removeClaude();
          }
          setFocus();
          await flush();
          await vscode.env.openExternal(
            await vscode.env.asExternalUri(vscode.Uri.parse(connection.url)),
          );
        },
      );
      void vscode.window.showInformationMessage(
        claudeReady
          ? 'HackTrail is ready. New Claude sessions will load the local hooks; restart an existing session once.'
          : 'HackTrail is ready. Editor activity stays on this computer.',
      );
    } catch (error) {
      void vscode.window.showErrorMessage(message(error));
    } finally {
      settingUp = false;
    }
  }

  function message(error: unknown) {
    return error instanceof Error ? error.message : 'Could not set up HackTrail.';
  }

  async function installClaude(report: (message: string) => void = () => {}) {
    if (!connection?.workspacePath) return;
    await connectClaude({
      workspace: connection.workspacePath,
      projectId: connection.projectId,
      url: connection.url,
      bundlePath: join(context.extensionPath, 'dist', 'claude-hook.mjs'),
      runtimePath: await collector.runtime(report),
    });
  }

  async function removeClaude() {
    if (!connection?.workspacePath) return;
    await connectClaude({
      workspace: connection.workspacePath,
      url: connection.url,
      remove: true,
      bundlePath: join(context.extensionPath, 'dist', 'claude-hook.mjs'),
    });
    await context.workspaceState.update('claudeEnabled', false);
  }

  async function restoreCollector() {
    if (
      !connection ||
      (!enabled && !context.workspaceState.get('claudeEnabled', false)) ||
      settingUp
    )
      return;
    lastRestartAttempt = Date.now();
    try {
      await collector.ensure(connection.url);
      if (context.workspaceState.get('claudeEnabled', false)) await installClaude();
      await flush();
    } catch (error) {
      online = false;
      status.tooltip = message(error);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('hacktrail.connect', () => setup()),
    vscode.commands.registerCommand('hacktrail.disableClaude', async () => {
      try {
        await removeClaude();
        void vscode.window.showInformationMessage(
          'HackTrail Claude hooks removed. Restart existing Claude sessions to apply this.',
        );
      } catch (error) {
        void vscode.window.showErrorMessage(message(error));
      }
    }),
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        if (uri.path !== '/enable') return;
        clearTimeout(welcomeTimer);
        if (settingUp) {
          void vscode.window.showInformationMessage(
            'Finish the open HackTrail setup, then use the dashboard link again to select its project.',
          );
          return;
        }
        const params = new URLSearchParams(uri.query);
        const projectId = params.get('projectId');
        if (!projectId || projectId.length > 128) return;
        await setup(projectId, params.get('collector') ?? defaultCollectorUrl);
      },
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
    vscode.commands.registerCommand('hacktrail.openDashboard', async () => {
      if (!connection) return setup();
      try {
        await collector.ensure(connection.url);
        await vscode.env.openExternal(
          await vscode.env.asExternalUri(vscode.Uri.parse(connection.url)),
        );
      } catch (error) {
        void vscode.window.showErrorMessage(message(error));
      }
    }),
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
    if (!online && Date.now() - lastRestartAttempt > 60_000) void restoreCollector();
    render();
  }, 15_000);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
      clearTimeout(welcomeTimer);
      remember(clock.focus(Date.now(), false));
    },
  });
  persist();
  setFocus();
  void flush();
  if (connection?.workspacePath) void restoreCollector();
  welcomeTimer = setTimeout(() => {
    if (
      !connection &&
      !settingUp &&
      !context.workspaceState.get('setupSeen', false) &&
      vscode.workspace.workspaceFolders?.length
    )
      void setup();
  }, 1000);
}

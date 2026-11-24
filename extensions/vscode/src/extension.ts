import * as vscode from 'vscode';
import { createHash, randomUUID } from 'node:crypto';
import { ActivityClock, type ActivityInterval } from '../../../src/shared/activity-clock.js';
import { CollectorError, LocalClient } from '../../../src/shared/local-client.js';
import type { TimeSample } from '../../../src/shared/tracking.js';
import type { ActivityEvent, GitContext, Project } from '../../../src/shared/events.js';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { connectClaude } from '../../../src/integrations/claude.js';
import { connectCodex } from '../../../src/integrations/codex.js';
import { observeGit } from '../../../src/integrations/git.js';
import { CollectorManager, defaultCollectorUrl } from './collector.js';
import {
  beginConnection,
  platformOrigin,
  platformRequest,
  PlatformError,
  syncBatch,
  type SyncConnection,
} from './platform-client.js';

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
  let platform = context.workspaceState.get<SyncConnection>('platform');
  const syncHistory = context.workspaceState.get<Record<string, SyncConnection>>('syncHistory', {});
  const historyKey = (value: Pick<SyncConnection, 'origin' | 'accountId' | 'projectId'>) =>
    createHash('sha256')
      .update(JSON.stringify([value.origin, value.accountId, value.projectId]))
      .digest('hex');
  let syncingPlatform = false;
  let connectingPlatform = false;
  let platformStatus = platform ? 'Waiting to sync' : 'Local only';
  let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRestartAttempt = 0;
  let connection = context.workspaceState.get<Connection>('connection');
  let enabled = context.workspaceState.get('enabled', false);
  let queue = context.workspaceState.get<TimeSample[]>('queue', []);
  let evidence = context.workspaceState.get<{
    events: ActivityEvent[];
    previous?: { projectId: string; git: GitContext };
  }>('evidence', { events: [] });
  let gitContext: GitContext | undefined;
  let language = vscode.window.activeTextEditor?.document.languageId;
  let pollingGit = false;
  let lastGitPoll = 0;
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
      language,
      editor: vscode.env.appName.slice(0, 80),
      git: gitContext,
    });
    persist();
  }

  function persist() {
    queue = queue
      .filter((sample) => Date.parse(sample.startedAt) >= Date.now() - 7 * 86_400_000)
      .slice(-5000);
    const snapshot = [...queue];
    const savedEvidence = { ...evidence, events: [...evidence.events] };
    storageWrites = storageWrites
      .then(async () => {
        await context.workspaceState.update('queue', snapshot);
        await context.workspaceState.update('evidence', savedEvidence);
      })
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
    language = vscode.window.activeTextEditor?.document.languageId;
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
    const syncStatus =
      platform && platform.projectId !== connection?.projectId
        ? 'This project is local only. Run Connect Account to sync it.'
        : platformStatus;
    status.text = '$(watch) HackTrail: ' + state;
    status.tooltip = connection
      ? connection.projectName +
        '\n' +
        queue.length +
        ' samples waiting for the local collector. Click to pause or resume.\n' +
        syncStatus
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
        ...new Set([
          selected.projectId,
          ...queue.map((sample) => sample.projectId),
          ...evidence.events.map((event) => event.projectId),
        ]),
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
            evidence.events = evidence.events.filter((event) => event.projectId !== projectId);
            gitContext = undefined;
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
        const events = evidence.events
          .filter((event) => event.projectId === projectId)
          .slice(0, 500);
        if (events.length) {
          await storageWrites;
          await requestClient.request('/events', { events });
          const ids = new Set(events.map((event) => event.id));
          evidence.events = evidence.events.filter((event) => !ids.has(event.id));
          persist();
        }
      }
      online = true;
      void syncPlatform();
    } catch {
      online = false;
    } finally {
      flushing = false;
      render();
    }
  }

  async function syncPlatform() {
    if (!platform || !client || syncingPlatform || platform.projectId !== connection?.projectId)
      return;
    syncingPlatform = true;
    const selected = platform;
    let pending = selected;
    try {
      const token = await context.secrets.get('platform:' + selected.deviceId);
      if (!token) throw new Error('Reconnect this workspace to your HackTrail account.');
      for (let page = 0; page < 5; page++) {
        const result = await syncBatch(client, pending, token, async (saved) => {
          if (platform !== selected) throw new Error('Connection changed.');
          pending = saved;
          syncHistory[historyKey(saved)] = saved;
          await context.workspaceState.update('syncHistory', syncHistory);
        });
        if (platform !== selected) return;
        pending = result.connection;
        syncHistory[historyKey(pending)] = pending;
        await context.workspaceState.update('syncHistory', syncHistory);
        platformStatus = result.paused
          ? 'Platform paused'
          : result.hasMore
            ? 'Syncing queued activity'
            : 'Synced to @' + pending.handle;
        if (!result.hasMore) break;
      }
    } catch (error) {
      platformStatus =
        error instanceof PlatformError && [401, 403, 410].includes(error.status)
          ? message(error) + ' Use HackTrail: Connect Account to reconnect.'
          : 'Platform offline. Local tracking continues; sync will retry.';
    } finally {
      if (platform === selected) {
        platform = pending;
        await context.workspaceState.update('platform', pending);
      }
      syncingPlatform = false;
      render();
    }
  }

  async function revokeConnection(previous: SyncConnection) {
    let revoked = false;
    try {
      const token = await context.secrets.get('platform:' + previous.deviceId);
      if (token)
        await platformRequest(previous.origin, '/devices/current', undefined, token, 'DELETE');
      revoked = true;
    } catch (error) {
      revoked = error instanceof PlatformError && error.status === 401;
    } finally {
      await context.secrets.delete('platform:' + previous.deviceId);
    }
    return revoked;
  }

  async function connectPlatform(suggestedOrigin?: string) {
    if (connectingPlatform) return;
    if (!connection || !client) {
      await setup();
      if (!connection || !client) return;
    }
    connectingPlatform = true;
    try {
      const value = await vscode.window.showInputBox({
        title: 'Connect your HackTrail account',
        prompt: 'Platform address. This workspace will sync up to the last seven days of activity.',
        value: suggestedOrigin ?? platform?.origin ?? 'http://127.0.0.1:47657',
        ignoreFocusOut: true,
      });
      if (!value) return;
      const origin = platformOrigin(value);
      const choices = await vscode.window.showQuickPick(
        [
          {
            label: 'Agent activity',
            description: 'Agent start/stop times, tool names, and outcomes. No prompts or output.',
            key: 'agents',
          },
          {
            label: 'Git context',
            description:
              'Commit IDs, branch names, and change counts. No source code or file paths.',
            key: 'git',
          },
        ],
        {
          title: 'What else should sync with editor time?',
          placeHolder: 'Leave both unchecked to sync only editor time, language, and editor name.',
          canPickMany: true,
          ignoreFocusOut: true,
        },
      );
      if (!choices) return;
      const selected = connection;
      const approved = await vscode.window.showInformationMessage(
        'Sync ' + selected.projectName + ' to ' + origin + '?',
        {
          modal: true,
          detail:
            'The project starts private. Your browser will ask you to approve this editor. Local notes and conversation text stay on this computer. New choices apply to future batches; a saved batch awaiting acknowledgement keeps its earlier choices. Pausing local tracking and disconnecting sync are separate controls.',
        },
        'Connect account',
      );
      if (!approved) return;
      const result = await beginConnection(origin, vscode.env.appName.slice(0, 60) + ' workspace');
      await vscode.env.openExternal(
        await vscode.env.asExternalUri(vscode.Uri.parse(result.verificationUrl)),
      );
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Approve code ' + result.userCode + ' in your browser',
          cancellable: true,
        },
        async (_progress, cancellation) => {
          const expiresAt = Date.now() + Math.min(result.expiresIn, 600) * 1000;
          while (!cancellation.isCancellationRequested && Date.now() < expiresAt) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            if (cancellation.isCancellationRequested) return;
            const approval = await platformRequest<{
              status: 'pending' | 'approved';
              token?: string;
              deviceId?: string;
              accountId?: string;
              handle?: string;
            }>(origin, '/devices/poll', {
              deviceCode: result.deviceCode,
              verifier: result.verifier,
            });
            if (approval.status !== 'approved') continue;
            if (!approval.token || !approval.deviceId || !approval.handle || !approval.accountId)
              throw new Error('Incomplete connection response.');
            if (connection !== selected)
              throw new Error('The selected project changed. Connect it again.');
            const previous = platform;
            const history =
              syncHistory[
                historyKey({ origin, accountId: approval.accountId, projectId: selected.projectId })
              ];
            await context.secrets.store('platform:' + approval.deviceId, approval.token);
            platform = {
              origin,
              deviceId: approval.deviceId,
              accountId: approval.accountId,
              handle: approval.handle,
              projectId: selected.projectId,
              includeGit: choices.some((choice) => choice.key === 'git'),
              includeAgents: choices.some((choice) => choice.key === 'agents'),
              cursor: history?.cursor ?? 0,
              pending: history?.pending,
            };
            await context.workspaceState.update('platform', platform);
            if (previous) await revokeConnection(previous);
            await syncPlatform();
            void vscode.window.showInformationMessage(
              'HackTrail account connected. This project is private until you publish it in the platform.',
            );
            return;
          }
          if (!cancellation.isCancellationRequested)
            throw new Error('The connection expired. Run Connect Account to try again.');
        },
      );
    } catch (error) {
      void vscode.window.showErrorMessage(message(error));
    } finally {
      connectingPlatform = false;
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
            'HackTrail starts a local collector and records editor activity timestamps. Full tracking adds Claude and Codex hooks for tool names, outcomes, and agent runtime, plus Git commit IDs, branch names, and change counts. Codex will ask you to trust its hooks via /hooks. No code, prompt text, tool arguments, or output is collected. Setup may download a runtime from nodejs.org once.',
        },
        'Enable tracking',
        'Editor only',
      );
      await context.workspaceState.update('setupSeen', true);
      if (!choice) return;
      const collection =
        choice === 'Enable tracking'
          ? await vscode.window.showQuickPick(
              [
                {
                  label: 'Git checkpoints',
                  description: 'Commit IDs, branches, and change counts',
                  key: 'git',
                  picked: true,
                },
                {
                  label: 'Claude Code activity',
                  description: 'Tool names, outcomes, and agent runtime',
                  key: 'claude',
                  picked: true,
                },
                {
                  label: 'Codex activity',
                  description: 'Tool names, outcomes, and agent runtime; requires /hooks trust',
                  key: 'codex',
                  picked: true,
                },
              ],
              {
                canPickMany: true,
                title: 'Choose what HackTrail collects locally',
                ignoreFocusOut: true,
              },
            )
          : [];
      if (!collection) return;
      const collects = (source: string) => collection.some((item) => item.key === source);
      let claudeReady = false;
      let codexReady = false;
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
          gitContext = undefined;
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
          await context.workspaceState.update('evidenceSetupSeen', true);
          await context.workspaceState.update('gitEnabled', collects('git'));
          await context.workspaceState.update('claudeEnabled', collects('claude'));
          await context.workspaceState.update('codexEnabled', collects('codex'));
          if (choice === 'Enable tracking') {
            try {
              if (collects('claude')) {
                await installAgent('claude', report);
                claudeReady = true;
              } else await removeAgent('claude');
            } catch (error) {
              void vscode.window.showWarningMessage(
                'Editor tracking is ready, but Claude setup needs attention: ' +
                  message(error) +
                  ' Run HackTrail: Enable Tracking to retry.',
              );
            }
            try {
              if (collects('codex')) {
                await installAgent('codex', report);
                codexReady = true;
              } else await removeAgent('codex');
            } catch (error) {
              void vscode.window.showWarningMessage(
                'Editor tracking is ready, but Codex setup needs attention: ' +
                  message(error) +
                  ' Run HackTrail: Enable Tracking to retry.',
              );
            }
            await pollGit();
          } else {
            await removeAgent('claude');
            await removeAgent('codex');
          }
          setFocus();
          await flush();
          await vscode.env.openExternal(
            await vscode.env.asExternalUri(vscode.Uri.parse(connection.url)),
          );
        },
      );
      void vscode.window.showInformationMessage(
        codexReady
          ? 'HackTrail is ready. In Codex, open /hooks to review and trust the new hooks. Restart an existing Claude session once.'
          : claudeReady
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

  async function installAgent(
    adapter: 'claude' | 'codex',
    report: (message: string) => void = () => {},
  ) {
    if (!connection?.workspacePath) return;
    await (adapter === 'claude' ? connectClaude : connectCodex)({
      workspace: connection.workspacePath,
      projectId: connection.projectId,
      url: connection.url,
      bundlePath: join(context.extensionPath, 'dist', adapter + '-hook.mjs'),
      runtimePath: await collector.runtime(report),
    });
  }

  async function removeAgent(adapter: 'claude' | 'codex') {
    if (!connection?.workspacePath) return;
    await (adapter === 'claude' ? connectClaude : connectCodex)({
      workspace: connection.workspacePath,
      url: connection.url,
      remove: true,
      bundlePath: join(context.extensionPath, 'dist', adapter + '-hook.mjs'),
    });
    await context.workspaceState.update(adapter + 'Enabled', false);
  }

  async function pollGit() {
    if (
      pollingGit ||
      !connection?.workspacePath ||
      !context.workspaceState.get('gitEnabled', false)
    )
      return;
    pollingGit = true;
    lastGitPoll = Date.now();
    const selected = connection;
    try {
      const previous =
        evidence.previous?.projectId === selected.projectId ? evidence.previous.git : undefined;
      const observed = await observeGit(selected.workspacePath!, selected.projectId, previous);
      if (connection !== selected || !context.workspaceState.get('gitEnabled', false)) return;
      remember(clock.tick(Date.now()));
      gitContext = observed?.context;
      if (!observed) return;
      if (observed.event) {
        if (evidence.events.length >= 5000) {
          void vscode.window.showWarningMessage(
            'HackTrail Git queue is full. Open the dashboard to reconnect the collector.',
          );
          return;
        }
        evidence.events.push(observed.event);
      }
      evidence.previous = { projectId: selected.projectId, git: observed.context };
      persist();
    } finally {
      pollingGit = false;
    }
  }

  async function restoreCollector() {
    if (
      !connection ||
      (!enabled &&
        !context.workspaceState.get('claudeEnabled', false) &&
        !context.workspaceState.get('codexEnabled', false) &&
        !context.workspaceState.get('gitEnabled', false)) ||
      settingUp
    )
      return;
    lastRestartAttempt = Date.now();
    try {
      await collector.ensure(connection.url);
      for (const adapter of ['claude', 'codex'] as const) {
        if (context.workspaceState.get(adapter + 'Enabled', false)) await installAgent(adapter);
      }
      await pollGit();
      await flush();
    } catch (error) {
      online = false;
      status.tooltip = message(error);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('hacktrail.connect', () => setup()),
    vscode.commands.registerCommand('hacktrail.connectAccount', () => connectPlatform()),
    vscode.commands.registerCommand('hacktrail.disconnectAccount', async () => {
      if (!platform) return;
      const previous = platform;
      platform = undefined;
      await context.workspaceState.update('platform', undefined);
      const revoked = await revokeConnection(previous);
      platformStatus = 'Local only';
      render();
      void vscode.window.showInformationMessage(
        revoked
          ? 'Account sync disconnected and device access revoked. Local tracking continues.'
          : 'Account sync disconnected locally. The server could not be reached; revoke this device in platform Connections when online.',
      );
    }),
    vscode.commands.registerCommand('hacktrail.openPlatform', async () => {
      if (!platform) return connectPlatform();
      await vscode.env.openExternal(
        await vscode.env.asExternalUri(vscode.Uri.parse(platform.origin)),
      );
    }),
    ...(['claude', 'codex'] as const).map((adapter) =>
      vscode.commands.registerCommand(
        adapter === 'claude' ? 'hacktrail.disableClaude' : 'hacktrail.disableCodex',
        async () => {
          try {
            await removeAgent(adapter);
            void vscode.window.showInformationMessage(
              'HackTrail ' + adapter + ' hooks removed. Restart the agent session to apply this.',
            );
          } catch (error) {
            void vscode.window.showErrorMessage(message(error));
          }
        },
      ),
    ),
    vscode.commands.registerCommand('hacktrail.disableGit', async () => {
      remember(clock.tick(Date.now()));
      gitContext = undefined;
      await context.workspaceState.update('gitEnabled', false);
      void vscode.window.showInformationMessage(
        'HackTrail Git collection is off. Existing checkpoints remain in your local record.',
      );
    }),
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        if (uri.path === '/account') {
          const origin = new URLSearchParams(uri.query).get('origin');
          if (origin) await connectPlatform(origin);
          return;
        }
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
        remember(clock.input(Date.now(), 'keyboard'));
      if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse)
        remember(clock.input(Date.now(), 'mouse'));
      render();
    }),
  );
  const timer = setInterval(() => {
    remember(clock.tick(Date.now()));
    void flush();
    if (Date.now() - lastGitPoll >= 30_000) void pollGit();
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
    if (connection && !settingUp && !context.workspaceState.get('evidenceSetupSeen', false)) {
      void context.workspaceState.update('evidenceSetupSeen', true);
      void vscode.window
        .showInformationMessage(
          'HackTrail can now add Git checkpoints and Codex activity. Review the new collection options to enable them.',
          'Review setup',
        )
        .then((choice) => {
          if (choice === 'Review setup') void setup();
        });
    }
    if (
      !connection &&
      !settingUp &&
      !context.workspaceState.get('setupSeen', false) &&
      vscode.workspace.workspaceFolders?.length
    )
      void setup();
  }, 1000);
}

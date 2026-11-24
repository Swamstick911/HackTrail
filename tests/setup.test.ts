import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { ExtensionContext } from 'vscode';
import { activate } from '../extensions/vscode/src/extension.js';
import { ActivityStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import {
  commandsByName,
  emit,
  openEditorUri,
  resetEditor,
  window,
  workspace,
} from './vscode-stub.js';
import { verifyDownload } from '../extensions/vscode/src/runtime.js';

const { ensure, runtime } = vi.hoisted(() => ({ ensure: vi.fn(), runtime: vi.fn() }));
vi.mock('../extensions/vscode/src/collector.js', () => ({
  defaultCollectorUrl: 'http://127.0.0.1:47654',
  CollectorManager: class {
    ensure = ensure;
    runtime = runtime;
  },
}));

describe('automatic workspace setup', () => {
  let directory: string;
  let store: ActivityStore;
  let app: ReturnType<typeof createApp>;
  let state: Map<string, unknown>;
  let subscriptions: { dispose(): void }[];

  beforeEach(() => {
    resetEditor();
    vi.spyOn(window, 'showQuickPick').mockImplementation(async (items) => items);
    ensure.mockReset().mockResolvedValue(undefined);
    runtime.mockReset().mockResolvedValue(process.execPath);
    directory = mkdtempSync(join(tmpdir(), 'hacktrail-setup-'));
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist', 'claude-hook.mjs'), 'export {};');
    writeFileSync(join(directory, 'dist', 'codex-hook.mjs'), 'export {};');
    workspace.workspaceFolders = [
      {
        name: 'My project',
        uri: {
          scheme: 'file',
          fsPath: directory,
          toString: () => 'file://' + directory,
        },
      },
    ];
    store = new ActivityStore(':memory:');
    app = createApp({ store, token: 'test-token', port: 47654 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        const response = await app.inject({
          url: new URL(url).pathname,
          method: options?.method === 'POST' ? 'POST' : 'GET',
          headers: {
            host: '127.0.0.1:47654',
            ...Object.fromEntries(new Headers(options?.headers)),
          },
          payload: options?.body as string | undefined,
        });
        return new Response(response.body, { status: response.statusCode });
      }),
    );
    state = new Map([['setupSeen', true]]);
    subscriptions = [];
    activate({
      extensionPath: directory,
      globalStorageUri: { fsPath: join(directory, 'storage') },
      subscriptions,
      workspaceState: {
        get: (key: string, fallback?: unknown) => state.get(key) ?? fallback,
        update: async (key: string, value: unknown) => {
          state.set(key, value);
        },
      },
    } as unknown as ExtensionContext);
  });

  afterEach(async () => {
    subscriptions.forEach((item) => item.dispose());
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
    workspace.workspaceFolders = [{}];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when the setup prompt is dismissed', async () => {
    await commandsByName.get('hacktrail.connect')!();
    expect(ensure).not.toHaveBeenCalled();
    expect(store.listProjects()).toHaveLength(0);
    expect(existsSync(join(directory, '.claude'))).toBe(false);
    expect(state.get('enabled')).not.toBe(true);
  });

  it('starts the collector, creates one project, and installs hooks without a command or key', async () => {
    vi.spyOn(window, 'showInformationMessage').mockResolvedValue('Enable tracking');
    mkdirSync(join(directory, '.claude'));
    const path = join(directory, '.claude', 'settings.local.json');
    writeFileSync(
      path,
      JSON.stringify({
        env: { KEEP: 'yes' },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] },
      }),
    );
    await commandsByName.get('hacktrail.connect')!();
    expect(ensure).toHaveBeenCalledOnce();
    expect(state.get('enabled')).toBe(true);
    expect(state.get('claudeEnabled')).toBe(true);
    expect(state.get('codexEnabled')).toBe(true);
    expect(state.get('gitEnabled')).toBe(true);
    const codexPath = join(directory, '.codex/hooks.json');
    const codex = readFileSync(codexPath, 'utf8');
    expect(JSON.parse(codex).hooks.Interrupt).toHaveLength(1);
    expect(store.listProjects()).toHaveLength(1);
    const first = readFileSync(path, 'utf8');
    const settings = JSON.parse(first);
    expect(settings.env.KEEP).toBe('yes');
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[1].hooks[0].command).toContain(
      process.execPath.replaceAll('\\', '/'),
    );
    await commandsByName.get('hacktrail.connect')!();
    expect(store.listProjects()).toHaveLength(1);
    expect(readFileSync(path, 'utf8')).toBe(first);
    expect(readFileSync(codexPath, 'utf8')).toBe(codex);
    expect(
      readdirSync(join(directory, '.hacktrail')).filter((name) =>
        name.startsWith('claude-settings-backup-'),
      ),
    ).toHaveLength(1);
    await commandsByName.get('hacktrail.disableClaude')!();
    expect(JSON.parse(readFileSync(path, 'utf8')).hooks.Stop).toHaveLength(1);
    expect(state.get('claudeEnabled')).toBe(false);
    await commandsByName.get('hacktrail.disableCodex')!();
    expect(JSON.parse(readFileSync(codexPath, 'utf8')).hooks).toEqual({});
    expect(state.get('codexEnabled')).toBe(false);
  });

  it('supports editor-only consent without creating Claude settings', async () => {
    vi.spyOn(window, 'showInformationMessage').mockResolvedValue('Editor only');
    await commandsByName.get('hacktrail.connect')!();
    expect(state.get('enabled')).toBe(true);
    expect(state.get('claudeEnabled')).toBe(false);
    expect(existsSync(join(directory, '.claude'))).toBe(false);
    expect(existsSync(join(directory, '.codex'))).toBe(false);
    expect(state.get('gitEnabled')).toBe(false);
    expect(state.get('codexEnabled')).toBe(false);
    expect(runtime).not.toHaveBeenCalled();
  });

  it('links Git context to editor samples and stops attaching it when disabled', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', [
        '-C',
        directory,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ]);
    git('init', '-b', 'main');
    writeFileSync(join(directory, 'project.txt'), 'fixture');
    git('add', 'project.txt');
    git('commit', '-m', 'fixture');
    vi.spyOn(window, 'showInformationMessage').mockResolvedValue('Enable tracking');
    vi.spyOn(workspace, 'getWorkspaceFolder').mockReturnValue(workspace.workspaceFolders[0]!);
    await commandsByName.get('hacktrail.connect')!();
    const project = store.listProjects()[0]!;
    expect(store.exportProject(project.id).events[0]).toMatchObject({
      kind: 'git_checkpoint',
      metadata: { git: { branch: 'main' } },
    });
    const started = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(started);
    try {
      emit('selection', { kind: 1, textEditor: window.activeTextEditor });
      clock.mockReturnValue(started + 15_000);
      await commandsByName.get('hacktrail.toggleTracking')!();
      expect(store.tracking.export(project.id).samples[0].git.branch).toBe('main');
      await commandsByName.get('hacktrail.disableGit')!();
      await commandsByName.get('hacktrail.toggleTracking')!();
      emit('selection', { kind: 1, textEditor: window.activeTextEditor });
      clock.mockReturnValue(started + 30_000);
      await commandsByName.get('hacktrail.toggleTracking')!();
      expect(store.tracking.export(project.id).samples.at(-1).git).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it('preserves invalid Codex settings and allows editor tracking to continue', async () => {
    mkdirSync(join(directory, '.codex'));
    writeFileSync(join(directory, '.codex/hooks.json'), '{broken');
    vi.spyOn(window, 'showInformationMessage').mockResolvedValue('Enable tracking');
    const warning = vi.spyOn(window, 'showWarningMessage');
    await commandsByName.get('hacktrail.connect')!();
    expect(state.get('enabled')).toBe(true);
    expect(readFileSync(join(directory, '.codex/hooks.json'), 'utf8')).toBe('{broken');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Codex setup needs attention'));
  });

  it('links a dashboard project instead of creating another during first-run setup', async () => {
    state.delete('setupSeen');
    store.createProject('Dashboard project', 'dashboard-project');
    vi.spyOn(window, 'showInformationMessage').mockResolvedValue('Editor only');
    await openEditorUri({
      path: '/enable',
      query: 'projectId=dashboard-project&collector=http%3A%2F%2F127.0.0.1%3A47654',
    });
    expect(store.listProjects()).toHaveLength(1);
    expect(state.get('connection')).toMatchObject({
      projectId: 'dashboard-project',
      projectName: 'Dashboard project',
    });
  });

  it('can retry failed startup without leaving a false connected state', async () => {
    vi.spyOn(window, 'showInformationMessage').mockResolvedValue('Editor only');
    const error = vi.spyOn(window, 'showErrorMessage');
    ensure.mockRejectedValueOnce(new Error('Download unavailable'));
    await commandsByName.get('hacktrail.connect')!();
    expect(error).toHaveBeenCalledWith('Download unavailable');
    expect(state.get('connection')).toBeUndefined();
    await commandsByName.get('hacktrail.connect')!();
    expect(state.get('enabled')).toBe(true);
  });

  it('rejects a corrupted runtime download before extraction or execution', () => {
    expect(() => verifyDownload(Buffer.from('untrusted binary'), '0'.repeat(64))).toThrow(
      'integrity check',
    );
  });
});

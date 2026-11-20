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
import { tmpdir } from 'node:os';
import type { ExtensionContext } from 'vscode';
import { activate } from '../extensions/vscode/src/extension.js';
import { ActivityStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { commandsByName, openEditorUri, resetEditor, window, workspace } from './vscode-stub.js';
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
    ensure.mockReset().mockResolvedValue(undefined);
    runtime.mockReset().mockResolvedValue(process.execPath);
    directory = mkdtempSync(join(tmpdir(), 'hacktrail-setup-'));
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist', 'claude-hook.mjs'), 'export {};');
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
    expect(
      readdirSync(join(directory, '.hacktrail')).filter((name) =>
        name.startsWith('claude-settings-backup-'),
      ),
    ).toHaveLength(1);
    await commandsByName.get('hacktrail.disableClaude')!();
    expect(JSON.parse(readFileSync(path, 'utf8')).hooks.Stop).toHaveLength(1);
    expect(state.get('claudeEnabled')).toBe(false);
  });

  it('supports editor-only consent without creating Claude settings', async () => {
    vi.spyOn(window, 'showInformationMessage').mockResolvedValue('Editor only');
    await commandsByName.get('hacktrail.connect')!();
    expect(state.get('enabled')).toBe(true);
    expect(state.get('claudeEnabled')).toBe(false);
    expect(existsSync(join(directory, '.claude'))).toBe(false);
    expect(runtime).not.toHaveBeenCalled();
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

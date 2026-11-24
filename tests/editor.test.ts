import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import { activate } from '../extensions/vscode/src/extension.js';
import { ActivityStore, StoreError } from '../src/server/store.js';
import { emit, resetEditor, window, commandsByName } from './vscode-stub.js';

describe('VS Code adapter with the real time store', () => {
  let store: ActivityStore;
  let offline: boolean;
  let state: Map<string, unknown>;
  let subscriptions: { dispose(): void }[];
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    resetEditor();
    offline = false;
    subscriptions = [];
    store = new ActivityStore(':memory:');
    store.createProject('Project', 'project-one');
    state = new Map<string, unknown>([
      ['enabled', true],
      [
        'connection',
        { projectId: 'project-one', projectName: 'Project', url: 'http://127.0.0.1:47654' },
      ],
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (offline) throw new Error('Collector unavailable');
        if (url.endsWith('/session')) return Response.json({ token: 'test-token' });
        try {
          return Response.json(store.tracking.heartbeat(JSON.parse(String(options?.body))));
        } catch (error) {
          if (error instanceof StoreError)
            return Response.json({ error: error.message }, { status: error.statusCode });
          throw error;
        }
      }),
    );
    activate({
      subscriptions,
      workspaceState: {
        get: (key: string, fallback?: unknown) => state.get(key) ?? fallback,
        update: async (key: string, value: unknown) => {
          state.set(key, value);
        },
      },
    } as unknown as ExtensionContext);
    await vi.advanceTimersByTimeAsync(0);
  });
  afterEach(() => {
    subscriptions.forEach((item) => item.dispose());
    store.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retains existing consent without silently enabling Codex or Git', async () => {
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.get('enabled')).toBe(true);
    expect(state.get('gitEnabled')).not.toBe(true);
    expect(state.get('codexEnabled')).not.toBe(true);
    expect(state.get('evidenceSetupSeen')).toBe(true);
  });

  it('ignores command-driven selection changes and focus-only activity', async () => {
    emit('selection', { kind: 3, textEditor: window.activeTextEditor });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.tracking.export('project-one').totalMs).toBe(0);
    emit('selection', { kind: 1, textEditor: window.activeTextEditor });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.tracking.export('project-one').totalMs).toBe(15_000);
    expect(JSON.stringify(store.tracking.export('project-one'))).not.toContain('code.ts');
  });

  it('keeps samples offline and retries them without losing or duplicating time', async () => {
    offline = true;
    emit('selection', { kind: 1, textEditor: window.activeTextEditor });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.get('queue')).toHaveLength(1);
    expect(store.tracking.export('project-one').totalMs).toBe(0);
    offline = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.tracking.export('project-one').totalMs).toBe(30_000);
    expect(state.get('queue')).toHaveLength(0);
    await commandsByName.get('hacktrail.toggleTracking')!();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.tracking.export('project-one').totalMs).toBe(30_000);
  });

  it('attributes the closed interval to the previous language when switching editors', async () => {
    emit('selection', { kind: 1, textEditor: window.activeTextEditor });
    await vi.advanceTimersByTimeAsync(5000);
    window.activeTextEditor.document.languageId = 'python';
    emit('editor', window.activeTextEditor);
    await vi.advanceTimersByTimeAsync(10000);
    const slices = store.tracking.export('project-one').slices;
    expect(
      slices.map((slice) => [
        slice.language,
        Date.parse(slice.endedAt) - Date.parse(slice.startedAt),
      ]),
    ).toEqual([
      ['typescript', 5000],
      ['python', 10000],
    ]);
  });

  it('captures only the time before the window loses focus', async () => {
    emit('selection', { kind: 2, textEditor: window.activeTextEditor });
    await vi.advanceTimersByTimeAsync(5000);
    window.state.focused = false;
    emit('focus', { focused: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.tracking.export('project-one').totalMs).toBe(5000);
  });

  it('disconnects and drops queued samples when its project is deleted', async () => {
    emit('selection', { kind: 1, textEditor: window.activeTextEditor });
    store.deleteProject('project-one');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.get('connection')).toBeUndefined();
    expect(state.get('enabled')).toBe(false);
    expect(state.get('queue')).toHaveLength(0);
  });
});

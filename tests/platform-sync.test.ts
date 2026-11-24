import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityStore } from '../src/server/store.js';
import { SyncReader } from '../src/server/sync-reader.js';
import { PlatformStore } from '../src/platform/store.js';
import { syncSchema } from '../src/platform/contracts.js';
import { WakaTimeReceiver } from '../src/platform/wakatime.js';
import { dashboard } from '../src/platform/analytics.js';
import {
  platformOrigin,
  syncBatch,
  type SyncConnection,
} from '../extensions/vscode/src/platform-client.js';
import { LocalClient } from '../src/shared/local-client.js';
import type { TimeSample } from '../src/shared/tracking.js';

let local: ActivityStore;
let reader: SyncReader;
let platform: PlatformStore;
let waka: WakaTimeReceiver;
const now = Date.now();
const sample = (id: string, start: number, end: number): TimeSample => ({
  id,
  projectId: 'local-project',
  startedAt: new Date(now + start).toISOString(),
  endedAt: new Date(now + end).toISOString(),
  signal: 'keyboard',
  git: { repositoryId: 'a'.repeat(64), commit: 'b'.repeat(40), branch: 'private-branch' },
});
const beat = (samples: TimeSample[]) =>
  local.tracking.heartbeat(
    {
      clientId: 'local-editor',
      projectId: 'local-project',
      label: 'Editor',
      state: 'active',
      samples,
    },
    now,
  );
const selection = { cursor: 0, includeGit: false, includeAgents: false };
beforeEach(() => {
  local = new ActivityStore(':memory:');
  local.createProject('My project', 'local-project');
  reader = new SyncReader(local);
  platform = new PlatformStore(':memory:');
  platform.ensureProfile({ id: 'alice', name: 'Alice', username: 'alice' });
  waka = new WakaTimeReceiver(platform);
});
afterEach(() => {
  vi.unstubAllGlobals();
  local.close();
  platform.close();
});

describe('durable collector sync', () => {
  it('uploads counted slices instead of restoring paused time', () => {
    local.tracking.pause(true, now - 20_000);
    local.tracking.pause(false, now - 10_000);
    beat([sample('sample-one', -30_000, 0)]);
    const batch = reader.batch('local-project', selection, now);
    const { nextCursor: _cursor, hasMore: _more, ...input } = batch;
    const result = platform.sync('alice', syncSchema.parse(input));
    expect(result.tracking.creditedMs).toBe(20_000);
    expect(batch.samples).toHaveLength(2);
    expect(new Set(batch.samples.map((item) => item.id)).size).toBe(2);
    expect(JSON.stringify(batch)).not.toContain('private-branch');
    expect(
      reader.batch('local-project', { ...selection, cursor: batch.nextCursor }, now).samples,
    ).toHaveLength(0);
  });
  it('retains monotonic cursors across project deletion and replacement', () => {
    beat([sample('sample-one', -30_000, -15_000)]);
    const first = reader.batch('local-project', selection, now);
    local.deleteProject('local-project');
    local.createProject('Replacement', 'local-project');
    beat([sample('sample-two', -15_000, 0)]);
    const second = reader.batch('local-project', { ...selection, cursor: first.nextCursor }, now);
    expect(second.nextCursor).toBeGreaterThan(first.nextCursor);
    expect(second.samples).toHaveLength(1);
  });
  it('filters text and agent metadata independently from Git consent', () => {
    local.ingest([
      {
        schemaVersion: 1,
        id: 'event-one',
        projectId: 'local-project',
        occurredAt: new Date(now).toISOString(),
        source: 'claude-code',
        actor: 'tool',
        kind: 'tool_call',
        metadata: { toolName: 'Bash', excerpt: 'private transcript' },
        evidence: { fileName: 'private-log.jsonl', line: 1, block: 0 },
      },
    ]);
    expect(reader.batch('local-project', selection, now).events).toHaveLength(0);
    const allowed = reader.batch('local-project', { ...selection, includeAgents: true }, now);
    expect(allowed.events).toHaveLength(1);
    expect(JSON.stringify(allowed)).not.toContain('private');
  });
  it('seeds existing activity once when upgrading an older collector', () => {
    beat([sample('sample-one', -30_000, -15_000)]);
    new SyncReader(local);
    new SyncReader(local);
    expect(reader.batch('local-project', selection, now).samples).toHaveLength(1);
  });
  it('keeps a cursor unchanged on network failure and retries an acknowledged batch safely', async () => {
    beat([sample('sample-one', -30_000, -15_000)]);
    let offline = true;
    const connection: SyncConnection = {
      origin: 'https://trail.example.org',
      deviceId: 'device-one',
      accountId: 'alice',
      handle: 'alice',
      projectId: 'local-project',
      includeGit: false,
      includeAgents: false,
      cursor: 0,
    };
    const batch = reader.batch('local-project', selection, now);
    const client = { request: async () => batch } as unknown as LocalClient;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        if (offline) throw new Error('offline');
        return Response.json(
          platform.sync('alice', syncSchema.parse(JSON.parse(String(options.body)))),
        );
      }),
    );
    await expect(syncBatch(client, connection, 'test-token')).rejects.toThrow('offline');
    expect(connection.cursor).toBe(0);
    offline = false;
    const first = await syncBatch(client, connection, 'test-token');
    await syncBatch(client, connection, 'test-token');
    expect(first.connection.cursor).toBe(batch.nextCursor);
    expect(dashboard(platform, 'alice').totalMs).toBe(15_000);
  });
  it('rejects credentials in URLs, insecure remote hosts, and endpoint paths', () => {
    expect(platformOrigin('http://127.0.0.1:47657')).toBe('http://127.0.0.1:47657');
    for (const value of [
      'http://remote.example',
      'https://user:secret@example.org',
      'https://example.org/path',
      'https://example.org?token=secret',
    ])
      expect(() => platformOrigin(value)).toThrow();
  });
});

describe('WakaTime-compatible heartbeat estimates', () => {
  function point(offset: number, project = 'Website', extra: Record<string, unknown> = {}) {
    return waka.receive(
      'alice',
      'credential-one',
      {
        time: (now + offset) / 1000,
        project,
        type: 'file',
        entity: '/private/source.ts',
        language: 'TypeScript',
        editor: 'VS Code',
        ...extra,
      },
      {},
      now,
    );
  }
  it('counts only bounded intervals between heartbeats, never an open timer', () => {
    point(-120_000);
    expect(dashboard(platform, 'alice').totalMs).toBe(0);
    point(-60_000);
    expect(dashboard(platform, 'alice').totalMs).toBe(60_000);
    point(0);
    expect(dashboard(platform, 'alice').totalMs).toBe(120_000);
    expect(dashboard(platform, 'alice').signals).toEqual([{ name: 'heartbeat', totalMs: 120_000 }]);
  });
  it('does not bridge an idle gap longer than two minutes', () => {
    point(-180_000);
    point(-30_000);
    point(0);
    expect(dashboard(platform, 'alice').totalMs).toBe(30_000);
  });
  it('deduplicates repeated heartbeats and discards source paths and extra fields', () => {
    const first = point(-30_000, 'Website', {
      branch: 'private-branch',
      dependencies: 'private-package',
    });
    expect(point(-30_000).id).toBe(first.id);
    point(0);
    expect(dashboard(platform, 'alice').totalMs).toBe(30_000);
    expect(
      JSON.stringify(platform.database.prepare('SELECT * FROM waka_points').all()),
    ).not.toContain('private');
  });
  it('reassigns an out-of-order project switch without increasing total time', () => {
    point(-120_000, 'First');
    point(0, 'First');
    point(-60_000, 'Second');
    const stats = dashboard(platform, 'alice');
    expect(stats.totalMs).toBe(120_000);
    expect(stats.projects.find((project) => project.name === 'First')!.totalMs).toBe(60_000);
    expect(stats.projects.find((project) => project.name === 'Second')!.totalMs).toBe(60_000);
  });
  it('fills gaps from out-of-order batches while preserving pause exclusions', () => {
    platform.user('alice').tracking.pause(true, now - 80_000);
    platform.user('alice').tracking.pause(false, now - 40_000);
    point(-180_000);
    point(0);
    point(-90_000);
    expect(dashboard(platform, 'alice').totalMs).toBe(140_000);
  });
  it('preserves native samples when rebuilding overlapping heartbeat estimates', () => {
    point(-60_000);
    point(0);
    const native = platform.sync(
      'alice',
      syncSchema.parse({
        project: { localId: 'native-project', name: 'Native' },
        clientId: 'native-editor',
        label: 'Editor',
        state: 'idle',
        samples: [{ ...sample('native-sample', -30_000, 0), projectId: 'native-project' }],
        events: [],
      }),
    );
    expect(native.tracking.creditedMs).toBe(0);
    point(-15_000, 'Another');
    const stats = dashboard(platform, 'alice');
    expect(stats.totalMs).toBe(60_000);
    expect(stats.projects.find((project) => project.name === 'Native')!.totalMs).toBe(30_000);
  });
  it('keeps devices separate and never counts their overlaps twice', () => {
    point(-30_000);
    point(0, 'Website', { machine: 'other-machine' });
    expect(dashboard(platform, 'alice').totalMs).toBe(0);
    point(0);
    point(-30_000, 'Website', { machine: 'other-machine' });
    expect(dashboard(platform, 'alice').totalMs).toBe(30_000);
  });
  it('does not classify explicitly reported AI coding as editor activity', () => {
    point(-30_000, 'Website', { category: 'ai coding' });
    point(0, 'Website', { category: 'ai coding' });
    expect(dashboard(platform, 'alice').totalMs).toBe(0);
  });
  it('rejects stale and future heartbeats without creating projects', () => {
    expect(() => point(20_000)).toThrow('future');
    expect(() => point(-8 * 86400_000)).toThrow('seven days');
    expect(platform.projects('alice')).toHaveLength(0);
  });
});

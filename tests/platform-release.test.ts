import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ActivityStore } from '../src/server/store.js';
import { PlatformStore } from '../src/platform/store.js';
import { createAuthentication } from '../src/platform/auth.js';
import { createPlatform } from '../src/platform/app.js';
import { syncBatch, type SyncConnection } from '../extensions/vscode/src/platform-client.js';
import { LocalClient } from '../src/shared/local-client.js';
import { SyncReader } from '../src/server/sync-reader.js';
import { vi } from 'vitest';

const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.unstubAllGlobals();
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'hacktrail-release-'));
  directories.push(path);
  return path;
}

describe('release boundaries', () => {
  it('migrates a legacy single-user database without losing projects or pause state', () => {
    const path = join(directory(), 'legacy.sqlite');
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_example INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL); CREATE TABLE tracking_pauses (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, end INTEGER); INSERT INTO projects VALUES ('old-project', 'Existing work', 0, '2026-11-20T00:00:00Z'); INSERT INTO tracking_pauses (start) VALUES (1000);",
    );
    db.close();
    const local = new ActivityStore(path);
    expect(local.getProject('old-project').name).toBe('Existing work');
    expect(local.tracking.paused()).toBe(true);
    expect(local.forScope('another-account').listProjects()).toEqual([]);
    expect(local.forScope('another-account').tracking.paused()).toBe(false);
    local.close();
  });
  it('retains sessions and account records across a full server restart', async () => {
    const path = directory();
    const origin = 'http://localhost:47657';
    const secret = 'persistent-test-secret-with-at-least-32-characters';
    let store = new PlatformStore(join(path, 'activity.sqlite'));
    let auth = await createAuthentication({
      databasePath: join(path, 'auth.sqlite'),
      origin,
      secret,
      onDeleteAccount: (id) => store.deleteAccount(id),
    });
    let app = createPlatform({ store, authentication: auth, origin });
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { host: 'localhost:47657', origin },
      payload: {
        name: 'Restart',
        username: 'restart',
        email: 'restart@example.test',
        password: 'a long restart test password',
      },
    });
    expect(signup.statusCode).toBe(200);
    const headers = {
      host: 'localhost:47657',
      origin,
      cookie: signup.cookies.map((item) => item.name + '=' + item.value).join('; '),
    };
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { name: 'Survives restart' },
    });
    expect(project.statusCode).toBe(201);
    await app.close();
    auth.close();
    store.close();
    store = new PlatformStore(join(path, 'activity.sqlite'));
    auth = await createAuthentication({
      databasePath: join(path, 'auth.sqlite'),
      origin,
      secret,
      onDeleteAccount: (id) => store.deleteAccount(id),
    });
    app = createPlatform({ store, authentication: auth, origin });
    expect((await app.inject({ url: '/api/projects', headers })).json()).toMatchObject([
      { name: 'Survives restart' },
    ]);
    await app.close();
    auth.close();
    store.close();
  });
  it('replays the exact persisted batch after a lost response and a consent change', async () => {
    const local = new ActivityStore(':memory:');
    local.createProject('Project', 'project-local');
    const reader = new SyncReader(local);
    const now = Date.now();
    local.tracking.heartbeat({
      clientId: 'local-editor',
      projectId: 'project-local',
      label: 'Editor',
      state: 'active',
      samples: [
        {
          id: 'sample-one',
          projectId: 'project-local',
          startedAt: new Date(now - 15000).toISOString(),
          endedAt: new Date(now).toISOString(),
          signal: 'keyboard',
          git: { repositoryId: 'a'.repeat(64), commit: 'b'.repeat(40) },
        },
      ],
    });
    const remote = new PlatformStore(':memory:');
    remote.ensureProfile({ id: 'alice', name: 'Alice', username: 'alice' });
    const client = {
      request: async () =>
        reader.batch('project-local', { cursor: 0, includeGit: true, includeAgents: false }),
    } as unknown as LocalClient;
    let saved: SyncConnection = {
      origin: 'https://trail.example.org',
      deviceId: 'device-one',
      accountId: 'alice',
      handle: 'alice',
      projectId: 'project-local',
      includeGit: true,
      includeAgents: false,
      cursor: 0,
    };
    let loseResponse = true;
    vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
      const result = remote.sync('alice', JSON.parse(String(options.body)));
      if (loseResponse) throw new Error('response lost');
      return Response.json(result);
    });
    await expect(
      syncBatch(client, saved, 'token', async (value) => {
        saved = value;
      }),
    ).rejects.toThrow('response lost');
    expect(saved.pending?.samples[0]?.git).toBeDefined();
    loseResponse = false;
    const result = await syncBatch(client, { ...saved, includeGit: false }, 'token');
    expect(result.connection.pending).toBeUndefined();
    expect(result.connection.cursor).toBeGreaterThan(0);
    expect(remote.user('alice').tracking.export(result.connection.remoteProjectId!).totalMs).toBe(
      15000,
    );
    local.close();
    remote.close();
  });
});

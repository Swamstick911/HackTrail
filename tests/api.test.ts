import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { ActivityStore } from '../src/server/store.js';
import { activity, transcript } from './fixtures.js';

describe('local collector API', () => {
  let store: ActivityStore;
  let app: ReturnType<typeof createApp>;
  const headers = { host: '127.0.0.1:47654', authorization: 'Bearer test-token' };
  beforeEach(() => {
    store = new ActivityStore(':memory:');
    store.createProject('Project', 'project-one');
    app = createApp({ store, token: 'test-token', port: 47654 });
  });
  afterEach(async () => { await app.close(); store.close(); });

  it('requires authentication for project data and mutations', async () => {
    const response = await app.inject({ url: '/api/projects', headers: { host: headers.host } });
    expect(response.statusCode).toBe(401);
  });

  it('blocks hostile origins and hosts, including token bootstrap requests', async () => {
    for (const requestHeaders of [
      { ...headers, origin: 'https://attacker.example' },
      { ...headers, host: 'attacker.example:47654' },
      { ...headers, 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await app.inject({ url: '/api/session', headers: requestHeaders });
      expect(response.statusCode).toBe(403);
    }
  });

  it('rejects unsupported event fields and accepts valid event batches', async () => {
    const invalid = await app.inject({ method: 'POST', url: '/api/events', headers, payload: { events: [{ ...activity(), prompt: 'secret' }] } });
    expect(invalid.statusCode).toBe(400);
    const valid = await app.inject({ method: 'POST', url: '/api/events', headers, payload: { events: [activity()] } });
    expect(valid.json()).toEqual({ inserted: 1, duplicates: 0 });
  });

  it('previews imports without persisting and commits them idempotently', async () => {
    const payload = { projectId: 'project-one', fileName: 'session.jsonl', text: transcript() };
    const preview = await app.inject({ method: 'POST', url: '/api/imports/preview', headers, payload });
    expect(preview.json().eventCount).toBe(4);
    expect(store.summary('project-one').total).toBe(0);
    const first = await app.inject({ method: 'POST', url: '/api/imports/claude', headers, payload });
    expect(first.json().inserted).toBe(4);
    const second = await app.inject({ method: 'POST', url: '/api/imports/claude', headers, payload });
    expect(second.json().duplicates).toBe(4);
  });

  it('exports the selected project and deletes its data', async () => {
    store.ingest([activity()]);
    const exported = await app.inject({ url: '/api/projects/project-one/export', headers });
    expect(exported.json().events).toHaveLength(1);
    expect(exported.headers['content-disposition']).toContain('attachment');
    const deleted = await app.inject({ method: 'DELETE', url: '/api/projects/project-one', headers });
    expect(deleted.statusCode).toBe(204);
    expect(store.listProjects()).toHaveLength(0);
  });

  it('keeps synthetic example data labeled and repeatable', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/example', headers });
    const second = await app.inject({ method: 'POST', url: '/api/example', headers });
    expect(first.json().project.isExample).toBe(true);
    expect(first.json().inserted).toBe(15);
    expect(second.json().duplicates).toBe(15);
  });
});

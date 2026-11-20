import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityStore } from '../src/server/store.js';
import { activity } from './fixtures.js';

describe('activity storage', () => {
  let directory: string;
  let store: ActivityStore;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'hacktrail-test-'));
    store = new ActivityStore(join(directory, 'events.sqlite'));
    store.createProject('Test project', 'project-one');
  });
  afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });

  it('persists events and treats identical replays as duplicates', () => {
    expect(store.ingest([activity()])).toEqual({ inserted: 1, duplicates: 0 });
    store.close();
    store = new ActivityStore(join(directory, 'events.sqlite'));
    expect(store.ingest([activity()])).toEqual({ inserted: 0, duplicates: 1 });
    expect(store.summary('project-one').total).toBe(1);
  });

  it('rolls back a whole batch if an existing ID has different contents', () => {
    store.ingest([activity()]);
    expect(() => store.ingest([
      activity({ id: 'event-two' }),
      activity({ actor: 'agent' }),
    ])).toThrow('different contents');
    expect(store.summary('project-one').total).toBe(1);
  });

  it('paginates identical timestamps without skipping or duplicating records', () => {
    store.ingest(Array.from({ length: 5 }, (_, index) => activity({ id: 'event-' + index })));
    const first = store.timeline('project-one', { limit: 2 });
    const second = store.timeline('project-one', { limit: 2, cursor: first.nextCursor! });
    const third = store.timeline('project-one', { limit: 2, cursor: second.nextCursor! });
    expect(new Set([...first.events, ...second.events, ...third.events].map(event => event.id)).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it('keeps project data separate and deletes its events with the project', () => {
    store.createProject('Other project', 'project-two');
    store.ingest([activity(), activity({ id: 'other-event', projectId: 'project-two' })]);
    store.deleteProject('project-one');
    expect(store.summary('project-two').total).toBe(1);
    expect(() => store.timeline('project-one', { limit: 10 })).toThrow('not found');
  });

  it('escapes search wildcard characters', () => {
    store.ingest([activity({ metadata: { excerpt: '100% complete' } }), activity({ id: 'event-two' })]);
    expect(store.timeline('project-one', { search: '%', limit: 10 }).total).toBe(1);
  });

  it('does not convert event spans into human time', () => {
    store.ingest([
      activity({ actor: 'agent', kind: 'tool_call' }),
      activity({ id: 'event-later', actor: 'agent', kind: 'tool_call', occurredAt: '2026-11-20T10:00:00Z' }),
    ]);
    expect(store.summary('project-one')).toMatchObject({ total: 2, agentEvents: 2, userMessages: 0 });
    expect(store.summary('project-one')).not.toHaveProperty('creditedSeconds');
  });
});

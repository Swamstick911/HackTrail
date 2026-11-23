import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PlatformStore } from '../src/platform/store.js';
import { projectDetailsSchema, syncSchema } from '../src/platform/contracts.js';
import { DeviceAuthorization, challengeFor } from '../src/platform/devices.js';
import { dashboard, dayStart } from '../src/platform/analytics.js';
import { createReport, previewReport, sharedReport } from '../src/platform/reports.js';
import { reviewActivity } from '../src/shared/review.js';
import type { ActivityEvent } from '../src/shared/events.js';

let store: PlatformStore;
const now = Date.now();
const instant = (offset: number) => new Date(now + offset).toISOString();
function sync(localId = 'local-project', offset = 0) {
  return syncSchema.parse({
    project: { localId, name: 'A private project' },
    clientId: 'local-collector',
    label: 'VS Code',
    state: 'active',
    samples: [
      {
        id: 'sample-' + localId,
        projectId: localId,
        startedAt: instant(-30_000 + offset),
        endedAt: instant(-15_000 + offset),
        signal: 'keyboard',
        language: 'typescript',
        editor: 'VS Code',
      },
    ],
    events: [],
  });
}
function event(
  id: string,
  projectId: string,
  offset: number,
  kind: ActivityEvent['kind'] = 'agent_started',
): ActivityEvent {
  return {
    schemaVersion: 1,
    id,
    projectId,
    occurredAt: instant(offset),
    source: 'claude-code',
    actor: 'agent',
    kind,
    metadata: { sessionId: 'session-shared', hook: 'Stop', excerpt: 'private transcript' },
    evidence: { fileName: 'private-log.jsonl', line: 1, block: 0 },
  };
}
beforeEach(() => {
  store = new PlatformStore(':memory:');
  store.ensureProfile({ id: 'alice', name: 'Alice', username: 'alice' });
  store.ensureProfile({ id: 'bob', name: 'Bob', username: 'bob' });
});
afterEach(() => store.close());

describe('account ledgers', () => {
  it('keeps simultaneous users independent, even with identical device IDs', () => {
    const input = sync();
    const a = store.sync('alice', input);
    const b = store.sync('bob', input);
    expect(a.tracking.creditedMs).toBe(15_000);
    expect(b.tracking.creditedMs).toBe(15_000);
    expect(a.projectId).not.toBe(b.projectId);
    expect(store.projects('alice').map((p) => p.id)).toEqual([a.projectId]);
    expect(() => store.project('bob', a.projectId)).toThrow('not found');
  });
  it('deduplicates overlapping projects within an account', () => {
    store.sync('alice', sync('project-one'));
    expect(store.sync('alice', sync('project-two', 5000)).tracking.creditedMs).toBe(5000);
  });
  it('isolates pauses while rejecting late uploads inside a pause', () => {
    store.user('alice').tracking.pause(true, now - 25_000);
    store.user('alice').tracking.pause(false, now - 20_000);
    expect(store.sync('alice', sync()).tracking.creditedMs).toBe(10_000);
    expect(store.sync('bob', sync()).tracking.creditedMs).toBe(15_000);
  });
  it('retries a sync without duplicating projects or time', () => {
    const first = store.sync('alice', sync());
    const second = store.sync('alice', sync());
    expect(second.projectId).toBe(first.projectId);
    expect(second.tracking).toMatchObject({ inserted: 0, duplicates: 1, creditedMs: 0 });
    expect(store.projects('alice')).toHaveLength(1);
  });
  it('rolls back an entire sync, including new project creation, on invalid time', () => {
    const input = sync();
    input.samples[0]!.endedAt = instant(30_000);
    expect(() => store.sync('alice', input)).toThrow();
    expect(store.projects('alice')).toHaveLength(0);
    expect(store.database.prepare('SELECT COUNT(*) AS n FROM sync_links').get()).toMatchObject({
      n: 0,
    });
  });
  it('rolls back valid time when the event batch conflicts', () => {
    const input = sync();
    input.events = [event('event-one', input.project.localId, -10_000)];
    const first = store.sync('alice', input);
    const next = sync('local-project', -15_000);
    next.samples[0]!.id = 'sample-new';
    next.events = [{ ...input.events[0]!, metadata: { sessionId: 'different-session' } }];
    expect(() => store.sync('alice', next)).toThrow('different contents');
    expect(store.user('alice').tracking.export(first.projectId).samples).toHaveLength(1);
  });
  it('does not resurrect a deleted project on the next upload', () => {
    const result = store.sync('alice', sync());
    store.deleteProject('alice', result.projectId);
    expect(() => store.sync('alice', sync())).toThrow('deleted');
    expect(store.projects('alice')).toHaveLength(0);
  });
  it('rejects cross-project events before creating anything', () => {
    const input = sync();
    input.events = [event('event-one', 'another-project', -10_000)];
    expect(() => store.sync('alice', input)).toThrow('selected local project');
    expect(store.projects('alice')).toHaveLength(0);
  });
  it('never syncs conversation excerpts, source filenames, or local notes', () => {
    const input = sync();
    input.events = [
      event('event-one', input.project.localId, -10_000),
      {
        ...event('event-note', input.project.localId, -5000, 'work_note'),
        source: 'manual',
        actor: 'user',
      },
    ];
    const result = store.sync('alice', input);
    const timeline = store.user('alice').timeline(result.projectId, { limit: 60 });
    expect(timeline.events).toHaveLength(1);
    expect(JSON.stringify(timeline)).not.toContain('private');
    expect(timeline.events[0]!.metadata.sessionId).toBe('session-shared');
  });
  it('cannot read, modify, or delete another account through a scoped store', () => {
    const { projectId } = store.sync('alice', sync());
    const bob = store.user('bob');
    expect(() => bob.deleteProject(projectId)).toThrow('not found');
    expect(() => bob.timeline(projectId, { limit: 10 })).toThrow('not found');
    expect(() => bob.ingest([event('event-one', projectId, -1000)])).toThrow('not found');
    expect(bob.tracking.export(projectId).samples).toHaveLength(0);
    expect(bob.tracking.report(projectId, now - 60_000, now).slices).toHaveLength(0);
  });
  it('deletes an account and all its credentials, reports, and activity', () => {
    const { projectId } = store.sync('alice', sync());
    const key = store.createKey('alice', 'Editor', ['write:activity']);
    const report = createReport(
      store,
      'alice',
      projectId,
      { range: { from: instant(-60_000), to: instant(0) }, includeGit: false, includeNotes: false },
      1,
    );
    store.sync('bob', sync());
    store.deleteAccount('alice');
    expect(() => store.key(key.token, 'write:activity')).toThrow('revoked');
    expect(() => sharedReport(store, report.token)).toThrow('unavailable');
    expect(store.projects('alice')).toHaveLength(0);
    expect(store.projects('bob')).toHaveLength(1);
  });
});

describe('credentials and device connections', () => {
  it('stores only a key hash, enforces its scope, and revokes immediately', () => {
    const key = store.createKey('alice', 'Editor', ['write:activity']);
    expect(JSON.stringify(store.database.prepare('SELECT * FROM credentials').all())).not.toContain(
      key.token,
    );
    expect(store.key(key.token, 'write:activity')).toBe('alice');
    expect(() => store.key(key.token, 'read:stats')).toThrow('permission');
    expect(store.listKeys('bob')).toHaveLength(0);
    store.revokeKey('bob', key.id);
    expect(store.key(key.token, 'write:activity')).toBe('alice');
    store.revokeKey('alice', key.id);
    expect(() => store.key(key.token, 'write:activity')).toThrow('revoked');
  });
  it('requires approval and the original verifier, then consumes the device code', () => {
    const devices = new DeviceAuthorization(store);
    const verifier = randomBytes(32).toString('base64url');
    const start = devices.start('VS Code', challengeFor(verifier), now);
    expect(devices.poll(start.deviceCode, verifier, now)).toEqual({ status: 'pending' });
    expect(() => devices.poll(start.deviceCode, 'wrong', now + 5000)).toThrow('verifier');
    devices.approve('alice', start.userCode, now + 5000);
    const result = devices.poll(start.deviceCode, verifier, now + 5000);
    expect(result.status).toBe('approved');
    if (result.status === 'approved')
      expect(store.key(result.token, 'write:activity')).toBe('alice');
    expect(() => devices.poll(start.deviceCode, verifier, now + 10_000)).toThrow('already used');
  });
  it('expires unapproved connections and limits polling frequency', () => {
    const devices = new DeviceAuthorization(store);
    const verifier = randomBytes(32).toString('base64url');
    const start = devices.start('VS Code', challengeFor(verifier), now);
    devices.poll(start.deviceCode, verifier, now);
    expect(() => devices.poll(start.deviceCode, verifier, now + 1000)).toThrow('five seconds');
    expect(() => devices.approve('alice', start.userCode, now + 600_000)).toThrow('expired');
    expect(() => devices.poll(start.deviceCode, verifier, now + 600_000)).toThrow('expired');
  });
  it('cannot switch an approved connection to a different account', () => {
    const devices = new DeviceAuthorization(store);
    const start = devices.start('VS Code', challengeFor('verifier'), now);
    devices.approve('alice', start.userCode, now);
    expect(() => devices.approve('bob', start.userCode, now)).toThrow('already');
  });
});

describe('published statistics and evidence', () => {
  it('excludes private projects from all public totals and breakdowns', () => {
    const { projectId } = store.sync('alice', sync());
    expect(dashboard(store, 'alice', 7).totalMs).toBe(15_000);
    const hidden = dashboard(store, 'alice', 7, { publicOnly: true });
    expect(hidden.totalMs).toBe(0);
    expect(hidden.projects).toHaveLength(0);
    expect(hidden.languages).toHaveLength(0);
    store.updateProject(
      'alice',
      projectId,
      projectDetailsSchema.parse({ name: 'Published', visibility: 'public' }),
    );
    expect(dashboard(store, 'alice', 7, { publicOnly: true }).totalMs).toBe(15_000);
  });
  it('uses actual local midnight across daylight saving and fractional offsets', () => {
    expect(new Date(dayStart('2026-03-08', 'America/New_York')).toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(new Date(dayStart('2026-03-09', 'America/New_York')).toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
    expect(new Date(dayStart('2026-11-23', 'Asia/Kolkata')).toISOString()).toBe(
      '2026-11-22T18:30:00.000Z',
    );
  });
  it('does not pair agent sessions belonging to different projects', () => {
    const events = [
      event('start-one', 'project-one', -30_000),
      event('stop-two', 'project-two', -15_000, 'agent_stopped'),
    ];
    expect(reviewActivity(events)).toMatchObject({ agentMs: 0, incompleteRuns: 2 });
  });
  it('previews explicit note disclosure and never exposes imported excerpts', () => {
    const { projectId } = store.sync('alice', sync());
    store
      .user('alice')
      .ingest([
        event('event-agent', projectId, -10_000),
        {
          ...event('note-one', projectId, -5000, 'work_note'),
          source: 'manual',
          actor: 'user',
          metadata: { excerpt: 'My explanation' },
        },
      ]);
    const options = {
      range: { from: instant(-60_000), to: instant(0) },
      includeGit: false,
      includeNotes: false,
    };
    const first = previewReport(store, 'alice', projectId, options);
    expect(JSON.stringify(first)).not.toContain('My explanation');
    expect(JSON.stringify(first)).not.toContain('private transcript');
    expect(JSON.stringify(first)).not.toContain('private-log');
    const second = previewReport(store, 'alice', projectId, { ...options, includeNotes: true });
    expect(JSON.stringify(second)).toContain('My explanation');
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(previewReport(store, 'alice', projectId, options).fingerprint).toBe(first.fingerprint);
  });
  it('shares an immutable snapshot that expires, can be revoked, and checks ownership', () => {
    const { projectId } = store.sync('alice', sync());
    const options = {
      range: { from: instant(-60_000), to: instant(0) },
      includeGit: false,
      includeNotes: false,
    };
    expect(() => previewReport(store, 'bob', projectId, options)).toThrow('not found');
    const report = createReport(store, 'alice', projectId, options, 1);
    store.updateProject('alice', projectId, projectDetailsSchema.parse({ name: 'Renamed' }));
    expect(sharedReport(store, report.token).project.name).toBe('A private project');
    expect(() => sharedReport(store, report.token, Date.parse(report.expiresAt))).toThrow(
      'expired',
    );
    store.database.prepare('DELETE FROM shared_reports WHERE id = ?').run(report.id);
    expect(() => sharedReport(store, report.token)).toThrow('revoked');
  });
});

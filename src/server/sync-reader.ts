import { createHash } from 'node:crypto';
import type { ActivityStore } from './store.js';
import type { ActivityEvent } from '../shared/events.js';
import type { TimeSample } from '../shared/tracking.js';
import { trackingPolicy } from '../shared/tracking.js';

export interface SyncSelection {
  cursor: number;
  includeGit: boolean;
  includeAgents: boolean;
}
export class SyncReader {
  constructor(private store: ActivityStore) {
    store.database.exec(`
      CREATE TABLE IF NOT EXISTS sync_records (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        record_id TEXT NOT NULL,
        UNIQUE(kind, record_id)
      );
      CREATE INDEX IF NOT EXISTS sync_records_project ON sync_records(project_id, sequence);
      CREATE TRIGGER IF NOT EXISTS sync_time_insert AFTER INSERT ON time_slices BEGIN
        INSERT INTO sync_records(project_id, kind, record_id) VALUES (NEW.project_id, 'time', CAST(NEW.id AS TEXT));
      END;
      CREATE TRIGGER IF NOT EXISTS sync_event_insert AFTER INSERT ON events BEGIN
        INSERT INTO sync_records(project_id, kind, record_id) VALUES (NEW.project_id, 'event', NEW.id);
      END;
      INSERT OR IGNORE INTO sync_records(project_id, kind, record_id) SELECT project_id, 'time', CAST(id AS TEXT) FROM time_slices;
      INSERT OR IGNORE INTO sync_records(project_id, kind, record_id) SELECT project_id, 'event', id FROM events;
    `);
  }

  batch(projectId: string, selection: SyncSelection, now = Date.now()) {
    const project = this.store.getProject(projectId);
    const rows = this.store.database
      .prepare(
        'SELECT sequence, kind, record_id FROM sync_records WHERE project_id = ? AND sequence > ? ORDER BY sequence LIMIT 501',
      )
      .all(projectId, selection.cursor) as { sequence: number; kind: string; record_id: string }[];
    const batch = rows.slice(0, 500);
    const samples: TimeSample[] = [];
    const events: ActivityEvent[] = [];
    const earliest = now - trackingPolicy.offlineRetentionMs + 60_000;
    for (const record of batch) {
      if (record.kind === 'time') {
        const row = this.store.database
          .prepare(
            'SELECT s.start, s.end, t.payload FROM time_slices s JOIN time_samples t ON t.id = s.sample_id WHERE s.id = ? AND s.project_id = ?',
          )
          .get(record.record_id, projectId) as
          { start: number; end: number; payload: string } | undefined;
        if (!row || row.start < earliest) continue;
        const original = JSON.parse(row.payload) as TimeSample;
        const { git, ...sample } = original;
        samples.push({
          ...sample,
          id:
            'slice-' +
            createHash('sha256')
              .update(original.id + ':' + row.start + ':' + row.end)
              .digest('hex'),
          originSampleId: original.id,
          startedAt: new Date(row.start).toISOString(),
          endedAt: new Date(row.end).toISOString(),
          ...(selection.includeGit && git ? { git } : {}),
        });
      } else {
        const row = this.store.database
          .prepare('SELECT payload FROM events WHERE id = ? AND project_id = ?')
          .get(record.record_id, projectId) as { payload: string } | undefined;
        if (!row) continue;
        const event = JSON.parse(row.payload) as ActivityEvent;
        if (Date.parse(event.occurredAt) < earliest || event.kind === 'work_note') continue;
        if (event.source === 'git' ? !selection.includeGit : !selection.includeAgents) continue;
        if (!['git', 'claude-code', 'codex'].includes(event.source)) continue;
        const { excerpt: _excerpt, git, ...metadata } = event.metadata;
        events.push({
          schemaVersion: 1,
          id: event.id,
          projectId,
          occurredAt: event.occurredAt,
          source: event.source,
          actor: event.actor,
          kind: event.kind,
          metadata: { ...metadata, ...(selection.includeGit && git ? { git } : {}) },
        });
      }
    }
    const clients = this.store.tracking.report(projectId, now, now).clients;
    const state = this.store.tracking.paused()
      ? 'paused'
      : clients.some((client) => client.state === 'active')
        ? 'active'
        : 'idle';
    return {
      project: { localId: projectId, name: project.name },
      clientId: 'sync-' + projectId,
      label: 'HackTrail collector',
      state,
      samples,
      events,
      nextCursor: batch.at(-1)?.sequence ?? selection.cursor,
      hasMore: rows.length > 500,
    };
  }
}
export type SyncBatch = ReturnType<SyncReader['batch']>;

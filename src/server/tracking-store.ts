import type { Database } from './database.js';
import {
  heartbeatSchema,
  trackingPolicy,
  type Heartbeat,
  type TrackingClient,
  type TrackingReport,
  type TimeSlice,
  type TimeSample,
} from '../shared/tracking.js';
import { StoreError } from './store.js';

interface Range {
  start: number;
  end: number;
}

export function subtractRanges(range: Range, exclusions: Range[]): Range[] {
  let remaining = [range];
  for (const excluded of exclusions) {
    remaining = remaining.flatMap((item) => {
      if (excluded.end <= item.start || excluded.start >= item.end) return [item];
      const pieces: Range[] = [];
      if (excluded.start > item.start) pieces.push({ start: item.start, end: excluded.start });
      if (excluded.end < item.end) pieces.push({ start: excluded.end, end: item.end });
      return pieces;
    });
  }
  return remaining;
}

export class TrackingStore {
  constructor(private database: Database) {
    database.exec(
      [
        'CREATE TABLE IF NOT EXISTS time_samples (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, client_id TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL);',
        'CREATE TABLE IF NOT EXISTS time_slices (id INTEGER PRIMARY KEY, sample_id TEXT NOT NULL REFERENCES time_samples(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, start INTEGER NOT NULL, end INTEGER NOT NULL);',
        'CREATE INDEX IF NOT EXISTS time_slices_range ON time_slices(start, end);',
        'CREATE INDEX IF NOT EXISTS time_slices_project ON time_slices(project_id, start);',
        'CREATE TABLE IF NOT EXISTS tracking_pauses (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, end INTEGER);',
        'CREATE TABLE IF NOT EXISTS tracking_clients (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, label TEXT NOT NULL, state TEXT NOT NULL, last_seen_at TEXT NOT NULL);',
      ].join('\n'),
    );
  }

  paused() {
    return Boolean(this.database.prepare('SELECT id FROM tracking_pauses WHERE end IS NULL').get());
  }

  pause(paused: boolean, now = Date.now()) {
    if (paused && !this.paused())
      this.database.prepare('INSERT INTO tracking_pauses (start) VALUES (?)').run(now);
    if (!paused)
      this.database.prepare('UPDATE tracking_pauses SET end = ? WHERE end IS NULL').run(now);
    return { paused: this.paused() };
  }

  heartbeat(input: Heartbeat, now = Date.now()) {
    const heartbeat = heartbeatSchema.parse(input);
    const timestamp = new Date(now).toISOString();
    const existing = this.database.prepare(
      'SELECT payload, client_id FROM time_samples WHERE id = ?',
    );
    const project = this.database.prepare('SELECT is_example FROM projects WHERE id = ?');
    return this.database.transaction(() => {
      const selected = project.get(heartbeat.projectId) as { is_example: number } | undefined;
      if (!selected) throw new StoreError('Project not found.', 404);
      if (selected.is_example)
        throw new StoreError('Connect a real project to track your work.', 400);
      let inserted = 0;
      let duplicates = 0;
      let creditedMs = 0;
      for (const sample of heartbeat.samples) {
        if (sample.projectId !== heartbeat.projectId)
          throw new StoreError('All samples must belong to the connected project.', 400);
        const payload = JSON.stringify(sample);
        const previous = existing.get(sample.id) as
          { payload: string; client_id: string } | undefined;
        if (previous) {
          if (previous.payload !== payload || previous.client_id !== heartbeat.clientId)
            throw new StoreError('This time sample ID already has different contents.', 409);
          duplicates++;
          continue;
        }
        const range = { start: Date.parse(sample.startedAt), end: Date.parse(sample.endedAt) };
        if (range.end > now + 5000 || range.start < now - trackingPolicy.offlineRetentionMs) {
          throw new StoreError(
            'Samples must be from the last seven days and cannot be in the future.',
            400,
          );
        }
        const overlaps = this.database
          .prepare('SELECT start, end FROM time_slices WHERE start < ? AND end > ?')
          .all(range.end, range.start) as unknown as Range[];
        const pauses = this.database
          .prepare(
            'SELECT start, COALESCE(end, ?) AS end FROM tracking_pauses WHERE start < ? AND (end IS NULL OR end > ?)',
          )
          .all(Math.max(now, range.end), range.end, range.start) as unknown as Range[];
        const slices = subtractRanges(range, [...overlaps, ...pauses]);
        this.database
          .prepare(
            'INSERT INTO time_samples (id, project_id, client_id, payload, received_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(sample.id, sample.projectId, heartbeat.clientId, payload, timestamp);
        for (const slice of slices) {
          this.database
            .prepare(
              'INSERT INTO time_slices (sample_id, project_id, start, end) VALUES (?, ?, ?, ?)',
            )
            .run(sample.id, sample.projectId, slice.start, slice.end);
          creditedMs += slice.end - slice.start;
        }
        inserted++;
      }
      this.database
        .prepare(
          'INSERT INTO tracking_clients (id, project_id, label, state, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, label = excluded.label, state = excluded.state, last_seen_at = excluded.last_seen_at',
        )
        .run(heartbeat.clientId, heartbeat.projectId, heartbeat.label, heartbeat.state, timestamp);
      return { inserted, duplicates, creditedMs, paused: this.paused() };
    })();
  }

  report(projectId: string, from: number, to: number, now = Date.now()): TrackingReport {
    const rows = this.database
      .prepare(
        'SELECT s.project_id, s.sample_id, s.start, s.end, t.payload FROM time_slices s JOIN time_samples t ON t.id = s.sample_id WHERE s.project_id = ? AND s.start < ? AND s.end > ? ORDER BY s.start',
      )
      .all(projectId, to, from) as {
      project_id: string;
      sample_id: string;
      payload: string;
      start: number;
      end: number;
    }[];
    const slices: TimeSlice[] = rows.map((row) => ({
      projectId: row.project_id,
      sampleId: row.sample_id,
      git: (JSON.parse(row.payload) as TimeSample).git,
      startedAt: new Date(Math.max(from, row.start)).toISOString(),
      endedAt: new Date(Math.min(to, row.end)).toISOString(),
    }));
    const clients = this.database
      .prepare(
        'SELECT id, project_id AS projectId, label, state, last_seen_at AS lastSeenAt FROM tracking_clients WHERE project_id = ? ORDER BY last_seen_at DESC',
      )
      .all(projectId) as unknown as TrackingClient[];
    return {
      policy: trackingPolicy,
      paused: this.paused(),
      totalMs: slices.reduce(
        (sum, slice) => sum + Date.parse(slice.endedAt) - Date.parse(slice.startedAt),
        0,
      ),
      slices,
      clients: clients.map((client) => ({
        ...client,
        state:
          now - Date.parse(client.lastSeenAt) > 45_000
            ? 'disconnected'
            : this.paused()
              ? 'paused'
              : client.state,
      })),
    };
  }

  export(projectId: string) {
    const samples = this.database
      .prepare(
        'SELECT payload, received_at AS receivedAt FROM time_samples WHERE project_id = ? ORDER BY received_at',
      )
      .all(projectId) as { payload: string; receivedAt: string }[];
    return {
      ...this.report(projectId, 0, Date.now() + 5000),
      samples: samples.map((sample) => ({
        ...JSON.parse(sample.payload),
        receivedAt: sample.receivedAt,
      })),
    };
  }
}

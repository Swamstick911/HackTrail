import { z } from 'zod';
import { StoreError } from '../server/store.js';
import { digest, type PlatformStore } from './store.js';
import { trackingPolicy, type TimeSample } from '../shared/tracking.js';

const heartbeat = z.object({
  time: z.number().finite().positive(),
  entity: z.string().max(4096).optional(),
  type: z.enum(['file', 'app', 'domain']).default('file'),
  project: z.string().trim().min(1).max(80).nullish(),
  language: z.string().max(64).nullish(),
  editor: z.string().max(80).nullish(),
  machine: z.string().max(512).optional(),
  category: z.string().max(80).nullish(),
  user_agent: z.string().max(512).optional(),
});
interface Point {
  id: string;
  project_id: string;
  time: number;
  language: string | null;
  editor: string;
  category: string;
}
const idleMs = 120_000;

export class WakaTimeReceiver {
  constructor(private store: PlatformStore) {
    store.database.exec(`
      CREATE TABLE IF NOT EXISTS waka_points (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, device TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, time INTEGER NOT NULL, language TEXT, editor TEXT NOT NULL, category TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS waka_points_device ON waka_points(owner_id, device, time);
      CREATE TABLE IF NOT EXISTS waka_edges (from_id TEXT NOT NULL REFERENCES waka_points(id) ON DELETE CASCADE, to_id TEXT NOT NULL REFERENCES waka_points(id) ON DELETE CASCADE, sample_id TEXT PRIMARY KEY REFERENCES time_samples(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS waka_edges_points ON waka_edges(from_id, to_id);
      CREATE INDEX IF NOT EXISTS time_samples_project_range ON time_samples(project_id, json_extract(payload, '$.startedAt'), json_extract(payload, '$.endedAt'));
    `);
  }

  receive(
    owner: string,
    credential: string,
    input: unknown,
    headers: { machine?: string; userAgent?: string } = {},
    now = Date.now(),
  ) {
    const value = heartbeat.parse(input);
    const time = Math.round(value.time * 1000);
    if (time > now + 5000 || time < now - trackingPolicy.offlineRetentionMs)
      throw new StoreError(
        'Heartbeats must be from the last seven days and cannot be in the future.',
        400,
      );
    const agent = value.user_agent ?? headers.userAgent ?? '';
    const editor =
      value.editor ||
      agent.match(/(?:^|\s)([a-zA-Z0-9._-]+)\/[^\s]+\s+[a-zA-Z0-9._-]+-wakatime\//)?.[1] ||
      'WakaTime plugin';
    const device = digest(
      owner + ':' + credential + ':' + (value.machine ?? headers.machine ?? 'default'),
    );
    const id = digest(device + ':' + time);
    return this.store.database.transaction(() => {
      const previous = this.store.database
        .prepare('SELECT * FROM waka_points WHERE id = ?')
        .get(id) as unknown as Point | undefined;
      if (previous) return { id, time: time / 1000 };
      const project = this.store.linkedProject(
        owner,
        'waka-' + digest(value.project ?? 'Unknown project'),
        value.project ?? 'Unknown project',
      );
      const point: Point = {
        id,
        project_id: project.id,
        time,
        language: value.language ?? null,
        editor,
        category: value.category ?? 'coding',
      };
      const before = this.store.database
        .prepare(
          'SELECT * FROM waka_points WHERE owner_id = ? AND device = ? AND time < ? ORDER BY time DESC LIMIT 1',
        )
        .get(owner, device, time) as unknown as Point | undefined;
      const after = this.store.database
        .prepare(
          'SELECT * FROM waka_points WHERE owner_id = ? AND device = ? AND time > ? ORDER BY time LIMIT 1',
        )
        .get(owner, device, time) as unknown as Point | undefined;
      this.store.database
        .prepare(
          'INSERT INTO waka_points (id, owner_id, device, project_id, time, language, editor, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, owner, device, project.id, time, point.language, editor, point.category);
      if (before && after)
        this.store.database
          .prepare(
            'DELETE FROM time_samples WHERE id IN (SELECT sample_id FROM waka_edges WHERE from_id = ? AND to_id = ?)',
          )
          .run(before.id, after.id);
      if (before) this.edge(owner, device, before, point, now);
      if (after) this.edge(owner, device, point, after, now);
      if (after)
        this.store
          .user(owner)
          .tracking.rebuild(
            Math.max(before?.time ?? time, time - idleMs),
            Math.min(after.time, time + idleMs),
          );
      // Older points cannot affect an accepted heartbeat, which is limited to seven days.
      this.store.database
        .prepare('DELETE FROM waka_points WHERE owner_id = ? AND time < ?')
        .run(owner, now - trackingPolicy.offlineRetentionMs - idleMs);
      return { id, time: time / 1000 };
    })();
  }

  private edge(owner: string, device: string, from: Point, to: Point, now: number) {
    if (
      to.time - from.time > idleMs ||
      from.category === 'ai coding' ||
      from.time < now - trackingPolicy.offlineRetentionMs
    )
      return;
    const samples: TimeSample[] = [];
    for (let start = from.time; start < to.time; start += trackingPolicy.maxSampleMs) {
      const end = Math.min(to.time, start + trackingPolicy.maxSampleMs);
      samples.push({
        id: digest(from.id + ':' + to.id + ':' + start),
        projectId: from.project_id,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
        signal: 'heartbeat',
        ...(from.language ? { language: from.language } : {}),
        editor: from.editor,
      });
    }
    if (!samples.length) return;
    this.store.user(owner).tracking.heartbeat(
      {
        clientId: device,
        projectId: from.project_id,
        label: from.editor,
        state: 'idle',
        samples,
      },
      now,
    );
    for (const sample of samples)
      this.store.database
        .prepare('INSERT INTO waka_edges(from_id, to_id, sample_id) VALUES (?, ?, ?)')
        .run(from.id, to.id, sample.id);
  }
}

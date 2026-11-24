import { Database } from './database.js';
import { randomUUID } from 'node:crypto';
import { TrackingStore } from './tracking-store.js';
import type { TimeSlice } from '../shared/tracking.js';
import { reviewActivity, maxAgentRunMs } from '../shared/review.js';
import {
  eventSchema,
  type ActivityEvent,
  type Project,
  type ProjectSummary,
  type TimelinePage,
  type Actor,
  type Source,
} from '../shared/events.js';

export class StoreError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

interface ProjectRow {
  id: string;
  name: string;
  is_example: number;
  created_at: string;
  event_count: number;
  last_event_at: string | null;
}

interface EventRow {
  payload: string;
}

export interface TimelineQuery {
  actor?: Actor;
  source?: Source;
  search?: string;
  cursor?: string;
  limit: number;
}

export class ActivityStore {
  readonly database: Database;
  private ownsDatabase: boolean;
  readonly tracking: TrackingStore;

  constructor(
    filePath: string | Database,
    readonly scopeId = 'local',
  ) {
    this.ownsDatabase = typeof filePath === 'string';
    this.database = typeof filePath === 'string' ? new Database(filePath) : filePath;
    if (typeof filePath !== 'string') {
      this.tracking = new TrackingStore(this.database, scopeId, false);
      return;
    }
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.database.exec(
      [
        'CREATE TABLE IF NOT EXISTS projects (',
        'id TEXT PRIMARY KEY, name TEXT NOT NULL,',
        'is_example INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);',
        'CREATE TABLE IF NOT EXISTS events (',
        'id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,',
        'occurred_at TEXT NOT NULL, source TEXT NOT NULL, actor TEXT NOT NULL,',
        'kind TEXT NOT NULL, payload TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS events_project_time ON events(project_id, occurred_at DESC, id DESC);',
        'CREATE TABLE IF NOT EXISTS workspace_links (workspace_key TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE);',
      ].join('\n'),
    );
    const columns = this.database.prepare('PRAGMA table_info(projects)').all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === 'scope_id'))
      this.database.exec("ALTER TABLE projects ADD COLUMN scope_id TEXT NOT NULL DEFAULT 'local'");
    this.database.exec('CREATE INDEX IF NOT EXISTS projects_scope ON projects(scope_id)');
    this.tracking = new TrackingStore(this.database, scopeId);
    this.database.pragma('user_version = 4');
  }

  forScope(scopeId: string) {
    return new ActivityStore(this.database, scopeId);
  }

  close() {
    if (this.ownsDatabase) this.database.close();
  }

  listProjects(): Project[] {
    const rows = this.database
      .prepare(
        'SELECT p.*, COUNT(e.id) AS event_count, MAX(e.occurred_at) AS last_event_at ' +
          'FROM projects p LEFT JOIN events e ON e.project_id = p.id ' +
          'WHERE p.scope_id = ? GROUP BY p.id ORDER BY p.is_example, p.created_at DESC, p.id',
      )
      .all(this.scopeId) as unknown as ProjectRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isExample: Boolean(row.is_example),
      createdAt: row.created_at,
      eventCount: row.event_count,
      lastEventAt: row.last_event_at,
    }));
  }

  getProject(id: string): Project {
    const row = this.database
      .prepare(
        'SELECT p.*, COUNT(e.id) AS event_count, MAX(e.occurred_at) AS last_event_at FROM projects p LEFT JOIN events e ON e.project_id = p.id WHERE p.id = ? AND p.scope_id = ? GROUP BY p.id',
      )
      .get(id, this.scopeId) as unknown as ProjectRow | undefined;
    if (!row) throw new StoreError('Project not found.', 404);
    return {
      id: row.id,
      name: row.name,
      isExample: Boolean(row.is_example),
      createdAt: row.created_at,
      eventCount: row.event_count,
      lastEventAt: row.last_event_at,
    };
  }

  createProject(name: string, id: string = randomUUID(), isExample = false): Project {
    this.database
      .prepare(
        'INSERT INTO projects (id, name, is_example, created_at, scope_id) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, name, Number(isExample), new Date().toISOString(), this.scopeId);
    return this.getProject(id);
  }

  deleteProject(id: string) {
    this.getProject(id);
    this.database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  resolveWorkspace(key: string, name: string, projectId?: string): Project {
    if (this.scopeId !== 'local') key = this.scopeId + ':' + key;
    return this.database.transaction(() => {
      const linked = this.database
        .prepare('SELECT project_id FROM workspace_links WHERE workspace_key = ?')
        .get(key) as { project_id: string } | undefined;
      const project = projectId
        ? this.getProject(projectId)
        : linked
          ? this.getProject(linked.project_id)
          : this.createProject(name);
      if (project.isExample) throw new StoreError('Choose a real project for tracking.', 400);
      this.database
        .prepare(
          'INSERT INTO workspace_links (workspace_key, project_id) VALUES (?, ?) ON CONFLICT(workspace_key) DO UPDATE SET project_id = excluded.project_id',
        )
        .run(key, project.id);
      return project;
    })();
  }

  review(id: string, from: string, to: string, slices: TimeSlice[] = []) {
    this.getProject(id);
    const rows = this.database
      .prepare(
        'SELECT payload FROM events WHERE project_id = ? AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at, id',
      )
      .all(
        id,
        new Date(Date.parse(from) - maxAgentRunMs).toISOString(),
        new Date(Date.parse(to) + maxAgentRunMs).toISOString(),
      ) as unknown as EventRow[];
    return reviewActivity(
      rows.map((row) => JSON.parse(row.payload) as ActivityEvent),
      { from: Date.parse(from), to: Date.parse(to), slices },
    );
  }

  ingest(input: ActivityEvent[]) {
    const events = input.map((event) => eventSchema.parse(event));
    const insert = this.database.prepare(
      'INSERT INTO events (id, project_id, occurred_at, source, actor, kind, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const existing = this.database.prepare('SELECT payload FROM events WHERE id = ?');
    const projectExists = this.database.prepare(
      'SELECT id FROM projects WHERE id = ? AND scope_id = ?',
    );
    return this.database.transaction(() => {
      let inserted = 0;
      let duplicates = 0;
      for (const event of events) {
        if (!projectExists.get(event.projectId, this.scopeId))
          throw new StoreError('Project not found.', 404);
        const payload = JSON.stringify(event);
        const previous = existing.get(event.id) as EventRow | undefined;
        if (previous) {
          if (previous.payload !== payload)
            throw new StoreError(
              'An event with this ID has different contents. No events were saved.',
              409,
            );
          duplicates++;
          continue;
        }
        insert.run(
          event.id,
          event.projectId,
          event.occurredAt,
          event.source,
          event.actor,
          event.kind,
          payload,
        );
        inserted++;
      }
      return { inserted, duplicates };
    })();
  }

  timeline(projectId: string, query: TimelineQuery): TimelinePage {
    this.getProject(projectId);
    const conditions = ['project_id = ?'];
    const values: (string | number)[] = [projectId];
    if (query.actor) {
      conditions.push('actor = ?');
      values.push(query.actor);
    }
    if (query.source) {
      conditions.push('source = ?');
      values.push(query.source);
    }
    if (query.search) {
      conditions.push("payload LIKE ? ESCAPE '\\'");
      values.push('%' + query.search.replace(/[\\%_]/g, '\\$&') + '%');
    }
    const total = this.database
      .prepare('SELECT COUNT(*) AS count FROM events WHERE ' + conditions.join(' AND '))
      .get(...values) as { count: number };
    if (query.cursor) {
      let cursor: unknown;
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
      } catch {
        throw new StoreError('Invalid timeline cursor.', 400);
      }
      if (
        !Array.isArray(cursor) ||
        cursor.length !== 2 ||
        !cursor.every((value) => typeof value === 'string')
      ) {
        throw new StoreError('Invalid timeline cursor.', 400);
      }
      conditions.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
      values.push(cursor[0]!, cursor[0]!, cursor[1]!);
    }
    const rows = this.database
      .prepare(
        'SELECT payload FROM events WHERE ' +
          conditions.join(' AND ') +
          ' ORDER BY occurred_at DESC, id DESC LIMIT ?',
      )
      .all(...values, query.limit + 1) as unknown as EventRow[];
    const events = rows
      .slice(0, query.limit)
      .map((row) => JSON.parse(row.payload) as ActivityEvent);
    const last = events.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify([last.occurredAt, last.id])).toString('base64url')
        : null;
    return { events, total: total.count, nextCursor };
  }

  summary(projectId: string): ProjectSummary {
    this.getProject(projectId);
    const counts = this.database
      .prepare(
        "SELECT COUNT(*) AS total, COALESCE(SUM(kind = 'user_prompt'), 0) AS userMessages, " +
          "COALESCE(SUM(actor = 'agent'), 0) AS agentEvents, COALESCE(SUM(actor = 'tool'), 0) AS toolEvents, " +
          'MIN(occurred_at) AS firstEventAt, MAX(occurred_at) AS lastEventAt FROM events WHERE project_id = ?',
      )
      .get(projectId) as Omit<ProjectSummary, 'sources'>;
    const sourceCounts = this.database
      .prepare(
        'SELECT source, COUNT(*) AS count FROM events WHERE project_id = ? GROUP BY source ORDER BY source',
      )
      .all(projectId) as ProjectSummary['sources'];
    return { ...counts, sources: sourceCounts };
  }

  exportProject(id: string) {
    const project = this.getProject(id);
    const rows = this.database
      .prepare('SELECT payload FROM events WHERE project_id = ? ORDER BY occurred_at, id')
      .all(id) as unknown as EventRow[];
    return {
      format: 'hacktrail-activity-v1',
      exportedAt: new Date().toISOString(),
      project,
      notice: 'Recorded activity is not verified human working time.',
      tracking: this.tracking.export(id),
      events: rows.map((row) => JSON.parse(row.payload) as ActivityEvent),
    };
  }
}

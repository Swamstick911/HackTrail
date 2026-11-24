import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ActivityStore, StoreError } from '../server/store.js';
import {
  profileSchema,
  projectDetailsSchema,
  type CredentialScope,
  type Profile,
  type ProfileSettings,
  type ProjectDetails,
  type SyncInput,
} from './contracts.js';
import type { ActivityEvent, Project } from '../shared/events.js';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type PlatformProject = Project & ProjectDetails;
interface KeyRow {
  id: string;
  owner_id: string;
  label: string;
  scopes: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export class PlatformStore {
  readonly activity: ActivityStore;
  readonly database;

  constructor(path: string) {
    this.activity = new ActivityStore(path);
    this.database = this.activity.database;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_details (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, label TEXT NOT NULL, scopes TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
      CREATE INDEX IF NOT EXISTS credentials_owner ON credentials(owner_id);
      CREATE TABLE IF NOT EXISTS sync_links (owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, local_id TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, PRIMARY KEY(owner_id, local_id));
      CREATE TABLE IF NOT EXISTS device_requests (token_hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, last_poll_at INTEGER, owner_id TEXT REFERENCES profiles(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS shared_reports (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_owner ON shared_reports(owner_id);
    `);
  }

  close() {
    this.activity.close();
  }
  user(id: string) {
    return this.activity.forScope(id);
  }

  ensureProfile(user: { id: string; name: string; username?: string | null }) {
    const existing = this.database
      .prepare('SELECT payload FROM profiles WHERE id = ?')
      .get(user.id) as { payload: string } | undefined;
    if (existing) return JSON.parse(existing.payload) as Profile;
    const profile: Profile = {
      id: user.id,
      handle: user.username?.toLowerCase() || 'builder-' + digest(user.id).slice(0, 16),
      name: user.name.slice(0, 80),
      bio: '',
      timezone: 'UTC',
      isPublic: true,
      leaderboard: false,
      dailyGoalMinutes: 60,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare('INSERT INTO profiles (id, handle, payload) VALUES (?, ?, ?)')
      .run(profile.id, profile.handle, JSON.stringify(profile));
    return profile;
  }

  profile(id: string) {
    const row = this.database.prepare('SELECT payload FROM profiles WHERE id = ?').get(id) as
      { payload: string } | undefined;
    if (!row) throw new StoreError('Account not found.', 404);
    return JSON.parse(row.payload) as Profile;
  }

  profileByHandle(handle: string) {
    const row = this.database
      .prepare('SELECT payload FROM profiles WHERE handle = ?')
      .get(handle.toLowerCase()) as { payload: string } | undefined;
    if (!row) throw new StoreError('Profile not found.', 404);
    const profile = JSON.parse(row.payload) as Profile;
    if (!profile.isPublic) throw new StoreError('Profile not found.', 404);
    return profile;
  }

  updateProfile(id: string, input: ProfileSettings) {
    const profile = { ...this.profile(id), ...profileSchema.parse(input) };
    this.database
      .prepare('UPDATE profiles SET payload = ? WHERE id = ?')
      .run(JSON.stringify(profile), id);
    return profile;
  }

  projects(owner: string): PlatformProject[] {
    return this.user(owner)
      .listProjects()
      .map((project) => this.project(owner, project.id, project));
  }

  project(owner: string, id: string, known?: Project): PlatformProject {
    const project = known ?? this.user(owner).getProject(id);
    const row = this.database
      .prepare('SELECT payload FROM project_details WHERE project_id = ?')
      .get(id) as { payload: string } | undefined;
    const details = row
      ? (JSON.parse(row.payload) as ProjectDetails)
      : projectDetailsSchema.parse({ name: project.name });
    return { ...project, ...details };
  }

  createProject(owner: string, input: ProjectDetails) {
    const details = projectDetailsSchema.parse(input);
    return this.database.transaction(() => {
      const project = this.user(owner).createProject(details.name);
      this.database
        .prepare('INSERT INTO project_details (project_id, payload) VALUES (?, ?)')
        .run(project.id, JSON.stringify(details));
      return { ...project, ...details };
    })();
  }

  updateProject(owner: string, id: string, input: ProjectDetails) {
    this.user(owner).getProject(id);
    const details = projectDetailsSchema.parse(input);
    this.database.transaction(() => {
      this.database.prepare('UPDATE projects SET name = ? WHERE id = ?').run(details.name, id);
      this.database
        .prepare(
          'INSERT INTO project_details (project_id, payload) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload',
        )
        .run(id, JSON.stringify(details));
    })();
    return this.project(owner, id);
  }

  deleteProject(owner: string, id: string) {
    this.user(owner).deleteProject(id);
  }

  deleteAccount(owner: string) {
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM projects WHERE scope_id = ?').run(owner);
      this.database.prepare('DELETE FROM tracking_pauses WHERE scope_id = ?').run(owner);
      this.database.prepare('DELETE FROM profiles WHERE id = ?').run(owner);
    })();
  }

  createKey(owner: string, label: string, scopes: CredentialScope[]) {
    this.profile(owner);
    const count = this.database
      .prepare('SELECT COUNT(*) AS total FROM credentials WHERE owner_id = ?')
      .get(owner) as { total: number };
    if (count.total >= 30)
      throw new StoreError('Revoke an unused key before creating another.', 400);
    const token = 'ht_' + randomBytes(32).toString('base64url');
    const id = randomUUID();
    this.database
      .prepare(
        'INSERT INTO credentials (id, owner_id, token_hash, prefix, label, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        owner,
        digest(token),
        token.slice(0, 10),
        label,
        JSON.stringify(scopes),
        new Date().toISOString(),
      );
    return { id, token, label, scopes };
  }

  key(token: string, required: CredentialScope) {
    const row = this.database
      .prepare('SELECT * FROM credentials WHERE token_hash = ?')
      .get(digest(token)) as unknown as KeyRow | undefined;
    if (!row) throw new StoreError('This device key is invalid or has been revoked.', 401);
    if (!(JSON.parse(row.scopes) as CredentialScope[]).includes(required))
      throw new StoreError('This key does not have the required permission.', 403);
    this.database
      .prepare('UPDATE credentials SET last_used_at = ? WHERE id = ?')
      .run(new Date().toISOString(), row.id);
    return row.owner_id;
  }

  revokeDevice(token: string) {
    this.key(token, 'write:activity');
    this.database.prepare('DELETE FROM credentials WHERE token_hash = ?').run(digest(token));
  }

  listKeys(owner: string) {
    const rows = this.database
      .prepare(
        'SELECT id, label, scopes, prefix, created_at, last_used_at FROM credentials WHERE owner_id = ? ORDER BY created_at DESC',
      )
      .all(owner) as unknown as KeyRow[];
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      scopes: JSON.parse(row.scopes) as CredentialScope[],
      prefix: row.prefix,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  revokeKey(owner: string, id: string) {
    this.database.prepare('DELETE FROM credentials WHERE id = ? AND owner_id = ?').run(id, owner);
  }

  linkedProject(owner: string, localId: string, name: string) {
    const link = this.database
      .prepare('SELECT project_id FROM sync_links WHERE owner_id = ? AND local_id = ?')
      .get(owner, localId) as { project_id: string | null } | undefined;
    if (link) {
      if (!link.project_id)
        throw new StoreError(
          'This synced project was deleted from your account. Create a new local project to sync again.',
          410,
        );
      return this.project(owner, link.project_id);
    }
    const project = this.createProject(owner, projectDetailsSchema.parse({ name }));
    this.database
      .prepare('INSERT INTO sync_links (owner_id, local_id, project_id) VALUES (?, ?, ?)')
      .run(owner, localId, project.id);
    return project;
  }

  sync(owner: string, input: SyncInput) {
    if (
      input.samples.some((sample) => sample.projectId !== input.project.localId) ||
      input.events.some((event) => event.projectId !== input.project.localId)
    )
      throw new StoreError('All activity must belong to the selected local project.', 400);
    return this.database.transaction(() => {
      const project = this.linkedProject(owner, input.project.localId, input.project.name);
      const scoped = (id: string) => digest(owner + ':' + id);
      const samples = input.samples.map((sample) => ({
        ...sample,
        id: scoped(sample.id),
        projectId: project.id,
      }));
      const events: ActivityEvent[] = input.events
        .filter((event) => event.kind !== 'work_note')
        .map((event) => {
          const { excerpt: _excerpt, ...metadata } = event.metadata;
          return {
            schemaVersion: 1,
            id: scoped(event.id),
            projectId: project.id,
            occurredAt: event.occurredAt,
            source: event.source,
            actor: event.actor,
            kind: event.kind,
            metadata,
          };
        });
      const store = this.user(owner);
      const tracking = store.tracking.heartbeat({
        clientId: scoped(input.clientId),
        projectId: project.id,
        label: input.label,
        state: input.state,
        samples,
      });
      const activity = store.ingest(events);
      return { projectId: project.id, tracking, activity };
    })();
  }
}

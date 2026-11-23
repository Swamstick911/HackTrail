import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rangeSchema } from './contracts.js';
import { digest, type PlatformStore } from './store.js';
import { StoreError } from '../server/store.js';
import type { ActivityEvent } from '../shared/events.js';
import { maxAgentRunMs, reviewActivity } from '../shared/review.js';
import { trackingPolicy } from '../shared/tracking.js';

export const reportOptionsSchema = z
  .object({
    range: rangeSchema,
    includeGit: z.boolean().default(false),
    includeNotes: z.boolean().default(false),
  })
  .strict();
export type ReportOptions = z.infer<typeof reportOptionsSchema>;

export function previewReport(
  store: PlatformStore,
  owner: string,
  projectId: string,
  input: ReportOptions,
) {
  const options = reportOptionsSchema.parse(input);
  const project = store.project(owner, projectId);
  const from = Date.parse(options.range.from);
  const to = Date.parse(options.range.to);
  if (to > Date.now() + 5000) throw new StoreError('The report cannot include future time.', 400);
  const tracking = store.user(owner).tracking.report(projectId, from, to);
  if (tracking.slices.length > 50_000)
    throw new StoreError('Choose a shorter period for this report.', 413);
  const rows = store.database
    .prepare(
      'SELECT payload FROM events WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at, id LIMIT 50001',
    )
    .all(
      projectId,
      new Date(from - maxAgentRunMs).toISOString(),
      new Date(to + maxAgentRunMs).toISOString(),
    ) as { payload: string }[];
  if (rows.length > 50_000) throw new StoreError('Choose a shorter period for this report.', 413);
  const events: ActivityEvent[] = [];
  for (const row of rows) {
    const event = JSON.parse(row.payload) as ActivityEvent;
    const time = Date.parse(event.occurredAt);
    const outside = time < from || time >= to;
    if (outside && !['agent_started', 'agent_stopped'].includes(event.kind)) continue;
    if (event.kind === 'work_note' && !options.includeNotes) continue;
    if (event.source === 'git' && !options.includeGit) continue;
    const { excerpt, git, ...metadata } = event.metadata;
    events.push({
      schemaVersion: 1,
      id: event.id,
      projectId: event.projectId,
      occurredAt: event.occurredAt,
      source: event.source,
      actor: event.actor,
      kind: event.kind,
      metadata: outside
        ? {
            sessionId: metadata.sessionId,
            turnId: metadata.turnId,
            interrupted: metadata.interrupted,
          }
        : {
            ...metadata,
            ...(options.includeGit && git ? { git } : {}),
            ...(options.includeNotes && event.kind === 'work_note' ? { excerpt } : {}),
          },
    });
  }
  const slices = tracking.slices.map(({ git, ...slice }) => ({
    ...slice,
    ...(options.includeGit && git ? { git } : {}),
  }));
  const report = {
    format: 'hacktrail-report-v1',
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      repositoryUrl: project.repositoryUrl,
      demoUrl: project.demoUrl,
    },
    range: options.range,
    disclosure: {
      git: options.includeGit,
      notes: options.includeNotes,
      boundaryContext:
        'Start/stop metadata up to 12 hours outside the period can establish a crossing run. Counted time is clipped to the selected period.',
    },
    notice:
      'Observed activity is not verified authorship, productive-struggle time, or program-approved hours.',
    policy: trackingPolicy,
    tracking: { totalMs: tracking.totalMs, slices },
    review: reviewActivity(events, { from, to, slices }),
    events,
  };
  return { ...report, fingerprint: digest(JSON.stringify(report)) };
}
export type EvidenceReport = ReturnType<typeof previewReport>;

export function createReport(
  store: PlatformStore,
  owner: string,
  projectId: string,
  options: ReportOptions,
  expiresInDays: number,
) {
  const count = store.database
    .prepare('SELECT COUNT(*) AS total FROM shared_reports WHERE owner_id = ? AND expires_at > ?')
    .get(owner, Date.now()) as { total: number };
  if (count.total >= 30) throw new StoreError('Revoke an old report before sharing another.', 400);
  const report = previewReport(store, owner, projectId, options);
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const expiresAt = Date.now() + expiresInDays * 86_400_000;
  store.database
    .prepare(
      'INSERT INTO shared_reports (id, owner_id, project_id, token_hash, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      owner,
      projectId,
      digest(token),
      JSON.stringify(report),
      new Date().toISOString(),
      expiresAt,
    );
  return { id, token, expiresAt: new Date(expiresAt).toISOString(), report };
}

export function sharedReport(store: PlatformStore, token: string, now = Date.now()) {
  const row = store.database
    .prepare('SELECT payload FROM shared_reports WHERE token_hash = ? AND expires_at > ?')
    .get(digest(token), now) as { payload: string } | undefined;
  if (!row) throw new StoreError('This report is unavailable, expired, or revoked.', 404);
  return JSON.parse(row.payload) as EvidenceReport;
}

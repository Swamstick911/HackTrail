import { createHash, randomBytes } from 'node:crypto';
import type { LocalClient } from '../../../src/shared/local-client.js';
import type { SyncBatch } from '../../../src/server/sync-reader.js';

export function platformOrigin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use the platform origin, for example https://trail.example.org.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use HTTPS, or HTTP on this computer for development.');
  return url.origin;
}
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function platformRequest<T>(
  origin: string,
  path: string,
  body?: unknown,
  token?: string,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(platformOrigin(origin) + '/api' + path, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new PlatformError(
      result.error ?? 'Could not reach the HackTrail platform.',
      response.status,
    );
  return result;
}
export async function beginConnection(origin: string, label: string) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const result = await platformRequest<{
    deviceCode: string;
    userCode: string;
    expiresIn: number;
    interval: number;
    verificationUrl: string;
  }>(origin, '/devices/start', { label, challenge });
  if (new URL(result.verificationUrl).origin !== platformOrigin(origin))
    throw new Error('The server returned an unexpected approval URL.');
  return { ...result, verifier };
}
export interface SyncConnection {
  origin: string;
  deviceId: string;
  accountId: string;
  handle: string;
  projectId: string;
  includeGit: boolean;
  includeAgents: boolean;
  cursor: number;
  remoteProjectId?: string;
  lastSyncedAt?: string;
  pending?: SyncBatch;
}
export async function syncBatch(
  local: LocalClient,
  connection: SyncConnection,
  token: string,
  savePending?: (value: SyncConnection) => Promise<void>,
) {
  const query = new URLSearchParams({
    cursor: String(connection.cursor),
    includeGit: String(connection.includeGit),
    includeAgents: String(connection.includeAgents),
  });
  const batch =
    connection.pending ??
    (await local.request<SyncBatch>(
      '/projects/' + encodeURIComponent(connection.projectId) + '/sync?' + query,
    ));
  await savePending?.({ ...connection, pending: batch });
  const { nextCursor, hasMore, ...input } = batch;
  input.samples = input.samples.filter(
    (sample) => Date.parse(sample.startedAt) >= Date.now() - 7 * 86400_000 + 30_000,
  );
  const result = await platformRequest<{ projectId: string; tracking: { paused: boolean } }>(
    connection.origin,
    '/sync',
    input,
    token,
  );
  return {
    connection: {
      ...connection,
      pending: undefined,
      cursor: nextCursor,
      remoteProjectId: result.projectId,
      lastSyncedAt: new Date().toISOString(),
    },
    hasMore,
    paused: result.tracking.paused,
  };
}

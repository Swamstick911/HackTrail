import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fromNodeHeaders } from 'better-auth/node';
import { existsSync, createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StoreError } from '../server/store.js';
import { type Authentication } from './auth.js';
import { type PlatformStore } from './store.js';
import {
  credentialScopes,
  type CredentialScope,
  profileSchema,
  projectDetailsSchema,
  syncSchema,
  rangeSchema,
} from './contracts.js';
import { dashboard } from './analytics.js';
import { DeviceAuthorization } from './devices.js';
import { createReport, previewReport, reportOptionsSchema, sharedReport } from './reports.js';

interface PlatformOptions {
  store: PlatformStore;
  authentication: Authentication;
  origin: string;
  webRoot?: string;
  extensionPath?: string;
  emailEnabled?: boolean;
  registrationOpen?: boolean;
  rateLimit?: number;
}
const daysSchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .refine((value) => [1, 7, 30].includes(value))
      .default(7),
  })
  .strict();
const codeSchema = z.string().regex(/^[A-Fa-f0-9]{10}$/);

export function createPlatform(options: PlatformOptions) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const { store, authentication, origin } = options;
  const devices = new DeviceAuthorization(store);
  app.register(rateLimit, { max: options.rateLimit ?? 300, timeWindow: '1 minute' });

  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.host !== new URL(origin).host)
      return reply.code(403).send({ error: 'Invalid host.' });
    request.headers['x-hacktrail-client-ip'] = request.ip;
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      ((request.headers.origin && request.headers.origin !== origin) ||
        request.headers['sec-fetch-site'] === 'cross-site')
    ) {
      return reply.code(403).send({ error: 'This origin is not allowed.' });
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: error.issues
          .slice(0, 3)
          .map((issue) => issue.path.join('.') + ': ' + issue.message)
          .join('; '),
      });
    if (error instanceof StoreError)
      return reply.code(error.statusCode).send({ error: error.message });
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status === 429)
      return reply.code(429).send({ error: 'Too many requests. Try again in a minute.' });
    if (status >= 400 && status < 500)
      return reply
        .code(status)
        .send({ error: status === 413 ? 'The request is too large.' : 'Invalid request.' });
    console.error(
      'Platform request failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return reply.code(500).send({ error: 'The platform could not complete this request.' });
  });

  async function account(request: FastifyRequest, scope?: CredentialScope) {
    if (scope && request.headers.authorization?.startsWith('Bearer '))
      return store.key(request.headers.authorization.slice(7), scope);
    const session = await authentication.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) throw new StoreError('Sign in to continue.', 401);
    store.ensureProfile(session.user);
    return session.user.id;
  }

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const headers = fromNodeHeaders(request.headers);
      const response = await authentication.auth.handler(
        new Request(new URL(request.url, origin), {
          method: request.method,
          headers,
          ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      for (const [key, value] of response.headers)
        if (key !== 'set-cookie') reply.header(key, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.code(response.status).send(await response.text());
    },
  });
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'hacktrail-platform',
    version: '0.5.0',
  }));
  app.get('/api/meta', async () => ({
    emailEnabled: Boolean(options.emailEnabled),
    registrationOpen: options.registrationOpen !== false,
    extensionAvailable: Boolean(options.extensionPath && existsSync(options.extensionPath)),
  }));
  app.get('/api/me', async (request) => store.profile(await account(request)));
  app.put('/api/me', async (request) =>
    store.updateProfile(await account(request), profileSchema.parse(request.body)),
  );
  app.get('/api/dashboard', async (request) =>
    dashboard(store, await account(request, 'read:stats'), daysSchema.parse(request.query).days),
  );
  app.get('/api/projects', async (request) => store.projects(await account(request, 'read:stats')));
  app.post('/api/projects', async (request, reply) =>
    reply
      .code(201)
      .send(store.createProject(await account(request), projectDetailsSchema.parse(request.body))),
  );
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) =>
    store.project(await account(request, 'read:stats'), request.params.id),
  );
  app.put<{ Params: { id: string } }>('/api/projects/:id', async (request) =>
    store.updateProject(
      await account(request),
      request.params.id,
      projectDetailsSchema.parse(request.body),
    ),
  );
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    store.deleteProject(await account(request), request.params.id);
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/work', async (request) => {
    const owner = await account(request, 'read:stats');
    store.project(owner, request.params.id);
    const range = rangeSchema.parse(request.query);
    const activity = store.user(owner);
    const tracking = activity.tracking.report(
      request.params.id,
      Date.parse(range.from),
      Date.parse(range.to),
    );
    return {
      tracking,
      review: activity.review(request.params.id, range.from, range.to, tracking.slices),
    };
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/events', async (request) => {
    const owner = await account(request);
    const query = z
      .object({
        cursor: z.string().max(1000).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(60),
      })
      .strict()
      .parse(request.query);
    return store.user(owner).timeline(request.params.id, query);
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/export', async (request, reply) => {
    const owner = await account(request);
    reply.header('Content-Disposition', 'attachment; filename="hacktrail-project.json"');
    return {
      ...store.user(owner).exportProject(request.params.id),
      project: store.project(owner, request.params.id),
    };
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/notes', async (request) => {
    const owner = await account(request);
    store.project(owner, request.params.id);
    const input = z
      .object({ text: z.string().trim().min(1).max(500) })
      .strict()
      .parse(request.body);
    return store
      .user(owner)
      .ingest([
        {
          schemaVersion: 1,
          id: randomUUID(),
          projectId: request.params.id,
          occurredAt: new Date().toISOString(),
          source: 'manual',
          actor: 'user',
          kind: 'work_note',
          metadata: { excerpt: input.text },
        },
      ]);
  });
  app.post('/api/tracking/pause', async (request) =>
    store
      .user(await account(request))
      .tracking.pause(z.object({ paused: z.boolean() }).strict().parse(request.body).paused),
  );
  app.post('/api/sync', async (request) =>
    store.sync(await account(request, 'write:activity'), syncSchema.parse(request.body)),
  );
  app.get('/api/keys', async (request) => store.listKeys(await account(request)));
  app.post('/api/keys', async (request, reply) => {
    const owner = await account(request);
    const input = z
      .object({
        label: z.string().trim().min(1).max(80),
        scopes: z.array(z.enum(credentialScopes)).min(1).max(2),
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send(store.createKey(owner, input.label, [...new Set(input.scopes)]));
  });
  app.delete<{ Params: { id: string } }>('/api/keys/:id', async (request, reply) => {
    store.revokeKey(await account(request), request.params.id);
    return reply.code(204).send();
  });
  app.post(
    '/api/devices/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const input = z
        .object({
          label: z.string().trim().min(1).max(80),
          challenge: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
        })
        .strict()
        .parse(request.body);
      const result = devices.start(input.label, input.challenge);
      return { ...result, verificationUrl: origin + '/connect?code=' + result.userCode };
    },
  );
  app.post('/api/devices/poll', async (request) => {
    const input = z
      .object({
        deviceCode: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
        verifier: z.string().regex(/^[a-zA-Z0-9_-]{43,128}$/),
      })
      .strict()
      .parse(request.body);
    return devices.poll(input.deviceCode, input.verifier);
  });
  app.get<{ Params: { code: string } }>('/api/devices/:code', async (request) => {
    await account(request);
    const row = devices.describe(codeSchema.parse(request.params.code));
    return {
      label: row.label,
      expiresAt: new Date(row.expires_at).toISOString(),
      approved: Boolean(row.owner_id),
    };
  });
  app.post<{ Params: { code: string } }>('/api/devices/:code/approve', async (request) =>
    devices.approve(await account(request), codeSchema.parse(request.params.code)),
  );

  app.post<{ Params: { id: string } }>('/api/projects/:id/reports/preview', async (request) =>
    previewReport(
      store,
      await account(request),
      request.params.id,
      reportOptionsSchema.parse(request.body),
    ),
  );
  app.post<{ Params: { id: string } }>('/api/projects/:id/reports', async (request, reply) => {
    const owner = await account(request);
    const input = reportOptionsSchema
      .extend({ expiresInDays: z.number().int().min(1).max(30) })
      .parse(request.body);
    const { expiresInDays, ...reportOptions } = input;
    const result = createReport(store, owner, request.params.id, reportOptions, expiresInDays);
    return reply.code(201).send({ ...result, url: origin + '/reports/' + result.token });
  });
  app.get('/api/reports', async (request) => {
    const owner = await account(request);
    return store.database
      .prepare(
        'SELECT r.id, r.project_id AS projectId, p.name AS projectName, r.created_at AS createdAt, r.expires_at AS expiresAt FROM shared_reports r JOIN projects p ON p.id = r.project_id WHERE r.owner_id = ? ORDER BY r.created_at DESC',
      )
      .all(owner);
  });
  app.delete<{ Params: { id: string } }>('/api/reports/:id', async (request, reply) => {
    store.database
      .prepare('DELETE FROM shared_reports WHERE id = ? AND owner_id = ?')
      .run(request.params.id, await account(request));
    return reply.code(204).send();
  });
  app.get<{ Params: { token: string } }>('/api/public/reports/:token', async (request) =>
    sharedReport(
      store,
      z
        .string()
        .regex(/^[a-zA-Z0-9_-]{43}$/)
        .parse(request.params.token),
    ),
  );
  app.get<{ Params: { handle: string } }>('/api/public/profiles/:handle', async (request) => {
    const profile = store.profileByHandle(request.params.handle);
    const stats = dashboard(store, profile.id, daysSchema.parse(request.query).days, {
      publicOnly: true,
    });
    const {
      id: _id,
      dailyGoalMinutes: _goal,
      leaderboard: _leaderboard,
      ...publicProfile
    } = profile;
    return {
      profile: publicProfile,
      stats: {
        ...stats,
        paused: undefined,
        projects: stats.projects.map(
          ({ eventCount: _events, lastEventAt: _last, active: _active, ...project }) => project,
        ),
      },
    };
  });
  app.get('/api/public/community', async () => {
    const profiles = store.database
      .prepare(
        "SELECT payload FROM profiles WHERE json_extract(payload, '$.isPublic') = 1 AND json_extract(payload, '$.leaderboard') = 1 ORDER BY handle LIMIT 100",
      )
      .all() as { payload: string }[];
    return profiles
      .map((row) => {
        const profile = JSON.parse(row.payload) as ReturnType<PlatformStore['profile']>;
        const stats = dashboard(store, profile.id, 7, { publicOnly: true, timezone: 'UTC' });
        return {
          handle: profile.handle,
          name: profile.name,
          bio: profile.bio,
          totalMs: stats.totalMs,
          projects: stats.projects.length,
        };
      })
      .sort((a, b) => b.totalMs - a.totalMs || a.handle.localeCompare(b.handle));
  });
  app.get('/api/integrations/vscode', async (_request, reply) => {
    if (!options.extensionPath || !existsSync(options.extensionPath))
      throw new StoreError('The extension package is not available on this server.', 404);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="hacktrail.vsix"');
    return reply.send(createReadStream(options.extensionPath));
  });
  if (options.webRoot && existsSync(options.webRoot)) {
    app.register(fastifyStatic, { root: options.webRoot, index: 'index.html' });
    app.setNotFoundHandler((request, reply) =>
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/assets/')
        ? reply.sendFile('index.html')
        : reply.code(404).send({ error: 'Not found.' }),
    );
  }
  return app;
}

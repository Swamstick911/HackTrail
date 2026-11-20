import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { actors, sources, eventSchema } from '../shared/events.js';
import { importClaude, maxImportBytes } from './claude-import.js';
import { seedExample } from './example.js';
import { ActivityStore, StoreError } from './store.js';

interface AppOptions {
  store: ActivityStore;
  token: string;
  port: number;
  webRoot?: string;
  development?: boolean;
}

const importSchema = z.object({
  projectId: z.string().min(3).max(128),
  fileName: z.string().min(1).max(255),
  text: z.string().max(maxImportBytes),
  includeExcerpts: z.boolean().default(false),
}).strict();

function validToken(value: unknown, expected: string) {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return false;
  const actual = Buffer.from(value.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function createApp(options: AppOptions) {
  const app = Fastify({ logger: false, bodyLimit: 24 * 1024 * 1024 });
  const origins = new Set([
    'http://127.0.0.1:' + options.port,
    'http://localhost:' + options.port,
  ]);
  if (options.development) origins.add('http://127.0.0.1:5173');
  const hosts = new Set([...origins].map(origin => new URL(origin).host));

  app.addHook('onRequest', async (request, reply) => {
    if (!hosts.has(request.headers.host ?? '')) return reply.code(403).send({ error: 'Local access only.' });
    const origin = request.headers.origin;
    if ((origin && !origins.has(origin)) || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'This origin is not allowed.' });
    }
    if (request.url.startsWith('/api/') && !['/api/health', '/api/session'].includes(request.url.split('?')[0]!)
      && !validToken(request.headers.authorization, options.token)) {
      return reply.code(401).send({ error: 'A local access token is required.' });
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid request: ' + error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).slice(0, 3).join('; ') });
    }
    if (error instanceof StoreError) return reply.code(error.statusCode).send({ error: error.message });
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status === 413) return reply.code(413).send({ error: 'The request is too large.' });
    if (status >= 400 && status < 500) return reply.code(status).send({ error: 'Invalid request.' });
    return reply.code(500).send({ error: 'The local collector could not complete the request.' });
  });

  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));
  app.get('/api/session', async () => ({ token: options.token }));
  app.get('/api/projects', async () => options.store.listProjects());
  app.post('/api/projects', async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f]+$/) }).strict().parse(request.body);
    return reply.code(201).send(options.store.createProject(input.name));
  });
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    options.store.deleteProject(request.params.id);
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/events', async request => {
    const query = z.object({
      actor: z.enum(actors).optional(), source: z.enum(sources).optional(),
      search: z.string().max(100).optional(), cursor: z.string().max(1000).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(60),
    }).strict().parse(request.query);
    return options.store.timeline(request.params.id, query);
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/summary', async request => options.store.summary(request.params.id));
  app.get<{ Params: { id: string } }>('/api/projects/:id/export', async (request, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="hacktrail-export.json"');
    return options.store.exportProject(request.params.id);
  });
  app.post('/api/events', async request => {
    const input = z.object({ events: z.array(eventSchema).min(1).max(500) }).strict().parse(request.body);
    return options.store.ingest(input.events);
  });
  app.post('/api/imports/preview', async request => {
    const input = importSchema.parse(request.body);
    options.store.getProject(input.projectId);
    const result = importClaude(input);
    return { ...result, events: result.events.slice(0, 5), eventCount: result.events.length };
  });
  app.post('/api/imports/claude', async request => {
    const input = importSchema.parse(request.body);
    options.store.getProject(input.projectId);
    const parsed = importClaude(input);
    return { ...options.store.ingest(parsed.events), ignoredRecords: parsed.ignoredRecords };
  });
  app.post('/api/example', async () => seedExample(options.store));

  if (options.webRoot && existsSync(options.webRoot)) {
    app.register(fastifyStatic, { root: options.webRoot, index: 'index.html' });
  } else {
    app.get('/', async () => ({ service: 'HackTrail', dashboard: 'Run npm run build to create the dashboard.' }));
  }
  return app;
}

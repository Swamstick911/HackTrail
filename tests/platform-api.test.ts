import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformStore } from '../src/platform/store.js';
import { createAuthentication, type Authentication } from '../src/platform/auth.js';
import { createPlatform } from '../src/platform/app.js';

const origin = 'http://localhost:47657';
let store: PlatformStore;
let authentication: Authentication;
let app: ReturnType<typeof createPlatform>;
let aliceCookie: string;
let bobCookie: string;
const password = 'a long unique test password';
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  cookie = aliceCookie,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method,
    url: path,
    headers: { host: 'localhost:47657', origin, ...(cookie ? { cookie } : {}), ...extra },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}
async function signup(username: string) {
  const response = await call(
    'POST',
    '/api/auth/sign-up/email',
    { name: username, username, email: username + '@example.test', password },
    '',
  );
  expect(response.statusCode, response.body).toBe(200);
  const cookie = response.cookies.map((item) => item.name + '=' + item.value).join('; ');
  const profile = await call('GET', '/api/me', undefined, cookie);
  expect(profile.statusCode).toBe(200);
  return cookie;
}
beforeAll(async () => {
  store = new PlatformStore(':memory:');
  authentication = await createAuthentication({
    databasePath: ':memory:',
    origin,
    secret: 'test-secret-with-more-than-thirty-two-characters',
    onDeleteAccount: (id) => store.deleteAccount(id),
  });
  app = createPlatform({ store, authentication, origin, rateLimit: 1000 });
  await app.ready();
  aliceCookie = await signup('alice');
  bobCookie = await signup('bob');
});
afterAll(async () => {
  await app?.close();
  authentication?.close();
  store?.close();
});

describe('platform HTTP boundary', () => {
  it('requires a real session and rejects a forged cookie', async () => {
    expect((await call('GET', '/api/me', undefined, '')).statusCode).toBe(401);
    expect(
      (await call('GET', '/api/me', undefined, 'hacktrail.session_token=forged')).statusCode,
    ).toBe(401);
    expect((await call('GET', '/api/me')).json()).toMatchObject({
      handle: 'alice',
      isPublic: true,
    });
  });
  it('rejects hostile hosts and cross-site mutations', async () => {
    expect(
      (await call('GET', '/api/me', undefined, aliceCookie, { host: 'attacker.test' })).statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', '/api/projects', { name: 'Cross-site' }, aliceCookie, {
          origin: 'https://attacker.test',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', '/api/projects', { name: 'Cross-site' }, aliceCookie, {
          'sec-fetch-site': 'cross-site',
        })
      ).statusCode,
    ).toBe(403);
  });
  it('sets non-cacheable, non-embeddable responses', async () => {
    const response = await call('GET', '/api/me');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('isolates project reads, updates, deletion, timelines, and exports', async () => {
    const result = await call('POST', '/api/projects', { name: 'Alice secret' });
    expect(result.statusCode).toBe(201);
    const { id } = result.json();
    for (const suffix of [
      '',
      '/events',
      '/export',
      '/work?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z',
    ])
      expect(
        (await call('GET', '/api/projects/' + id + suffix, undefined, bobCookie)).statusCode,
      ).toBe(404);
    expect(
      (await call('PUT', '/api/projects/' + id, { name: 'Stolen' }, bobCookie)).statusCode,
    ).toBe(404);
    expect((await call('DELETE', '/api/projects/' + id, undefined, bobCookie)).statusCode).toBe(
      404,
    );
    expect((await call('GET', '/api/projects', undefined, bobCookie)).json()).toEqual([]);
    expect((await call('GET', '/api/projects/' + id)).json().name).toBe('Alice secret');
  });
  it('rejects unsafe project URLs and unknown profile settings', async () => {
    expect(
      (await call('POST', '/api/projects', { name: 'Bad', repositoryUrl: 'javascript:alert(1)' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/projects', {
          name: 'Bad',
          demoUrl: 'https://user:pass@example.com',
        })
      ).statusCode,
    ).toBe(400);
    expect((await call('PUT', '/api/me', { role: 'admin' })).statusCode).toBe(400);
  });
  it('keeps private projects and email addresses out of public profiles', async () => {
    const response = await call('GET', '/api/public/profiles/alice', undefined, '');
    expect(response.statusCode).toBe(200);
    expect(response.json().stats.projects).toEqual([]);
    expect(response.body).not.toContain('Alice secret');
    expect(response.body).not.toContain('@example.test');
    expect(response.json().profile.id).toBeUndefined();
  });
  it('supports making a profile private without deleting its projects', async () => {
    const {
      id: _id,
      handle: _handle,
      createdAt: _createdAt,
      ...profile
    } = (await call('GET', '/api/me')).json();
    expect((await call('PUT', '/api/me', { ...profile, isPublic: false })).statusCode).toBe(200);
    expect((await call('GET', '/api/public/profiles/alice', undefined, '')).statusCode).toBe(404);
    expect((await call('GET', '/api/projects')).json()).toHaveLength(1);
    await call('PUT', '/api/me', profile);
  });
  it('uses scoped credentials without giving them account management access', async () => {
    const key = (
      await call('POST', '/api/keys', { label: 'Stats reader', scopes: ['read:stats'] })
    ).json();
    const authorization = { authorization: 'Bearer ' + key.token };
    expect((await call('GET', '/api/dashboard', undefined, '', authorization)).statusCode).toBe(
      200,
    );
    expect((await call('GET', '/api/keys', undefined, '', authorization)).statusCode).toBe(401);
    expect((await call('POST', '/api/sync', {}, '', authorization)).statusCode).toBe(403);
    expect(
      (await call('POST', '/api/projects', { name: 'No permission' }, '', authorization))
        .statusCode,
    ).toBe(401);
    expect((await call('GET', '/api/keys')).body).not.toContain(key.token);
    await call('DELETE', '/api/keys/' + key.id);
    expect((await call('GET', '/api/dashboard', undefined, '', authorization)).statusCode).toBe(
      401,
    );
  });
  it('signs in through password verification and invalidates sessions on sign-out', async () => {
    expect(
      (
        await call(
          'POST',
          '/api/auth/sign-in/email',
          { email: 'alice@example.test', password: 'wrong password' },
          '',
        )
      ).statusCode,
    ).toBe(401);
    const login = await call(
      'POST',
      '/api/auth/sign-in/email',
      { email: 'alice@example.test', password },
      '',
    );
    expect(login.statusCode, login.body).toBe(200);
    const cookie = login.cookies.map((item) => item.name + '=' + item.value).join('; ');
    expect((await call('GET', '/api/me', undefined, cookie)).statusCode).toBe(200);
    expect((await call('POST', '/api/auth/sign-out', {}, cookie)).statusCode).toBe(200);
    expect((await call('GET', '/api/me', undefined, cookie)).statusCode).toBe(401);
  });
  it('deletes account data through authenticated password confirmation', async () => {
    const cookie = await signup('delete-me');
    await call('POST', '/api/projects', { name: 'To delete' }, cookie);
    const profile = (await call('GET', '/api/me', undefined, cookie)).json();
    expect(
      (await call('POST', '/api/auth/delete-user', { password: 'incorrect password' }, cookie))
        .statusCode,
    ).toBe(400);
    expect(store.projects(profile.id)).toHaveLength(1);
    const deletion = await call('POST', '/api/auth/delete-user', { password }, cookie);
    expect(deletion.statusCode, deletion.body).toBe(200);
    expect(store.projects(profile.id)).toHaveLength(0);
    expect((await call('GET', '/api/me', undefined, cookie)).statusCode).toBe(401);
  });
});

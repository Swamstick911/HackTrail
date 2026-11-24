import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createAuthentication, type Authentication } from '../src/platform/auth.js';
import { PlatformStore } from '../src/platform/store.js';
import { createPlatform } from '../src/platform/app.js';

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: (typeof sent)[number]) => {
        sent.push(message);
      },
      close() {},
    }),
  },
}));
let store: PlatformStore;
let authentication: Authentication;
let app: ReturnType<typeof createPlatform>;
const origin = 'http://localhost:47657';
const password = 'a long email workflow password';
const email = 'verification@example.test';
function call(path: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: payload === undefined ? 'GET' : 'POST',
    url: path,
    headers: { host: 'localhost:47657', origin },
    payload,
  });
}
beforeAll(async () => {
  store = new PlatformStore(':memory:');
  authentication = await createAuthentication({
    databasePath: ':memory:',
    origin,
    secret: 'a-long-test-secret-that-will-not-be-used-in-production',
    smtpUrl: 'smtps://not-a-real-mail-server.invalid',
    mailFrom: 'HackTrail <test@example.test>',
    onDeleteAccount: (id) => store.deleteAccount(id),
  });
  app = createPlatform({ store, authentication, origin, emailEnabled: true });
});
afterAll(async () => {
  await app.close();
  authentication.close();
  store.close();
});
it('requires mailbox verification when email is configured, then accepts the verified account', async () => {
  const signup = await call('/api/auth/sign-up/email', {
    name: 'Verified user',
    username: 'verified-user',
    email,
    password,
    callbackURL: origin,
  });
  expect(signup.statusCode, signup.body).toBe(200);
  expect(signup.json().token).toBeNull();
  const login = await call('/api/auth/sign-in/email', { email, password });
  expect(login.statusCode).toBe(403);
  const message = sent.find((item) => item.subject.startsWith('Verify'))!;
  expect(message.to).toBe(email);
  const url = new URL(message.text.split('\n\n')[1]!);
  const verified = await call(url.pathname + url.search);
  expect(verified.statusCode).toBe(302);
  expect((await call('/api/auth/sign-in/email', { email, password })).statusCode).toBe(200);
});
it('resets the password with a single-use emailed token without revealing unknown accounts', async () => {
  const unknown = await call('/api/auth/request-password-reset', {
    email: 'missing@example.test',
    redirectTo: origin + '/reset-password',
  });
  const requested = await call('/api/auth/request-password-reset', {
    email,
    redirectTo: origin + '/reset-password',
  });
  expect(requested.statusCode).toBe(200);
  expect(unknown.json()).toEqual(requested.json());
  const message = sent.find((item) => item.subject.startsWith('Reset'))!;
  const url = new URL(message.text.split('\n\n')[1]!);
  const redirected = await call(url.pathname + url.search);
  expect(redirected.statusCode).toBe(302);
  const token = new URL(String(redirected.headers.location)).searchParams.get('token');
  const next = 'a new email workflow password';
  expect((await call('/api/auth/reset-password', { token, newPassword: next })).statusCode).toBe(
    200,
  );
  expect(
    (await call('/api/auth/reset-password', { token, newPassword: password })).statusCode,
  ).toBe(400);
  expect((await call('/api/auth/sign-in/email', { email, password })).statusCode).toBe(401);
  expect((await call('/api/auth/sign-in/email', { email, password: next })).statusCode).toBe(200);
});

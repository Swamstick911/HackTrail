import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlatformStore } from './store.js';
import { createAuthentication } from './auth.js';
import { createPlatform } from './app.js';

const port = Number(process.env.HACKTRAIL_PLATFORM_PORT ?? 47657);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('HACKTRAIL_PLATFORM_PORT must be between 1024 and 65535.');
const origin = process.env.HACKTRAIL_ORIGIN ?? 'http://127.0.0.1:' + port;
const url = new URL(origin);
if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
  throw new Error('HACKTRAIL_ORIGIN must be an HTTP(S) origin without a trailing slash.');
const production = process.env.NODE_ENV === 'production';
if (production && url.protocol !== 'https:')
  throw new Error('Production requires an HTTPS HACKTRAIL_ORIGIN.');
const directory = resolve(process.env.HACKTRAIL_PLATFORM_DATA_DIR ?? '.hacktrail-platform');
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (process.platform !== 'win32') chmodSync(directory, 0o700);
let secret = process.env.HACKTRAIL_AUTH_SECRET;
if (!secret) {
  if (production) throw new Error('Set a persistent HACKTRAIL_AUTH_SECRET in production.');
  const path = resolve(directory, 'auth.secret');
  try {
    secret = readFileSync(path, 'utf8').trim();
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
    secret = randomBytes(48).toString('base64url');
    try {
      writeFileSync(path, secret, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
        throw error;
      secret = readFileSync(path, 'utf8').trim();
    }
  }
}
if (secret.length < 32)
  throw new Error('HACKTRAIL_AUTH_SECRET must contain at least 32 characters.');
const smtpUrl = process.env.HACKTRAIL_SMTP_URL;
const mailFrom = process.env.HACKTRAIL_MAIL_FROM;
if (Boolean(smtpUrl) !== Boolean(mailFrom))
  throw new Error('Set both HACKTRAIL_SMTP_URL and HACKTRAIL_MAIL_FROM.');
if (production && !smtpUrl)
  throw new Error('Configure account verification and recovery email before production use.');
const store = new PlatformStore(resolve(directory, 'activity.sqlite'));
const authentication = await createAuthentication({
  databasePath: resolve(directory, 'auth.sqlite'),
  origin,
  secret,
  smtpUrl,
  mailFrom,
  registrationOpen: process.env.HACKTRAIL_REGISTRATION_OPEN !== 'false',
  onDeleteAccount: (id) => store.deleteAccount(id),
});
const here = dirname(fileURLToPath(import.meta.url));
const app = createPlatform({
  store,
  authentication,
  origin,
  emailEnabled: Boolean(smtpUrl),
  registrationOpen: process.env.HACKTRAIL_REGISTRATION_OPEN !== 'false',
  webRoot: resolve(here, '../platform-web'),
  extensionPath: resolve(here, '../../releases/hacktrail.vsix'),
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  authentication.close();
  store.close();
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
try {
  await app.listen({ host: process.env.HACKTRAIL_PLATFORM_HOST ?? '127.0.0.1', port });
  console.log('HackTrail platform: ' + origin);
  console.log('Platform data: ' + directory);
} catch (error) {
  await shutdown();
  console.error(error instanceof Error ? error.message : 'Could not start the platform.');
  process.exitCode = 1;
}

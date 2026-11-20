import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActivityStore } from './store.js';
import { createApp } from './app.js';

const dataDirectory = resolve(process.env.HACKTRAIL_DATA_DIR ?? '.hacktrail');
const port = Number(process.env.HACKTRAIL_PORT ?? 47654);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('HACKTRAIL_PORT must be between 1024 and 65535.');
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
if (process.platform !== 'win32') chmodSync(dataDirectory, 0o700);

const tokenPath = resolve(dataDirectory, 'collector.token');
let token: string;
try {
  token = readFileSync(tokenPath, 'utf8').trim();
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
    throw error;
  token = randomBytes(32).toString('hex');
  writeFileSync(tokenPath, token + '\n', { mode: 0o600, flag: 'wx' });
}
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('The local token file is invalid.');
if (process.platform !== 'win32') chmodSync(tokenPath, 0o600);

const databasePath = resolve(dataDirectory, 'activity.sqlite');
const store = new ActivityStore(databasePath);
if (process.platform !== 'win32') chmodSync(databasePath, 0o600);
const directory = dirname(fileURLToPath(import.meta.url));
const app = createApp({
  store,
  token,
  port,
  webRoot: resolve(directory, '../web'),
  development: directory.includes('/src/server') || directory.includes('\\src\\server'),
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  store.close();
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log('HackTrail is running at http://127.0.0.1:' + port);
  console.log('Local data: ' + dataDirectory);
} catch (error) {
  store.close();
  console.error(error instanceof Error ? error.message : 'Could not start the collector.');
  process.exitCode = 1;
}

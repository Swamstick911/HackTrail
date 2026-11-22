import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHook } from './hook-runner.js';
import { codexEvents } from './codex-events.js';

await runHook(
  dirname(fileURLToPath(import.meta.url)),
  'codex-connection.json',
  'codex-hook-queue',
  codexEvents,
);

process.stdout.write('{}\n');

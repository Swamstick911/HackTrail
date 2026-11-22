import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHook } from './hook-runner.js';
import { hookEvents } from './hook-events.js';

await runHook(dirname(fileURLToPath(import.meta.url)), 'connection.json', 'hook-queue', hookEvents);

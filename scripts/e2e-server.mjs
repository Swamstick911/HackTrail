import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const directory = mkdtempSync(join(tmpdir(), 'hacktrail-browser-'));
const server = spawn(process.execPath, ['dist/server/main.js'], {
  stdio: 'inherit',
  env: { ...process.env, HACKTRAIL_DATA_DIR: directory, HACKTRAIL_PORT: '47655' },
});
server.on('exit', (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
process.on('SIGTERM', () => server.kill('SIGTERM'));
process.on('SIGINT', () => server.kill('SIGINT'));

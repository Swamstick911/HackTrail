import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const directory = mkdtempSync(join(tmpdir(), 'hacktrail-platform-browser-'));
const server = spawn(process.execPath, ['dist/platform/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HACKTRAIL_PLATFORM_DATA_DIR: directory,
    HACKTRAIL_PLATFORM_PORT: '47658',
    HACKTRAIL_ORIGIN: 'http://127.0.0.1:47658',
  },
});
const collector = spawn(process.execPath, ['dist/server/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HACKTRAIL_DATA_DIR: join(directory, 'collector'),
    HACKTRAIL_PORT: '47659',
  },
});
server.on('exit', (code) => {
  collector.kill('SIGTERM');
  collector.once('exit', () => {
    rmSync(directory, { recursive: true, force: true });
    process.exit(code ?? 0);
  });
});
process.on('SIGTERM', () => server.kill('SIGTERM'));
process.on('SIGINT', () => server.kill('SIGINT'));

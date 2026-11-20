import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalClient } from '../../src/shared/local-client.js';

test('the extension collector runs without the repository or node_modules', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hacktrail-portable-'));
  const extension = join(directory, 'extension');
  cpSync(resolve('extensions/vscode/dist'), extension, { recursive: true });
  const child = spawn(process.execPath, [join(extension, 'collector.mjs')], {
    cwd: directory,
    env: {
      ...process.env,
      HACKTRAIL_DATA_DIR: join(directory, 'data'),
      HACKTRAIL_PORT: '47656',
      HACKTRAIL_WEB_ROOT: join(extension, 'web'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  try {
    const url = 'http://127.0.0.1:47656';
    await expect
      .poll(async () => {
        if (child.exitCode !== null) throw new Error(output);
        return fetch(url + '/api/health')
          .then((response) => response.ok)
          .catch(() => false);
      })
      .toBe(true);
    expect(await (await fetch(url)).text()).toContain('<div id="root">');
    const client = new LocalClient(url);
    const project = await client.request<{ id: string }>('/workspaces/resolve', {
      key: 'd'.repeat(64),
      name: 'Portable project',
    });
    const again = await client.request<{ id: string }>('/workspaces/resolve', {
      key: 'd'.repeat(64),
      name: 'Portable project',
    });
    expect(again.id).toBe(project.id);
    const now = Date.now();
    const heartbeat = await client.request<{ inserted: number }>('/tracking/heartbeat', {
      projectId: project.id,
      clientId: 'portable-editor',
      label: 'VS Code',
      state: 'active',
      samples: [
        {
          id: 'portable-sample',
          projectId: project.id,
          startedAt: new Date(now - 15_000).toISOString(),
          endedAt: new Date(now).toISOString(),
          signal: 'keyboard',
        },
      ],
    });
    expect(heartbeat.inserted).toBe(1);
    const exported = await client.request<{ tracking: { totalMs: number } }>(
      '/projects/' + project.id + '/export',
    );
    expect(exported.tracking.totalMs).toBe(15_000);
  } finally {
    child.kill('SIGTERM');
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
});

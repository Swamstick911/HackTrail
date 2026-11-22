import { expect, test } from '@playwright/test';
import { transcript } from '../fixtures.js';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connectClaude } from '../../src/cli/connect-claude.js';
import { connectCodex } from '../../src/integrations/codex.js';

test.beforeEach(async ({ request }) => {
  const session = await request.get('/api/session');
  const { token } = await session.json();
  const headers = { Authorization: 'Bearer ' + token };
  await request.post('/api/tracking/pause', { headers, data: { paused: false } });
  const response = await request.get('/api/projects', { headers });
  for (const project of await response.json()) {
    const deleted = await request.delete('/api/projects/' + project.id, { headers });
    expect(deleted.status()).toBe(204);
  }
});

for (const adapter of ['claude', 'codex'] as const) {
  const connect = adapter === 'claude' ? connectClaude : connectCodex;
  test(
    adapter + ' setup preserves hooks, delivers live events, retries offline, and disconnects',
    async ({ request }) => {
      const { token } = await (await request.get('/api/session')).json();
      const headers = { Authorization: 'Bearer ' + token };
      const project = await (
        await request.post('/api/projects', { headers, data: { name: 'Claude integration test' } })
      ).json();
      const workspace = mkdtempSync(join(tmpdir(), 'hacktrail-hooks-'));
      const options = {
        workspace,
        projectId: project.id,
        url: 'http://127.0.0.1:47655',
        bundlePath: resolve('dist/cli/' + adapter + '-hook.mjs'),
      };
      try {
        mkdirSync(join(workspace, '.' + adapter));
        const settingsPath = join(
          workspace,
          adapter === 'claude' ? '.claude/settings.local.json' : '.codex/hooks.json',
        );
        writeFileSync(
          settingsPath,
          JSON.stringify({
            env: { KEEP: 'value' },
            hooks: {
              PreToolUse: [
                { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing-hook' }] },
              ],
            },
          }),
        );
        await connect(options);
        await connect(options);
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        expect(settings.env.KEEP).toBe('value');
        expect(settings.hooks.PreToolUse).toHaveLength(2);
        function run(hook: string) {
          execFileSync(process.execPath, [join(workspace, '.hacktrail', adapter + '-hook.mjs')], {
            input: JSON.stringify({
              hook_event_name: hook,
              session_id: 'live-test-session',
              tool_name: 'Bash',
              tool_use_id: 'live-tool',
              prompt: 'PRIVATE_PROMPT',
              tool_input: { command: 'PRIVATE_COMMAND' },
              tool_response: { exit_code: 1, output: 'PRIVATE_OUTPUT' },
            }),
            timeout: 5000,
          });
        }
        run('UserPromptSubmit');
        run('PreToolUse');
        run(adapter === 'claude' ? 'PostToolUseFailure' : 'PostToolUse');
        run('Stop');
        const exported = await (
          await request.get('/api/projects/' + project.id + '/export', { headers })
        ).json();
        expect(exported.events).toHaveLength(5);
        expect(JSON.stringify(exported)).not.toContain('PRIVATE_');
        expect(
          exported.events.find((event: { kind: string }) => event.kind === 'tool_result').metadata
            .success,
        ).toBe(false);
        const connectionPath = join(
          workspace,
          '.hacktrail',
          adapter === 'claude' ? 'connection.json' : 'codex-connection.json',
        );
        writeFileSync(
          connectionPath,
          JSON.stringify({ projectId: project.id, url: 'http://127.0.0.1:1' }),
        );
        run('UserPromptSubmit');
        expect(
          readdirSync(
            join(workspace, '.hacktrail', adapter === 'claude' ? 'hook-queue' : 'codex-hook-queue'),
          ),
        ).toHaveLength(1);
        writeFileSync(connectionPath, JSON.stringify({ projectId: project.id, url: options.url }));
        run('Stop');
        expect(
          readdirSync(
            join(workspace, '.hacktrail', adapter === 'claude' ? 'hook-queue' : 'codex-hook-queue'),
          ),
        ).toHaveLength(0);
        const latest = await (
          await request.get('/api/projects/' + project.id + '/export', { headers })
        ).json();
        expect(latest.events).toHaveLength(8);
        if (adapter === 'codex') {
          const queue = join(workspace, '.hacktrail/codex-hook-queue');
          for (let index = 0; index < 5000; index++)
            writeFileSync(join(queue, index + '.json'), JSON.stringify([latest.events[0]]));
          run('Stop');
          expect(readdirSync(queue)).toHaveLength(4900);
        }
        await connect({ ...options, remove: true });
        const removed = JSON.parse(readFileSync(settingsPath, 'utf8'));
        expect(removed.env.KEEP).toBe('value');
        expect(removed.hooks.PreToolUse).toHaveLength(1);
        expect(removed.hooks.PreToolUse[0].hooks[0].command).toBe('echo existing-hook');
        const download = await request.get('/api/integrations/vscode', { headers });
        expect(download.ok()).toBe(true);
        expect((await download.body()).subarray(0, 2).toString()).toBe('PK');
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );
}

test('example timeline is labeled, inspectable, and responsive', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:47655')) externalRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore an example', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orbit Notes', exact: true })).toBeVisible();
  await expect(page.locator('.example-banner')).toContainText('synthetic activity');
  await expect(page.getByRole('button', { name: 'Inspect User message', exact: true })).toHaveCount(
    3,
  );
  await page.getByRole('button', { name: 'Inspect User message', exact: true }).first().click();
  await expect(page.getByRole('complementary', { name: 'Event details' })).toContainText(
    'Original record',
  );
  await page.screenshot({ path: testInfo.outputPath('timeline-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close event details' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import activity', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('timeline-mobile.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('create, preview, import, inspect, export, replay, and delete', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name').fill('Browser test project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser test project', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Connect your tools' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enable in VS Code' })).toHaveAttribute(
    'href',
    /^vscode:\/\/swamstick911\.hacktrail\/enable\?projectId=/,
  );
  await expect(page.getByRole('dialog')).toContainText(
    'No Claude account connection or terminal command',
  );
  await page.screenshot({ path: testInfo.outputPath('setup-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('setup-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Close dialog' }).click();

  async function importFile() {
    await page.getByRole('button', { name: 'Import activity', exact: true }).click();
    await page.getByLabel('Transcript file').setInputFiles({
      name: 'test-session.jsonl',
      mimeType: 'application/jsonl',
      buffer: Buffer.from(transcript()),
    });
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await expect(page.getByText('4 events ready to import')).toBeVisible();
    await page.getByRole('button', { name: 'Import 4 events', exact: true }).click();
  }

  await importFile();
  await expect(page.getByRole('status').filter({ hasText: '4 events imported' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect Tool result', exact: true })).toHaveCount(
    1,
  );
  await page.getByLabel('Filter by actor').selectOption('tool');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inspect Tool result', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Event details' })).toContainText('Line 4');
  await expect(page.locator('body')).not.toContainText('Private project question');
  await page.getByLabel('Filter by actor').selectOption('');
  await page.getByLabel('Search activity').fill('Bash');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await page.getByLabel('Search activity').fill('');
  await expect(page.locator('.event-row')).toHaveCount(4);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^hacktrail-.+\.json$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.events).toHaveLength(4);
  expect(JSON.stringify(exported)).not.toContain('Private project question');

  await page.reload();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser test project', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.event-row')).toHaveCount(4);
  await importFile();
  await expect(
    page.getByRole('status').filter({ hasText: '0 events imported. 4 duplicates skipped.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete project', exact: true })
    .click();
  await expect(page.getByRole('navigation', { name: 'Projects' })).not.toContainText(
    'Browser test project',
  );
});

test('live editor time, pause controls, notes, and review update without reload', async ({
  page,
  request,
}, testInfo) => {
  const { token } = await (await request.get('/api/session')).json();
  const headers = { Authorization: 'Bearer ' + token };
  const project = await (
    await request.post('/api/projects', { headers, data: { name: 'Building a better search' } })
  ).json();
  await page.goto('/');
  await expect(page.getByTestId('today-time')).toHaveText('0s');
  const end = Date.now() - 1000;
  const samples = Array.from({ length: 3 }, (_, index) => ({
    id: 'browser-time-' + index,
    projectId: project.id,
    startedAt: new Date(end - (3 - index) * 15_000).toISOString(),
    endedAt: new Date(end - (2 - index) * 15_000).toISOString(),
    signal: 'keyboard',
  }));
  const heartbeat = {
    clientId: 'browser-editor',
    projectId: project.id,
    label: 'VS Code',
    state: 'active',
    samples,
  };
  expect((await request.post('/api/tracking/heartbeat', { headers, data: heartbeat })).ok()).toBe(
    true,
  );
  await expect(page.getByTestId('today-time')).toHaveText('45s', { timeout: 10_000 });
  await expect(page.getByText('Tracking editor activity')).toBeVisible();
  await page.getByRole('button', { name: 'Pause tracking', exact: true }).click();
  await expect(page.getByText('Tracking paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume tracking', exact: true }).click();
  await expect(page.getByText('Tracking editor activity')).toBeVisible();
  await page
    .getByLabel('Work note', { exact: true })
    .fill('Fixed keyboard navigation and checked the empty state.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator('.saved-notes')).toContainText('Fixed keyboard navigation');
  await page.screenshot({ path: testInfo.outputPath('today-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('today-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('.review-panel')).toContainText('45s');
  await expect(page.locator('.review-panel')).toContainText('Fixed keyboard navigation');
  await page.getByRole('button', { name: 'Read the counting rules' }).click();
  await expect(page.getByRole('dialog')).toContainText('2 minutes');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await expect(page.getByTestId('today-time')).toHaveText('45s');
});

test('Git-linked sessions and agent overlap remain inspectable on desktop and mobile', async ({
  page,
  request,
}, testInfo) => {
  const { token } = await (await request.get('/api/session')).json();
  const headers = { Authorization: 'Bearer ' + token };
  const project = await (
    await request.post('/api/projects', { headers, data: { name: 'Evidence workflow' } })
  ).json();
  const now = Date.now() - 120_000;
  const at = (offset: number) => new Date(now + offset).toISOString();
  const git = {
    repositoryId: 'a'.repeat(64),
    commit: 'b'.repeat(40),
    branch: 'feature/session-context',
  };
  const heartbeat = await request.post('/api/tracking/heartbeat', {
    headers,
    data: {
      projectId: project.id,
      clientId: 'evidence-editor',
      label: 'VS Code',
      state: 'active',
      samples: [
        {
          id: 'evidence-sample',
          projectId: project.id,
          startedAt: at(-30_000),
          endedAt: at(0),
          signal: 'keyboard',
          git,
        },
      ],
    },
  });
  expect(heartbeat.ok()).toBe(true);
  const events = [
    {
      id: 'evidence-start',
      kind: 'agent_started',
      source: 'codex',
      actor: 'agent',
      occurredAt: at(-60_000),
      metadata: { sessionId: 'session-one', turnId: 'turn-one', hook: 'UserPromptSubmit' },
    },
    {
      id: 'evidence-stop',
      kind: 'agent_stopped',
      source: 'codex',
      actor: 'agent',
      occurredAt: at(0),
      metadata: { sessionId: 'session-one', turnId: 'turn-one', hook: 'Stop' },
    },
    {
      id: 'evidence-git',
      kind: 'git_checkpoint',
      source: 'git',
      actor: 'unknown',
      occurredAt: at(-30_000),
      metadata: {
        git,
        checkpointReason: 'head-changed',
        filesChanged: 2,
        linesAdded: 4,
        linesDeleted: 1,
      },
    },
  ].map((event) => ({ ...event, schemaVersion: 1, projectId: project.id }));
  expect((await request.post('/api/events', { headers, data: { events } })).ok()).toBe(true);
  await page.clock.setFixedTime(new Date(now));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Evidence workflow', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recent Git checkpoints' })).toBeVisible();
  await page.locator('.session-row summary').click();
  await expect(page.locator('.session-git')).toContainText('bbbbbbbbbb');
  await expect(page.locator('.checkpoint-list')).toContainText('2 changed files');
  await page.screenshot({ path: testInfo.outputPath('evidence-today.png'), fullPage: true });
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByTestId('agent-overlap')).toHaveText('30s');
  await expect(page.getByTestId('agent-without-editor')).toHaveText('30s');
  await page.screenshot({ path: testInfo.outputPath('evidence-review.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('evidence-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect Git checkpoint' }).click();
  await expect(page.getByRole('complementary', { name: 'Event details' })).toContainText(
    git.commit,
  );
  const exported = await (
    await request.get('/api/projects/' + project.id + '/export', { headers })
  ).json();
  expect(exported.tracking.samples[0].git).toEqual(git);
  expect(exported.tracking.totalMs).toBe(30_000);
});

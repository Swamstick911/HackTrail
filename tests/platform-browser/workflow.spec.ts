import { expect, test, type Page } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';
import { LocalClient } from '../../src/shared/local-client.js';
import { syncBatch, type SyncConnection } from '../../extensions/vscode/src/platform-client.js';
const password = 'a unique browser test password';
async function signup(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Username', { exact: true }).fill(name.toLowerCase());
  await page.getByLabel('Email', { exact: true }).fill(name.toLowerCase() + '@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep going, ' + name + '.' })).toBeVisible();
}
async function sync(page: Page, token: string, name: string) {
  const now = Date.now() - 120_000;
  const samples = Array.from({ length: 30 }, (_, i) => ({
    id: 'sample-' + i,
    projectId: 'local-project',
    startedAt: new Date(now - 600_000 + i * 20_000).toISOString(),
    endedAt: new Date(now - 580_000 + i * 20_000).toISOString(),
    signal: 'keyboard',
    language: 'TypeScript',
    editor: 'VS Code',
  }));
  const response = await page.request.post('/api/sync', {
    headers: { Authorization: 'Bearer ' + token },
    data: {
      project: { localId: 'local-project', name },
      clientId: 'local-collector',
      label: 'VS Code',
      state: 'active',
      samples,
      events: [
        {
          schemaVersion: 1,
          id: 'agent-start',
          projectId: 'local-project',
          occurredAt: new Date(now - 300_000).toISOString(),
          source: 'claude-code',
          actor: 'agent',
          kind: 'agent_started',
          metadata: { sessionId: 'session-one' },
        },
        {
          schemaVersion: 1,
          id: 'agent-stop',
          projectId: 'local-project',
          occurredAt: new Date(now).toISOString(),
          source: 'claude-code',
          actor: 'agent',
          kind: 'agent_stopped',
          metadata: { sessionId: 'session-one' },
        },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).projectId as string;
}

test('a builder approves an editor, syncs activity, publishes a project, and shares a reviewed report', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signup(page, 'Alice');
  const verifier = randomBytes(32).toString('base64url');
  const started = await page.request.post('/api/devices/start', {
    data: {
      label: 'VS Code test device',
      challenge: createHash('sha256').update(verifier).digest('base64url'),
    },
  });
  const device = await started.json();
  await page.goto(device.verificationUrl);
  await expect(page.getByRole('heading', { name: 'VS Code test device' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve connection' }).click();
  await expect(page.getByRole('heading', { name: 'You are connected.' })).toBeVisible();
  const approved = await page.request.post('/api/devices/poll', {
    data: { deviceCode: device.deviceCode, verifier },
  });
  const credential = await approved.json();
  expect(credential.status).toBe('approved');
  const projectId = await sync(page, credential.token, 'Garden Journal');
  await page.goto('/');
  await expect(page.locator('.stats-grid').getByText('10m', { exact: true })).toBeVisible();
  await expect(page.locator('.stats-grid').getByText('5m', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Garden Journal', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('dashboard-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Garden Journal', exact: true }).click();
  await page.getByLabel('Project note').fill('I fixed the date filter and tested the empty state.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(
    page.locator('.activity-list').getByText('I fixed the date filter and tested the empty state.'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Project settings' }).click();
  await page.getByLabel('What are you making?').fill('A small journal for a growing garden.');
  await page.getByLabel('Repository URL').fill('https://github.com/example/garden-journal');
  await page.getByLabel('Project visibility').selectOption('public');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByText('Project settings saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Share a report' }).click();
  await page.getByLabel('Include work notes').check();
  await page.getByRole('button', { name: 'Preview report' }).click();
  await expect(page.getByRole('heading', { name: 'Your disclosure preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Create share link' }).click();
  await expect(page.getByLabel('Report link', { exact: true })).toBeVisible();
  const url = await page.getByLabel('Report link', { exact: true }).inputValue();
  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  await guest.goto(url);
  await expect(guest.getByRole('heading', { name: 'Garden Journal' })).toBeVisible();
  await expect(
    guest.getByText('I fixed the date filter and tested the empty state.'),
  ).toBeVisible();
  await guest.goto('http://127.0.0.1:47658/u/alice');
  await expect(guest.getByRole('heading', { name: 'Alice' })).toBeVisible();
  await expect(guest.locator('.stats-grid').getByText('10m', { exact: true })).toBeVisible();
  await expect(guest.getByText('I fixed the date filter and tested the empty state.')).toHaveCount(
    0,
  );
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(
    page.getByRole('heading', { name: 'Share the story behind a project.' }),
  ).toBeVisible();
  await guest.goto(url);
  await expect(guest.getByRole('alert')).toContainText('revoked');
  await page.goto('/connections');
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm revoke' }).click();
  const rejected = await page.request.post('/api/sync', {
    headers: { Authorization: 'Bearer ' + credential.token },
    data: {},
  });
  expect(rejected.status()).toBe(401);
  await page.goto('/projects/' + projectId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('project-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await anonymous.close();
});

test('settings, API keys, private profiles, account pause, and account deletion work from the browser', async ({
  page,
}) => {
  await signup(page, 'Morgan');
  await page.getByRole('button', { name: 'Pause account time' }).click();
  await expect(page.getByText('Account time is paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume account time' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Time zone', { exact: true }).fill('Asia/Kolkata');
  await page.getByLabel('Daily goal, in minutes').fill('45');
  await page.getByLabel('Make my profile public').uncheck();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Your preferences are saved.')).toBeVisible();
  expect((await page.request.get('/api/public/profiles/morgan')).status()).toBe(404);
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.getByText('Create an API key', { exact: true }).click();
  await page.getByLabel('Key name').fill('Read-only integration');
  await page.getByLabel('Permission').selectOption('read:stats');
  await page.getByRole('button', { name: 'Create key', exact: true }).click();
  const token = await page.getByLabel('New API key').inputValue();
  const response = await page.request.get('/api/dashboard', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(response.status()).toBe(200);
  await page.getByRole('button', { name: 'I have saved it' }).click();
  await expect(page.getByLabel('New API key')).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByLabel('Type morgan to confirm').fill('morgan');
  await page.getByLabel('Confirm with your password').fill(password);
  await page.getByRole('button', { name: 'Permanently delete my account' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(
    (
      await page.request.get('/api/dashboard', { headers: { Authorization: 'Bearer ' + token } })
    ).status(),
  ).toBe(401);
});

test('mobile authentication and empty states stay usable without horizontal scrolling', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page, 'Sam');
  await expect(page.getByRole('button', { name: 'Connect your editor' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('empty-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Start with something you care about.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Little Clock');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Little Clock', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Project settings' }).click();
  await page.getByRole('button', { name: 'Delete this project' }).click();
  await page.getByRole('button', { name: 'Permanently delete Little Clock' }).click();
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
});

test('the real local collector syncs through the extension client without sending local notes', async ({
  page,
}) => {
  await signup(page, 'Taylor');
  const keyResponse = await page.request.post('/api/keys', {
    data: { label: 'Collector connection', scopes: ['write:activity'] },
  });
  const key = await keyResponse.json();
  const profile = await (await page.request.get('/api/me')).json();
  const local = new LocalClient('http://127.0.0.1:47659');
  const project = await local.request<{ id: string }>('/projects', { name: 'Offline Garden' });
  const now = Date.now() - 120_000;
  await local.request('/tracking/heartbeat', {
    clientId: 'browser-editor',
    projectId: project.id,
    label: 'VS Code',
    state: 'idle',
    samples: [
      {
        id: 'browser-sample',
        projectId: project.id,
        startedAt: new Date(now - 15000).toISOString(),
        endedAt: new Date(now).toISOString(),
        signal: 'keyboard',
        language: 'TypeScript',
        editor: 'VS Code',
      },
    ],
  });
  await local.request('/projects/' + project.id + '/notes', { text: 'This note must stay local.' });
  const connection: SyncConnection = {
    origin: 'http://127.0.0.1:47658',
    accountId: profile.id,
    deviceId: key.id,
    handle: profile.handle,
    projectId: project.id,
    cursor: 0,
    includeGit: false,
    includeAgents: false,
  };
  const result = await syncBatch(local, connection, key.token);
  await syncBatch(local, connection, key.token);
  await page.goto('/projects/' + result.connection.remoteProjectId);
  await expect(page.getByRole('heading', { name: 'Offline Garden', exact: true })).toBeVisible();
  await expect(page.locator('.stats-grid').getByText('15s', { exact: true })).toBeVisible();
  const exported = await page.request.get(
    '/api/projects/' + result.connection.remoteProjectId + '/export',
  );
  expect(await exported.text()).not.toContain('This note must stay local.');
});

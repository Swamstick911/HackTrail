import { expect, test } from '@playwright/test';
import { transcript } from '../fixtures.js';

test.beforeEach(async ({ request }) => {
  const session = await request.get('/api/session');
  const { token } = await session.json();
  const headers = { Authorization: 'Bearer ' + token };
  const response = await request.get('/api/projects', { headers });
  for (const project of await response.json()) {
    const deleted = await request.delete('/api/projects/' + project.id, { headers });
    expect(deleted.status()).toBe(204);
  }
});

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

test('create, preview, import, inspect, export, replay, and delete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name').fill('Browser test project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser test project', exact: true }),
  ).toBeVisible();

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
  await expect(page.getByRole('status')).toContainText('4 events imported');
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
  await expect(
    page.getByRole('heading', { name: 'Browser test project', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.event-row')).toHaveCount(4);
  await importFile();
  await expect(page.getByRole('status')).toContainText('0 events imported. 4 duplicates skipped.');
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete project', exact: true })
    .click();
  await expect(page.getByRole('navigation', { name: 'Projects' })).not.toContainText(
    'Browser test project',
  );
});

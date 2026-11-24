import { expect, test } from '@playwright/test';
import { durationLabel } from '../../src/shared/tracking.js';
import type { Dashboard } from '../../src/platform/analytics.js';

test.use({ hasTouch: true });

// Exercise the chart with recorded intervals, including a day with no activity.
test('activity can be explored by keyboard and touch across periods and screen sizes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath('signin-desktop.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('signin-mobile.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name').fill('Avery');
  await page.getByLabel('Username', { exact: true }).fill('avery');
  await page.getByLabel('Email', { exact: true }).fill('avery@example.test');
  await page.getByLabel('Password', { exact: true }).fill('a unique design test password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep going, Avery.' })).toBeVisible();
  const keyResponse = await page.request.post('/api/keys', {
    data: { label: 'Design test editor', scopes: ['write:activity'] },
  });
  expect(keyResponse.status()).toBe(201);
  const { token } = await keyResponse.json();
  const today = new Date().toISOString().slice(0, 10);
  const projects = [
    { name: 'Garden Journal', language: 'TypeScript', minutes: [12, 25, 0, 35, 30, 22, 20] },
    { name: 'Tiny Weather', language: 'CSS', minutes: [6, 20, 0, 25, 12, 4, 15] },
    { name: 'Pocket Synth', language: 'JavaScript', minutes: [0, 10, 0, 0, 0, 8, 12] },
  ];
  for (const [projectIndex, project] of projects.entries()) {
    const localId = 'design-project-' + projectIndex;
    const samples = project.minutes.flatMap((minutes, day) => {
      const end =
        Math.min(Date.parse(today + 'T12:00:00Z') - (6 - day) * 86400_000, Date.now() - 180_000) -
        projectIndex * 3600_000;
      return Array.from({ length: minutes * 2 }, (_, sample) => ({
        id: `${localId}-${day}-${sample}`,
        projectId: localId,
        startedAt: new Date(end - (minutes * 2 - sample) * 30_000).toISOString(),
        endedAt: new Date(end - (minutes * 2 - sample - 1) * 30_000).toISOString(),
        signal: 'keyboard',
        language: project.language,
        editor: 'VS Code',
      }));
    });
    const response = await page.request.post('/api/sync', {
      headers: { Authorization: 'Bearer ' + token },
      data: {
        project: { localId, name: project.name },
        clientId: 'design-editor',
        label: 'VS Code',
        state: 'idle',
        samples,
        events: [],
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  }
  const recorded: Dashboard = await (await page.request.get('/api/dashboard?days=7')).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const chart = page.getByRole('group', { name: 'Daily editor activity' });
  const days = chart.getByRole('radio');
  await expect(days).toHaveCount(7);
  const latestLabel = await days.last().getAttribute('aria-label');
  await expect(days.last()).toBeChecked();
  await days.last().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(days.nth(5)).toBeChecked();
  await expect(page.locator('.chart-readout strong')).toHaveText(
    durationLabel(recorded.daily[5]!.totalMs),
  );
  await chart.locator('.day-column').nth(2).click();
  await expect(page.locator('.chart-readout strong')).toHaveText('0s');
  const zeroBar = await chart.locator('.bar').nth(2).boundingBox();
  expect(zeroBar?.height).toBe(0);
  await chart.locator('.day-column').last().click();
  await page.mouse.move(0, 0);
  await chart.locator('.day-label').first().hover();
  await expect(page.locator('.chart-readout strong')).toHaveText('18m');
  await page.mouse.move(0, 0);
  await expect(page.locator('.chart-readout strong')).toHaveText(
    durationLabel(recorded.daily.at(-1)!.totalMs),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('workspace-desktop.png'),
    animations: 'disabled',
    fullPage: true,
  });

  await page.getByLabel('Statistics period').selectOption('1');
  await expect(days).toHaveCount(1);
  await expect(days.first()).toBeChecked();
  await expect(days.first()).toHaveAttribute('aria-label', latestLabel!);
  await page.getByLabel('Statistics period').selectOption('30');
  await expect(days).toHaveCount(30);
  const selectedColumn = chart.locator('.day-column').last();
  const scrollBounds = await page.locator('.chart-scroll').boundingBox();
  const selectedBounds = await selectedColumn.boundingBox();
  expect(selectedBounds!.x + selectedBounds!.width).toBeLessThanOrEqual(
    scrollBounds!.x + scrollBounds!.width + 1,
  );
  await days.first().focus();
  await page.keyboard.press('Space');
  await expect(days.first()).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(days.nth(1)).toBeChecked();
  await expect(page.locator('.chart-readout strong')).toHaveText('0s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Statistics period').selectOption('7');
  await expect(days).toHaveCount(7);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0);
  for (const width of [320, 390, 768, 900, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Overflow at ${width}px`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await chart.locator('.day-column').nth(1).tap();
  await expect(days.nth(1)).toBeChecked();
  await expect(page.locator('.chart-readout strong')).toHaveText('55m');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('workspace-mobile.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByLabel('Statistics period').selectOption('30');
  await expect(days).toHaveCount(30);
  await chart.locator('.day-column').last().click();
  await expect(days.last()).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Adjust goal' }).click();
  await expect(page.getByLabel('Daily goal, in minutes')).toBeVisible();
  await page.getByLabel('Daily goal, in minutes').fill('0');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Your preferences are saved.')).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: "Today's goal progress" })).toHaveAttribute(
    'aria-valuetext',
    'No daily goal set',
  );
  await expect(page.getByRole('button', { name: 'Set a daily goal' })).toBeVisible();
  expect(errors).toEqual([]);
});

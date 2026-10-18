import { expect, test } from '@playwright/test';
import path from 'node:path';

test('handouts preview locally, publish to late joiners and hide across player tabs', async ({ page, context }) => {
  test.setTimeout(240_000);
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Handout verification ${Date.now()}` } }
  });
  expect(created.ok()).toBe(true);
  const { party } = await created.json();
  const player = await context.newPage();
  try {
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Handouts' } }
    });
    const { gameSession } = await response.json();
    await page.goto(`/${party.slug}/${gameSession.slug}`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
    await expect(page.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
    const dismiss = page.getByTestId('checklistDismissButton');
    if (await dismiss.isVisible()) await dismiss.click();
    await page.keyboard.press('m');
    await page.getByRole('tab', { name: /^Handout/ }).click();
    const controls = page.locator('#sidePanel-handout');
    await controls
      .getByLabel('Upload handout image', { exact: true })
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(controls.getByTestId('handoutPreview').locator('img')).toBeVisible({ timeout: 30_000 });
    await controls.getByLabel('Handout title', { exact: true }).fill('Shared illustration');
    await expect(controls.getByRole('button', { name: 'Hide handout', exact: true })).toHaveCount(0);
    await controls.getByRole('button', { name: 'Show to players', exact: true }).click();
    await expect(controls.getByRole('status')).toHaveText('Showing Shared illustration to players');
    await player.goto(`/${party.slug}/play`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    const overlay = player.getByTestId('handoutOverlay');
    await expect(overlay).toBeVisible({ timeout: 55_000 });
    await expect(overlay.getByRole('img', { name: 'Shared illustration' })).toBeVisible();
    expect(await overlay.locator('img').evaluate((image) => getComputedStyle(image).objectFit)).toBe('contain');
    await player.reload({ waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(overlay).toBeVisible({ timeout: 55_000 });
    await controls.getByRole('button', { name: 'Hide handout', exact: true }).click();
    await expect(overlay).toHaveCount(0, { timeout: 20_000 });
    await controls.getByRole('button', { name: 'Show to players', exact: true }).click();
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    await page.close();
    await expect(overlay).toBeVisible();
  } finally {
    await player.close();
    await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
  }
});

test('viewer handouts respect pause and sleeping views wake when a presentation changes', async ({
  page,
  context,
  browser
}, testInfo) => {
  test.setTimeout(240_000);
  const { randomUUID } = await import('node:crypto');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const email = `handout-${randomUUID()}@example.test`;
  const password = randomUUID();
  const viewerContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: 'http://192.168.1.26:5174'
  });
  const signup = await viewerContext.request.post('/api/auth/signup', {
    data: { email, password, confirmPassword: password }
  });
  expect(signup.ok()).toBe(true);
  const directory = path.resolve('../../.local-data/clipboard-verification/handout-accounts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(directory, `${testInfo.project.name}-${Date.now()}.json`),
    JSON.stringify({ email, password, state: await viewerContext.storageState() }),
    { mode: 0o600 }
  );
  const profile = await viewerContext.request.post('/api/auth/updateUser', {
    data: { userData: { name: 'Handout viewer verification' } }
  });
  const { user } = await profile.json();
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Handout permissions ${Date.now()}` } }
  });
  const { party } = await created.json();
  const viewer = await viewerContext.newPage();
  try {
    const invitation = await context.request.post('/api/partyInvite/createPartyInvite', {
      data: { partyId: party.id, email, role: 'viewer' }
    });
    expect(invitation.ok()).toBe(true);
    const { partyInvite } = await invitation.json();
    expect(
      (
        await viewerContext.request.post('/api/partyInvite/respondToPartyInvite', {
          data: { code: partyInvite.code, accepted: true }
        })
      ).ok()
    ).toBe(true);
    expect(
      (
        await viewerContext.request.post('/api/partyMember/updatePartyMember', {
          data: { partyId: party.id, userId: user.id, role: 'admin' }
        })
      ).status()
    ).toBe(401);
    expect(
      (
        await viewerContext.request.post('/api/handouts/manage', { data: { action: 'authorize', partyId: party.id } })
      ).status()
    ).toBe(401);
    expect(
      (
        await viewerContext.request.post('/api/partyInvite/createPartyInvite', {
          data: { partyId: party.id, email: `other-${email}`, role: 'admin' }
        })
      ).status()
    ).toBe(401);
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Handout roles' } }
    });
    const { gameSession } = await response.json();
    await page.goto(`/${party.slug}/${gameSession.slug}`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
    await expect(page.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
    const dismiss = page.getByTestId('checklistDismissButton');
    if (await dismiss.isVisible()) await dismiss.click();
    await page.keyboard.press('m');
    await page.getByRole('tab', { name: /^Handout/ }).click();
    const controls = page.locator('#sidePanel-handout');
    await controls
      .getByLabel('Upload handout image', { exact: true })
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(controls.getByTestId('handoutPreview').locator('img')).toBeVisible({ timeout: 30_000 });
    await controls.getByLabel('Handout title', { exact: true }).fill('Pause verification');
    await controls.getByRole('button', { name: 'Show to players', exact: true }).click();
    await expect(controls.getByRole('status')).toHaveText('Showing Pause verification to players');
    await viewer.goto(`/${party.slug}/play?idleSleep=4`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    const overlay = viewer.getByTestId('handoutOverlay');
    await expect(overlay).toBeVisible({ timeout: 55_000 });
    await page.getByText('Play', { exact: true }).locator('..').click();
    await page.getByRole('button', { name: 'Pause playfield', exact: true }).click();
    await expect(overlay).toHaveCount(0, { timeout: 20_000 });
    await expect(viewer.getByTestId('playfieldPauseScreen')).toBeVisible();
    await page.getByRole('button', { name: 'Unpause playfield', exact: true }).click();
    await expect(overlay).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(viewer.getByTestId('playfieldSleepOverlay')).toBeVisible({ timeout: 30_000 });
    await controls.getByRole('button', { name: 'Hide handout', exact: true }).click();
    await expect(overlay).toHaveCount(0, { timeout: 45_000 });
    await expect(viewer.getByTestId('playfieldSleepOverlay')).toHaveCount(0, { timeout: 10_000 });
    expect(
      (
        await context.request.post('/api/partyMember/updatePartyMember', {
          data: { partyId: party.id, userId: user.id, role: 'editor' }
        })
      ).ok()
    ).toBe(true);
    expect(
      (
        await viewerContext.request.post('/api/handouts/manage', { data: { action: 'authorize', partyId: party.id } })
      ).ok()
    ).toBe(true);
    expect(
      (
        await viewerContext.request.post('/api/partyMember/updatePartyMember', {
          data: { partyId: party.id, userId: user.id, role: 'admin' }
        })
      ).status()
    ).toBe(401);
  } finally {
    await viewerContext.close();
    await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
  }
});

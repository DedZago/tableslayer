import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = path.resolve('../../.local-data/clipboard-verification/persistence.json');
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

test('registered artwork, assets, catalog and handouts survive a controlled restart', async ({ page, context }) => {
  test.setTimeout(180_000);
  if (process.env.TABLESLAYER_PERSISTENCE_PHASE === 'prepare') {
    const created = await context.request.post('/api/party/createParty', {
      data: { partyData: { name: `Persistence verification ${Date.now()}` } }
    });
    expect(created.ok()).toBe(true);
    const { party } = await created.json();
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Persistence' } }
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
    await controls.getByLabel('Handout title', { exact: true }).fill('Restart illustration');
    const prepared = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/handouts/manage') && response.request().postDataJSON()?.action === 'prepare'
    );
    await controls.getByRole('button', { name: 'Show to players', exact: true }).click();
    const { handout } = await (await prepared).json();
    const saved = await context.request.post('/api/assets/manage', {
      data: {
        action: 'save',
        fields: {
          name: 'Restart asset verification',
          artworkLocation: handout.artworkLocation,
          shape: 2,
          size: 3,
          imageScale: 1.7
        }
      }
    });
    expect(saved.ok()).toBe(true);
    const { asset } = await saved.json();
    const artwork = await context.request.get(`/assets/${handout.artworkLocation}`);
    expect(artwork.ok()).toBe(true);
    await expect
      .poll(
        async () => {
          const response = await context.request.post('/api/party/liveState', { data: { partyId: party.id } });
          return (await response.json()).activeHandoutId;
        },
        { timeout: 15_000 }
      )
      .toBe(handout.presentationId);
    await writeFile(
      fixturePath,
      JSON.stringify({ party, assetId: asset.id, handout, digest: digest(await artwork.body()) }),
      { mode: 0o600 }
    );
    return;
  }
  test.skip(
    process.env.TABLESLAYER_PERSISTENCE_PHASE !== 'verify',
    'Requires an explicitly prepared fixture and controlled restart'
  );
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  try {
    const list = await context.request.post('/api/assets/manage', {
      data: { action: 'list', search: 'Restart asset verification' }
    });
    const asset = (await list.json()).assets.find((asset: { id: string }) => asset.id === fixture.assetId);
    expect(asset).toMatchObject({
      artworkLocation: fixture.handout.artworkLocation,
      shape: 2,
      size: 3,
      imageScale: 1.7
    });
    const artwork = await context.request.get(`/assets/${fixture.handout.artworkLocation}`);
    expect(artwork.ok()).toBe(true);
    expect(digest(await artwork.body())).toBe(fixture.digest);
    await page.goto(`/${fixture.party.slug}/play`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(page.getByTestId('handoutOverlay')).toHaveAttribute(
      'data-presentation-id',
      fixture.handout.presentationId,
      { timeout: 55_000 }
    );
    await expect(page.getByRole('img', { name: 'Restart illustration' })).toBeVisible();
    await expect
      .poll(
        async () => {
          const response = await context.request.post('/api/assets/catalog', {
            data: { action: 'search', search: 'Goblin' }
          });
          const result = await response.json();
          return result.status.state === 'ready' ? result.totalMatches : 0;
        },
        { timeout: 55_000 }
      )
      .toBeGreaterThan(1);
  } finally {
    await context.request.post('/api/assets/manage', { data: { action: 'delete', id: fixture.assetId } });
    await context.request.post('/api/party/deleteParty', { data: { partyId: fixture.party.id } });
  }
});

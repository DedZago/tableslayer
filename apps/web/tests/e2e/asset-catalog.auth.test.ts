import { expect, test } from '@playwright/test';

test('all-source catalog search feeds the shared stored-artwork import preview on LAN HTTP', async ({
  page,
  context
}) => {
  test.setTimeout(240_000);
  const assetIds = new Set<string>();
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Catalog verification ${Date.now()}` } }
  });
  const { party } = await created.json();
  try {
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Catalog' } }
    });
    const { gameSession } = await response.json();
    await page.goto(`/${party.slug}/${gameSession.slug}`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
    await expect(page.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
    const dismiss = page.getByTestId('checklistDismissButton');
    if (await dismiss.isVisible()) await dismiss.click();
    await page.keyboard.press('m');
    await page.getByRole('tab', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'Add from 5etools', exact: true }).click();
    const importer = page.getByRole('dialog', { name: 'Add creatures from 5etools', exact: true });
    const catalog = importer;
    await expect(catalog.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await catalog.getByLabel('Search creatures', { exact: true }).fill('goblin');
    const rowFor = (name: string, source: string) =>
      catalog
        .getByTestId('asset-catalog-row')
        .filter({ has: page.locator('.assetCatalog__rowName', { hasText: new RegExp(`^${name}$`) }) })
        .filter({ has: page.locator('.assetCatalog__rowMeta', { hasText: new RegExp(`(^|· )${source}$`) }) });
    const goblin = rowFor('Goblin', 'MM');
    await expect(goblin).toBeVisible({ timeout: 180_000 });
    await expect(rowFor('Goblin Warrior', 'XMM')).toBeVisible();
    const mmChip = catalog.getByRole('button', { name: 'MM', exact: true });
    if (await mmChip.isVisible()) await mmChip.click();
    else {
      await catalog.getByRole('button', { name: 'More ▾', exact: true }).click();
      await catalog.getByRole('menuitemradio', { name: /^MM\b/ }).click();
    }
    await expect(rowFor('Goblin Warrior', 'XMM')).toHaveCount(0);
    await goblin.getByRole('button', { name: /Goblin/ }).click();
    await expect(catalog.getByRole('heading', { name: 'Goblin', exact: true, level: 3 })).toBeVisible();
    await goblin.getByRole('checkbox', { name: 'Select Goblin', exact: true }).check();
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/assets/import') && response.request().postDataJSON()?.action === 'import') {
        for (const result of (await response.json()).results ?? [])
          if (result.assetId && result.status === 'created') assetIds.add(result.assetId);
      }
    });
    await importer.getByRole('button', { name: 'Add 1 to library', exact: true }).click();
    await expect(goblin.getByRole('img', { name: 'created: Goblin', exact: true })).toBeVisible({ timeout: 55_000 });
    const list = await context.request.post('/api/assets/manage', { data: { action: 'list', search: 'Goblin' } });
    const imported = (await list.json()).assets.find((asset: { id: string }) => assetIds.has(asset.id));
    expect(imported.artworkLocation).toMatch(/^originals\//);
    expect(imported.tokenArtworkLocation).toMatch(/^originals\//);
    expect(imported.artworkLocation).not.toBe(imported.tokenArtworkLocation);
    expect((await context.request.get(`/assets/${imported.artworkLocation}`)).ok()).toBe(true);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  } finally {
    for (const id of assetIds)
      expect((await context.request.post('/api/assets/manage', { data: { action: 'delete', id } })).ok()).toBe(true);
    expect((await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } })).ok()).toBe(true);
  }
});

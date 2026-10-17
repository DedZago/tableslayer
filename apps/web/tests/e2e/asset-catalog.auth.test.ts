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
    await page.getByText('Personal asset library', { exact: true }).click();
    await page.getByText('Import 5etools assets', { exact: true }).click();
    const importer = page.locator('.asset-import');
    await importer.getByText('Search 5etools catalog', { exact: true }).click();
    const catalog = importer.locator('.asset-import__catalog');
    await expect(catalog.getByLabel('Catalog source', { exact: true })).toHaveValue('');
    await catalog.getByLabel('Search names').fill('goblin');
    await expect(catalog.getByText('Goblin (MM)', { exact: true })).toBeVisible({ timeout: 180_000 });
    await expect(catalog.getByText('Goblin Warrior (XMM)', { exact: true })).toBeVisible();
    await catalog.getByLabel('Catalog source', { exact: true }).selectOption('MM');
    await expect(catalog.getByText('Goblin Warrior (XMM)', { exact: true })).toHaveCount(0);
    const goblin = catalog
      .locator('.asset-import__item')
      .filter({ has: page.getByText('Goblin (MM)', { exact: true }) });
    await goblin.getByRole('button', { name: 'Add to import preview', exact: true }).click();
    const previewRow = importer
      .locator('.asset-import__item')
      .filter({ has: page.getByRole('checkbox', { name: 'Goblin (MM)', exact: true }) });
    await expect(previewRow).toContainText('Portrait available');
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/assets/import') && response.request().postDataJSON()?.action === 'import') {
        for (const result of (await response.json()).results ?? [])
          if (result.assetId && result.status === 'created') assetIds.add(result.assetId);
      }
    });
    await importer.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(previewRow.getByRole('status')).toHaveText('created: Goblin', { timeout: 55_000 });
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

import { expect, test } from '@playwright/test';

const bestiary = {
  monster: [
    { name: 'Goblin', source: 'MM', hasToken: true },
    { name: 'Import placeholder verification', source: 'TS-TEST' }
  ]
};

test('JSON import stores upstream artwork, preserves edits and retries without duplicate assets on LAN HTTP', async ({
  page,
  context
}) => {
  test.setTimeout(180_000);
  const assetIds = new Set<string>();
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Asset import verification ${Date.now()}` } }
  });
  expect(created.ok()).toBe(true);
  const { party } = await created.json();
  try {
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Import' } }
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
    await importer.getByLabel('Bestiary JSON').setInputFiles({
      name: 'bestiary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bestiary))
    });
    await expect(importer.getByText('2 selected.', { exact: false })).toBeVisible();
    const importResponses: { results: { requestId: string; identity: string; status: string; assetId?: string }[] }[] =
      [];
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/assets/import') && response.request().postDataJSON()?.action === 'import') {
        const body = await response.json();
        importResponses.push(body);
        for (const result of body.results ?? [])
          if (result.assetId && result.status === 'created') assetIds.add(result.assetId);
      }
    });
    await importer.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(importer.getByText('created: Goblin', { exact: true })).toBeVisible({ timeout: 55_000 });
    await expect(
      importer.getByText('created: Imported without artwork; use Edit to upload an image', { exact: true })
    ).toBeVisible();
    expect(importResponses).toHaveLength(1);
    const goblinResult = importResponses[0].results.find((result) => result.identity === '["mm","goblin"]')!;
    expect(goblinResult.status).toBe('created');
    const replay = await context.request.post('/api/assets/import', {
      data: {
        action: 'import',
        items: [
          {
            requestId: goblinResult.requestId,
            policy: 'skip',
            record: {
              name: 'Goblin',
              source: 'MM',
              identity: '["mm","goblin"]',
              tokenUrl: 'https://5e.tools/img/bestiary/tokens/MM/Goblin.webp',
              artworkUrl: null,
              warnings: []
            }
          }
        ]
      }
    });
    expect((await replay.json()).results[0].assetId).toBe(goblinResult.assetId);
    const list = await context.request.post('/api/assets/manage', { data: { action: 'list', search: 'Goblin' } });
    const asset = (await list.json()).assets.find((asset: { id: string }) => asset.id === goblinResult.assetId);
    expect(asset.tokenArtworkLocation).toMatch(/^originals\//);
    const image = await context.request.get(`/assets/${asset.tokenArtworkLocation}`);
    expect(image.ok()).toBe(true);
    expect((await image.body()).length).toBeGreaterThan(1000);
    expect(
      (
        await context.request.post('/api/assets/manage', {
          data: {
            action: 'save',
            fields: { id: asset.id, name: 'Edited goblin verification', shape: 2, size: 3, imageScale: 1.8 }
          }
        })
      ).ok()
    ).toBe(true);
    await importer.getByLabel('Bestiary JSON').setInputFiles({
      name: 'bestiary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ monster: [{ name: 'Goblin', source: 'MM' }] }))
    });
    await expect(importer.getByText('Already imported: Edited goblin verification', { exact: true })).toBeVisible();
    await importer.getByLabel('Duplicate action').selectOption('update');
    await importer.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(
      importer.getByText('updated: No replacement artwork; existing artwork preserved', { exact: true })
    ).toBeVisible();
    const editedList = await context.request.post('/api/assets/manage', {
      data: { action: 'list', search: 'Edited goblin verification' }
    });
    expect(
      (await editedList.json()).assets.find((candidate: { id: string }) => candidate.id === asset.id)
    ).toMatchObject({
      name: 'Edited goblin verification',
      shape: 2,
      size: 3,
      imageScale: 1.8,
      tokenArtworkLocation: asset.tokenArtworkLocation
    });
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  } finally {
    for (const id of assetIds)
      expect((await context.request.post('/api/assets/manage', { data: { action: 'delete', id } })).ok()).toBe(true);
    expect((await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } })).ok()).toBe(true);
  }
});

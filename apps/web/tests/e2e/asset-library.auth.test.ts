import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YPartyKitProvider from 'y-partykit/provider';
import * as Y from 'yjs';
import { getSceneSnapshot } from '../../src/lib/realtime/docSchema';

test('personal assets create independent instances, preserve artwork after deletion and remain owner-only', async ({
  page,
  context,
  browser
}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = JSON.parse(
    await readFile(path.resolve('../../.local-data/clipboard-verification/persistence.json'), 'utf8')
  );
  const saved = await context.request.post('/api/assets/manage', {
    data: {
      action: 'save',
      fields: {
        name: `Library verification ${Date.now()}`,
        artworkLocation: fixture.handout.artworkLocation,
        shape: 2,
        size: 3,
        imageScale: 1.7
      }
    }
  });
  expect(saved.ok()).toBe(true);
  const { asset } = await saved.json();
  const assets = new Set<string>([asset.id]);
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Library party ${Date.now()}` } }
  });
  const { party } = await created.json();
  const directory = path.resolve('../../.local-data/clipboard-verification/handout-accounts');
  const accounts = (await readdir(directory)).filter((name) => name.startsWith(testInfo.project.name)).sort();
  const account = JSON.parse(await readFile(path.join(directory, accounts.at(-1)!), 'utf8'));
  const other = await browser.newContext({ storageState: account.state, baseURL: 'http://192.168.1.26:5174' });
  const doc = new Y.Doc();
  let provider: YPartyKitProvider | undefined;
  try {
    const foreign = await other.request.post('/api/assets/manage', { data: { action: 'list', search: asset.name } });
    expect((await foreign.json()).assets).toHaveLength(0);
    expect(
      (
        await other.request.post('/api/assets/manage', {
          data: { action: 'save', fields: { id: asset.id, name: 'Unauthorized rename' } }
        })
      ).ok()
    ).toBe(false);
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Library' } }
    });
    const { gameSession } = await response.json();
    provider = new YPartyKitProvider('192.168.1.26:1999', gameSession.id, doc, {
      party: 'game_session',
      protocol: 'ws',
      disableBc: true
    });
    await expect.poll(() => provider?.synced).toBe(true);
    const sceneId = [...doc.getMap('scenes').keys()][0];
    const markers = () => getSceneSnapshot(doc, sceneId)!.markers;
    await page.goto(`/${party.slug}/${gameSession.slug}`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
    await expect(page.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
    const dismiss = page.getByTestId('checklistDismissButton');
    if (await dismiss.isVisible()) await dismiss.click();
    await page.keyboard.press('m');
    await page.getByRole('tab', { name: 'Library', exact: true }).click();
    const library = page.locator('#sidePanel-library');
    await library.getByLabel('Search assets', { exact: true }).fill(asset.name);
    const item = library.locator('.assetLibrary__item').filter({ hasText: asset.name });
    await expect(item).toHaveCount(1);
    await library.getByLabel('Quantity', { exact: true }).fill('2');
    await item.getByRole('button', { name: 'Place', exact: true }).click();
    await expect(page.getByTestId('markerListItem')).toHaveCount(2);
    await expect.poll(() => markers().length).toBe(2);
    const original = markers().map((marker) => ({ ...marker }));
    expect(new Set(original.map((marker) => marker.id)).size).toBe(2);
    expect(
      original.every(
        (marker) =>
          marker.visibility === 1 && marker.imageScale === 1.7 && marker.imageLocation === asset.artworkLocation
      )
    ).toBe(true);
    await page.getByRole('tab', { name: 'Tokens', exact: true }).click();
    await page.getByTestId('markerListItem').first().getByRole('button', { name: asset.name, exact: true }).click();
    await page.getByTestId('markerEditView').getByLabel('Title', { exact: true }).fill('Independent instance');
    await page
      .getByTestId('markerEditView')
      .locator('input[type="file"]')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect
      .poll(() => markers().find((marker) => marker.title === 'Independent instance')?.imageLocation)
      .not.toBe(asset.artworkLocation);
    expect(markers().find((marker) => marker.title === asset.name)?.imageLocation).toBe(asset.artworkLocation);
    const capture = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/assets/manage') && response.request().postDataJSON()?.action === 'saveMarker'
    );
    await page.getByRole('tab', { name: 'Library', exact: true }).click();
    await library.getByRole('button', { name: 'Save selected token', exact: true }).click();
    const copiedAsset = (await (await capture).json()).asset;
    assets.add(copiedAsset.id);
    expect(copiedAsset.name).toBe('Independent instance');
    await page.getByRole('tab', { name: 'Tokens', exact: true }).click();
    await page.getByTestId('markerBackButton').click();
    await page.getByRole('tab', { name: 'Library', exact: true }).click();
    await item.getByRole('button', { name: `More actions for ${asset.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await library.getByLabel('Asset name', { exact: true }).fill('Updated library verification');
    await library.getByRole('button', { name: 'Save asset', exact: true }).click();
    await library.getByLabel('Search assets', { exact: true }).fill('Updated library verification');
    const updated = library.locator('.assetLibrary__item').filter({ hasText: 'Updated library verification' });
    await updated.getByRole('button', { name: 'Place', exact: true }).click();
    await expect.poll(() => markers().length).toBe(4);
    expect(markers().filter((marker) => marker.title === 'Updated library verification')).toHaveLength(2);
    expect(markers().filter((marker) => marker.title === 'Independent instance')).toHaveLength(1);
    await updated.getByRole('button', { name: 'More actions for Updated library verification', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await updated.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(updated).toHaveCount(0);
    expect(markers()).toHaveLength(4);
    expect((await context.request.get(`/assets/${asset.artworkLocation}`)).ok()).toBe(true);
  } finally {
    provider?.destroy();
    doc.destroy();
    await other.close();
    for (const id of assets) await context.request.post('/api/assets/manage', { data: { action: 'delete', id } });
    await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
  }
});

import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YPartyKitProvider from 'y-partykit/provider';
import * as Y from 'yjs';
import { createSessionWriter, getSceneSnapshot } from '../../src/lib/realtime/docSchema';

const artwork = readFileSync(fileURLToPath(new URL('./fixtures/test-image.png', import.meta.url))).toString('base64');
const dropFiles = async (target: Locator, names: string[], point?: { x: number; y: number }) => {
  await target.evaluate(
    (element, { artwork, names, point }) => {
      const bytes = Uint8Array.from(atob(artwork), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      for (const name of names)
        transfer.items.add(new File([bytes], name, { type: name.endsWith('.txt') ? 'text/plain' : 'image/png' }));
      const bounds = element.getBoundingClientRect();
      const coordinates = point ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      for (const type of ['dragover', 'drop'])
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: coordinates.x,
            clientY: coordinates.y
          })
        );
    },
    { artwork, names, point }
  );
};

test('image drops target rotated-map tokens, reject multiple images and create ordered sidebar scenes', async ({
  page,
  context
}) => {
  test.setTimeout(150_000);
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Image drop verification ${Date.now()}` } }
  });
  expect(created.ok()).toBe(true);
  const { party } = await created.json();
  const doc = new Y.Doc();
  let provider: YPartyKitProvider | undefined;
  try {
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Drops' } }
    });
    expect(response.ok()).toBe(true);
    const { gameSession } = await response.json();
    provider = new YPartyKitProvider('192.168.1.26:1999', gameSession.id, doc, {
      party: 'game_session',
      protocol: 'ws',
      disableBc: true
    });
    await expect.poll(() => provider?.synced).toBe(true);
    const sceneId = [...doc.getMap('scenes').keys()][0];
    createSessionWriter(doc, 'fixture').setSceneSettings(sceneId, {
      gridMode: 1,
      mapRotation: 90,
      sceneRotation: 90,
      mapOffsetX: 50,
      mapOffsetY: -30,
      mapZoom: 2
    });
    await page.goto(`/${party.slug}/${gameSession.slug}/${sceneId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 55_000
    });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
    await expect(page.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
    const dismiss = page.getByTestId('checklistDismissButton');
    if (await dismiss.isVisible()) await dismiss.click();
    await page.keyboard.press('m');
    await page.locator('.markerManager__header').getByText('off', { exact: true }).click();
    await page.getByRole('button', { name: 'Rotate scene', exact: true }).click();
    await page.getByRole('button', { name: 'Fit scene', exact: true }).click();
    const canvas = page.locator('canvas').first();
    const bounds = (await canvas.boundingBox())!;
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.click(point.x, point.y);
    const preview = page.getByTestId('markerEditView').getByRole('button', { name: 'Change marker image' });
    await expect(preview).toBeVisible();
    await dropFiles(preview, ['first.png']);
    await expect(preview).toHaveAttribute('style', /originals\//, { timeout: 20_000 });
    const first = await preview.getAttribute('style');
    await dropFiles(preview, ['a.png', 'b.png']);
    await expect(page.getByText('Drop one image file to replace token artwork', { exact: true })).toBeVisible();
    expect(await preview.getAttribute('style')).toBe(first);
    await dropFiles(canvas, ['before-pan.png'], point);
    await expect.poll(() => preview.getAttribute('style')).not.toBe(first);
    const beforePan = await preview.getAttribute('style');
    const prior = getSceneSnapshot(doc, sceneId)!.settings;
    await page.keyboard.down('Control');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y + 30, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    point.x += 60;
    point.y += 30;
    expect(getSceneSnapshot(doc, sceneId)!.settings.mapOffsetX).toBe(prior.mapOffsetX);
    expect(getSceneSnapshot(doc, sceneId)!.settings.mapOffsetY).toBe(prior.mapOffsetY);
    await dropFiles(canvas, ['canvas.png'], point);
    await expect.poll(() => preview.getAttribute('style')).not.toBe(beforePan);
    await dropFiles(canvas, ['empty.png'], { x: bounds.x + 8, y: bounds.y + 8 });
    await expect(
      page.getByText('Drop an image on a token, or in the scene sidebar to create a scene', { exact: true })
    ).toBeVisible();
    await page.getByTestId('markerBackButton').click();
    await expect(page.getByTestId('markerListItem')).toHaveCount(1);
    const activeScene = await page
      .getByTestId('sceneActiveIcon')
      .locator('xpath=ancestor::*[@data-testid="sceneItem"]')
      .getAttribute('id');
    const requests: { mapLocation?: string; gridMapDefinedX?: number; gridMapDefinedY?: number; order: number }[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/scenes/createScene')) requests.push(request.postDataJSON().sceneData);
    });
    await dropFiles(page.getByTestId('scenesContainer'), ['reject.txt', 'first-12x8.png', 'second-20x15.png']);
    await expect(page.getByTestId('sceneItem')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByText('Some scenes could not be created', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ gridMapDefinedX: 12, gridMapDefinedY: 8 });
    expect(requests[1]).toMatchObject({ gridMapDefinedX: 20, gridMapDefinedY: 15 });
    expect(requests[1].order).toBeGreaterThan(requests[0].order);
    await expect(
      page.getByTestId('sceneActiveIcon').locator('xpath=ancestor::*[@data-testid="sceneItem"]')
    ).toHaveAttribute('id', activeScene!);
    await expect(page.getByTestId('sceneItem').first()).toHaveAttribute('draggable', 'true');
    const firstSceneId = await page.getByTestId('sceneItem').first().getAttribute('id');
    await page
      .getByTestId('sceneItem')
      .first()
      .locator('.scene__dragHandle')
      .dragTo(page.getByTestId('sceneItem').last());
    await expect.poll(() => page.getByTestId('sceneItem').first().getAttribute('id')).not.toBe(firstSceneId);
    await expect(page.getByTestId('sceneItem')).toHaveCount(3);
  } finally {
    provider?.destroy();
    doc.destroy();
    const removed = await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
    expect(removed.ok()).toBe(true);
  }
});

test('an image upload finishing after another editor deletes its token cannot recreate the token', async ({
  page,
  context
}) => {
  test.setTimeout(150_000);
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Interrupted artwork ${Date.now()}` } }
  });
  const { party } = await created.json();
  const doc = new Y.Doc();
  let provider: YPartyKitProvider | undefined;
  let releaseUpload = () => {};
  try {
    const response = await context.request.post('/api/gameSessions/createGameSession', {
      data: { partyId: party.id, gameSessionData: { name: 'Interrupted upload' } }
    });
    const { gameSession } = await response.json();
    provider = new YPartyKitProvider('192.168.1.26:1999', gameSession.id, doc, {
      party: 'game_session',
      protocol: 'ws',
      disableBc: true
    });
    await expect.poll(() => provider?.synced).toBe(true);
    const sceneId = [...doc.getMap('scenes').keys()][0];
    await page.goto(`/${party.slug}/${gameSession.slug}/${sceneId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 55_000
    });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
    await expect(page.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
    const dismiss = page.getByTestId('checklistDismissButton');
    if (await dismiss.isVisible()) await dismiss.click();
    await page.keyboard.press('m');
    const bounds = (await page.locator('canvas').first().boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.getByTestId('markerEditView')).toBeVisible();
    await expect.poll(() => getSceneSnapshot(doc, sceneId)?.markers.length).toBe(1);
    const markerId = getSceneSnapshot(doc, sceneId)!.markers[0].id;
    let signalRegistration = () => {};
    const started = new Promise<void>((resolve) => {
      signalRegistration = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route('**/api/file/createFile', async (route) => {
      signalRegistration();
      await gate;
      await route.continue();
    });
    await page
      .getByTestId('markerEditView')
      .locator('input[type="file"]')
      .setInputFiles(fileURLToPath(new URL('./fixtures/test-image.png', import.meta.url)));
    await started;
    createSessionWriter(doc, 'concurrent-editor').deleteMarker(sceneId, markerId);
    await expect(page.getByTestId('markerListItem')).toHaveCount(0);
    releaseUpload();
    await expect(page.getByText('The target token was deleted; image was not applied', { exact: true })).toBeVisible({
      timeout: 30_000
    });
    expect(getSceneSnapshot(doc, sceneId)!.markers).toHaveLength(0);
    await expect(page.getByTestId('markerListItem')).toHaveCount(0);
  } finally {
    releaseUpload();
    await page.unrouteAll({ behavior: 'wait' });
    provider?.destroy();
    doc.destroy();
    await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
  }
});

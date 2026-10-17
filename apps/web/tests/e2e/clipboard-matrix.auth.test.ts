import { expect, test } from '@playwright/test';
import YPartyKitProvider from 'y-partykit/provider';
import * as Y from 'yjs';
import { createSessionWriter, getSceneSnapshot } from '../../src/lib/realtime/docSchema';

const marker = (sceneId: string, title: string, x: number) => ({
  id: crypto.randomUUID(),
  sceneId,
  title,
  label: null,
  imageLocation: null,
  imageScale: 1,
  positionX: x,
  positionY: 0,
  shape: 1,
  shapeColor: '#ffffff',
  size: 1,
  visibility: 0,
  note: { type: 'doc', content: [] },
  pinnedTooltip: false
});

test('touch selection, rotated-grid clipboard conversion and concurrent paste undo work together', async ({
  page,
  context,
  browser
}) => {
  test.setTimeout(240_000);
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Clipboard matrix ${Date.now()}` } }
  });
  const { party } = await created.json();
  const destination = await context.newPage();
  const connections: { doc: Y.Doc; provider: YPartyKitProvider; sceneId: string; slug: string }[] = [];
  let touchContext;
  try {
    for (const [index, name] of ['Source', 'Destination'].entries()) {
      const response = await context.request.post('/api/gameSessions/createGameSession', {
        data: { partyId: party.id, gameSessionData: { name } }
      });
      const { gameSession } = await response.json();
      const doc = new Y.Doc();
      const provider = new YPartyKitProvider('192.168.1.26:1999', gameSession.id, doc, {
        party: 'game_session',
        protocol: 'ws',
        disableBc: true
      });
      await expect.poll(() => provider.synced).toBe(true);
      const sceneId = [...doc.getMap('scenes').keys()][0];
      const writer = createSessionWriter(doc, 'fixture');
      writer.setSceneSettings(sceneId, {
        gridMode: 0,
        gridSpacing: index ? 2 : 1,
        mapRotation: index ? 90 : 0,
        mapOffsetX: 0,
        mapOffsetY: 0,
        mapZoom: 1
      });
      if (!index) {
        writer.upsertMarker(sceneId, marker(sceneId, 'First token', -50));
        writer.upsertMarker(sceneId, marker(sceneId, 'Second token', 50));
      }
      connections.push({ doc, provider, sceneId, slug: gameSession.slug });
    }
    for (const [index, editor] of [page, destination].entries()) {
      await editor.goto(`/${party.slug}/${connections[index].slug}`, {
        waitUntil: 'domcontentloaded',
        timeout: 55_000
      });
      await expect(editor.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
      await expect(editor.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
      const dismiss = editor.getByTestId('checklistDismissButton');
      if (await dismiss.isVisible()) await dismiss.click();
      await editor.keyboard.press('m');
    }
    touchContext = await browser.newContext({
      storageState: await context.storageState(),
      baseURL: 'http://192.168.1.26:5174',
      hasTouch: true,
      viewport: { width: 500, height: 900 }
    });
    const touch = await touchContext.newPage();
    await touch.goto(`/${party.slug}/${connections[0].slug}`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(touch.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
    const dismiss = touch.getByTestId('checklistDismissButton');
    if (await dismiss.isVisible()) await dismiss.tap();
    await touch.keyboard.press('m');
    await touch.getByRole('button', { name: 'Select all', exact: true }).tap();
    await expect(touch.getByText('2 selected', { exact: true })).toBeVisible();
    await touch.getByRole('button', { name: 'Clear selection', exact: true }).tap();
    await touch.getByRole('checkbox', { name: 'Select First token', exact: true }).tap();
    await expect(touch.getByText('1 selected', { exact: true })).toBeVisible();
    await touchContext.close();
    touchContext = undefined;
    await page.bringToFront();
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await page.evaluate(() =>
      document.addEventListener('copy', (event) =>
        document.documentElement.setAttribute(
          'data-test-token-clipboard',
          event.clipboardData?.getData('text/plain') ?? ''
        )
      )
    );
    await page.keyboard.press('Control+c');
    await expect
      .poll(() => page.locator('html').getAttribute('data-test-token-clipboard'))
      .toContain('tableslayer.tokens');
    const clipboard = JSON.parse((await page.locator('html').getAttribute('data-test-token-clipboard'))!);
    await destination.bringToFront();
    const bounds = (await destination.locator('canvas').first().boundingBox())!;
    await destination.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await destination.keyboard.press('Control+v');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(2, { timeout: 20_000 });
    const target = connections[1];
    const snapshot = () => getSceneSnapshot(target.doc, target.sceneId)!;
    await expect.poll(() => snapshot().markers.length).toBe(2);
    const placed = snapshot().markers;
    const cell =
      (snapshot().settings.gridSpacing * snapshot().settings.displayResolutionX) / snapshot().settings.displaySizeX;
    const first = placed.find((token) => token.title === clipboard.tokens[0].title)!;
    const second = placed.find((token) => token.title === clipboard.tokens[1].title)!;
    expect(second.positionX - first.positionX).toBeCloseTo(0);
    expect(second.positionY - first.positionY).toBeCloseTo(
      (clipboard.tokens[1].offset.x - clipboard.tokens[0].offset.x) * cell
    );
    createSessionWriter(target.doc, 'concurrent-editor').upsertMarker(
      target.sceneId,
      marker(target.sceneId, 'Concurrent change', 500)
    );
    await expect(destination.getByTestId('markerListItem')).toHaveCount(3);
    await destination.keyboard.press('Control+z');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(1);
    await expect(destination.getByText('Concurrent change', { exact: true })).toBeVisible();
    await destination.keyboard.press('Control+Shift+z');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(3);
    await destination.keyboard.press('Control+v');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(5);
    const rejected = await context.request.post('/api/assets/clipboard', {
      data: {
        action: 'paste',
        sceneId: target.sceneId,
        clipboard: { ...clipboard, deploymentId: 'another-deployment' },
        positions: [
          { x: 0, y: 0 },
          { x: 10, y: 10 }
        ]
      }
    });
    expect(rejected.ok()).toBe(false);
    expect(snapshot().markers).toHaveLength(5);
  } finally {
    await touchContext?.close();
    await destination.close();
    for (const { provider, doc } of connections) {
      provider.destroy();
      doc.destroy();
    }
    await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
  }
});

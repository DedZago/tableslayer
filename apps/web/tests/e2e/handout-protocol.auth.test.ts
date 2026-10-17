import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YPartyKitProvider from 'y-partykit/provider';
import * as Y from 'yjs';
import {
  createPartyWriter,
  createSessionWriter,
  getPartyState,
  getSceneSnapshot
} from '../../src/lib/realtime/docSchema';

const connect = async (room: string, party: string, params: Record<string, string>) => {
  const doc = new Y.Doc();
  const provider = new YPartyKitProvider('192.168.1.26:1999', room, doc, {
    party,
    protocol: 'ws',
    disableBc: true,
    params
  });
  await expect.poll(() => provider.synced, { timeout: 20_000 }).toBe(true);
  return {
    room,
    doc,
    provider,
    destroy: () => {
      provider.destroy();
      doc.destroy();
    }
  };
};

test('viewer party updates are rejected while game-session movement and party handouts survive scene switches', async ({
  context,
  browser
}, testInfo) => {
  test.setTimeout(180_000);
  const directory = path.resolve('../../.local-data/clipboard-verification/handout-accounts');
  const files = (await readdir(directory)).filter((name) => name.startsWith(testInfo.project.name)).sort();
  const account = JSON.parse(await readFile(path.join(directory, files.at(-1)!), 'utf8'));
  const viewer = await browser.newContext({ storageState: account.state, baseURL: 'http://192.168.1.26:5174' });
  const profile = await viewer.request.post('/api/auth/updateUser', {
    data: { userData: { name: 'Protocol viewer verification' } }
  });
  const { user } = await profile.json();
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Handout protocol ${Date.now()}` } }
  });
  const { party } = await created.json();
  const connections: Awaited<ReturnType<typeof connect>>[] = [];
  try {
    const invitation = await context.request.post('/api/partyInvite/createPartyInvite', {
      data: { partyId: party.id, email: account.email, role: 'viewer' }
    });
    expect(invitation.ok()).toBe(true);
    const { partyInvite } = await invitation.json();
    expect(
      (
        await viewer.request.post('/api/partyInvite/respondToPartyInvite', {
          data: { code: partyInvite.code, accepted: true }
        })
      ).ok()
    ).toBe(true);
    const token = async (request: typeof context.request) =>
      (await (await request.post('/api/party/connectionToken', { data: { partyId: party.id } })).json()).token;
    const admin = await connect(party.id, 'party', { token: await token(context.request) });
    connections.push(admin);
    const handout = {
      presentationId: crypto.randomUUID(),
      artworkLocation: 'originals/protocol-fixture.png',
      title: 'Protocol descriptor',
      presenterId: 'fixture',
      publishedAt: Math.floor(Date.now() / 1000)
    };
    createPartyWriter(admin.doc, 'admin').setHandout(handout);
    const readonly = await connect(party.id, 'party', { token: await token(viewer.request) });
    connections.push(readonly);
    await expect.poll(() => getPartyState(readonly.doc).activeHandout?.presentationId).toBe(handout.presentationId);
    const malicious = createPartyWriter(readonly.doc, 'viewer');
    malicious.setHandout(null);
    malicious.setPaused(true);
    readonly.destroy();
    const probe = await connect(party.id, 'party', { token: await token(viewer.request) });
    connections.push(probe);
    expect(getPartyState(probe.doc)).toMatchObject({ activeHandout: handout, isPaused: false });
    const sessions = [];
    for (const name of ['Source', 'Destination']) {
      const response = await context.request.post('/api/gameSessions/createGameSession', {
        data: { partyId: party.id, gameSessionData: { name } }
      });
      const { gameSession } = await response.json();
      const connection = await connect(gameSession.id, 'game_session', { userId: user.id });
      connections.push(connection);
      sessions.push(connection);
    }
    const sceneId = [...sessions[0].doc.getMap('scenes').keys()][0];
    const writer = createSessionWriter(sessions[0].doc, 'viewer');
    writer.setSceneSettings(sceneId, { gridMode: 0, mapRotation: 0, mapOffsetX: 0, mapOffsetY: 0, mapZoom: 1 });
    const markerId = crypto.randomUUID();
    writer.setMarkerFields(sceneId, markerId, {
      id: markerId,
      sceneId,
      title: 'Viewer movement',
      label: null,
      assetId: null,
      imageLocation: null,
      imageScale: 1,
      positionX: 0,
      positionY: 0,
      visibility: 0,
      shape: 1,
      shapeColor: '#ffffff',
      size: 1,
      note: null,
      pinnedTooltip: false
    });
    const movementProbe = await connect(sessions[0].room, 'game_session', { userId: user.id });
    connections.push(movementProbe);
    await expect
      .poll(
        () => getSceneSnapshot(movementProbe.doc, sceneId)?.markers.find((marker) => marker.id === markerId)?.positionX
      )
      .toBe(0);
    writer.setMarkerFields(sceneId, markerId, { positionX: 120, positionY: 80 });
    await expect
      .poll(
        () => getSceneSnapshot(movementProbe.doc, sceneId)?.markers.find((marker) => marker.id === markerId)?.positionX
      )
      .toBe(120);
    writer.setMarkerFields(sceneId, markerId, { positionX: 0, positionY: 0 });
    await expect
      .poll(
        () => getSceneSnapshot(movementProbe.doc, sceneId)?.markers.find((marker) => marker.id === markerId)?.positionX
      )
      .toBe(0);
    createPartyWriter(admin.doc, 'admin').setActiveScene(sceneId);
    const playerPage = await viewer.newPage();
    await playerPage.goto(`/${party.slug}/play`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await expect(playerPage.getByTestId('handoutOverlay')).toBeVisible({ timeout: 55_000 });
    const canvas = playerPage.getByTestId('playfieldStage').locator('canvas').first();
    await expect(canvas).toBeAttached({ timeout: 55_000 });
    const bounds = (await canvas.boundingBox())!;
    const drag = async () => {
      await playerPage.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await playerPage.mouse.down();
      await playerPage.mouse.move(bounds.x + bounds.width / 2 + 120, bounds.y + bounds.height / 2 + 80, { steps: 10 });
      await playerPage.mouse.up();
    };
    await drag();
    await playerPage.keyboard.press('Escape');
    await expect(playerPage.getByTestId('handoutOverlay')).toBeVisible();
    expect(
      getSceneSnapshot(movementProbe.doc, sceneId)?.markers.find((marker) => marker.id === markerId)?.positionX
    ).toBe(0);
    createPartyWriter(admin.doc, 'admin').setHandout(null);
    await expect(playerPage.getByTestId('handoutOverlay')).toHaveCount(0);
    await expect(playerPage.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
    await drag();
    await expect
      .poll(
        () => getSceneSnapshot(movementProbe.doc, sceneId)?.markers.find((marker) => marker.id === markerId)?.positionX
      )
      .not.toBe(0);
    createPartyWriter(admin.doc, 'admin').setHandout(handout);
    await expect.poll(() => getPartyState(probe.doc).activeHandout?.presentationId).toBe(handout.presentationId);
    for (const session of sessions) {
      createPartyWriter(admin.doc, 'admin').setActiveScene([...session.doc.getMap('scenes').keys()][0]);
      await expect.poll(() => getPartyState(probe.doc).activeSceneId).toBe([...session.doc.getMap('scenes').keys()][0]);
      expect(getPartyState(probe.doc).activeHandout).toEqual(handout);
      await expect(playerPage.getByTestId('handoutOverlay')).toHaveAttribute(
        'data-presentation-id',
        handout.presentationId
      );
    }
  } finally {
    for (const connection of connections) connection.destroy();
    await viewer.close();
    await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
  }
});

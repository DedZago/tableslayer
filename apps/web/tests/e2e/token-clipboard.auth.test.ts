import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const artwork = fileURLToPath(new URL('./fixtures/test-image.png', import.meta.url));

test('native token clipboard crosses editor tabs, survives source deletion and groups undo', async ({
  page,
  context
}) => {
  test.setTimeout(150_000);
  const created = await context.request.post('/api/party/createParty', {
    data: { partyData: { name: `Clipboard verification ${Date.now()}` } }
  });
  expect(created.ok()).toBe(true);
  const { party } = (await created.json()) as { party: { id: string; slug: string } };
  const destination = await context.newPage();
  try {
    const sessions: { slug: string }[] = [];
    for (const name of ['Source', 'Destination']) {
      const response = await context.request.post('/api/gameSessions/createGameSession', {
        data: { partyId: party.id, gameSessionData: { name } }
      });
      expect(response.ok()).toBe(true);
      const { gameSession } = (await response.json()) as { gameSession: { slug: string } };
      sessions.push(gameSession);
    }
    for (const [index, editor] of [page, destination].entries()) {
      await editor.goto(`/${party.slug}/${sessions[index].slug}`, { waitUntil: 'domcontentloaded', timeout: 55_000 });
      await expect(editor.locator('canvas').first()).toBeVisible({ timeout: 55_000 });
      await expect(editor.locator('.stage--loading')).toHaveCount(0, { timeout: 55_000 });
      const dismiss = editor.getByTestId('checklistDismissButton');
      if (await dismiss.isVisible()) await dismiss.click();
    }
    await page.bringToFront();
    await page.keyboard.press('m');
    for (const fraction of [0.4, 0.65]) {
      const bounds = await page.locator('canvas').first().boundingBox();
      expect(bounds).not.toBeNull();
      await page.mouse.click(bounds!.x + bounds!.width * fraction, bounds!.y + bounds!.height / 2);
      await expect(page.getByTestId('markerEditView')).toBeVisible();
      if (fraction === 0.4) {
        await page.getByTestId('markerEditView').locator('input[type="file"]').setInputFiles(artwork);
        await expect(
          page.getByTestId('markerEditView').getByRole('button', { name: 'Change marker image' })
        ).toHaveAttribute('style', /originals\//, { timeout: 20_000 });
      }
      await page.getByTestId('markerBackButton').click();
    }
    await expect(page.getByTestId('markerListItem')).toHaveCount(2);
    const bounds = await page.locator('canvas').first().boundingBox();
    expect(bounds).not.toBeNull();
    await page.keyboard.down('Shift');
    await page.mouse.move(bounds!.x + 10, bounds!.y + 150);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width - 10, bounds!.y + bounds!.height - 150, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await page.evaluate(() =>
      document.addEventListener('copy', (event) => {
        document.documentElement.setAttribute(
          'data-test-token-clipboard',
          event.clipboardData?.getData('text/plain') ?? ''
        );
      })
    );
    await page.keyboard.press('Control+c');
    await expect
      .poll(() => page.locator('html').getAttribute('data-test-token-clipboard'))
      .toContain('tableslayer.tokens');
    const copied = JSON.parse((await page.locator('html').getAttribute('data-test-token-clipboard'))!);
    expect(copied.tokens).toHaveLength(2);
    expect(
      copied.tokens.some((token: { imageLocation: string | null }) => token.imageLocation?.startsWith('originals/'))
    ).toBe(true);
    while (await page.getByTestId('markerListItem').count()) {
      await page.getByTestId('markerDeleteButton').first().click({ force: true });
      await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    }
    await destination.bringToFront();
    const target = await destination.locator('canvas').first().boundingBox();
    expect(target).not.toBeNull();
    await destination.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2);
    await destination.keyboard.press('Control+v');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(2, { timeout: 20_000 });
    await destination.keyboard.press('Control+z');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(0);
    await destination.keyboard.press('Control+Shift+z');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(2);
    await destination.keyboard.press('Control+v');
    await expect(destination.getByTestId('markerListItem')).toHaveCount(4, { timeout: 20_000 });
    await destination.locator('.markerManager__title').first().click();
    const title = destination.getByTestId('markerEditView').locator('input[name="title"]');
    await title.fill('Ordinary text clipboard');
    await title.press('Control+a');
    await title.press('Control+c');
    await title.fill('');
    await title.press('Control+v');
    await expect(title).toHaveValue('Ordinary text clipboard');
  } finally {
    await destination.close();
    const removed = await context.request.post('/api/party/deleteParty', { data: { partyId: party.id } });
    expect(removed.ok()).toBe(true);
  }
});

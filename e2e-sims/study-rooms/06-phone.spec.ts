/** J9: phone and touch. La Lectora uses a Pixel 7 profile (see personas.ts). */
import { test, expect, TID, TIMING, tileOf } from './fixtures';

test('phone reader walks by touch and is seen from desktop', async ({ cast }) => {
  const { lectora, host } = await cast('lectora', 'host');
  await host.enterRoom('circulo-en-espanol');

  await lectora.open();
  await lectora.completeFirstEntry();

  // AC9.1: the map fits the screen, a d-pad is shown.
  const vw = lectora.page.viewportSize()!.width;
  const box = await lectora.tid(TID.map).boundingBox();
  expect(box!.width).toBeLessThanOrEqual(vw);
  await expect(lectora.tid(TID.dpad)).toBeVisible();

  const start = await lectora.tile();
  await lectora.tid(TID.dpadRight).tap();
  await expect.poll(() => lectora.tile()).toEqual({ x: start.x + 1, y: start.y });

  // Tap-to-walk through the door.
  await lectora.tid(TID.door('circulo-en-espanol')).tap();
  await expect(lectora.tid(TID.selfAvatar)).toHaveAttribute('data-room', 'circulo-en-espanol', { timeout: 15_000 });

  // AC9.3: desktop sees the phone reader move.
  const id = await lectora.personId();
  await expect(host.avatarOf(id)).toBeVisible({ timeout: TIMING.realtime });
  await lectora.tid(TID.dpadUp).tap();
  const there = await lectora.tile();
  await expect.poll(() => tileOf(host.avatarOf(id)), { timeout: TIMING.realtime }).toEqual(there);

  // AC9.2: chat via the bottom sheet, no hover needed.
  await lectora.tid(TID.mobileSheetTab('chat')).tap();
  await lectora.say('¡Hola a todos!');
  await expect(host.messages().last()).toContainText('¡Hola a todos!', { timeout: TIMING.realtime });
});

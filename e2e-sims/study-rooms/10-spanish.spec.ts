/** J13: Spanish interface. */
import { test, expect, TID, TIMING, ROUTES } from './fixtures';

test('Spanish interface end to end', async ({ cast }) => {
  const { lectora } = await cast('lectora');
  await lectora.open(ROUTES.lobbyEs);
  await expect(lectora.page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(lectora.tid(TID.optIn)).toContainText(/visible/i);
  await lectora.completeFirstEntry();

  await lectora.tid(TID.viewToggle).tap();
  // AC13.2: Círculo en español first in the Spanish list.
  const first = lectora.tid(TID.roomList).locator('[data-testid^="sr-room-list-item-"]').first();
  await expect(first).toHaveAttribute('data-testid', TID.roomListItem('circulo-en-espanol'));

  await lectora.tid(TID.roomListJoin('circulo-en-espanol')).tap();
  await lectora.tid(TID.mobileSheetTab('chat')).tap();
  await expect(lectora.tid(TID.chatSend)).toHaveAccessibleName(/enviar/i);
  await lectora.tid(TID.mobileSheetTab('call')).tap();
  await expect(lectora.tid(TID.callJoin)).toHaveAccessibleName(/unirse|entrar/i);
});

test('mixed-language room: Spanish and English readers see each other', async ({ cast }) => {
  const { lectora, host } = await cast('lectora', 'host');
  await host.enterRoom('circulo-en-espanol');
  await lectora.enterRoom('circulo-en-espanol');
  const hostId = await host.personId();
  const lId = await lectora.personId();
  await expect(lectora.avatarOf(hostId)).toBeVisible({ timeout: TIMING.realtime });
  await expect(host.avatarOf(lId)).toBeVisible({ timeout: TIMING.realtime });

  await host.say('Welcome — bienvenida.');
  await lectora.tid(TID.mobileSheetTab('chat')).tap();
  await expect(lectora.messages().last()).toContainText('bienvenida', { timeout: TIMING.realtime });
});

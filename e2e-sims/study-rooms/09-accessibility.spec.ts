/** J12: keyboard, list view, screen reader. */
import { test, expect, TID, ATTR, TIMING, ROUTES } from './fixtures';

test('keyboard only: enter a room and send a message', async ({ cast }) => {
  const { professor, host } = await cast('professor', 'host');
  await host.enterRoom('platonists-circle');
  await professor.open();
  await professor.completeFirstEntry();

  // The map is focusable and named; arrows move.
  const map = professor.tid(TID.map);
  await expect(map).toHaveAttribute('tabindex', '0');
  await expect(map).toHaveAccessibleName(/.+/);
  await map.focus();
  const before = await professor.tile();
  await professor.page.keyboard.press('ArrowUp');
  await expect.poll(() => professor.tile()).not.toEqual(before);

  // Doors are keyboard-reachable buttons.
  const door = professor.tid(TID.door('platonists-circle'));
  await door.focus();
  await professor.page.keyboard.press('Enter');
  await expect(professor.tid(TID.selfAvatar)).toHaveAttribute(ATTR.room, 'platonists-circle', { timeout: 15_000 });

  await professor.tid(TID.chatInput).focus();
  await professor.page.keyboard.type('Typed with the keyboard only.');
  await professor.page.keyboard.press('Enter');
  await expect(host.messages().last()).toContainText('keyboard only', { timeout: TIMING.realtime });
});

test('list view joins a room without the map', async ({ cast }) => {
  const { host, newcomer } = await cast('host', 'newcomer');
  await host.enterRoom('hermetica-alchemy');

  await newcomer.open(ROUTES.listView);
  await newcomer.completeFirstEntry().catch(() => {}); // list view may skip the avatar
  const item = newcomer.tid(TID.roomListItem('hermetica-alchemy'));
  await expect(item).toBeVisible();
  await expect(item.getByTestId(TID.roomListCount)).toHaveText(/1/);
  await expect(item).toContainText(host.name);

  await newcomer.tid(TID.roomListJoin('hermetica-alchemy')).click();
  await expect(newcomer.tid(TID.map)).toHaveCount(0);
  await expect(newcomer.tid(TID.roomHeader)).toContainText('Hermetica');
  await expect(newcomer.tid(TID.chat)).toBeVisible();
  await expect(newcomer.tid(TID.callJoin)).toBeVisible();
  await newcomer.say('Joined from the list.');
  await expect(host.messages().last()).toContainText('Joined from the list.', { timeout: TIMING.realtime });
});

test('arrivals and messages are announced in a polite live region', async ({ cast }) => {
  const { professor, translator } = await cast('professor', 'translator');
  await professor.enterRoom('translators-room');
  const live = professor.tid(TID.liveRegion);
  await expect(live).toHaveAttribute('aria-live', 'polite');

  await translator.enterRoom('translators-room');
  await expect(live).toContainText(translator.name, { timeout: TIMING.realtime });
  await translator.say('Ready when you are.');
  await expect(live).toContainText('Ready when you are.', { timeout: TIMING.realtime });
  await expect(professor.tid(TID.mapDescription)).toContainText("Translators' Room");
});

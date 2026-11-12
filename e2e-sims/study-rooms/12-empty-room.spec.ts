/** J15: empty room / first arrival. */
import { test, expect, TID, TIMING } from './fixtures';

test('first arrival sees the empty state; it clears when someone joins', async ({ cast }) => {
  const { translator, newcomer } = await cast('translator', 'newcomer');
  await translator.enterRoom('translators-room');

  const empty = translator.tid(TID.emptyRoom);
  await expect(empty).toBeVisible();
  await expect(translator.tid(TID.nextMeeting)).toBeVisible();
  // AC15.2: notes still work alone.
  await expect(translator.tid(TID.noteInput)).toBeEnabled();

  await newcomer.enterRoom('translators-room');
  await expect(empty).toBeHidden({ timeout: TIMING.realtime });
  await expect(newcomer.tid(TID.emptyRoom)).toBeHidden();
});

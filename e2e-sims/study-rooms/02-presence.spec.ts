/** J4: see others arrive, move and leave. */
import { test, expect, TID, TIMING, tileOf } from './fixtures';

test('two readers see each other arrive, move and leave', async ({ cast }) => {
  const { professor, host } = await cast('professor', 'host');

  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  const profId = await professor.personId();
  const hostId = await host.personId();

  // Arrive: both see each other's avatar and roster entry (AC4.1).
  await expect(host.avatarOf(profId)).toBeVisible({ timeout: TIMING.realtime });
  await expect(host.rosterItemOf(profId)).toContainText(professor.name);
  await expect(professor.avatarOf(hostId)).toBeVisible({ timeout: TIMING.realtime });
  await expect(professor.rosterItemOf(hostId)).toContainText(host.name);

  // Move: the host sees the professor land on the same tile (AC4.2).
  await professor.step('ArrowDown', 1);
  await professor.step('ArrowLeft', 1);
  const there = await professor.tile();
  await expect
    .poll(() => tileOf(host.avatarOf(profId)), { timeout: TIMING.realtime })
    .toEqual(there);

  // Leave: avatar and roster entry disappear for the host (AC4.3).
  await professor.leave();
  await expect(host.avatarOf(profId)).toHaveCount(0, { timeout: TIMING.realtime });
  await expect(host.rosterItemOf(profId)).toHaveCount(0);
});

test('people in another room are not shown in yours', async ({ cast }) => {
  const { professor, translator } = await cast('professor', 'translator');
  await professor.enterRoom('platonists-circle');
  await translator.enterRoom('translators-room');
  const tId = await translator.personId();
  await expect(professor.avatarOf(tId)).toHaveCount(0);
  await expect(professor.rosterItemOf(tId)).toHaveCount(0);
  await expect(professor.tid(TID.roster)).not.toContainText(translator.name);
});

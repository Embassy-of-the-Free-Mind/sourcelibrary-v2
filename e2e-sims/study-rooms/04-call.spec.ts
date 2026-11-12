/** J6: proximity audio/video (fake media devices, see config). */
import { test, expect, TID, ATTR, STATE, TIMING } from './fixtures';

test('two readers join a call and see each other\'s tile', async ({ cast }) => {
  const { professor, host } = await cast('professor', 'host');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  const profId = await professor.personId();
  const hostId = await host.personId();

  // AC6.1: nothing published before Join.
  await expect(professor.tid(TID.callStatus)).toHaveAttribute(ATTR.state, STATE.call.idle);
  await expect(host.tid(TID.callTile(profId))).toHaveCount(0);

  await host.tid(TID.callJoin).click();
  await professor.tid(TID.callJoin).click();

  // AC6.2: connected, each sees the other's tile.
  for (const r of [host, professor]) {
    await expect(r.tid(TID.callStatus)).toHaveAttribute(ATTR.state, STATE.call.connected, { timeout: 20_000 });
  }
  await expect(host.tid(TID.callTile(profId))).toBeVisible({ timeout: TIMING.realtime });
  await expect(professor.tid(TID.callTile(hostId))).toBeVisible({ timeout: TIMING.realtime });

  // AC6.4: mute shows to others; leave stops publishing.
  await professor.tid(TID.micToggle).click();
  await expect(professor.tid(TID.micToggle)).toHaveAttribute(ATTR.state, STATE.toggle.off);
  await expect(host.tid(TID.callTile(profId))).toHaveAttribute('data-mic', STATE.toggle.off, { timeout: TIMING.realtime });

  await professor.tid(TID.callLeave).click();
  await expect(professor.tid(TID.callStatus)).toHaveAttribute(ATTR.state, STATE.call.idle);
  await expect(host.tid(TID.callTile(profId))).toHaveCount(0, { timeout: TIMING.realtime });
});

test('proximity: far apart in the hall, not connected; close together, connected', async ({ cast }) => {
  const { translator, newcomer } = await cast('translator', 'newcomer');
  for (const r of [translator, newcomer]) {
    await r.open();
    await r.completeFirstEntry();
  }
  const tId = await translator.personId();
  const nId = await newcomer.personId();

  // Move apart, then both join the hall call.
  await translator.step('ArrowLeft', 10);
  await newcomer.step('ArrowRight', 10);
  await translator.tid(TID.callJoin).click();
  await newcomer.tid(TID.callJoin).click();
  await expect(translator.tid(TID.callTile(nId))).toHaveCount(0);

  // Walk together: tiles appear (AC6.3).
  await newcomer.step('ArrowLeft', 19);
  await expect(translator.tid(TID.callTile(nId))).toBeVisible({ timeout: TIMING.realtime });
  await expect(newcomer.tid(TID.callTile(tId))).toBeVisible({ timeout: TIMING.realtime });
});

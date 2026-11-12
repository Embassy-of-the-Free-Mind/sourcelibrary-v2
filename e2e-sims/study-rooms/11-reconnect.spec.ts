/** J14: reconnect after dropping. */
import { test, expect, TID, ATTR, STATE, TIMING } from './fixtures';

test('offline and back: same room and tile, others see you return', async ({ cast }) => {
  const { professor, host } = await cast('professor', 'host');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  const id = await professor.personId();
  const tile = await professor.tile();
  await host.say('Before the drop.');

  await professor.context.setOffline(true);
  await expect(professor.tid(TID.connectionStatus)).toHaveAttribute(ATTR.state, STATE.connection.reconnecting, {
    timeout: 15_000,
  });
  // AC14.1: still shown to others, as away.
  await expect(host.avatarOf(id)).toHaveAttribute(ATTR.presence, 'away', { timeout: 15_000 });
  await host.say('During the drop.');

  await professor.context.setOffline(false);
  await expect(professor.tid(TID.connectionStatus)).toHaveAttribute(ATTR.state, STATE.connection.connected, {
    timeout: 20_000,
  });
  await expect(professor.tid(TID.selfAvatar)).toHaveAttribute(ATTR.room, 'platonists-circle');
  expect(await professor.tile()).toEqual(tile);
  await expect(professor.messages().last()).toContainText('During the drop.', { timeout: TIMING.realtime });
  await expect(host.avatarOf(id)).not.toHaveAttribute(ATTR.presence, 'away', { timeout: TIMING.realtime });
});

test('gone longer than the grace period: others see you leave', async ({ cast }) => {
  test.setTimeout(120_000);
  const { professor, host } = await cast('professor', 'host');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  const id = await professor.personId();

  await professor.context.setOffline(true);
  await expect(host.avatarOf(id)).toHaveCount(0, { timeout: TIMING.reconnectGrace + 15_000 });
});

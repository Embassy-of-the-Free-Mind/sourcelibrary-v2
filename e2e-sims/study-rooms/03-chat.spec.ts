/** J5: room chat. */
import { test, expect, TID, TIMING } from './fixtures';

test('room chat reaches the room and only the room', async ({ cast }) => {
  const { professor, host, translator } = await cast('professor', 'host', 'translator');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  await translator.enterRoom('translators-room');

  await professor.say('Shall we start with Ennead I.6, on beauty?');
  await host.say('Yes — page 1 of the Taylor.');

  for (const r of [professor, host]) {
    await expect(r.messages()).toHaveCount(2, { timeout: TIMING.realtime });
    await expect(r.messages().nth(0)).toContainText('Ennead I.6');
    await expect(r.messages().nth(0).getByTestId(TID.chatAuthor)).toHaveText(professor.name);
    await expect(r.messages().nth(1)).toContainText('page 1 of the Taylor');
    await expect(r.messages().nth(1).getByTestId(TID.chatAuthor)).toHaveText(host.name);
  }
  // AC5.2: another room hears nothing.
  await expect(translator.messages()).toHaveCount(0);
});

test('a late arrival sees recent messages', async ({ cast }) => {
  const { host, newcomer } = await cast('host', 'newcomer');
  await host.enterRoom('hermetica-alchemy');
  await host.say('Welcome — we are reading the Pimander tonight.');

  await newcomer.enterRoom('hermetica-alchemy');
  await expect(newcomer.messages().last()).toContainText('Pimander', { timeout: TIMING.realtime });
});

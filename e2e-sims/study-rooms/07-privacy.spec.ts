/** J10: opt-in, invisible, nothing private shown. */
import { test, expect, TID, ATTR, STATE, TIMING } from './fixtures';

test('going invisible hides you from others, and back', async ({ cast }) => {
  const { professor, host } = await cast('professor', 'host');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  const id = await professor.personId();
  await expect(host.avatarOf(id)).toBeVisible({ timeout: TIMING.realtime });

  await professor.tid(TID.visibilityToggle).click();
  await expect(professor.tid(TID.visibilityToggle)).toHaveAttribute(ATTR.state, STATE.visibility.invisible);
  await expect(host.avatarOf(id)).toHaveCount(0, { timeout: TIMING.realtime });
  await expect(host.rosterItemOf(id)).toHaveCount(0);

  // AC10.3: no chat or call while invisible.
  await expect(professor.tid(TID.invisibleNotice)).toBeVisible();
  await expect(professor.tid(TID.chatInput)).toBeDisabled();
  await expect(professor.tid(TID.callJoin)).toBeDisabled();
  // ...but they can still look around.
  await expect(professor.avatarOf(await host.personId())).toBeVisible();

  await professor.tid(TID.visibilityToggle).click();
  await expect(host.avatarOf(id)).toBeVisible({ timeout: TIMING.realtime });
});

test('email and account id are never shown to others', async ({ cast }) => {
  const { professor, host } = await cast('professor', 'host');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  await professor.say('hello');
  await expect(host.messages().last()).toContainText('hello', { timeout: TIMING.realtime });

  const html = await host.page.content();
  expect(html).not.toContain(professor.persona.email);
  expect(html).not.toContain(professor.persona.userId);
  expect(await professor.personId()).not.toBe(professor.persona.userId);
});

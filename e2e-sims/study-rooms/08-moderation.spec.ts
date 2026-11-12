/** J11: report, block, remove. */
import { test, expect, TID, TIMING } from './fixtures';

test('block hides both ways, without reload', async ({ cast }) => {
  const { lectora, newcomer } = await cast('lectora', 'newcomer');
  await lectora.enterRoom('hermetica-alchemy');
  await newcomer.enterRoom('hermetica-alchemy');
  const nId = await newcomer.personId();
  const lId = await lectora.personId();
  await expect(lectora.avatarOf(nId)).toBeVisible({ timeout: TIMING.realtime });

  await lectora.tid(TID.mobileSheetTab('people')).tap();
  await lectora.tid(TID.personMenu(nId)).tap();
  await lectora.tid(TID.actionBlock).tap();

  await expect(lectora.avatarOf(nId)).toHaveCount(0);
  await expect(newcomer.avatarOf(lId)).toHaveCount(0, { timeout: TIMING.realtime });
  await newcomer.say('can anyone see this?');
  await lectora.page.waitForTimeout(2_000);
  await expect(lectora.messages().filter({ hasText: 'can anyone see this?' })).toHaveCount(0);
});

test('report reaches the host; reported person is not told who', async ({ cast }) => {
  const { host, professor, newcomer } = await cast('host', 'professor', 'newcomer');
  for (const r of [host, professor, newcomer]) await r.enterRoom('platonists-circle');
  const nId = await newcomer.personId();

  await professor.tid(TID.personMenu(nId)).click();
  await professor.tid(TID.actionReport).click();
  await expect(professor.tid(TID.reportDialog)).toBeVisible();
  await professor.tid(TID.reportReason).selectOption({ index: 1 });
  await professor.tid(TID.reportDetails).fill('Off-topic posting (simulated).');
  await professor.tid(TID.reportSubmit).click();
  await expect(professor.tid(TID.reportConfirmation)).toBeVisible();

  await expect(host.tid(TID.hostReports).getByTestId(TID.hostReportItem)).toContainText(newcomer.name, {
    timeout: TIMING.realtime,
  });
  await expect(newcomer.page.getByText(professor.name + ' reported')).toHaveCount(0);
});

test('host removes a disruptive person', async ({ cast }) => {
  const { host, newcomer } = await cast('host', 'newcomer');
  await host.enterRoom('ancient-worlds');
  await newcomer.enterRoom('ancient-worlds');
  const nId = await newcomer.personId();

  await host.tid(TID.personMenu(nId)).click();
  await host.tid(TID.actionRemove).click();
  await expect(newcomer.tid(TID.removedNotice)).toBeVisible({ timeout: TIMING.realtime });
  await expect(host.avatarOf(nId)).toHaveCount(0);

  // Cannot walk back in this session (AC11.4).
  await newcomer.tid(TID.door('ancient-worlds')).click();
  await expect(newcomer.tid(TID.selfAvatar)).not.toHaveAttribute('data-room', 'ancient-worlds');
});

test('readers have Report and Block, but no Remove', async ({ cast }) => {
  const { host, professor } = await cast('host', 'professor');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  await professor.tid(TID.personMenu(await host.personId())).click();
  await expect(professor.tid(TID.actionReport)).toBeVisible();
  await expect(professor.tid(TID.actionBlock)).toBeVisible();
  await expect(professor.tid(TID.actionRemove)).toHaveCount(0);
});

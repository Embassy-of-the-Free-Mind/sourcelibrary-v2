/** J7–J8: open the group's text together; leave a note. */
import { test, expect, TID, ATTR, GROUPS, TIMING } from './fixtures';

test('host brings the group to a page', async ({ cast }) => {
  const { host, professor } = await cast('host', 'professor');
  await host.enterRoom('platonists-circle');
  await professor.enterRoom('platonists-circle');
  const slug = GROUPS['platonists-circle'].anchorBook!.replace('/book/', '');

  // AC7.1: opens in a side panel, still in the room.
  await host.tid(TID.openText).click();
  const panel = host.tid(TID.sharedReader);
  await expect(panel).toHaveAttribute(ATTR.bookSlug, slug);
  await expect(host.tid(TID.roomHeader)).toBeVisible();
  // AC7.3: links to the normal reader.
  await expect(host.tid(TID.sharedReaderFullLink)).toHaveAttribute('href', new RegExp(`/book/${slug}`));

  await host.tid(TID.pageNext).click();
  await host.tid(TID.pageNext).click();
  const page = await panel.getAttribute(ATTR.page);

  // AC7.2: others are asked, not moved.
  await host.tid(TID.bringEveryone).click();
  await expect(professor.tid(TID.followPrompt)).toBeVisible({ timeout: TIMING.realtime });
  await expect(professor.tid(TID.sharedReader)).toHaveCount(0);
  await professor.tid(TID.followAccept).click();
  await expect(professor.tid(TID.sharedReader)).toHaveAttribute(ATTR.page, page!);
});

test('a note left today is there for the next visitor', async ({ cast }) => {
  const { translator } = await cast('translator');
  await translator.enterRoom('translators-room');
  const text = `Crux: "mens" here — mind or intellect? (sim ${Date.now()})`;
  await translator.tid(TID.noteInput).fill(text);
  await translator.tid(TID.noteSubmit).click();
  await expect(translator.tid(TID.noteBoard).getByTestId(TID.note).filter({ hasText: text })).toBeVisible();
  await translator.leave();
  await translator.context.close();

  // AC8.2: still there for someone else, with author name.
  const { newcomer } = await cast('newcomer');
  await newcomer.enterRoom('translators-room');
  const note = newcomer.tid(TID.noteBoard).getByTestId(TID.note).filter({ hasText: text });
  await expect(note).toBeVisible();
  await expect(note).toContainText(translator.name);
});

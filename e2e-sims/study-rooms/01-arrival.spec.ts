/** J1–J3: invitation, sign in, consent + character, walk to the group room. */
import { test, expect, TID, ATTR, GROUPS, ANY, ROUTES } from './fixtures';

test.describe('J1–J3 arrival', () => {
  test('logged-out invitee sees the group but nobody in it', async ({ anonymous, cast }) => {
    // Someone is already in the room, so "nobody shown" is a real check.
    const { host } = await cast('host');
    await host.enterRoom('platonists-circle');

    const { newcomer } = await anonymous('newcomer');
    const realtime: string[] = [];
    newcomer.page.on('websocket', (ws) => realtime.push(ws.url()));

    await newcomer.open(ROUTES.room('platonists-circle'));
    await expect(newcomer.tid(TID.groupInfo)).toContainText(GROUPS['platonists-circle'].name);
    await expect(newcomer.tid(TID.nextMeeting)).toBeVisible();
    await expect(newcomer.tid(TID.signinCta)).toBeVisible();
    await expect(newcomer.page.locator(ANY.otherAvatars)).toHaveCount(0);
    await expect(newcomer.page.locator(ANY.rosterItems)).toHaveCount(0);
    await expect(newcomer.tid(TID.chat)).toHaveCount(0);
    await expect(newcomer.page.getByText(host.name)).toHaveCount(0);
    expect(realtime.filter((u) => /supabase|realtime|livekit/i.test(u)), 'no realtime connection when logged out').toEqual([]);

    // AC1.3: the sign-in link returns to this group page.
    const href = await newcomer.tid(TID.signinCta).getAttribute('href');
    expect(href).toContain(encodeURIComponent(ROUTES.room('platonists-circle')));
  });

  test('first entry asks for consent, then a character', async ({ cast }) => {
    const { newcomer } = await cast('newcomer');
    await newcomer.open();

    await expect(newcomer.tid(TID.optIn)).toBeVisible();
    await newcomer.tid(TID.optInAccept).click();

    const picker = newcomer.tid(TID.characterPicker);
    await expect(picker).toBeVisible();
    expect(await picker.getByTestId(TID.characterOption).count()).toBeGreaterThanOrEqual(8);
    await expect(newcomer.tid(TID.displayNameInput)).toHaveValue(newcomer.persona.accountName);

    await picker.getByTestId(TID.characterOption).nth(newcomer.persona.character).click();
    await newcomer.tid(TID.displayNameInput).fill(newcomer.name);
    await newcomer.tid(TID.characterConfirm).click();
    await expect(newcomer.tid(TID.selfAvatar)).toBeVisible();
    await expect(newcomer.tid(TID.selfAvatar)).toHaveAttribute(ATTR.room, 'hall');

    // AC2.3: remembered on the next visit.
    await newcomer.page.reload();
    await expect(newcomer.tid(TID.optIn)).toHaveCount(0);
    await expect(newcomer.tid(TID.characterPicker)).toHaveCount(0);
    await expect(newcomer.tid(TID.selfAvatar)).toBeVisible();
  });

  test('declining consent keeps the list view and makes you invisible', async ({ cast }) => {
    const { newcomer, host } = await cast('newcomer', 'host');
    await host.enterRoom('ancient-worlds');

    await newcomer.open();
    await newcomer.tid(TID.optInDecline).click();
    await expect(newcomer.tid(TID.roomList)).toBeVisible();
    await expect(newcomer.tid(TID.selfAvatar)).toHaveCount(0);
    await expect(host.page.getByText(newcomer.name)).toHaveCount(0);
  });

  test('walks from the hall into the group room', async ({ cast }) => {
    const { professor } = await cast('professor');
    await professor.open();
    await professor.completeFirstEntry();

    // Keyboard moves one tile per press (AC3.2).
    const start = await professor.tile();
    await professor.step('ArrowRight', 2);
    await expect.poll(() => professor.tile()).toEqual({ x: start.x + 2, y: start.y });

    // Clicking the door walks there and enters (AC3.2, AC3.3).
    await professor.walkToDoor('platonists-circle');
    await expect(professor.tid(TID.roomHeader)).toContainText('Plotinus');
  });
});

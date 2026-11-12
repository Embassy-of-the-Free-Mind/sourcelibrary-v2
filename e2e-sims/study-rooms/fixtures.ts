/**
 * Fixtures for the Study Rooms sims: target guard, test sign-in, and a
 * `Reader` driver per persona. Each multi-user test opens one browser context
 * per persona and asserts on what each one sees.
 *
 * Sign-in: the site uses Auth.js with JWT sessions (src/lib/auth.ts,
 * `session.strategy: 'jwt'`). We mint a session cookie for an invented user
 * with `encode` from next-auth/jwt, using the same AUTH_SECRET as the server
 * under test (SIMS_AUTH_SECRET). That is exactly what a real sign-in leaves in
 * the browser, without sending a magic-link email.
 */
import { test as base, expect, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { ANY, ATTR, GROUPS, PERSON_ID_ATTR, ROUTES, STATE, TID, TIMING, type GroupSlug } from './contract';
import { PERSONAS, type Persona, type PersonaKey } from './personas';
import { assertSafeTarget } from './target';

// ---------------------------------------------------------------------------
// Test sign-in
// ---------------------------------------------------------------------------

function sessionCookieName(url: URL): string {
  if (process.env.SIMS_COOKIE_NAME) return process.env.SIMS_COOKIE_NAME;
  return url.protocol === 'https:' ? '__Secure-authjs.session-token' : 'authjs.session-token';
}

/** Put a valid Auth.js session for `persona` into `context`. */
export async function signIn(context: BrowserContext, persona: Persona): Promise<void> {
  const url = assertSafeTarget();
  const secret = process.env.SIMS_AUTH_SECRET;
  if (!secret) {
    throw new Error('Study Rooms sims: set SIMS_AUTH_SECRET to the AUTH_SECRET of the server under test.');
  }
  const name = sessionCookieName(url);
  const value = await encode({
    secret,
    salt: name,
    maxAge: 60 * 60,
    token: {
      sub: persona.userId,
      id: persona.userId,
      email: persona.email,
      name: persona.accountName,
      role: persona.role,
      membership: null,
      needsWelcome: false,
    },
  });
  await context.addCookies([
    {
      name,
      value,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: url.protocol === 'https:',
    },
  ]);
}

// ---------------------------------------------------------------------------
// Reader driver
// ---------------------------------------------------------------------------

/** Fails with a readable message when the route is not built yet. */
export async function gotoOrFail(page: Page, path: string): Promise<Response | null> {
  const res = await page.goto(path);
  expect(res, `no response for ${path}`).not.toBeNull();
  expect(res!.status(), `Study Rooms route ${path} returned ${res!.status()} — not built yet?`).toBeLessThan(400);
  await expect(page.getByTestId(TID.root), `${path} has no [data-testid=${TID.root}] — not built yet?`).toBeVisible();
  return res;
}

export class Reader {
  constructor(
    readonly persona: Persona,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  get name() {
    return this.persona.displayName;
  }

  tid(id: string) {
    return this.page.getByTestId(id);
  }

  lobbyPath() {
    return this.persona.locale === 'es' ? ROUTES.lobbyEs : ROUTES.lobby;
  }

  roomPath(slug: GroupSlug) {
    return this.persona.locale === 'es' ? ROUTES.roomEs(slug) : ROUTES.room(slug);
  }

  async open(path: string = this.lobbyPath()) {
    await gotoOrFail(this.page, path);
  }

  /** First-entry flow: accept visibility, pick character and name (J2). */
  async completeFirstEntry() {
    const optIn = this.tid(TID.optIn);
    if (await optIn.isVisible().catch(() => false)) {
      await this.tid(TID.optInAccept).click();
    }
    const picker = this.tid(TID.characterPicker);
    if (await picker.isVisible().catch(() => false)) {
      await picker.getByTestId(TID.characterOption).nth(this.persona.character).click();
      await this.tid(TID.displayNameInput).fill(this.persona.displayName);
      await this.tid(TID.characterConfirm).click();
    }
    await expect(this.tid(TID.selfAvatar)).toBeVisible();
    await expect(this.tid(TID.connectionStatus)).toHaveAttribute(ATTR.state, STATE.connection.connected, {
      timeout: TIMING.realtime,
    });
  }

  /** Open the lobby, finish first entry, walk through the group's door (J3). */
  async enterRoom(slug: GroupSlug) {
    await this.open();
    await this.completeFirstEntry();
    await this.walkToDoor(slug);
  }

  async walkToDoor(slug: GroupSlug) {
    await this.tid(TID.door(slug)).click();
    await expect(this.tid(TID.selfAvatar)).toHaveAttribute(ATTR.room, slug, { timeout: 15_000 });
    await expect(this.tid(TID.roomHeader)).toContainText(GROUPS[slug].name);
  }

  /** This person's opaque public id, as others see it in test ids. */
  async personId(): Promise<string> {
    const id = await this.tid(TID.selfAvatar).getAttribute(PERSON_ID_ATTR);
    expect(id, `self avatar has no ${PERSON_ID_ATTR}`).toBeTruthy();
    return id!;
  }

  async tile(): Promise<{ x: number; y: number }> {
    return tileOf(this.tid(TID.selfAvatar));
  }

  /** Keyboard movement: focus the map and press an arrow key `n` times. */
  async step(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', n = 1) {
    await this.tid(TID.map).focus();
    for (let i = 0; i < n; i++) await this.page.keyboard.press(key);
  }

  async say(text: string) {
    await this.tid(TID.chatInput).fill(text);
    await this.tid(TID.chatSend).click();
  }

  /** Locator for another person's avatar as THIS reader sees it. */
  avatarOf(personId: string) {
    return this.tid(TID.avatar(personId));
  }

  rosterItemOf(personId: string) {
    return this.tid(TID.rosterItem(personId));
  }

  otherAvatars() {
    return this.page.locator(ANY.otherAvatars);
  }

  messages() {
    return this.tid(TID.chat).getByTestId(TID.chatMessage);
  }

  async leave() {
    await this.tid(TID.leave).click();
  }
}

export async function tileOf(locator: ReturnType<Page['getByTestId']>): Promise<{ x: number; y: number }> {
  const x = await locator.getAttribute(ATTR.tileX);
  const y = await locator.getAttribute(ATTR.tileY);
  expect(x, `${ATTR.tileX} missing`).not.toBeNull();
  expect(y, `${ATTR.tileY} missing`).not.toBeNull();
  return { x: Number(x), y: Number(y) };
}

// ---------------------------------------------------------------------------
// Playwright fixtures
// ---------------------------------------------------------------------------

export type Cast = <K extends PersonaKey>(...keys: K[]) => Promise<Record<K, Reader>>;

async function openReader(browser: Browser, persona: Persona, opts: { signedIn: boolean }): Promise<Reader> {
  const url = assertSafeTarget();
  const context = await browser.newContext({ ...persona.context, baseURL: url.origin });
  if (opts.signedIn) await signIn(context, persona);
  const page = await context.newPage();
  return new Reader(persona, context, page);
}

export const test = base.extend<{ cast: Cast; anonymous: Cast }>({
  /** `const { professor, host } = await cast('professor', 'host')` — signed-in readers. */
  cast: async ({ browser }, provide) => {
    const opened: Reader[] = [];
    await provide(async (...keys) => {
      const out = {} as Record<(typeof keys)[number], Reader>;
      for (const k of keys) {
        const r = await openReader(browser, PERSONAS[k], { signedIn: true });
        opened.push(r);
        out[k] = r;
      }
      return out;
    });
    await Promise.all(opened.map((r) => r.context.close()));
  },
  /** Same, but logged out (no session cookie). */
  anonymous: async ({ browser }, provide) => {
    const opened: Reader[] = [];
    await provide(async (...keys) => {
      const out = {} as Record<(typeof keys)[number], Reader>;
      for (const k of keys) {
        const r = await openReader(browser, PERSONAS[k], { signedIn: false });
        opened.push(r);
        out[k] = r;
      }
      return out;
    });
    await Promise.all(opened.map((r) => r.context.close()));
  },
});

export { expect, TID, ATTR, STATE, TIMING, ROUTES, GROUPS, ANY };

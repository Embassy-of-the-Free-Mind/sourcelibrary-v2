/**
 * Which `users.profile` fields a welcome/account save should write.
 *
 * The rule that matters: an ABSENT key means "leave this alone", a present empty
 * string means "the reader cleared this box". Conflating the two is how two
 * readers lost their answers on 2026-07-30 — the welcome form rendered blank on
 * every visit, and the redirect loop (#3467) made people submit it twice, so the
 * second, empty save overwrote the first, real one.
 *
 * Extracted from the route so the rule is reachable by a test.
 */

export interface WelcomeProfileBody {
  about_you?: unknown;
  help_description?: unknown;
  preferred_language?: unknown;
  name?: unknown;
  skip?: unknown;
}

const str = (v: unknown, max: number, collapse = false) => {
  if (typeof v !== 'string') return '';
  const s = collapse ? v.trim().replace(/\s+/g, ' ') : v.trim();
  return s.slice(0, max);
};

/**
 * @returns the `$set` fragment for the profile fields, keyed as stored. Callers
 * add `welcomedAt` / `name` themselves.
 */
export function buildProfileUpdate(body: WelcomeProfileBody | null | undefined, now: Date): Record<string, unknown> {
  const b = body || {};
  const update: Record<string, unknown> = {};

  if ('about_you' in b) update['profile.aboutYou'] = str(b.about_you, 4000);
  if ('help_description' in b) update['profile.helpDescription'] = str(b.help_description, 2000);
  if ('preferred_language' in b) {
    const lang = str(b.preferred_language, 60, true);
    update['profile.preferredLanguage'] = lang;
    update['profile.preferredLanguageKey'] = lang.toLowerCase();
  }

  // Only stamp when something actually changed, so an empty save doesn't make a
  // profile look freshly edited.
  if (Object.keys(update).length) update['profile.updatedAt'] = now;

  return update;
}

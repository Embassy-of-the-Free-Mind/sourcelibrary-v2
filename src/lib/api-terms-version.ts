/**
 * The API terms a key holder agrees to (/terms#api-terms), in a file with no
 * server imports so the key form can read it. #8235.
 *
 * PRIOR ART: src/lib/partner-terms-version.ts — the same split for the Embassy
 * collection terms. Those stay the download gate; these are the API's, and the
 * API section says the Embassy terms also apply to its books, so one tick covers both.
 *
 * A change of substance to the #api-terms section needs a new version here, and
 * every key holder is then asked again.
 */
export const API_TERMS_VERSION = '2026-11-08';

export const API_TERMS_URL = 'https://sourcelibrary.org/terms#api-terms';

/**
 * The /terms page as a whole (its "Effective date"). The sign-in form says
 * signing in is agreeing to it; createUser (src/lib/auth.ts) records this
 * version on the new account so the agreement has a date and a text.
 */
export const SITE_TERMS_VERSION = '2026-11-08';

/**
 * Keys made before these terms (143 of 145 on 2026-11-08 had agreed to nothing)
 * keep working until this date, while their holders are emailed. After it, a key
 * whose holder has not agreed is refused with a link to agree.
 */
export const API_TERMS_DEADLINE = '2026-11-23T00:00:00Z';

/** True when this key's holder has agreed to the current API terms. Versions are ISO dates, so they compare as strings. */
export function keyHasCurrentTerms(key: { terms_version?: string | null }): boolean {
  return typeof key.terms_version === 'string' && key.terms_version >= API_TERMS_VERSION;
}

/**
 * True when a key must agree before it is served: a FREE key, past the deadline,
 * without the current terms. Paid and partner tiers are issued by hand under an
 * agreement (src/app/api/admin/api-keys), so a checkbox does not switch them off.
 * A key with no tier is treated as free, the same floor api-budget.ts uses.
 */
export function keyBlockedForTerms(key: { terms_version?: string | null; tier?: string | null }, now: Date = new Date()): boolean {
  const free = !key.tier || key.tier === 'explorer';
  return free && now >= new Date(API_TERMS_DEADLINE) && !keyHasCurrentTerms(key);
}

/** The body a refused key gets: what happened and the one step that fixes it. */
export function apiTermsRequiredBody() {
  return {
    error: 'terms_required',
    message: `This key's holder has not agreed to the API terms (version ${API_TERMS_VERSION}). Sign in at https://sourcelibrary.org/developers#get-key and agree; the key then works again unchanged.`,
    terms_version: API_TERMS_VERSION,
    terms_url: API_TERMS_URL,
    agree_url: 'https://sourcelibrary.org/developers#get-key',
  };
}

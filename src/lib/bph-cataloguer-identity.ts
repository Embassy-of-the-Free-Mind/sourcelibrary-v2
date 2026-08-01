/**
 * Link a signed-in editor to the cataloguing they did before Source Library.
 *
 * 27,703 of the 29,879 BPH records carry `modified_by_email` /
 * `modified_by_username` from Memorix — eight named cataloguers working from
 * February 2017 to June 2025. That is the bulk of the human labour in the
 * catalogue, and until now it was invisible: the columns are rendered nowhere.
 *
 * The catch is that the library changed domain. José's Memorix address is
 * `jbouman@ritmanlibrary.nl`; she signs in as `jbouman@efm.amsterdam`. Same
 * person, and nothing in the data says so. This maps between the two by local
 * part across the library's known domains — deliberately narrow, because the
 * consequence of a wrong match is attributing one person's work to another.
 *
 * Personal addresses (gmail and the like) are matched only to themselves.
 */

/** Domains the library has used for staff accounts, old and current. */
const BPH_DOMAINS = ['efm.amsterdam', 'ritmanlibrary.nl'];

/**
 * Accounts shared by several people. Work done under these must never be
 * attributed to whoever happens to be signed in — "BPH1" is a desk, not a
 * person, and 7,449 records sit behind it.
 */
const SHARED_ACCOUNTS = new Set(['bph@ritmanlibrary.nl', 'memorix.servicedesk@vitecsoftware.com']);

/** Usernames belonging to shared accounts, for the same reason. */
export const SHARED_USERNAMES = new Set(['BPH1', 'BPH2', 'pictura']);

/**
 * Every Memorix address that plausibly belongs to this signed-in person.
 * Empty when the account is shared — we would rather show nothing than credit
 * one librarian with another's eight years of work.
 */
export function memorixAliasesFor(email: string | null | undefined): string[] {
  if (!email) return [];
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@') || SHARED_ACCOUNTS.has(normalized)) return [];

  const [local, domain] = normalized.split('@');
  if (!local || !domain) return [];

  // Only bridge domains for library accounts. A personal address matches
  // itself and nothing else: `jsmith@gmail.com` must not claim
  // `jsmith@ritmanlibrary.nl`.
  const aliases = BPH_DOMAINS.includes(domain)
    ? BPH_DOMAINS.map((d) => `${local}@${d}`)
    : [normalized];

  return aliases.filter((a) => !SHARED_ACCOUNTS.has(a));
}

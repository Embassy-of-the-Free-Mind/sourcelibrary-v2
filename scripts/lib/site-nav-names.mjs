/**
 * Name tokens for navigational search (#5945): a visitor types a page's NAME
 * ("timeline", "check pages", "Huygens") and should land on the page.
 *
 * One folder for both sides of the match: scripts/workers/embed-site-pages.mjs
 * stores `site_pages.name_tokens` with it and the unified search route folds
 * the query with it, so "Libraries" and "library" cannot drift apart.
 *
 * PRIOR ART: src/lib/search/word-forms.ts — matchStem() returns a PREFIX for
 * substring lanes (botanical → botan); a prefix is not a token and an array
 * containment test needs "libraries" to equal "library" exactly.
 * scripts/lib/name-equivalence.mjs — decides whether two PERSON names are one
 * person (Cicéron/Cicero); far looser than a page name should be matched.
 */

/** Marks that sit inside a word are elided, never turned into separators (non-latin-text-operations.md). */
const ELIDED = /['’‘ʻʿʾ`´]/g;

function singular(w) {
  if (!/^[a-z]+$/.test(w)) return w;
  if (w.length >= 6 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  // Plural -s, but not -ss/-us/-is (glass, census, genesis).
  if (w.length >= 4 && /[^sui]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * Distinct folded tokens of a name or a query, in order: accents stripped,
 * lowercased, letters and digits of every script kept, English plurals folded,
 * "the" dropped. `Böhme's Works` → [bohme, work].
 */
export function navTokens(s) {
  const folded = String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(ELIDED, '').toLowerCase();
  const out = [];
  for (const w of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (!w || w === 'the') continue;
    const t = singular(w);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** The names a URL path spells out: `/research/page-errors` → ["page errors", "research page errors"]. */
export function pathNames(path) {
  const segs = String(path).split('/').filter(Boolean).map((s) => decodeURIComponent(s).replace(/[-_]+/g, ' '));
  if (segs.length === 0) return [];
  return segs.length === 1 ? [segs[0]] : [segs[segs.length - 1], segs.join(' ')];
}

/** Names with no tokens removed, and names that fold to the same tokens kept once. */
export function distinctNames(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const name = String(n ?? '').replace(/\s+/g, ' ').trim();
    const key = navTokens(name).slice().sort().join(' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Every token of every name: the column the candidate lookup is indexed on. */
export function nameTokens(names) {
  return [...new Set(names.flatMap(navTokens))];
}

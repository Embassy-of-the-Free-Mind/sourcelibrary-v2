// PRIOR ART: scripts/lib/latin-morphology.mjs — STRIPS Latin endings to compare two names
// (catalog matching, attribution audits); it never generates forms and is not importable from
// the request path. src/lib/entity-aliases.ts — resolves a name to ONE canonical name at sync
// time from `entity_aliases`, which carries generic epithets. src/lib/concept-aliases.ts —
// curated CONCEPT vocabulary, no persons. src/lib/search/word-forms.ts — English stems for the
// substring lanes. None expands a person's name into the spellings a page may print (#5888).
/**
 * Query-time name variants for the keyword page lanes (#5888).
 *
 * Early-modern names are printed in Latin cases and period spellings, and translations keep
 * the source's spelling: "Drebbel" is also Drebelius, Drebelii, Drebbelius and Drebel. The
 * `pages_search` index is `lucene.standard` (no stemming, no diacritic folding), so the reader's
 * spelling finds only itself.
 *
 * When a query names a person `entities` knows (by name or alias), the keyword lanes OR in:
 *   1. that person's alias spellings OF THE SAME NAME TOKEN — never the whole alias list;
 *   2. period spellings of the surname (doubled consonants written single; umlauted forms
 *      only when `entities` knows a person under them);
 *   3. generated Latin case forms of each.
 *
 * Three guards carry the precision:
 *   - An alias token is used only if it is a near spelling of the token the reader typed.
 *     `entities.aliases` holds epithets and other people ("Mercury" → Hermes, Quicksilver;
 *     "Paris" → Alexander; "Philip" → Paracelsus). Those are synonyms at best, not spellings.
 *   - A token too short to compare (under 4 characters, in any script) is never expanded.
 *     That is "cannot judge", not "no variants" — see
 *     .claude/docs/invariants/non-latin-text-operations.md.
 *
 *   - A name whose larger `entities` record is a place or concept ("Paris", "Nature") is not
 *     treated as a person.
 *
 * A query that names no known person yields [] and the search stage is unchanged.
 */
import { getDb } from '@/lib/mongodb';

/** Upper bound on variant terms added to one query. */
export const MAX_NAME_VARIANTS = 40;
/** Upper bound on exact-match candidates sent to `entities` per lookup. */
const MAX_LOOKUP_CANDIDATES = 40;
/** A name longer than this many words is not looked up. */
const MAX_NAME_WORDS = 4;
/** A query longer than this is prose, not a name lookup. */
const MAX_QUERY_WORDS = 8;
/** Shortest token that is expanded, and shortest token ever emitted. */
const MIN_TOKEN = 4;

const LATIN_ONLY = /^\p{Script=Latin}+$/u;
const INNER_MARKS = /[ʻʼʾʿ‘’'`´]/g;

/** The slice of an `entities` person record the expansion reads. */
export interface PersonNameRecord {
  name: string;
  aliases?: string[];
  /** Absent is read as 'person' (tests, callers that pre-filter). */
  type?: string;
  book_count?: number;
}

/** Latin case endings generated for a surname, in the order they are emitted. */
export const LATIN_ENDINGS = ['us', 'ius', 'i', 'ii', 'o', 'io', 'um', 'ium', 'ianus', 'iana'] as const;
/** Longest first, so "-ianus" is not read as "-us". */
const STRIP_ORDER = ['ianus', 'iana', 'ium', 'ius', 'ii', 'io', 'um', 'us', 'i', 'o'];

/**
 * Fold a name for comparison: lowercase everywhere; strip combining marks from Latin-script
 * text only. Other scripts keep their marks — stripping them from Hebrew or Devanagari changes
 * the word. Never returns "" for non-empty input.
 */
export function foldName(s: string): string {
  // Ayn, hamza and apostrophes sit INSIDE a word: elided, never a separator (Saʻdī → sadi).
  const nfc = s.normalize('NFC').replace(INNER_MARKS, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(nfc)) return nfc;
  return nfc.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/** Words of a name or query: letters, marks and digits of any script; inner apostrophes elided. */
export function nameTokens(s: string): string[] {
  return s
    .normalize('NFC')
    .replace(INNER_MARKS, '')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

function chars(s: string): string[] {
  return Array.from(s);
}

/** The stem Latin endings attach to, or null when the token cannot take them. */
function latinStem(token: string): { stem: string; stripped: string } | null {
  if (!LATIN_ONLY.test(token)) return null;
  const lower = token.toLowerCase();
  for (const suf of STRIP_ORDER) {
    if (lower.endsWith(suf)) {
      const stem = token.slice(0, token.length - suf.length);
      // An ending on a stem too short to be a name ("Jesus" → "Jes") — do not guess.
      return chars(stem).length >= MIN_TOKEN ? { stem, stripped: suf } : null;
    }
  }
  if (lower.endsWith('e')) {
    const stem = token.slice(0, -1);
    return chars(stem).length >= MIN_TOKEN ? { stem, stripped: 'e' } : null;
  }
  // Other vowel-final names decline differently (Agrippa, Agrippae) — out of scope. So is a
  // form that is already declined (Baconis, Christos): no ending is stacked on an ending.
  if (/[aeiouyàáâäãåèéêëìíîïòóôöõùúûü]$/u.test(lower) || /[aeiou]s$/.test(lower)) return null;
  return chars(token).length >= MIN_TOKEN ? { stem: token, stripped: '' } : null;
}

/**
 * Latin case forms of a surname: Drebbel → Drebbelus, Drebbelius, Drebbelii, …; a Latin form
 * goes back to its stem too (Drebbelius → Drebbel). Never emits a token under 4 characters,
 * never emits the input, and returns [] for a non-Latin-script token.
 */
export function latinCaseForms(surname: string): string[] {
  const parsed = latinStem(surname);
  if (!parsed) return [];
  const { stem, stripped } = parsed;
  const out: string[] = [];
  // The bare stem is a real spelling only when a full ending came off (-us, -ius, -ii, …).
  if (stripped.length >= 2) out.push(stem);
  for (const end of LATIN_ENDINGS) out.push(stem + end);
  const self = surname.toLowerCase();
  return out.filter(f => chars(f).length >= MIN_TOKEN && f.toLowerCase() !== self);
}

const DIACRITIC = /\p{M}/u;
const hasDiacritics = (s: string) => DIACRITIC.test(s.normalize('NFD'));
const stripMarks = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
const singleConsonants = (s: string) => s.replace(/([b-df-hj-np-tv-xz])\1/gi, '$1');

/**
 * Rule-generated period spellings that are safe to search for unconfirmed: doubled consonants
 * written single (Kuffler → Kufler, Drebbel → Drebel) and, for a name TYPED with diacritics,
 * the plain and digraph forms (Küffler → Kuffler, Kueffler). Latin script only.
 */
export function spellingVariants(surname: string): string[] {
  if (!LATIN_ONLY.test(surname)) return [];
  const out = new Set<string>();
  const add = (v: string) => {
    if (v !== surname && chars(v).length >= MIN_TOKEN + 1) out.add(v);
  };
  add(singleConsonants(surname));
  if (hasDiacritics(surname)) {
    const plain = stripMarks(surname);
    const digraph = surname.replace(/[äöüÄÖÜ]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' }[c] as string));
    for (const v of [plain, digraph]) {
      add(v);
      add(singleConsonants(v));
    }
  }
  return [...out];
}

/**
 * Umlauted spellings of a plain surname (Kuffler → Küffler, Kueffler). Unlike the rules above
 * these are mostly non-words (Paris → Päris), so they are only LOOKED UP: one is searched for
 * only if `entities` knows a person under that spelling.
 */
export function umlautCandidates(surname: string): string[] {
  if (!LATIN_ONLY.test(surname) || hasDiacritics(surname)) return [];
  const m = /[aou](?![aeiou])/i.exec(surname);
  if (!m) return [];
  const map: Record<string, [string, string]> = {
    a: ['ä', 'ae'], o: ['ö', 'oe'], u: ['ü', 'ue'],
    A: ['Ä', 'Ae'], O: ['Ö', 'Oe'], U: ['Ü', 'Ue'],
  };
  return map[m[0]].map(rep => surname.slice(0, m.index) + rep + surname.slice(m.index + 1));
}

function editDistance(a: string, b: string, max: number): number {
  const s = chars(a);
  const t = chars(b);
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

/**
 * Folded stem used to compare two spellings of one name. Latin script: marks stripped,
 * ae/oe/ue read as a/o/u (Boehme = Böhme), k = c, y/j = i, v = u, ph = f, th = t, doubled
 * consonants single, a full Latin ending removed (Drebelius, Drebbel → drebel). Other scripts
 * are only lowercased.
 */
function comparisonStem(token: string): string {
  let s = foldName(token);
  if (!LATIN_ONLY.test(s)) return s;
  for (const suf of STRIP_ORDER) {
    if (suf.length >= 2 && s.endsWith(suf) && s.length - suf.length >= MIN_TOKEN) {
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }
  s = s.replace(/([aou])e/g, '$1').replace(/ph/g, 'f').replace(/th/g, 't')
    .replace(/k/g, 'c').replace(/[yj]/g, 'i').replace(/v/g, 'u');
  return singleConsonants(s);
}

/**
 * Is `candidate` a spelling of the name token `typed`? Their folded stems must be equal, or one
 * a prefix of the other by at most two letters (Plato / Platon / Platone), or — from six letters
 * up — one edit apart (Drebbel / Drebber, Kuffler / Kiffler). One edit on a short word is a
 * different word (Bacon / Baron), so it is refused there. Under four characters, in any script,
 * nothing is comparable and the answer is no: Dee, Yi I and 薛己 match only themselves.
 */
export function isSpellingOf(typed: string, candidate: string): boolean {
  const a = comparisonStem(typed);
  const b = comparisonStem(candidate);
  const [short, long] = chars(a).length <= chars(b).length ? [a, b] : [b, a];
  const len = chars(short).length;
  if (len < MIN_TOKEN) return false;
  if (a === b) return true;
  if (chars(a)[0] !== chars(b)[0]) return false;
  if (long.startsWith(short) && chars(long).length - len <= 2) return true;
  return len >= 6 && editDistance(a, b, 1) <= 1;
}

function titleCase(s: string): string {
  return s.replace(/(^|[\s-])(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

interface NameSpan {
  /** The words as typed, joined by one space. */
  text: string;
  /** Last word — the token that gets variants. Null when it is too short to expand. */
  surname: string | null;
  start: number;
  end: number;
}

/** Every run of 1–4 adjacent query words, longest first: the spans that could be a person's name. */
export function nameSpans(query: string): NameSpan[] {
  const trimmed = query.trim();
  if (!trimmed || /^".*"$/.test(trimmed)) return []; // a quoted phrase asks for those exact words
  const words = trimmed.split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '')).filter(Boolean);
  if (words.length === 0 || words.length > MAX_QUERY_WORDS) return [];
  const spans: NameSpan[] = [];
  for (let n = Math.min(MAX_NAME_WORDS, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n);
      const last = nameTokens(slice[n - 1]).pop();
      if (!last) continue;
      // A lone word too short to expand is not worth a lookup; inside a longer name it is
      // (so "John Dee" is recognised as one person and "John" is not expanded on its own).
      if (n === 1 && chars(last).length < MIN_TOKEN) continue;
      spans.push({ text: slice.join(' '), surname: chars(last).length >= MIN_TOKEN ? last : null, start: i, end: i + n });
    }
  }
  return spans;
}

/**
 * Exact strings to look up in `entities.name` / `entities.aliases`. Those indexes are
 * case-sensitive, so each span is tried as typed, in Title Case, and with Latin diacritics
 * removed. Longest spans first; bounded.
 */
export function lookupCandidates(query: string): string[] {
  const out = new Set<string>();
  for (const span of nameSpans(query)) {
    for (const form of [span.text, titleCase(span.text.toLowerCase())]) {
      out.add(form);
      if (LATIN_ONLY.test(form.replace(/[\s.\-]/g, ''))) out.add(stripMarks(form));
    }
    if (out.size >= MAX_LOOKUP_CANDIDATES) break;
  }
  return [...out].slice(0, MAX_LOOKUP_CANDIDATES);
}

function recordNames(r: PersonNameRecord): string[] {
  return [r.name, ...(Array.isArray(r.aliases) ? r.aliases : [])].filter(n => typeof n === 'string' && n.trim());
}

const isPerson = (r: PersonNameRecord) => (r.type ?? 'person') === 'person';

/**
 * The typed surnames that name a PERSON. A span counts when a person record carries it as its
 * name or an alias — unless a place or concept of the same name is the larger entry ("Paris",
 * "Nature", "Mercury"), in which case the reader most likely means that and nothing is expanded.
 * A span inside a longer matched name is skipped.
 */
function matchedSurnames(query: string, records: PersonNameRecord[]): string[] {
  return matchedNames(query, records).surnames;
}

function matchedNames(query: string, records: PersonNameRecord[]): { surnames: string[]; taken: NameSpan[] } {
  const person = new Map<string, number>();
  const other = new Map<string, number>();
  for (const r of records) {
    const weight = r.book_count ?? 0;
    if (isPerson(r)) {
      for (const n of recordNames(r)) {
        const k = foldName(n);
        person.set(k, Math.max(person.get(k) ?? 0, weight));
      }
    } else if (typeof r.name === 'string') {
      const k = foldName(r.name);
      other.set(k, Math.max(other.get(k) ?? 0, weight));
    }
  }
  const out: string[] = [];
  const taken: NameSpan[] = [];
  for (const span of nameSpans(query)) {
    const k = foldName(span.text);
    const weight = person.get(k);
    if (weight === undefined || (other.get(k) ?? -1) > weight) continue;
    if (taken.some(t => t.start <= span.start && span.end <= t.end)) continue;
    taken.push(span);
    if (span.surname && !out.includes(span.surname)) out.push(span.surname);
  }
  return { surnames: out, taken };
}

/**
 * The query's words that are NOT part of a matched person's name and are long enough to carry
 * a topic ("Paracelsus on the plague" → ["plague"]). Empty when the query is only the name.
 */
export function topicWords(query: string, matched: PersonNameRecord[]): string[] {
  const { taken } = matchedNames(query, matched);
  if (taken.length === 0) return [];
  const words = query.trim().split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '')).filter(Boolean);
  return words.filter((w, i) => !taken.some(t => t.start <= i && i < t.end) && chars(w).length >= MIN_TOKEN);
}

/**
 * Names worth a second lookup: the matched person's other full names that contain a spelling of
 * the typed surname ("Drebbel" finds the record aliased "Drebbel"; its alias "Cornelius Drebbel"
 * is the NAME of a second record, whose own alias is "Cornelius Drebel"), plus the umlauted
 * spellings that are searched only if confirmed.
 */
export function secondHopCandidates(query: string, records: PersonNameRecord[]): string[] {
  const surnames = matchedSurnames(query, records);
  if (surnames.length === 0) return [];
  const already = new Set(lookupCandidates(query));
  const out = new Set<string>();
  for (const s of surnames) for (const u of umlautCandidates(s)) out.add(u);
  for (const r of records) {
    if (!isPerson(r)) continue;
    for (const n of recordNames(r)) {
      if (out.size >= MAX_LOOKUP_CANDIDATES) return [...out];
      if (already.has(n) || out.has(n)) continue;
      if (nameTokens(n).some(t => surnames.some(s => isSpellingOf(s, t)))) out.add(n);
    }
  }
  return [...out];
}

/**
 * The variant terms for a query, given the records its names matched (and, optionally, the
 * records reached through their aliases). Pure — the lookup is `expandPersonNames`.
 *
 * Order is priority order, because the list is capped: spellings from the alias data first,
 * then rule-generated spellings, then Latin case forms of each.
 */
export function buildNameVariants(
  query: string,
  matched: PersonNameRecord[],
  related: PersonNameRecord[] = [],
): string[] {
  const surnames = matchedSurnames(query, matched);
  if (surnames.length === 0) return [];

  const typed = new Set(nameTokens(query).map(t => t.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (term: string) => {
    const key = term.normalize('NFC').toLowerCase();
    if (typed.has(key) || seen.has(key) || chars(term).length < MIN_TOKEN) return;
    seen.add(key);
    out.push(term.normalize('NFC'));
  };

  const spellings: string[] = [];
  const addSpelling = (t: string) => {
    if (!spellings.some(s => s.toLowerCase() === t.toLowerCase())) spellings.push(t);
  };
  for (const surname of surnames) {
    for (const r of [...matched, ...related]) {
      if (!isPerson(r)) continue;
      for (const n of recordNames(r)) {
        for (const t of nameTokens(n)) {
          if (t.toLowerCase() !== surname.toLowerCase() && isSpellingOf(surname, t)) addSpelling(t);
        }
      }
    }
  }
  for (const base of [...surnames, ...spellings.slice()]) {
    for (const v of spellingVariants(base)) addSpelling(v);
  }
  for (const s of spellings) push(s);
  // Latin text does not print umlauts or accents on a declined name: plain bases only. A
  // spelling that already ends in a vowel or a case ending (Bacone, Baco, Paracelso) is used as
  // it stands — re-declining it invents words (Bacco → Baccus).
  for (const base of [...surnames, ...spellings]) {
    if (hasDiacritics(base)) continue;
    if (!surnames.includes(base) && latinStem(base)?.stripped !== '') continue;
    for (const f of latinCaseForms(base)) push(f);
  }
  return out.slice(0, MAX_NAME_VARIANTS);
}

// ── Lookup (cached, bounded, fail-open) ──────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const LOOKUP_MAX_MS = 400;
const LOOKUP_LIMIT = 25;
export interface NameExpansion {
  /** Other spellings of the person(s) the query names; [] when it names none. */
  variants: string[];
  /** The query's topic words outside the name; [] when the query is only the name. */
  topicWords: string[];
}
const NONE: NameExpansion = { variants: [], topicWords: [] };
const cache = new Map<string, NameExpansion & { expires: number }>();

async function findPersons(candidates: string[]): Promise<PersonNameRecord[]> {
  if (candidates.length === 0) return [];
  const db = await getDb();
  const entities = db.collection('entities');
  const opts = { projection: { _id: 0, name: 1, aliases: 1, type: 1, book_count: 1 }, maxTimeMS: LOOKUP_MAX_MS };
  // Two indexed equality finds (name_1_type_1, entities_aliases_idx), not one $or: an $or
  // leaves the planner free to pick a scan (request-path-queries.md). The name find takes every
  // type, so a place or concept of the same name can outweigh the person.
  const [byName, byAlias] = await Promise.all([
    entities.find({ name: { $in: candidates } }, opts).limit(LOOKUP_LIMIT * 3).toArray(),
    entities.find({ type: 'person', aliases: { $in: candidates } }, opts).limit(LOOKUP_LIMIT).toArray(),
  ]);
  return [...byName, ...byAlias] as unknown as PersonNameRecord[];
}

/**
 * Variant terms for the names in a query (and its remaining topic words), or nothing when it
 * names no known person.
 *
 * At most four indexed finds on `entities` per uncached query, each capped in rows and time.
 * A lookup failure returns nothing (today's search, unexpanded) and is NOT cached — an error is
 * not "no such person".
 */
export async function expandNameQuery(query: string): Promise<NameExpansion> {
  const candidates = lookupCandidates(query);
  if (candidates.length === 0) return NONE;
  const key = query.trim().replace(/\s+/g, ' ').toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit;

  let result: NameExpansion;
  try {
    const matched = await findPersons(candidates);
    const related = matched.length > 0 ? await findPersons(secondHopCandidates(query, matched)) : [];
    const variants = buildNameVariants(query, matched, related);
    result = { variants, topicWords: variants.length > 0 ? topicWords(query, matched) : [] };
  } catch {
    return NONE;
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { ...result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Just the variant terms — what the keyword page lanes OR in. */
export async function expandPersonNames(query: string): Promise<string[]> {
  return (await expandNameQuery(query)).variants;
}

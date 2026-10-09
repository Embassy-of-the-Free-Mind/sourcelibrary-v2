// PRIOR ART: src/lib/search/name-variants.ts — finds that a query names A person and returns
// other SPELLINGS of that name; it never says which person, and treats every bearer as one.
// src/lib/known-entities.ts — the "go here" card for collections and reading rooms, a curated
// list with no persons. src/lib/author-thesaurus.ts — resolves one author slug to one person.
// None answers "this surname belongs to several people — which one do you mean?" (#5950).
/**
 * "Which Bacon?" — the people a bare surname could mean (#5950).
 *
 * `entities` keeps one catch-all record per bare surname ("Bacon", 211 books) beside the full-name
 * records of the people who bear it ("Roger Bacon", "Francis Bacon"). Measured 2026-10-06, 47% of
 * the mentions on a bare-surname record that carries a Wikidata id belong to somebody else
 * (scripts/eval/experiments/2026-10-06-shared-name-mislinks-5950.md). So the chooser never reads
 * the bare record: a person is offered only on the strength of records that name them in full,
 * and the book count shown is the count of those records' books.
 *
 * Read-only. One Atlas `$search` on `entities_search` plus one small `authors` find, both capped
 * in time, cached for ten minutes, and run ONLY when the query is a single word that
 * `expandNameQuery` (already cached, #5893) says is a person's name. Any failure yields no
 * chooser — never an error, never a slower search.
 */
import { getDb } from '@/lib/mongodb';
import { expandNameQuery, foldName, nameTokens } from '@/lib/search/name-variants';

const ENTITIES_SEARCH_INDEX = 'entities_search';
/** Most choices shown. */
export const MAX_NAME_CHOICES = 5;
/** A person needs this many books under their full name to be offered. */
export const MIN_CHOICE_BOOKS = 5;
/**
 * …and at least this share of the largest choice's books. A stray Wikidata id on a small record
 * ("Sir Francis Bacon" → a 17th-century judge, 10 books beside 470) must not become a third Bacon.
 */
export const MIN_SHARE_OF_LARGEST = 0.05;
const LOOKUP_LIMIT = 150;
const LOOKUP_MAX_MS = 1500;
const AUTHORS_MAX_MS = 400;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

/** The slice of an `entities` person record the chooser reads. */
export interface ChooserRecord {
  name: string;
  wikidata_id?: string | null;
  description?: string | null;
  wikidata_birth_date?: string | null;
  wikidata_death_date?: string | null;
  merged_into?: unknown;
  /** Distinct book ids of the record's `books[]`. */
  book_ids?: string[];
  /** `books[].book_year`, in any order; entries without a year are simply absent. */
  book_years?: unknown[];
}

export interface NameChoice {
  /** The person's name as their largest full-name record has it. */
  name: string;
  wikidata_id: string;
  /** "c. 1220–1292", "63–12 BC", or null when Wikidata gave no year. */
  dates: string | null;
  /** First sentence of the record's description, or null. */
  who: string | null;
  /** Distinct books that name this person in full. */
  book_count: number;
  href: string;
  /** Whether `href` is the person's author page (they wrote books we hold) or their index page. */
  href_kind: 'author' | 'encyclopedia';
}

export interface NameChoices {
  /** The surname as the reader typed it, capitalised. */
  surname: string;
  choices: NameChoice[];
}

/** Name particles that may follow a surname without making it a forename ("Fabricius ab Aquapendente"). */
const PARTICLES = new Set(['of', 'de', 'di', 'da', 'del', 'della', 'van', 'von', 'ab', 'a', 'the', 'le', 'la']);

/**
 * Is `surname` this name's SURNAME — not a forename ("Hartmann Schedel"), not a middle name
 * ("Johann Hartmann Beyer")? True when it is the last word, the word before a comma
 * ("Bacon, Roger"), or followed by a particle ("Bacon of Verulam"). Parentheses are set aside.
 * A name that is only the surname is the catch-all record and is never a person.
 */
export function bearsSurname(name: string, surname: string): boolean {
  const target = foldName(surname);
  const plain = name.replace(/\([^)]*\)/g, ' ');
  const [beforeComma, ...rest] = plain.split(',');
  const head = nameTokens(beforeComma).map(foldName);
  if (head.length === 0) return false;
  if (rest.length > 0) return head[head.length - 1] === target && nameTokens(rest.join(' ')).length > 0;
  if (head.length < 2) return false;
  if (head[head.length - 1] === target) return true;
  const at = head.indexOf(target);
  return at >= 0 && at < head.length - 1 && PARTICLES.has(head[at + 1]);
}

/** Year of a Wikidata date ("1561-01-22", "1220-00-00", "-0063-00-00"); null when it has none. */
export function wikidataYear(date: string | null | undefined): number | null {
  if (typeof date !== 'string') return null;
  const m = /^(-?)(\d{1,4})/.exec(date.trim());
  if (!m) return null;
  const year = parseInt(m[2], 10);
  if (!year) return null;
  return m[1] ? -year : year;
}

/** "1561–1626", "d. 1292", "63–12 BC", "20 BC–AD 50"; null when neither year is known. */
export function lifeDates(born: string | null | undefined, died: string | null | undefined): string | null {
  const b = wikidataYear(born);
  const d = wikidataYear(died);
  if (b === null && d === null) return null;
  const abs = (y: number) => String(Math.abs(y));
  if (b !== null && d !== null) {
    if (b < 0 && d < 0) return `${abs(b)}–${abs(d)} BC`;
    if (b < 0) return `${abs(b)} BC–AD ${d}`;
    return `${b}–${d}`;
  }
  if (b !== null) return b < 0 ? `b. ${abs(b)} BC` : `b. ${b}`;
  return (d as number) < 0 ? `d. ${abs(d as number)} BC` : `d. ${d}`;
}

/** First sentence of a description, cut at a word if it runs long. */
export function oneLine(description: string | null | undefined, max = 140): string | null {
  if (typeof description !== 'string') return null;
  const text = description.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  // A full stop after an initial or an abbreviation ("St.", "J. C.") does not end the sentence.
  const end = text.search(/(?<![A-Z]|\b[A-Z][a-z]|\bSt|\bc)\.(\s|$)/);
  const sentence = end > 0 ? text.slice(0, end + 1) : text;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,;:]$/, '') + '…';
}

/** Fewest dated books before the anachronism test below says anything. */
const MIN_DATED_BOOKS = 5;
/** Nobody is named in print before this age. */
const YOUNGEST_NAMED = 15;

/**
 * Was this person alive to be named in these books? A Wikidata id can be a namesake's: "William
 * Smith" carried a man born in 1933 while every book naming him was printed before 1900. When most
 * dated books predate the birth year the id is somebody else's, and the dates and one-line "who"
 * it would put on the card are wrong — the person is left out rather than shown with them.
 * The other direction proves nothing (a 1925 book names Boethius) and is not tested.
 */
export function namedBeforeBorn(bornYear: number | null, bookYears: number[]): boolean {
  if (bornYear === null || bookYears.length < MIN_DATED_BOOKS) return false;
  const early = bookYears.filter(y => y < bornYear + YOUNGEST_NAMED).length;
  return early * 2 > bookYears.length;
}

/**
 * The people a surname could mean, from the person records an `entities` search for it returned.
 * Pure. `authorSlugs` maps a Wikidata id to that person's canonical author slug, when they have one.
 *
 * Records are grouped by Wikidata id; a record without one names nobody the chooser can tell
 * apart, and the bare-surname record is the blend itself — both are left out. Returns null unless
 * at least two people qualify.
 */
export function buildNameChoices(
  surname: string,
  records: ChooserRecord[],
  authorSlugs: ReadonlyMap<string, string> = new Map(),
): NameChoices | null {
  interface Group { qid: string; books: Set<string>; years: number[]; members: (ChooserRecord & { n: number })[] }
  const groups = new Map<string, Group>();
  for (const r of records) {
    if (!r || typeof r.name !== 'string' || !r.wikidata_id || r.merged_into) continue;
    if (!bearsSurname(r.name, surname)) continue;
    const ids = Array.isArray(r.book_ids) ? r.book_ids.filter(id => typeof id === 'string' && id) : [];
    const g = groups.get(r.wikidata_id) ?? { qid: r.wikidata_id, books: new Set<string>(), years: [], members: [] };
    for (const id of ids) g.books.add(id);
    for (const y of Array.isArray(r.book_years) ? r.book_years : []) {
      const year = typeof y === 'number' ? y : parseInt(String(y), 10);
      if (Number.isFinite(year) && year > 0 && year < 2100) g.years.push(year);
    }
    g.members.push({ ...r, n: new Set(ids).size });
    groups.set(r.wikidata_id, g);
  }

  const lifeOf = (g: Group) => {
    const m = g.members.find(x => wikidataYear(x.wikidata_birth_date) !== null || wikidataYear(x.wikidata_death_date) !== null);
    return { born: wikidataYear(m?.wikidata_birth_date), died: wikidataYear(m?.wikidata_death_date) };
  };
  const wordsOf = (g: Group) => new Set(g.members.flatMap(m => nameTokens(m.name.replace(/\([^)]*\)/g, ' ')).map(foldName)));

  const alive = [...groups.values()]
    .filter(g => !namedBeforeBorn(lifeOf(g).born, g.years))
    .sort((a, b) => b.books.size - a.books.size || a.qid.localeCompare(b.qid));

  // One person under two Wikidata ids ("Arias Montanus" and "Benedict Arias Montanus", both
  // 1527–1598): the same birth AND death year, and one name's words all inside the other's. Either
  // test alone would join two people — brothers share a surname, strangers share a year.
  const ranked: Group[] = [];
  for (const g of alive) {
    const life = lifeOf(g);
    const words = wordsOf(g);
    const twin = life.born !== null && life.died !== null ? ranked.find(k => {
      const kl = lifeOf(k);
      if (kl.born !== life.born || kl.died !== life.died) return false;
      const kw = wordsOf(k);
      return [...words].every(w => kw.has(w)) || [...kw].every(w => words.has(w));
    }) : undefined;
    if (!twin) { ranked.push(g); continue; }
    for (const id of g.books) twin.books.add(id);
    twin.members.push(...g.members);
  }
  ranked.sort((a, b) => b.books.size - a.books.size || a.qid.localeCompare(b.qid));
  if (ranked.length < 2) return null;
  const floor = Math.max(MIN_CHOICE_BOOKS, Math.ceil(ranked[0].books.size * MIN_SHARE_OF_LARGEST));
  const kept = ranked.filter(g => g.books.size >= floor).slice(0, MAX_NAME_CHOICES);
  if (kept.length < 2) return null;

  const choices = kept.map((g): NameChoice => {
    const members = [...g.members].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    // The display name is the largest record's, without a parenthesis: "Bauhin (Caspar Bauhin)"
    // is a label for the blend, "Caspar Bauhin" is the person.
    const lead = members.find(m => !m.name.includes('(') && !m.name.includes(',')) ?? members[0];
    const described = members.find(m => oneLine(m.description));
    const dated = members.find(m => lifeDates(m.wikidata_birth_date, m.wikidata_death_date));
    const slug = authorSlugs.get(g.qid);
    return {
      name: lead.name,
      wikidata_id: g.qid,
      dates: dated ? lifeDates(dated.wikidata_birth_date, dated.wikidata_death_date) : null,
      who: described ? oneLine(described.description) : null,
      book_count: g.books.size,
      href: slug ? `/author/${slug}` : `/encyclopedia/${encodeURIComponent(lead.name)}`,
      href_kind: slug ? 'author' : 'encyclopedia',
    };
  });
  const shown = surname.trim();
  return { surname: shown.charAt(0).toUpperCase() + shown.slice(1), choices };
}

/**
 * A query the chooser considers: one word, not quoted. Everything else returns before any lookup,
 * so a topical or multi-word search does no extra work at all.
 */
export function bareNameQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed || /["\s]/.test(trimmed)) return null;
  const tokens = nameTokens(trimmed);
  return tokens.length === 1 ? tokens[0] : null;
}

const cache = new Map<string, { value: NameChoices | null; expires: number }>();

/**
 * The chooser for a search query, or null. Null for anything but a single word that names a
 * person; null when fewer than two people bear it; null on any lookup failure (not cached — an
 * error is not "one person").
 */
export async function findNameChoices(query: string): Promise<NameChoices | null> {
  const word = bareNameQuery(query);
  if (!word) return null;
  const key = foldName(word);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: NameChoices | null = null;
  try {
    // #5893's lookup, cached: is this word a person's name at all? "Mercury" is; "alchemy" is not.
    const { surnames } = await expandNameQuery(word);
    // No person — or that lookup failed, which looks the same from here. Its own cache holds the
    // real "no"; caching it again would turn one failed lookup into ten minutes without a chooser.
    if (surnames.length === 0) return null;
    if (surnames.length === 1) {
      const db = await getDb();
      const records = await db.collection('entities').aggregate<ChooserRecord>([
        {
          $search: {
            index: ENTITIES_SEARCH_INDEX,
            compound: {
              must: [{ text: { query: word, path: 'name' } }],
              filter: [{ equals: { path: 'type', value: 'person' } }],
              // The full-name records with the most books first: they are the ones that decide.
              score: { boost: { path: 'book_count', undefined: 1 } },
            },
          },
        },
        { $limit: LOOKUP_LIMIT },
        {
          $project: {
            _id: 0, name: 1, wikidata_id: 1, description: 1, wikidata_birth_date: 1,
            wikidata_death_date: 1, merged_into: 1, book_ids: '$books.book_id', book_years: '$books.book_year',
          },
        },
      ], { maxTimeMS: LOOKUP_MAX_MS }).toArray();

      const first = buildNameChoices(word, records);
      if (first) {
        // `authors` is ~5K small documents; this is one bounded find for at most five ids.
        const qids = first.choices.map(c => c.wikidata_id);
        const authors = await db.collection('authors')
          .find({ wikidata_id: { $in: qids } }, { projection: { _id: 1, slug: 1, wikidata_id: 1, merged_into: 1, is_person: 1 }, maxTimeMS: AUTHORS_MAX_MS })
          .limit(qids.length * 4)
          .toArray()
          .catch(() => []);
        const slugs = new Map<string, string>();
        for (const a of authors) {
          if (a.merged_into || a.is_person === false || typeof a.wikidata_id !== 'string') continue;
          if (!slugs.has(a.wikidata_id)) slugs.set(a.wikidata_id, String(a.slug || a._id));
        }
        value = buildNameChoices(word, records, slugs);
      }
    }
  } catch {
    return null;
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

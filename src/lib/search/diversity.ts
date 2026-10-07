/**
 * Tradition- and work-aware re-ranking for the concept lanes (#3514, #3895).
 *
 * PRIOR ART: `shapePageRows` in src/lib/semantic-search.ts — a per-BOOK cap
 * (`maxPerBook`), which leaves ten results from ten Latin scholastic books
 * untouched. src/lib/search/work-grouping.ts `collapseByWork` — one row per
 * work for BOOK results; it removes rows, and a passage list wants its second
 * passage from a work kept lower down, not dropped. The pilot's `quota` /
 * `mmr` in scripts/eval/embed-granularity/run-arms.mjs — the measured shape
 * this follows (quota; MMR needs every candidate's vector, which the RPCs do
 * not return).
 *
 * WHY. A concept query ("the highest good", "prima materia") returns the ten
 * nearest pages, and the nearest ten are usually one tradition's vocabulary:
 * the largest tradition held 67% of an average top 10 in the #6173 pilot. This
 * re-orders the candidates a lane already returned so that the first screen
 * holds at most `perTradition` passages per tradition family and `perWork` per
 * work. It only re-orders: nothing is dropped, and a lane whose candidates are
 * all one tradition comes back as it went in.
 *
 * `margin` keeps it honest for a query with one right answer. A capped row is
 * passed over only for a row scoring within `margin` of it, so a clearly
 * better match is never traded for variety.
 *
 * Pure: no database client here (a unit test that imports `@/lib/supabase`
 * without the env spends minutes in import). The facet loader is
 * diversity-facets.ts.
 */
import vocabulary from '@/lib/taxonomy/traditions.json';

export type DiversityMode = 'tradition' | 'author' | 'off';

/** What the re-rank needs to know about a book. All optional: an unlabelled book is never capped by tradition. */
export interface BookFacets {
  tradition?: string[] | null;
  work_id?: string | null;
  author_id?: string | null;
  author?: string | null;
}

interface TraditionLabel { label: string; family: string; period?: boolean }
const LABELS = (vocabulary as { labels: TraditionLabel[] }).labels;
const BY_LABEL = new Map(LABELS.map((l) => [l.label, l]));

/** The closed list of `books.tradition` values. */
export const TRADITION_LABELS: readonly string[] = LABELS.map((l) => l.label);

/**
 * The family a book is counted under. A specific label outranks a European
 * period label, whatever their order: `["Renaissance & Early Modern Europe",
 * "Kabbalistic & Hasidic"]` counts as `jewish`.
 */
export function traditionFamily(labels: readonly string[] | null | undefined): string | null {
  const known = (labels || []).map((l) => BY_LABEL.get(l)).filter((l): l is TraditionLabel => !!l);
  if (known.length === 0) return null;
  return (known.find((l) => !l.period) ?? known[0]).family;
}

/** `?diversity=` as sent by a caller; null when absent or not a mode. */
export function parseDiversityParam(raw: string | null | undefined): DiversityMode | null {
  const v = (raw || '').trim().toLowerCase();
  return v === 'tradition' || v === 'author' || v === 'off' ? v : null;
}

/**
 * Words by which a query names the tradition it wants. "Sufi metaphysics of
 * the unity of being" asks for Sufi pages; holding Sufi pages to two of ten
 * answers a question nobody asked (the Librarian golden set lost exactly
 * those queries under an unconditional quota, 2026-10-07).
 */
const NAMES_A_TRADITION = new RegExp(
  '\\b(?:'
  + 'sufi\\w*|islam\\w*|muslim|quran\\w*|arabic|persian|ottoman|turkish'
  + '|kabbal\\w*|cabal\\w*|qabal\\w*|jewish|judai\\w*|hebrew|hasid\\w*|rabbinic\\w*|talmud\\w*|zohar'
  + '|buddh\\w*|zen|chan|tibetan|theravad\\w*|mahayan\\w*|tantr\\w*'
  + '|dao\\w*|tao\\w*|confuci\\w*|chinese|japanese|korean|shinto'
  + '|hindu\\w*|vedic|vedant\\w*|upanishad\\w*|yog[ai]\\w*|sanskrit|indian|jain\\w*'
  + '|hermetic\\w*|gnostic\\w*|alchem\\w*|rosicrucian\\w*|theosoph\\w*|masonic|freemason\\w*|paracels\\w*'
  + '|christian\\w*|catholic|protestant|lutheran|calvinis\\w*|patristic|monastic\\w*|scholastic\\w*|byzantine|orthodox|syriac|armenian|coptic'
  + '|greek|roman|stoic\\w*|epicure\\w*|platon\\w*|neoplaton\\w*|aristotel\\w*|pythagor\\w*'
  + '|egyptian|mesopotamian|babylonian|sumerian|zoroastr\\w*|manichae\\w*|norse|celtic|druid\\w*|aztec|maya|mesoamerican'
  + '|renaissance|medieval|enlightenment'
  + ')\\b', 'i');

// Capitalised words that are concepts, not names ("the One", "the Good").
const CAPITALISED_CONCEPTS = new Set(['One', 'God', 'Good', 'Divine', 'Absolute', 'Self', 'Being', 'Word', 'Logos', 'Spirit', 'Soul', 'Mind', 'Nature', 'Heaven', 'Earth', 'Sun', 'Moon', 'Lord', 'Truth', 'Way', 'All', 'Nous', 'Intellect', 'Creator', 'I']);

/** A capitalised word after the first that is not a capitalised concept: a person, place or title. */
function namesSomeone(q: string): boolean {
  const words = q.split(/[\s,;:—–()]+/).filter(Boolean);
  // The first word is capitalised in any sentence, so it counts only in the
  // shapes a name takes there: "Agrippa on …", "Plato's …".
  if (/^\p{Lu}\p{Ll}{2,}(?:['’]s\b|\s+on\s)/u.test(q) && !CAPITALISED_CONCEPTS.has(words[0])) return true;
  return words.slice(1).some((w) => /^\p{Lu}\p{Ll}{2,}/u.test(w) && !CAPITALISED_CONCEPTS.has(w.replace(/[^\p{L}]+$/u, '').replace(/['’]s$/, '')));
}

/**
 * The default when the caller did not say. On for a concept query; off for an
 * exact phrase or a known item:
 *  - a quoted query, a navigational or verbatim intent, a search inside one book;
 *  - a query that names a year, a person or a title ("Agrippa on natural magic");
 *  - a query that names its tradition ("Sufi metaphysics of the unity of being").
 * A name typed in lower case is not seen; the score margin in `diversify` is
 * what protects that query.
 */
export function defaultDiversity(
  query: string,
  hints: { phrase?: boolean; intent?: string | null; bookScoped?: boolean } = {},
): DiversityMode {
  const q = query.trim();
  if (hints.bookScoped || hints.phrase) return 'off';
  if (hints.intent === 'navigational' || hints.intent === 'verbatim') return 'off';
  if (/^["“].*["”]$/.test(q)) return 'off';
  if (/\b1[0-9]{3}\b/.test(q)) return 'off';
  if (NAMES_A_TRADITION.test(q) || namesSomeone(q)) return 'off';
  return 'tradition';
}

export interface DiversifyOptions<T> {
  mode: DiversityMode;
  bookId: (row: T) => string;
  facets: ReadonlyMap<string, BookFacets>;
  /** Rows per screen the caps apply within; counts start again for the next screen. Default 10. */
  window?: number;
  /** Tradition mode: rows per tradition family per screen. Default 2 (the pilot's quota). */
  perTradition?: number;
  /** Rows per work per screen. Default 2 in tradition mode, 1 in author mode. */
  perWork?: number;
  /** Author mode: rows per author per screen. Default 1. */
  perAuthor?: number;
  /** A comparable relevance score (cosine similarity). Without it the caps are absolute. */
  score?: (row: T) => number;
  /** With `score`: a capped row is passed over only for a row scoring within this of it. */
  margin?: number;
  /**
   * Further per-screen caps that hold in every mode, `off` included: the
   * untranslated lane is held to a share of the screen this way (#5729).
   * A null key is never capped.
   */
  extra?: { key: (row: T) => string | null; cap: number }[];
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Re-order `rows` (best first) so each screen spreads across traditions and
 * works. Stable inside a screen: rows keep their relative order unless a cap
 * moves one down. Returns every row.
 */
export function diversify<T>(rows: readonly T[], opts: DiversifyOptions<T>): T[] {
  const extra = opts.extra ?? [];
  if ((opts.mode === 'off' && extra.length === 0) || rows.length < 3) return [...rows];
  const window = Math.max(1, opts.window ?? 10);
  const author = opts.mode === 'author';
  const off = opts.mode === 'off';
  const caps = {
    tradition: off || author ? Infinity : opts.perTradition ?? 2,
    work: off ? Infinity : opts.perWork ?? (author ? 1 : 2),
    author: author ? opts.perAuthor ?? 1 : Infinity,
  };
  const keysOf = (row: T) => {
    const id = opts.bookId(row);
    const f = opts.facets.get(id);
    const authorKey = f?.author_id || (f?.author ? norm(f.author) : '');
    return {
      tradition: traditionFamily(f?.tradition),
      work: f?.work_id || id,
      author: authorKey && authorKey !== 'unknown' && authorKey !== 'anonymous' ? authorKey : null,
      extra: extra.map((e) => e.key(row)),
    };
  };
  const useMargin = !!opts.score && opts.margin !== undefined && Number.isFinite(opts.margin);

  let rest = rows.map((row) => ({ row, k: keysOf(row) }));
  const out: T[] = [];
  while (rest.length > 0) {
    const n = { tradition: new Map<string, number>(), work: new Map<string, number>(), author: new Map<string, number>() };
    const nExtra = extra.map(() => new Map<string, number>());
    const fits = (k: ReturnType<typeof keysOf>) =>
      (k.tradition === null || (n.tradition.get(k.tradition) ?? 0) < caps.tradition)
      && (n.work.get(k.work) ?? 0) < caps.work
      && (k.author === null || (n.author.get(k.author) ?? 0) < caps.author)
      && k.extra.every((key, j) => key === null || (nExtra[j].get(key) ?? 0) < extra[j].cap);
    const taken = new Set<number>();
    let screen = 0;
    while (screen < window && taken.size < rest.length) {
      const first = rest.findIndex((_, i) => !taken.has(i));
      let pick = rest.findIndex((c, i) => !taken.has(i) && fits(c.k));
      if (pick === -1) pick = first;
      // The best remaining row is `first`. Passing over it is allowed only for
      // a row that scores close to it.
      else if (pick !== first && useMargin && opts.score!(rest[first].row) - opts.score!(rest[pick].row) > opts.margin!) pick = first;
      const c = rest[pick];
      taken.add(pick);
      out.push(c.row);
      screen++;
      if (c.k.tradition !== null) n.tradition.set(c.k.tradition, (n.tradition.get(c.k.tradition) ?? 0) + 1);
      n.work.set(c.k.work, (n.work.get(c.k.work) ?? 0) + 1);
      if (c.k.author !== null) n.author.set(c.k.author, (n.author.get(c.k.author) ?? 0) + 1);
      c.k.extra.forEach((key, j) => { if (key !== null) nExtra[j].set(key, (nExtra[j].get(key) ?? 0) + 1); });
    }
    rest = rest.filter((_, i) => !taken.has(i));
  }
  return out;
}

/** How many of `rows` fall in each tradition family, for a caller that reports the spread (MCP). */
export function traditionSpread<T>(rows: readonly T[], bookId: (row: T) => string, facets: ReadonlyMap<string, BookFacets>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const fam = traditionFamily(facets.get(bookId(row))?.tradition) ?? 'unlabelled';
    out[fam] = (out[fam] ?? 0) + 1;
  }
  return out;
}

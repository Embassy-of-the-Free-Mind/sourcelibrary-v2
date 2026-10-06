/**
 * Side-by-side passage search across traditions, for the Librarian's
 * `compare_traditions` tool (#6077).
 *
 * PRIOR ART: src/lib/search/librarian-search.ts hybridSearch — one ranked list
 * of 8 for the whole library, in which the most-translated tradition takes most
 * of the slots and `collection` only leans; this module runs one search per
 * tradition, scoped BEFORE ranking (scopedPassageSearch), so no tradition can
 * starve another. src/lib/embassy/collection-catalog.ts resolveCollectionSlug
 * — reused for `scope` and for a tradition name we have no entry for.
 *
 * Who reads the result: a model writing a comparison for a reader who wants
 * each tradition in its own words, with the original, the English and a page
 * link. Every absence is stated in words (agent-tool-results.md rule 2).
 */

import { getDb } from '@/lib/mongodb';
import { scopedPassageSearch, MAX_SCOPED_BOOKS, type SearchPassage } from '@/lib/search/librarian-search';
import { resolveCollectionSlug } from '@/lib/embassy/collection-catalog';
import { READABLE_IN_ENGLISH_EXPR } from '@/lib/page-counts';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

/**
 * A tradition = the union of its collections and its `faceted_tags.tradition`
 * values. Collections carry most of the membership: the facet is sparse and
 * category-mapped (sufi 96 books against ~140 on the three Sufi shelves,
 * measured 2026-10-07), so it is a supplement, never the definition.
 */
export interface TraditionDef {
  label: string;
  collections: string[];
  facets: string[];
}

export const TRADITIONS: Record<string, TraditionDef> = {
  sufi: { label: 'Sufi', collections: ['sufism', 'sufism-islamic-mysticism', 'sufi-eastern-mysticism'], facets: ['sufi'] },
  islamic: { label: 'Islamic philosophy and theology', collections: ['islamic-philosophy', 'islam', 'quran-islamic-theology', 'judeo-islamic-philosophy'], facets: [] },
  kabbalistic: { label: 'Kabbalah', collections: ['kabbalah', 'jewish-kabbalistic-mysticism'], facets: ['kabbalistic'] },
  chan: { label: 'Chan / Zen', collections: ['zen-chan'], facets: [] },
  buddhist: { label: 'Buddhist', collections: ['buddhism', 'chinese-buddhist-texts', 'indian-buddhist-jain', 'tibetan-canon', 'zen-chan'], facets: ['buddhist'] },
  daoist: { label: 'Daoist', collections: ['daoist-classics', 'daoist-alchemy', 'chinese-daoist-magic', 'daoism'], facets: ['daoist'] },
  vedantic: { label: 'Vedanta and Hindu', collections: ['vedanta-darshana', 'hinduism', 'yoga-tantra-mysticism'], facets: ['vedic'] },
  hermetic: { label: 'Hermetic', collections: ['corpus-hermeticum', 'hermetica', 'hermetic-revival'], facets: ['hermetic'] },
  neoplatonic: { label: 'Neoplatonic', collections: ['neoplatonism', 'florentine-neoplatonism'], facets: ['neoplatonic'] },
  'christian-mystical': { label: 'Christian mystical', collections: ['christian-mysticism-sub', 'german-speculative-mysticism', 'rhineland-mystics', 'beguine-mystics'], facets: ['christian-mystical'] },
  gnostic: { label: 'Gnostic', collections: ['gnostic-texts'], facets: ['gnostic'] },
  alchemical: { label: 'Alchemical', collections: ['alchemy', 'spiritual-alchemy'], facets: ['alchemical'] },
  rosicrucian: { label: 'Rosicrucian', collections: ['rosicrucian-alchemy'], facets: ['rosicrucian'] },
};

/** Words a model or reader is likely to type for each key. */
const ALIASES: Record<string, string> = {
  sufism: 'sufi', tasawwuf: 'sufi', islam: 'islamic', 'islamic philosophy': 'islamic', falsafa: 'islamic',
  kabbalah: 'kabbalistic', kabbalist: 'kabbalistic', cabala: 'kabbalistic', qabbalah: 'kabbalistic', jewish: 'kabbalistic', hasidic: 'kabbalistic',
  zen: 'chan', 'chan buddhism': 'chan', 'zen buddhism': 'chan', seon: 'chan', 'chan/zen': 'chan',
  buddhism: 'buddhist', tibetan: 'buddhist', pali: 'buddhist', mahayana: 'buddhist', madhyamaka: 'buddhist',
  daoism: 'daoist', taoism: 'daoist', taoist: 'daoist', zhuangzi: 'daoist',
  vedanta: 'vedantic', hindu: 'vedantic', hinduism: 'vedantic', advaita: 'vedantic', yoga: 'vedantic', tantra: 'vedantic', vedic: 'vedantic',
  hermetica: 'hermetic', hermeticism: 'hermetic', neoplatonism: 'neoplatonic', platonist: 'neoplatonic', plotinus: 'neoplatonic',
  christian: 'christian-mystical', 'christian mysticism': 'christian-mystical', 'christian mystical': 'christian-mystical', rhineland: 'christian-mystical',
  gnosticism: 'gnostic', alchemy: 'alchemical', rosicrucianism: 'rosicrucian',
};

export interface ResolvedTradition {
  /** What the model asked for. */
  asked: string;
  /** Our key, or the collection slug used when no key matched; null = unknown. */
  key: string | null;
  label: string;
  collections: string[];
  facets: string[];
}

export async function resolveTradition(input: string): Promise<ResolvedTradition> {
  const raw = input.trim().toLowerCase();
  const key = TRADITIONS[raw] ? raw : ALIASES[raw] ?? (TRADITIONS[raw.replace(/\s+/g, '-')] ? raw.replace(/\s+/g, '-') : undefined);
  if (key) return { asked: input, key, ...TRADITIONS[key] };
  // Not a tradition we know: treat it as a collection, so "arabic alchemy" or
  // "tibetan canon" still scopes to a real shelf instead of silently to nothing.
  const slug = await resolveCollectionSlug(input);
  if (slug) return { asked: input, key: slug, label: input, collections: [slug], facets: [] };
  return { asked: input, key: null, label: input, collections: [], facets: [] };
}

// ── Scope: a shelf that hard-limits the search ───────────────────────

/** Verdict words a review shelf writes at the head of a highlighted book's note. */
const VERDICT_RE = /^\s*(SHOW WITH CARE|SHOW|DO NOT SHOW|INVENTED|MAJOR|FIX FIRST|BROKEN IMAGES|WRONG KIND|WARNING|NOT CHECKED)/i;

export interface Scope {
  slug: string;
  name: string;
  /** Books a passage may come from. */
  bookIds: Set<string>;
  /** True when the shelf carries by-eye verdicts and only SHOW books are kept. */
  verdictShelf: boolean;
  /** Books the shelf withholds (verdict other than SHOW). */
  withheld: number;
  /** The shelf's note per kept book (caveats a reader should hear). */
  notes: Map<string, string>;
}

interface HighlightedBook { book_id?: string; note?: string }

/**
 * Read a review shelf's verdicts. Null when no note carries a verdict (an
 * ordinary collection). Otherwise only books whose verdict starts with SHOW
 * ("SHOW", "SHOW WITH CARE", "SHOW p.4 …") are kept; every other verdict, and
 * a note with no verdict on a verdict shelf ("Checked p.211 …", unrated), is
 * withheld — passing a by-eye check is the condition, not the default.
 */
export function shelfVerdicts(highlighted: HighlightedBook[]): { shown: Set<string>; notes: Map<string, string>; withheld: number } | null {
  if (!highlighted.some(h => VERDICT_RE.test(h.note || ''))) return null;
  const shown = new Set<string>();
  const notes = new Map<string, string>();
  let withheld = 0;
  for (const h of highlighted) {
    if (!h.book_id) continue;
    const m = (h.note || '').match(VERDICT_RE);
    if (m && /^show/i.test(m[1])) {
      shown.add(h.book_id);
      notes.set(h.book_id, (h.note || '').trim());
    } else {
      withheld++;
    }
  }
  return { shown, notes, withheld };
}

/**
 * Resolve `scope` to the books a passage may come from. On a verdict shelf
 * (highlighted notes opening with SHOW / DO NOT SHOW / INVENTED / MAJOR /
 * FIX FIRST — the eternity-spot-check pattern) ONLY books marked SHOW count:
 * a book that is on the shelf in order to be fixed must not be quoted from it.
 * On an ordinary collection every book on it counts.
 */
export async function resolveScope(input: string): Promise<Scope | null> {
  const slug = await resolveCollectionSlug(input) ?? input.trim();
  const db = await getDb();
  const col = await db.collection('collections').findOne(
    { slug },
    { projection: { slug: 1, name: 1, highlighted_books: 1 } },
  );
  if (!col) return null;
  const highlighted = (col.highlighted_books || []) as HighlightedBook[];
  const verdicts = shelfVerdicts(highlighted);
  const verdictShelf = verdicts !== null;
  const notes = verdicts?.notes ?? new Map<string, string>();
  const bookIds = verdicts?.shown ?? new Set<string>();
  const withheld = verdicts?.withheld ?? 0;
  if (!verdictShelf) {
    const rows = await db.collection('books').find({ collections: slug }).project({ id: 1 }).toArray();
    for (const r of rows) if (r.id) bookIds.add(r.id);
    for (const h of highlighted) if (h.book_id) bookIds.add(h.book_id);
  }
  return { slug: col.slug, name: col.name || col.slug, bookIds, verdictShelf, withheld, notes };
}

// ── Per-tradition search ─────────────────────────────────────────────

const LIVE = { visible: { $ne: false }, hidden: { $ne: true }, pages_count: { $gt: 0 } };

export interface TraditionResult {
  tradition: ResolvedTradition;
  /** Live books in this tradition (inside the scope, when one is set). */
  held: number;
  /** Of those, readable in English (translation-state.md `readable_in_english`). */
  readable: number;
  passages: Array<SearchPassage & { original?: string; shelfNote?: string }>;
}

async function traditionBooks(t: ResolvedTradition, scope: Scope | null): Promise<{ ids: string[]; held: number; readable: number }> {
  if (t.collections.length === 0 && t.facets.length === 0) return { ids: [], held: 0, readable: 0 };
  const or: Record<string, unknown>[] = [];
  if (t.collections.length) or.push({ collections: { $in: t.collections } });
  if (t.facets.length) or.push({ 'faceted_tags.tradition': { $in: t.facets } });
  const match: Record<string, unknown> = { ...LIVE, $or: or };
  if (scope) match.id = { $in: [...scope.bookIds] };
  const db = await getDb();
  const rows = await db.collection('books').aggregate([
    { $match: match },
    { $project: { id: 1, readable: READABLE_IN_ENGLISH_EXPR, pages_count: 1 } },
    // Readable books first: only they have English pages for the lanes to
    // rank, and the scoped lanes take at most MAX_SCOPED_BOOKS ids.
    { $sort: { readable: -1, pages_count: -1 } },
  ]).toArray();
  return {
    ids: rows.map(r => r.id as string).filter(Boolean).slice(0, MAX_SCOPED_BOOKS),
    held: rows.length,
    readable: rows.filter(r => r.readable).length,
  };
}

/** The page's transcription in its own language, cleaned — the "original" beside the English. */
async function loadOriginals(passages: SearchPassage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (passages.length === 0) return out;
  const db = await getDb();
  const pages = await db.collection('pages')
    .find({ $or: passages.map(p => ({ book_id: p.book_id, page_number: p.page_number })) })
    .project({ book_id: 1, page_number: 1, 'ocr.data': 1 })
    .toArray();
  for (const p of pages) {
    const raw = typeof p.ocr?.data === 'string' ? p.ocr.data : '';
    const cleaned = stripEditorialWrappers(raw)
      .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned) out.set(`${p.book_id}:${p.page_number}`, cleaned.slice(0, 900));
  }
  return out;
}

export async function compareTraditions(
  query: string,
  traditions: string[],
  opts: { perTradition?: number; scope?: string | null } = {},
): Promise<{ results: TraditionResult[]; scope: Scope | null; scopeAsked: string | null }> {
  const perTradition = Math.min(Math.max(opts.perTradition ?? 3, 1), 5);
  const asked = [...new Set(traditions.map(t => t.trim()).filter(Boolean))].slice(0, 4);
  const scope = opts.scope ? await resolveScope(opts.scope) : null;
  const resolved = await Promise.all(asked.map(resolveTradition));

  const results = await Promise.all(resolved.map(async (t): Promise<TraditionResult> => {
    const { ids, held, readable } = await traditionBooks(t, scope);
    // One page per book: three passages from three books says more about a
    // tradition than three pages of one treatise.
    const passages = ids.length > 0
      ? await scopedPassageSearch(query, ids, { limit: perTradition, maxPerBook: 1, tenantId: null, preferOriginalLanguage: true })
      : [];
    const originals = await loadOriginals(passages);
    return {
      tradition: t,
      held,
      readable,
      passages: passages.map(p => ({
        ...p,
        original: originals.get(`${p.book_id}:${p.page_number}`),
        shelfNote: scope?.notes.get(p.book_id),
      })),
    };
  }));
  return { results, scope, scopeAsked: opts.scope ?? null };
}

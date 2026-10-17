/**
 * Browser side of "Ask the librarian" on the catalogue page.
 *
 * The request is read on the page (read-request.ts); what is left, the topic,
 * goes to the site search (`/api/search`), whose lanes read the pages of the
 * books by word and by meaning. This file turns its hits into one row per
 * work with the page that matched, adds the books found under other names
 * (synonyms.ts), and enforces the page's filters on what comes back.
 *
 * Why enforce here as well: a filter is only as strong as its weakest lane
 * (search-filters-and-lanes.md). Measured 2026-10-17, "plague remedies" with
 * year_to=1600 still returned an 1886 book. A row that contradicts a filter the
 * reader can SEE is dropped rather than shown under it.
 */
import type { CatalogFilters } from '@/lib/catalog/filters';
import { textUsesName } from '@/lib/catalog/synonyms';

/** One hit from /api/search (book or page). Only the fields read here. */
export interface SearchHit {
  id: string;
  book_id?: string;
  type: 'book' | 'page' | string;
  slug?: string | null;
  title: string;
  display_title?: string | null;
  author?: string | null;
  language?: string | null;
  published?: string | null;
  year?: number | null;
  page_count?: number;
  translated_count?: number;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  categories?: string[];
  summary?: string | null;
  snippet?: string | null;
  page_number?: number;
}

/** A work in the asked results: the book, the page that answered, and the other name that found it. */
export interface AskWork {
  hit: SearchHit;
  page: SearchHit | null;
  via?: string;
}

export const yearOfHit = (h: Pick<SearchHit, 'year' | 'published'>): number | null => {
  if (typeof h.year === 'number' && h.year !== 0) return h.year;
  const m = (h.published ?? '').match(/-?\d{3,4}/);
  return m ? parseInt(m[0], 10) : null;
};

export function searchUrl(f: CatalogFilters, topic: string): string {
  const p = new URLSearchParams({ q: topic, limit: '100' });
  if (f.languages?.length === 1) p.set('language', f.languages[0]);
  else if (f.languages?.length) p.set('languages', f.languages.join(','));
  if (f.category) p.set('category', f.category);
  if (f.yearMin != null) p.set('year_from', String(f.yearMin));
  if (f.yearMax != null) p.set('year_to', String(f.yearMax));
  if (f.hasTranslation) p.set('has_translation', 'true');
  if (f.firstTranslation) p.set('first_translation', 'true');
  return `/api/search?${p}`;
}

// Searches already started — by typing, or by hovering an example — so asking
// finds them in flight. A response with degraded lanes is not kept.
const started = new Map<string, Promise<{ results?: SearchHit[]; degraded_lanes?: unknown[] | null }>>();

function search(url: string) {
  let p = started.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`search ${r.status}`);
      return r.json();
    });
    started.set(url, p);
    p.then((j) => { if (j?.degraded_lanes?.length) started.delete(url); }, () => started.delete(url));
  }
  return p;
}

/** Start the search for a topic now, so the answer is ready when the reader asks. */
export function warmSearch(f: CatalogFilters, topic: string): void {
  if (topic.trim().length >= 3) search(searchUrl(f, topic)).catch(() => {});
}

/** Does a hit contradict a filter the page is showing? */
function breaksFilters(h: SearchHit, f: CatalogFilters, collectionIds: Set<string> | null): boolean {
  const y = yearOfHit(h);
  if ((f.yearMin != null || f.yearMax != null) && (y == null || (f.yearMin != null && y < f.yearMin) || (f.yearMax != null && y > f.yearMax))) return true;
  if (f.languages?.length && h.language && !f.languages.includes(h.language)) return true;
  if (f.author && !(h.author ?? '').toLowerCase().includes(f.author.toLowerCase())) return true;
  if (collectionIds && !collectionIds.has(h.book_id || h.id)) return true;
  return false;
}

/** One row per work, in the order the search ranked them, with its first matching page. */
function group(hits: SearchHit[]): AskWork[] {
  const works = new Map<string, AskWork>();
  for (const h of hits) {
    const id = h.book_id || h.id;
    if (!works.has(id)) works.set(id, { hit: h, page: null });
    const w = works.get(id)!;
    if (h.type === 'page' && !w.page) w.page = h;
  }
  return [...works.values()];
}

/**
 * The search lanes take no collection; the catalogue does. Its book ids, so a
 * collection chosen in Advanced search holds in the asked results too.
 */
const collectionCache = new Map<string, Promise<Set<string>>>();
function collectionIds(slug: string): Promise<Set<string>> {
  let p = collectionCache.get(slug);
  if (!p) {
    p = (async () => {
      const ids = new Set<string>();
      for (let page = 1; page <= 10; page++) {
        const r = await fetch(`/api/catalog/results?collection=${encodeURIComponent(slug)}&limit=120&page=${page}`).then((x) => x.json());
        for (const b of r.books ?? []) ids.add(b.id);
        if (!r.books?.length || ids.size >= (r.total ?? 0)) break;
      }
      return ids;
    })();
    collectionCache.set(slug, p);
  }
  return p;
}

/** The works whose pages answer `topic`, under the page's filters. */
export async function askSearch(f: CatalogFilters, topic: string): Promise<AskWork[]> {
  const [res, ids] = await Promise.all([
    search(searchUrl(f, topic)),
    f.collection ? collectionIds(f.collection) : Promise.resolve(null),
  ]);
  return group((res.results ?? []).filter((h) => !breaksFilters(h, f, ids)));
}

/**
 * Books found under the other names, after the reader's own words. A book only
 * joins when that name really appears in its title, summary or matched
 * passage: the meaning lane returns loose neighbours for every query, and for
 * "black death" those included books on black bile.
 */
export async function askOtherNames(f: CatalogFilters, topic: string, names: string[], have: AskWork[]): Promise<AskWork[]> {
  const lists = await Promise.all(names.map(async (name) => {
    try {
      const works = await askSearch(f, name);
      return works
        .filter((w) => textUsesName(`${w.hit.title} ${w.hit.display_title ?? ''} ${w.hit.summary ?? ''} ${w.page?.snippet ?? w.hit.snippet ?? ''}`, name, topic))
        .map((w) => ({ ...w, via: name }));
    } catch {
      return [];
    }
  }));
  const seen = new Set(have.map((w) => w.hit.book_id || w.hit.id));
  const merged = have.slice();
  // Take turns between the names, so one broad name cannot crowd out the rest.
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const w = l[i];
      const id = w && (w.hit.book_id || w.hit.id);
      if (w && id && !seen.has(id)) { seen.add(id); merged.push(w); }
    }
  }
  return merged;
}

/**
 * The catalogue's own record for each work an asked search found, by id. The
 * search hits carry no OCR count, no card image and no translation rung, so a
 * card built from a hit would claim "no OCR" for a fully transcribed book.
 * A work with no record (hidden, or an artwork) is not a catalogue result.
 */
export async function catalogRows<T extends { id: string }>(ids: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (let i = 0; i < ids.length; i += 120) {
    const sp = new URLSearchParams({ limit: '120' });
    for (const id of ids.slice(i, i + 120)) sp.append('id', id);
    const r = await fetch(`/api/catalog/results?${sp}`).then((x) => x.json()).catch(() => ({ books: [] }));
    for (const b of (r.books ?? []) as T[]) out.set(b.id, b);
  }
  return out;
}

/** The library's own name for an author the reader typed, if it knows one. */
export async function resolveAuthor(query: string): Promise<{ name: string; surname: string } | null> {
  try {
    const r = await fetch(`/api/catalog/author-search?q=${encodeURIComponent(query)}`).then((x) => x.json());
    const name: string | undefined = r?.matches?.[0]?.canonical_name;
    if (!name) return null;
    const surname = (name.includes(',') ? name.split(',')[0] : name.split(/\s+/).pop() ?? name).trim();
    return { name, surname };
  } catch {
    return null;
  }
}

/**
 * Other directions to look in, from the site's search guide (the same call
 * /search makes). Offered to the reader as one-click additions, never applied:
 * they are leads (a book, a person, a field), not other names for the topic.
 */
export async function guideTerms(text: string): Promise<string[]> {
  try {
    const r = await fetch('/api/search/ai-expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text }),
    });
    const raw = await r.text();
    for (const block of raw.split('\n\n')) {
      if (!/event: terms/.test(block)) continue;
      const data = block.match(/data: ([\s\S]*)/)?.[1];
      const terms = data ? JSON.parse(data) : [];
      return Array.isArray(terms) ? terms.filter((t): t is string => typeof t === 'string').slice(0, 6) : [];
    }
  } catch { /* the suggestions are optional */ }
  return [];
}

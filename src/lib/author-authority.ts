/**
 * Author authority resolution via VIAF + Wikidata.
 *
 * Given a free-text author string (often as printed on a title page, e.g.
 * "Tr. Bokkalini"), this module looks up the most likely VIAF cluster and
 * Wikidata Q-id, returning a ranked list of candidates the editor UI surfaces
 * for a librarian to confirm.
 *
 * The motivation is twofold:
 *   1. Paul Dijstelberge's BPH cataloguing workflow wants title-page-as-printed
 *      AND a canonical author form, cross-linked. The schema slot for the
 *      canonical link is `Book.author_entity_id` (Atlas) and
 *      `bph_works.author_entity_id` (Supabase, added by P3 migration).
 *   2. Cross-archive matching (Jung↔BPH alignment, USTC clusters) collapses
 *      from fuzzy token overlap to identity-grade matches once both records
 *      carry the same VIAF id.
 *
 * Implementation notes:
 *   - Primary lookup: VIAF AutoSuggest API (free, no auth, ranked).
 *   - Enrichment: VIAF cluster JSON for full metadata (dates, Wikidata Q).
 *   - Fallback: Wikidata search API when AutoSuggest returns nothing.
 *   - Local cache: MongoDB `entities` collection (already exists), keyed by
 *     a deterministic `viaf:<id>` document id. Re-queries hit the cache.
 *   - Politeness: 24h cache (App Router's fetch revalidate) on outbound calls.
 *
 * No PII — VIAF and Wikidata are public bibliographic data.
 *
 * Issue: #1921 (P3).
 */

import { getDb } from '@/lib/mongodb';

export interface AuthorAuthorityMatch {
  /** VIAF cluster id (numeric string), e.g. "22156484". */
  viaf_id: string;
  /** Full canonical form with dates, e.g. "Boccalini, Traiano, 1556-1613". */
  canonical_name: string;
  /** Short canonical form (no dates), e.g. "Boccalini, Traiano". */
  short_name: string;
  birth_year: number | null;
  death_year: number | null;
  /** Wikidata Q-id (e.g. "Q352718") when VIAF aggregates the link, else null. */
  wikidata_qid: string | null;
  /** 0-100 — combines AutoSuggest order with post-hoc adjustments. */
  score: number;
  /** Alternate name forms (variant transliterations, vernacular spellings). */
  alternate_names: string[];
  /** Authority sources VIAF aggregates this cluster from (LCNAF, GND, BNF, …). */
  source_authorities?: string[];
}

export interface AuthorAuthorityResult {
  /** Original input string (unnormalised). */
  query: string;
  /** Normalised form actually sent to VIAF. */
  normalised_query: string;
  matches: AuthorAuthorityMatch[];
  /** True when a result came from the local entities cache. */
  cache_hit?: boolean;
}

const VIAF_AUTOSUGGEST_URL = 'https://viaf.org/viaf/AutoSuggest';
const VIAF_CLUSTER_URL = (id: string) => `https://viaf.org/viaf/${id}/viaf.json`;
const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php';

/** 24h revalidate window for outbound calls — VIAF clusters rarely change. */
const FETCH_REVALIDATE_SECONDS = 60 * 60 * 24;
const FETCH_TIMEOUT_MS = 5000;

/**
 * Strip honorifics, bracketed catalogue markers, and trailing dates from a
 * free-text author string before sending to VIAF.
 *
 * VIAF AutoSuggest handles diacritics (ö↔oe), case folding, and
 * "Lastname, Firstname" vs "Firstname Lastname" internally, so we don't try
 * to do those locally — we'd just risk masking a real variant.
 *
 * Examples (case → output):
 *   "Tr. Bokkalini"           → "Bokkalini"
 *   "[s.n.]"                  → ""   (filtered out at the caller)
 *   "Dr. C. G. Jung"          → "C. G. Jung"
 *   "Boccalini, Trajano 1556-1613" → "Boccalini, Trajano"
 *   "Joh. Valentin Andreae"   → "Joh. Valentin Andreae"  (Joh. is informative)
 */
export function normaliseAuthorQuery(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // Drop bracketed pseudo-author markers VIAF can't help with.
  if (/^\[(s\.\s*n\.|sine\s+nomine|n\.?n\.|anonymous|anon\.?)\]?$/i.test(s)) return '';
  if (/^anonymous$/i.test(s)) return '';

  // Strip trailing date ranges (1556-1613, c. 1500-, fl. 1600, etc.).
  // Two patterns — range form (1500-1560) and single form (fl. 1600).
  s = s.replace(/[,;]?\s*\b(?:c\.|ca\.|circa|fl\.?|d\.|b\.)?\s*\d{3,4}\s*[-–—]\s*(?:\d{3,4})?\b\.?$/i, '');
  // Single-year form with a marker: "Author, fl. 1600" or "Author, d. 1543".
  // Bare years without a marker stay — they could be part of an imprint
  // mark in rare cases.
  s = s.replace(/[,;]?\s*\b(?:c\.|ca\.|circa|fl\.?|d\.|b\.)\s*\d{3,4}\b\.?$/i, '');

  // Strip surrounding parens with dates: "Author (1556-1613)" → "Author"
  s = s.replace(/\s*\(\s*\d{3,4}\s*[-–—]?\s*\d{0,4}\s*\)\s*$/, '');

  // Strip honorific prefixes that aren't part of the name. Be conservative:
  // "Joh." / "Joh" are often the only form on a title page (Joh. Valentin
  // Andreae), so leave them; remove only obvious titles.
  s = s.replace(/^\s*(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Tr\.|Trans\.|Sir|Lady|Rev\.|Father)\s+/i, '');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // Drop trailing punctuation that confuses search
  s = s.replace(/[,;.]+$/, '').trim();

  return s;
}

/**
 * Lookup an author by free-text string. Returns up to `limit` candidates
 * ranked by VIAF's AutoSuggest order, lightly post-adjusted.
 *
 * Cache strategy: if any candidate was previously enriched (a Wikidata Q-id
 * is present in the cached `entities` doc), we serve from cache without
 * calling VIAF again for that cluster. The AutoSuggest call itself is cheap
 * and not cached locally — only the per-cluster enrichment is.
 */
export async function lookupAuthor(
  raw: string,
  { limit = 5 }: { limit?: number } = {},
): Promise<AuthorAuthorityResult> {
  const normalised = normaliseAuthorQuery(raw);
  if (!normalised) {
    return { query: raw, normalised_query: '', matches: [] };
  }

  const candidates = await viafAutoSuggest(normalised);
  if (candidates.length === 0) {
    // Fallback path — Wikidata search. Less precise than VIAF for canonical
    // authors but useful when VIAF misses obscure figures.
    const wd = await wikidataSearchAuthor(normalised);
    return { query: raw, normalised_query: normalised, matches: wd.slice(0, limit) };
  }

  // Enrich top candidates with cluster metadata (dates, Wikidata Q-id).
  const top = candidates.slice(0, limit);
  const enriched = await Promise.all(top.map((c) => enrichCluster(c)));

  return {
    query: raw,
    normalised_query: normalised,
    matches: enriched,
  };
}

interface ViafAutoSuggestRaw {
  term?: string;
  displayForm?: string;
  nametype?: string;
  recordID?: string;
  viafid?: string;
  score?: string | number;
  // VIAF AutoSuggest returns `score` as a string; sometimes the doc has both.
}

interface ViafAutoSuggestResponse {
  query?: string;
  result?: ViafAutoSuggestRaw[] | null;
}

async function viafAutoSuggest(query: string): Promise<AuthorAuthorityMatch[]> {
  const url = `${VIAF_AUTOSUGGEST_URL}?query=${encodeURIComponent(query)}`;
  const json = await fetchJson<ViafAutoSuggestResponse>(url);
  if (!json || !Array.isArray(json.result)) return [];

  return json.result
    .filter((r) => r && r.viafid)
    .filter((r) => {
      // Personal name entries only — VIAF AutoSuggest also surfaces
      // corporate bodies, geographic, work entities. `nametype` carries the
      // entity type ("personal", "corporate", "geographic", "uniformtitle").
      const t = (r.nametype || '').toLowerCase();
      // Default to keeping the row if nametype is absent — older API
      // responses sometimes omit it.
      return !t || t === 'personal';
    })
    .map((r, idx) => {
      const viafId = String(r.viafid);
      const display = r.term || r.displayForm || '';
      const { shortName, birth, death } = splitNameAndDates(display);
      // Score: top hit = 100, decay 10 per position so #5 ≈ 60.
      const score = Math.max(20, 100 - idx * 10);
      return {
        viaf_id: viafId,
        canonical_name: display,
        short_name: shortName,
        birth_year: birth,
        death_year: death,
        wikidata_qid: null,
        score,
        alternate_names: [],
      } satisfies AuthorAuthorityMatch;
    });
}

/**
 * Pull full cluster metadata (dates, Wikidata link, alt names). Cached in
 * MongoDB `entities` keyed by `viaf:<id>` — first time hits VIAF, repeat
 * calls within the same process or the next deploy hit the cache.
 */
async function enrichCluster(base: AuthorAuthorityMatch): Promise<AuthorAuthorityMatch> {
  // 1. Cache lookup.
  const cached = await readEntityCache(base.viaf_id);
  if (cached) {
    return {
      ...base,
      canonical_name: cached.canonical_name || base.canonical_name,
      short_name: cached.short_name || base.short_name,
      birth_year: cached.birth_year ?? base.birth_year,
      death_year: cached.death_year ?? base.death_year,
      wikidata_qid: cached.wikidata_qid || null,
      alternate_names: cached.alternate_names || [],
      source_authorities: cached.source_authorities || [],
    };
  }

  // 2. VIAF cluster fetch.
  const cluster = await fetchViafCluster(base.viaf_id);
  if (!cluster) return base;

  const merged: AuthorAuthorityMatch = {
    ...base,
    canonical_name: cluster.canonical_name || base.canonical_name,
    short_name: cluster.short_name || base.short_name,
    birth_year: cluster.birth_year ?? base.birth_year,
    death_year: cluster.death_year ?? base.death_year,
    wikidata_qid: cluster.wikidata_qid || null,
    alternate_names: cluster.alternate_names || [],
    source_authorities: cluster.source_authorities || [],
  };

  // 3. Cache write — best effort; cache failures shouldn't break the lookup.
  writeEntityCache(merged).catch((err) => {
    console.warn('[author-authority] cache write failed', err);
  });

  return merged;
}

interface ViafClusterShape {
  canonical_name: string;
  short_name: string;
  birth_year: number | null;
  death_year: number | null;
  wikidata_qid: string | null;
  alternate_names: string[];
  source_authorities: string[];
}

interface ViafClusterRaw {
  mainHeadings?: { data?: ViafMainHeading | ViafMainHeading[] | null } | null;
  nameType?: string;
  birthDate?: string;
  deathDate?: string;
  xLinks?: { xLink?: ViafXLink | ViafXLink[] | null } | null;
  sources?: { source?: ViafSource | ViafSource[] | null } | null;
}

interface ViafMainHeading {
  data?: { text?: string } | { text?: string }[] | null;
  text?: string;
  sources?: unknown;
}

interface ViafXLink {
  '#text'?: string;
  '@nsid'?: string;
}

interface ViafSource {
  '#text'?: string;
  '@nsid'?: string;
}

async function fetchViafCluster(viafId: string): Promise<ViafClusterShape | null> {
  const raw = await fetchJson<ViafClusterRaw>(VIAF_CLUSTER_URL(viafId));
  if (!raw) return null;

  // Canonical / short name
  const headings = collectMainHeadings(raw);
  const canonicalName = pickPreferredHeading(headings);
  const { shortName, birth: parsedBirth, death: parsedDeath } = splitNameAndDates(canonicalName);

  // Dates — prefer top-level birthDate/deathDate, fall back to parsed name.
  const birthYear = parseYear(raw.birthDate) ?? parsedBirth;
  const deathYear = parseYear(raw.deathDate) ?? parsedDeath;

  // xLinks include Wikipedia / Wikidata entries among other authority urls.
  const xs = toArray(raw.xLinks?.xLink);
  let wikidataQid: string | null = null;
  for (const x of xs) {
    const text = x['#text'] || '';
    const ns = (x['@nsid'] || '').toUpperCase();
    if (ns.includes('WKP') || /wikidata\.org\/wiki\/Q\d+/i.test(text)) {
      const m = text.match(/Q\d+/);
      if (m) {
        wikidataQid = m[0];
        break;
      }
    }
  }

  // Source authority IDs (LC, BNF, GND, …). Useful display info.
  const sources = toArray(raw.sources?.source);
  const sourceAuthorities = sources
    .map((s) => (s['@nsid'] || '').toUpperCase().split('|')[0])
    .filter(Boolean);

  // Alternate names — take up to 5 distinct headings.
  const alternateNames = Array.from(new Set(headings.filter((h) => h && h !== canonicalName))).slice(0, 5);

  return {
    canonical_name: canonicalName,
    short_name: shortName,
    birth_year: birthYear,
    death_year: deathYear,
    wikidata_qid: wikidataQid,
    alternate_names: alternateNames,
    source_authorities: Array.from(new Set(sourceAuthorities)),
  };
}

function collectMainHeadings(raw: ViafClusterRaw): string[] {
  const data = raw.mainHeadings?.data;
  const all = toArray(data as ViafMainHeading | ViafMainHeading[] | null | undefined);
  const headings: string[] = [];
  for (const h of all) {
    if (!h) continue;
    // The "data" field is sometimes an array of {text} entries, sometimes a
    // single object. Different VIAF endpoints differ — handle both.
    if (h.text) headings.push(h.text);
    const inner = h.data;
    if (Array.isArray(inner)) {
      for (const i of inner) if (i?.text) headings.push(i.text);
    } else if (inner && typeof inner === 'object' && 'text' in inner && inner.text) {
      headings.push(inner.text);
    }
  }
  return headings;
}

function pickPreferredHeading(headings: string[]): string {
  if (headings.length === 0) return '';
  // Prefer the one with the most familiar Western-style ASCII (LC and BNF
  // usually agree); fall back to the first.
  const ascii = headings.find((h) => /^[\x00-\x7F,.\s'-]+$/.test(h));
  return ascii || headings[0];
}

function splitNameAndDates(s: string): { shortName: string; birth: number | null; death: number | null } {
  if (!s) return { shortName: '', birth: null, death: null };
  // "Boccalini, Traiano, 1556-1613" → short=Boccalini, Traiano; b=1556; d=1613
  const m = s.match(/^(.*?)(?:[,;]?\s+(?:c\.|ca\.|circa)?\s*(\d{3,4})\s*[-–—]\s*(\d{3,4})?\s*\.?\s*)$/);
  if (m) {
    return {
      shortName: m[1].replace(/[,;]\s*$/, '').trim(),
      birth: m[2] ? Number(m[2]) : null,
      death: m[3] ? Number(m[3]) : null,
    };
  }
  return { shortName: s.replace(/[,;.]+$/, '').trim(), birth: null, death: null };
}

function parseYear(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d{3,4})/);
  return m ? Number(m[1]) : null;
}

function toArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------- Wikidata fallback ----------------

interface WikidataSearchResponse {
  search?: Array<{ id?: string; label?: string; description?: string; aliases?: string[] }>;
}

async function wikidataSearchAuthor(query: string): Promise<AuthorAuthorityMatch[]> {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '5',
    format: 'json',
    origin: '*',
  });
  const json = await fetchJson<WikidataSearchResponse>(`${WIKIDATA_SEARCH_URL}?${params.toString()}`);
  if (!json?.search) return [];

  return json.search
    .filter((r) => r.id && /^Q\d+/.test(r.id))
    .map((r, idx) => ({
      // No VIAF cluster — we encode "wikidata-only" by leaving viaf_id blank.
      // The editor UI shows these but the "Use this" button can still save
      // the Wikidata Q-id without a VIAF id (see API layer).
      viaf_id: '',
      canonical_name: r.label || '',
      short_name: r.label || '',
      birth_year: null,
      death_year: null,
      wikidata_qid: r.id || null,
      score: Math.max(20, 80 - idx * 10), // slightly lower than VIAF matches
      alternate_names: r.aliases || [],
      source_authorities: ['WIKIDATA'],
    } satisfies AuthorAuthorityMatch));
}

// ---------------- Cache layer ----------------

interface AuthorEntityCacheDoc {
  _id: string;             // "viaf:<id>" or "wikidata:<Q-id>"
  type: 'person';
  viaf_id: string;
  wikidata_qid: string | null;
  canonical_name: string;
  short_name: string;
  birth_year: number | null;
  death_year: number | null;
  alternate_names: string[];
  source_authorities: string[];
  cached_at: Date;
}

async function readEntityCache(viafId: string): Promise<AuthorEntityCacheDoc | null> {
  if (!viafId) return null;
  try {
    const db = await getDb();
    const doc = await db.collection<AuthorEntityCacheDoc>('entities').findOne({ _id: `viaf:${viafId}` });
    return doc || null;
  } catch (err) {
    console.warn('[author-authority] cache read failed', err);
    return null;
  }
}

async function writeEntityCache(match: AuthorAuthorityMatch): Promise<void> {
  if (!match.viaf_id) return;
  try {
    const db = await getDb();
    await db.collection<AuthorEntityCacheDoc>('entities').updateOne(
      { _id: `viaf:${match.viaf_id}` },
      {
        $set: {
          type: 'person',
          viaf_id: match.viaf_id,
          wikidata_qid: match.wikidata_qid,
          canonical_name: match.canonical_name,
          short_name: match.short_name,
          birth_year: match.birth_year,
          death_year: match.death_year,
          alternate_names: match.alternate_names,
          source_authorities: match.source_authorities || [],
          cached_at: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    // Re-throw so the caller can warn — entries collection might not exist
    // in a fresh dev DB.
    throw err;
  }
}

/**
 * Look up a single cached entity by VIAF id (used by display components).
 * Returns null on cache miss — the UI degrades to "Canonical: VIAF <id>".
 */
export async function getCachedAuthority(viafId: string): Promise<AuthorEntityCacheDoc | null> {
  return readEntityCache(viafId);
}

// ---------------- HTTP helper ----------------

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'sourcelibrary-author-authority/1.0 (+https://sourcelibrary.org)',
      },
      // 24h revalidate — Next 16 fetch cache.
      next: { revalidate: FETCH_REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      console.warn(`[author-authority] ${url} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      console.warn(`[author-authority] ${url} timed out`);
    } else {
      console.warn(`[author-authority] ${url} fetch failed`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Biblissima IIIF Collections search integration.
 *
 * Biblissima aggregates IIIF manuscripts from 40+ European libraries (BnF,
 * Bodleian, Vatican, BSB, etc.) — pre-1800 content only. No JSON API exists,
 * so we scrape the HTML search interface which exposes clean data-* attributes.
 *
 * Results feed into the existing /api/import/iiif route.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BiblissimaSearchResult {
  title: string;
  manifest_url: string;
  collection?: string;
  library?: string;
  date?: string;
  language?: string;
  thumbnail?: string;
  description?: string;
  biblissima_url: string;
  detected_provider?: string;
}

export interface BiblissimaSearchResponse {
  query: string;
  total: number;
  offset: number;
  results: BiblissimaSearchResult[];
  filters: Record<string, string>;
}

export interface BiblissimaSearchOptions {
  q: string;
  language?: string;
  collection?: string;
  library?: string;
  location?: string;
  from?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

const PROVIDER_MAP: Record<string, string> = {
  'gallica.bnf.fr': 'gallica',
  'digi.vatlib.it': 'vatican',
  'iiif.bodleian.ox.ac.uk': 'bodleian',
  'digital.bodleian.ox.ac.uk': 'bodleian',
  'cudl.lib.cam.ac.uk': 'cambridge',
  'api.digitale-sammlungen.de': 'mdz',
  'diglib.hab.de': 'hab',
  'e-codices.unifr.ch': 'e-codices',
  'www.e-rara.ch': 'e-rara',
  'e-rara.ch': 'e-rara',
  'bl.uk': 'british-library',
  'access.bl.uk': 'british-library',
  'www.loc.gov': 'loc',
  'digitalcollections.universiteitleiden.nl': 'leiden',
  'iiif.wellcomecollection.org': 'wellcome',
};

export function detectProvider(manifestUrl: string): string | undefined {
  try {
    const hostname = new URL(manifestUrl).hostname;
    // Direct match
    if (PROVIDER_MAP[hostname]) return PROVIDER_MAP[hostname];
    // Try without 'www.'
    const bare = hostname.replace(/^www\./, '');
    if (PROVIDER_MAP[bare]) return PROVIDER_MAP[bare];
    // Partial match (e.g. subdomain.bl.uk)
    for (const [domain, slug] of Object.entries(PROVIDER_MAP)) {
      if (hostname.endsWith(`.${domain}`) || hostname === domain) return slug;
    }
  } catch {
    // Invalid URL
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

const BIBLISSIMA_BASE = 'https://iiif.biblissima.fr/collections';
const RESULTS_PER_PAGE = 20;

function buildSearchUrl(opts: BiblissimaSearchOptions, offset: number): string {
  const params = new URLSearchParams();
  params.set('q', opts.q);
  params.set('from', String(offset));
  params.set('lang', ''); // English UI
  if (opts.language) params.set('language', opts.language);
  if (opts.collection) params.set('collection', opts.collection);
  if (opts.library) params.set('library', opts.library);
  if (opts.location) params.set('location', opts.location);
  return `${BIBLISSIMA_BASE}/search?${params.toString()}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

interface ParsedPage {
  total: number;
  results: BiblissimaSearchResult[];
}

function parsePage(html: string, searchUrl: string): ParsedPage {
  // Extract total count
  const totalMatch = html.match(/<h2>\s*(\d[\d,]*)\s+results?\s*<\/h2>/i);
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : 0;

  const results: BiblissimaSearchResult[] = [];

  // Split on each result <li> with data attributes
  // Each result has: data-id, data-thumbnail, data-shelfmark, data-manifest
  const resultPattern =
    /<li\s+class="result[^"]*"[^>]*data-id="([^"]*)"[^>]*data-thumbnail="([^"]*)"[^>]*data-shelfmark="([^"]*)"[^>]*data-manifest="([^"]*)"[^>]*>([\s\S]*?)(?=<li\s+class="result|<\/ul>)/gi;

  let match;
  while ((match = resultPattern.exec(html)) !== null) {
    const [, id, thumbnail, shelfmark, manifest, block] = match;

    const title = decodeHtmlEntities(shelfmark);
    const manifestUrl = decodeHtmlEntities(manifest);

    // Extract metadata from <dl> blocks
    const getMetadata = (label: string): string | undefined => {
      const re = new RegExp(
        `<dt[^>]*>${label}</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`,
        'i'
      );
      const m = block.match(re);
      return m ? stripHtml(decodeHtmlEntities(m[1])) : undefined;
    };

    const collection = getMetadata('Collection');
    const library = getMetadata('Library');
    const date = getMetadata('Date');
    const language = getMetadata('Language');

    // Extract description/highlight snippet
    const highlightMatch = block.match(
      /<li\s+class="highlight">\s*([\s\S]*?)\s*<\/li>/i
    );
    const description = highlightMatch
      ? stripHtml(decodeHtmlEntities(highlightMatch[1]))
      : undefined;

    const biblissima_url = `${BIBLISSIMA_BASE}/manifest/${id}`;

    results.push({
      title,
      manifest_url: manifestUrl,
      collection,
      library,
      date,
      language,
      thumbnail: decodeHtmlEntities(thumbnail) || undefined,
      description,
      biblissima_url,
      detected_provider: detectProvider(manifestUrl),
    });
  }

  return { total, results };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function searchBiblissima(
  opts: BiblissimaSearchOptions
): Promise<BiblissimaSearchResponse> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const startOffset = opts.from ?? 0;

  const filters: Record<string, string> = {};
  if (opts.language) filters.language = opts.language;
  if (opts.collection) filters.collection = opts.collection;
  if (opts.library) filters.library = opts.library;
  if (opts.location) filters.location = opts.location;

  const allResults: BiblissimaSearchResult[] = [];
  let total = 0;
  let offset = startOffset;

  while (allResults.length < limit) {
    const url = buildSearchUrl(opts, offset);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
        Accept: 'text/html',
      },
    });

    if (!res.ok) {
      // Return partial results on failure
      if (allResults.length > 0) break;
      throw new Error(`Biblissima returned ${res.status}: ${res.statusText}`);
    }

    const html = await res.text();
    const parsed = parsePage(html, url);
    total = parsed.total;

    if (parsed.results.length === 0) break;

    allResults.push(...parsed.results);
    offset += RESULTS_PER_PAGE;

    // Stop if we've fetched everything available
    if (offset >= total) break;

    // Rate-limit between pages (1s delay)
    if (allResults.length < limit) {
      await delay(1000);
    }
  }

  return {
    query: opts.q,
    total,
    offset: startOffset,
    results: allResults.slice(0, limit),
    filters,
  };
}

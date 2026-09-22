/**
 * prior-translation-search.mjs — the deterministic search standard, as code.
 *
 * PRIOR ART:
 *   scripts/eval/ft-catalog-match.mjs — Tier 0: our own 24K-row
 *     `translation_catalogs`. Free and instant, but it only covers what we have
 *     already ingested (98.9% Latin, skewed to canonical classics). It cannot
 *     see 16th-c casuistry, so a miss there is not an answer.
 *   scripts/lib/search-effort.mjs — the doctrine: publish the bounded search
 *     rather than assert the unbounded negative; record every query verbatim
 *     and every source's boundary.
 *   The #4617 drain verifier prompt — the same standard, executed by an agent.
 *     Most of it is plain API queries, which is what this module makes runnable
 *     without an agent (and without a model ever asserting an absence).
 *
 * This is Tier 1: when the catalogue misses, actually go and look. Public
 * bibliographic APIs, English-language filter, every query and every failure
 * recorded. A source that errors or rate-limits is `unchecked` — NEVER counted
 * as "nothing found", because the difference between those two is the whole
 * point of the exercise.
 */

const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org; derek@sourcelibrary.org)';

const norm = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(['de', 'et', 'in', 'ad', 'per', 'cum', 'sive', 'seu', 'liber', 'libri',
  'opera', 'omnia', 'tomus', 'pars', 'vol', 'volume', 'the', 'of', 'on', 'and', 'a', 'an',
  'or', 'ex', 'quae', 'qui', 'sur', 'des', 'les', 'von', 'der', 'die', 'das']);

/** Distinctive title tokens — what makes this work findable. */
export function titleTokens(title, max = 4) {
  return norm(title).split(' ').filter((t) => t.length > 3 && !STOP.has(t)).slice(0, max);
}

export function surnameOf(author) {
  const a = String(author ?? '').trim();
  if (!a) return '';
  if (a.includes(',')) return norm(a.split(',')[0]);
  const parts = norm(a).split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

async function getJson(url, { timeoutMs = 12000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message ?? e) };
  } finally { clearTimeout(t); }
}

/**
 * Reject the noise these APIs reliably return. Measured on the Conscience corpus:
 * Crossref answered "Summa Angelica" with OED entries ("Angelus, n.", "summa
 * summarum, adv. & n.") and with German articles ABOUT the work. A candidate has
 * to look like an edition of THIS text, not a reference-work headword or a study.
 */
const REFERENCE_ENTRY = /,\s*(n|v|adv|adj|prep|int)\.\s*(&|$)|^\w+,\s*(n|adj|adv)\.$/i;
const ABOUT_NOT_OF = /^(zur |zum |die |der |das |on the |towards a |notes on |essays on|a study of|the reception|entstehungsgeschichte)/i;

function plausibleEdition(hit, tokens) {
  const t = String(hit.english_title ?? '');
  if (!t || t.length < 4) return false;
  if (REFERENCE_ENTRY.test(t)) return false;
  if (ABOUT_NOT_OF.test(t)) return false;
  // Must share at least one distinctive token with the work's title.
  const ht = new Set(norm(t).split(' '));
  return tokens.some((tok) => ht.has(tok));
}

// ── Source 1: OpenLibrary ────────────────────────────────────────────────────
async function searchOpenLibrary(author, tokens) {
  const q = new URLSearchParams({
    author, title: tokens.join(' '), language: 'eng', limit: '20',
    fields: 'title,author_name,first_publish_year,publisher,language,key,contributions',
  });
  const url = `https://openlibrary.org/search.json?${q}`;
  const r = await getJson(url);
  if (!r.ok) return { source: 'openlibrary', url, status: `unchecked (${r.error})`, hits: [] };
  const docs = r.data?.docs ?? [];
  const hits = docs.filter((d) => (d.language ?? []).some((l) => /^eng/i.test(l))).map((d) => ({
    english_title: d.title,
    translator: (d.contributions ?? []).find((c) => /translat/i.test(c)) ?? null,
    year: d.first_publish_year ?? null,
    publisher: (d.publisher ?? [])[0] ?? null,
    url: d.key ? `https://openlibrary.org${d.key}` : null,
    language: 'eng',
  }));
  return { source: 'openlibrary', url, status: `${docs.length} records, ${hits.length} English`, hits };
}

// ── Source 2: Internet Archive ───────────────────────────────────────────────
async function searchArchive(author, tokens) {
  const q = `creator:(${author}) AND (${tokens.map((t) => `title:(${t})`).join(' AND ')}) AND language:(English) AND mediatype:(texts)`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=language&rows=20&output=json`;
  const r = await getJson(url, { timeoutMs: 15000 });
  if (!r.ok) return { source: 'archive.org', url, status: `unchecked (${r.error})`, hits: [] };
  const docs = r.data?.response?.docs ?? [];
  const hits = docs.map((d) => ({
    english_title: d.title, translator: null, year: d.year ?? null, publisher: null,
    url: `https://archive.org/details/${d.identifier}`, language: 'eng',
  }));
  return { source: 'archive.org', url, status: `${docs.length} English text records`, hits };
}

// ── Source 3: Crossref (monographs + scholarly editions) ─────────────────────
async function searchCrossref(author, tokens) {
  const q = new URLSearchParams({
    'query.bibliographic': `${author} ${tokens.join(' ')} English translation`,
    rows: '10', select: 'title,author,issued,publisher,URL,type',
  });
  const url = `https://api.crossref.org/works?${q}`;
  const r = await getJson(url);
  if (!r.ok) return { source: 'crossref', url, status: `unchecked (${r.error})`, hits: [] };
  const items = r.data?.message?.items ?? [];
  const hits = items.filter((i) => /book|monograph/i.test(i.type ?? '')).map((i) => ({
    english_title: (i.title ?? [])[0] ?? null, translator: null,
    year: i.issued?.['date-parts']?.[0]?.[0] ?? null, publisher: i.publisher ?? null,
    url: i.URL ?? null, language: 'eng',
  }));
  return { source: 'crossref', url, status: `${items.length} works, ${hits.length} book-type`, hits };
}

// ── Source 4: K10plus (early modern print; SRU, XML) ─────────────────────────
async function searchK10plus(author, tokens) {
  const cql = `pica.all="${author} ${tokens.join(' ')}" and pica.spr=eng`;
  const url = `https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(cql)}&maximumRecords=10&recordSchema=dc`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
    if (!res.ok) return { source: 'k10plus', url, status: `unchecked (HTTP ${res.status})`, hits: [] };
    const xml = await res.text();
    const n = parseInt(xml.match(/<zs:numberOfRecords>(\d+)</)?.[1] ?? xml.match(/<numberOfRecords>(\d+)</)?.[1] ?? '0', 10);
    const titles = [...xml.matchAll(/<dc:title>([^<]+)<\/dc:title>/g)].map((m) => m[1]).slice(0, 10);
    return {
      source: 'k10plus', url, status: `${n} English-language records`,
      hits: titles.map((ti) => ({ english_title: ti, translator: null, year: null, publisher: null, url: null, language: 'eng' })),
    };
  } catch (e) {
    return { source: 'k10plus', url, status: `unchecked (${e.name === 'AbortError' ? 'timeout' : e.message})`, hits: [] };
  } finally { clearTimeout(t); }
}

/**
 * Run the standard for one work. Returns every query, every source's boundary,
 * and the English-language candidates found — NOT a verdict. The caller decides,
 * and a source that could not be reached is reported as `unchecked`.
 */
export async function searchPriorTranslations(book, { sources } = {}) {
  const author = surnameOf(book.author);
  const tokens = titleTokens(book.display_title || book.title);
  if (!author || tokens.length === 0) {
    return { ran: false, reason: 'no usable author surname or title tokens', queries: [], sources: [], candidates: [] };
  }
  // DECISIVE vs ADVISORY. Only a source with a real language filter can support
  // "no English edition here". OpenLibrary, archive.org and K10plus all filter on
  // language; Crossref does not, and on the Conscience corpus it answered with
  // OED headwords, German articles about the work, and the LATIN 1542 edition of
  // the Summa Sylvestrina. So Crossref is recorded but never decides — it can
  // raise a candidate for review, it can never establish an absence.
  const DECISIVE = new Set(['openlibrary', 'archive.org', 'k10plus']);
  const runners = { openlibrary: searchOpenLibrary, archive: searchArchive, crossref: searchCrossref, k10plus: searchK10plus };
  const picked = (sources ?? Object.keys(runners)).map((k) => runners[k]).filter(Boolean);

  const results = [];
  for (const run of picked) {
    results.push(await run(author, tokens));      // sequential: be polite to public APIs
  }
  const raw = results.flatMap((r) => r.hits.map((h) => ({ ...h, found_in: r.source })));
  const candidates = raw.filter((h) => plausibleEdition(h, tokens));
  const dropped = raw.length - candidates.length;
  const unchecked = results.filter((r) => /^unchecked/.test(r.status)).map((r) => r.source);
  const decisiveUnchecked = unchecked.filter((s) => DECISIVE.has(s));
  const decisiveHits = candidates.filter((h) => DECISIVE.has(h.found_in));
  return {
    ran: true,
    author, tokens,
    queries: results.map((r) => r.url),
    sources: results.map((r) => `${r.source}${DECISIVE.has(r.source) ? '' : ' [advisory]'} — ${r.status}`),
    unchecked,
    // A negative is only reportable when every decisive source actually answered.
    decisive_complete: decisiveUnchecked.length === 0,
    decisive_unchecked: decisiveUnchecked,
    decisive_hits: decisiveHits,
    candidates,
    dropped_as_noise: dropped,
  };
}

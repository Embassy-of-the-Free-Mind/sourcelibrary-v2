#!/usr/bin/env node
/**
 * Sanskrit work spine for the works catalog (#2453, Frame B census).
 *
 * The catalog had only 185 Sanskrit works while Sanskrit is one of the three
 * IIIF-census languages (#2447) — the largest Frame B gap. This ingests every
 * Wikidata work whose language-of-work (P407) is Sanskrit (Q11059): 4,467 as
 * of 2026-06-08. Authority id = `wd:Q…`, source_catalog = 'wikidata-sanskrit'.
 *
 * Wikidata Sanskrit labels are inconsistent — the `sa` label is sometimes
 * Devanagari, sometimes IAST romanization, and many works carry only English.
 * We detect script per row: Devanagari labels go to `title` (original script)
 * with IAST → title_romanized; IAST-only labels populate both title and
 * title_romanized; English is always title_english. translation_status is left
 * 'unknown' (honest — evidence is a later pass, never a bare claim).
 *
 * Run on Hetzner (SUPABASE_DB_URL). Idempotent (upsert).
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/ingest-sanskrit-wikidata.mjs
 */
import { pgClient, fetchRetry, sleep, upsertWorks } from './lib.mjs';

const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)';
const PAGE = 1000;

const hasDevanagari = s => /[ऀ-ॿ]/.test(s || '');
const hasLatin = s => /[a-zA-Z]/.test(s || '');

// inception (P571) ISO date / year → composition century (negative = BCE).
function centuryOf(inception) {
  if (!inception) return null;
  const m = String(inception).match(/^(-?)(\d{1,4})/);
  if (!m) return null;
  const year = parseInt(m[2]) * (m[1] === '-' ? -1 : 1);
  if (!year) return null;
  return year > 0 ? Math.ceil(year / 100) : -Math.ceil(Math.abs(year) / 100);
}

async function fetchPage(offset) {
  const query = `SELECT ?w ?sa ?saLatn ?en ?authorLabel ?inception WHERE {
    ?w wdt:P407 wd:Q11059 .
    OPTIONAL { ?w rdfs:label ?sa . FILTER(lang(?sa)="sa") }
    OPTIONAL { ?w rdfs:label ?saLatn . FILTER(lang(?saLatn)="sa-Latn") }
    OPTIONAL { ?w rdfs:label ?en . FILTER(lang(?en)="en") }
    OPTIONAL { ?w wdt:P50 ?author . }
    OPTIONAL { ?w wdt:P571 ?inception . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } ORDER BY ?w LIMIT ${PAGE} OFFSET ${offset}`;
  const res = await fetchRetry(`${SPARQL}?query=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`SPARQL ${res.status} at offset ${offset}`);
  return (await res.json()).results.bindings;
}

const client = pgClient();
await client.connect();

// Collapse multi-row (author/inception fan-out) into one record per QID.
const byQid = new Map();
let offset = 0;
for (;;) {
  const rows = await fetchPage(offset);
  if (!rows.length) break;
  for (const b of rows) {
    const qid = b.w.value.split('/').pop();
    const rec = byQid.get(qid) || { qid, sa: null, saLatn: null, en: null, author: null, inception: null };
    rec.sa ??= b.sa?.value || null;
    rec.saLatn ??= b.saLatn?.value || null;
    rec.en ??= b.en?.value || null;
    if (!rec.author && b.authorLabel?.value && !/^Q\d+$/.test(b.authorLabel.value)) rec.author = b.authorLabel.value;
    rec.inception ??= b.inception?.value || null;
    byQid.set(qid, rec);
  }
  process.stderr.write(`fetched ${byQid.size} works (offset ${offset})\n`);
  if (rows.length < PAGE) break;
  offset += PAGE;
  await sleep(800);
}
console.log(`Collected ${byQid.size} Sanskrit works from Wikidata`);

const works = [];
for (const r of byQid.values()) {
  // Pick canonical title: Devanagari sa-label > IAST sa-label > English.
  const devanagari = hasDevanagari(r.sa) ? r.sa : null;
  const iast = r.saLatn || (r.sa && hasLatin(r.sa) ? r.sa : null);
  const title = devanagari || iast || r.en;
  if (!title) continue; // nothing usable
  works.push({
    id: `wd:${r.qid}`,
    tradition: 'sanskrit',
    original_language: 'san',
    title,
    title_romanized: iast || null,
    title_english: r.en && hasLatin(r.en) ? r.en : null,
    author: r.author,
    century: centuryOf(r.inception),
    wikidata_qid: r.qid,
    authority_ids: {},
    corpus_tags: ['wikidata-sanskrit'],
    source_catalog: 'wikidata-sanskrit',
    extra: r.inception ? { inception: r.inception } : {},
  });
}

const inserted = await upsertWorks(client, works);
const stats = (await client.query(
  `select count(*) total,
          count(*) filter (where title_romanized is not null) with_iast,
          count(*) filter (where author is not null) with_author,
          count(*) filter (where century is not null) with_century
   from works where tradition = 'sanskrit'`)).rows[0];
await client.end();
console.log(`Upserted ${inserted} works; Sanskrit tradition now: ${JSON.stringify(stats)}`);

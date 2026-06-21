#!/usr/bin/env node
/**
 * Ingest the Latin/Western translation layer (#2626) into the universal works
 * catalog (#2453) — the CONVERGENCE step. Today the catalog covers only the 8
 * non-Western traditions; this adds `tradition='latin'` works and lands the
 * external English-translation evidence as `work_sources(kind='translation')`,
 * so the registry stops being a bespoke island and becomes the Western extension
 * of the same works-knowledge layer the SHWEP matcher also converges onto.
 *
 * Source: the work-level registry built by scripts/translation-layer/* and
 * committed at src/app/research/translation-registry/registry-data.json
 * (1,616 confidence-gated works, deduped, with credits + SL holdings).
 *
 * Writes (on Hetzner, where SUPABASE_DB_URL lives):
 *   works            — one row per Latin work (id 'latin:<author>:<title>')
 *   work_sources     — one row per external translation (kind='translation')
 *   works.translation_status / _evidence / _method  — evidenced, method='census-auto'
 *   work_holdings    — our books where we hold the work (book_id, translated_pct)
 *
 * INVARIANT (#2626): every translation row here is an EXTERNAL prior. Our own
 * SL translations are NEVER ingested as translation evidence — they belong on
 * the separate holdings channel (work_holdings, set by translation-floor-from-
 * holdings.mjs with method tagging), exactly as the catalog already does.
 *
 * Usage:
 *   node scripts/works-catalog/ingest-latin-translations.mjs            # DRY-RUN: emit jsonl + counts
 *   node scripts/works-catalog/ingest-latin-translations.mjs --write    # upsert (needs SUPABASE_DB_URL)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { pgClient, upsertWorks, upsertSources } from './lib.mjs';
import { surnameStems, titleFit } from '../translation-layer/lib.mjs';
import { editionVisible, editionReadable, translatedRatio } from '../lib/holdings-resolver.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(__dir, '../../src/app/research/translation-registry/registry-data.json');
const OUT = path.join(__dir, '../output/works-catalog-latin.jsonl');
const WRITE = process.argv.includes('--write');

const slug = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// map a registry credit source → a catalog `work_sources.source` name
const SOURCE_MAP = {
  itrl_curated: 'i-tatti-renaissance-library', brill_curated: 'brill', doml_curated: 'dumbarton-oaks-medieval-library',
  loeb: 'loeb', unesco_master: 'unesco-index-translationum', extended_unesco_index_translationum: 'unesco-index-translationum',
  loc_marc: 'loc-marc', openlibrary: 'openlibrary', hathitrust: 'hathitrust',
};
const sourceName = (s) => SOURCE_MAP[s] || s.replace(/_/g, '-');
// US public-domain cutoff (published ≥95 yrs ago) → a PD translation we could import
const rightsFor = (y) => (y && y < 1930 ? 'public-domain' : y ? 'in-copyright' : null);
const centuryOf = (y) => (y == null ? null : y < 0 ? Math.floor(y / 100) : Math.floor((y - 1) / 100) + 1);

// the work's catalog id — shared by buildRows() and resolveHoldings() so the
// work_holdings rows reference the same works.id we mint.
const workIdOf = (w) => `latin:${slug(w.a)}:${slug(w.w || w.wl)}`;

/**
 * Resolve our SL holdings for each registry work directly from Mongo — the
 * OWNERSHIP truth (full catalog incl. hidden/draft). One work_holdings row per
 * held edition. status/visible are the two SEPARATE predicates (#2567): status =
 * ownership+processed (visibility-agnostic), visible = public-link gate.
 */
async function resolveHoldings(works) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required for work_holdings resolution');
  const c = new MongoClient(uri);
  await c.connect();
  const books = await c.db('bookstore').collection('books').find({}, {
    projection: { id: 1, slug: 1, author: 1, title: 1, display_title: 1,
      pages_translated: 1, pages_count: 1, pages_ocr: 1, pages_blank: 1, visible: 1, hidden: 1 },
  }).toArray();
  await c.close();

  const byStem = new Map();
  for (const b of books) {
    for (const s of surnameStems(b.author)) {
      if (!byStem.has(s)) byStem.set(s, []);
      byStem.get(s).push(b);
    }
  }

  const holdingRows = [];
  for (const w of works) {
    const id = workIdOf(w);
    if (id === 'latin::') continue;
    const seen = new Set();
    const cands = [];
    for (const s of surnameStems(w.a)) for (const b of (byStem.get(s) || [])) {
      if (!seen.has(b._id)) { seen.add(b._id); cands.push(b); }
    }
    const matched = cands.filter((b) => {
      const t = b.title || b.display_title;
      return titleFit(w.wl || w.w, t).match || (w.wl && titleFit(w.w, t).match);
    });
    for (const b of matched) {
      holdingRows.push({
        work_id: id,
        book_id: String(b._id),
        status: editionReadable(b) ? 'held_readable' : 'held_unprocessed',
        visible: editionVisible(b),
        pages: b.pages_count ?? null,
        translated_pct: Number((translatedRatio(b) * 100).toFixed(1)),
        matched_by: 'registry-worklevel',
      });
    }
  }
  return holdingRows;
}

async function upsertHoldings(client, rows, batch = 500) {
  // dedupe by (work_id, book_id)
  const seen = new Set();
  rows = rows.filter((r) => { const k = `${r.work_id}|${r.book_id}`; return !seen.has(k) && seen.add(k); });
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const cols = ['work_id', 'book_id', 'pages', 'translated_pct', 'matched_by', 'status', 'visible'];
    const values = [], params = [];
    chunk.forEach((r, j) => {
      const base = j * cols.length;
      values.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(',')})`);
      params.push(r.work_id, r.book_id, r.pages, r.translated_pct, r.matched_by, r.status, r.visible);
    });
    const res = await client.query(
      `insert into work_holdings (${cols.join(',')}) values ${values.join(',')}
       on conflict (work_id, book_id) do update set
         pages = excluded.pages, translated_pct = excluded.translated_pct,
         matched_by = excluded.matched_by, status = excluded.status, visible = excluded.visible`,
      params);
    n += res.rowCount;
  }
  return n;
}

function buildRows(works) {
  const workRows = [], sourceRows = [], statusUpdates = [];
  for (const w of works) {
    const id = workIdOf(w);
    if (id === 'latin::') continue;
    workRows.push({
      id,
      tradition: 'latin',
      original_language: 'lat',
      title: w.wl || w.w,
      title_english: w.w,
      author: w.a,
      century: centuryOf(w.y),
      authority_ids: {},
      corpus_tags: w.tgt ? ['renaissance-latin'] : [],
      source_catalog: 'sl-translation-registry-2626',
      extra: { orig_year: w.y, era: w.era, ustc_editions_matched: w.ed },
    });
    // evidenced translation status from the external priors
    const named = w.c.filter((c) => c.tr);
    const lead = named[0] || w.c[0];
    if (lead) {
      statusUpdates.push({
        id,
        evidence: `External: ${lead.tr ? lead.tr + ', ' : ''}${lead.y || ''}${lead.pub ? ' (' + lead.pub + ')' : ''} [${sourceName(lead.s)}]`,
      });
    }
    for (const c of w.c) {
      sourceRows.push({
        work_id: id,
        source: sourceName(c.s),
        source_id: `${slug(c.t || w.w)}-${c.y || 'na'}`,
        kind: 'translation',
        url: null,
        rights: rightsFor(c.y),
        extra: { translator: c.tr || null, year: c.y || null, publisher: c.pub || null, english_title: c.t || null },
      });
    }
  }
  return { workRows, sourceRows, statusUpdates };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const { workRows, sourceRows, statusUpdates } = buildRows(data.works);
  const pd = sourceRows.filter((s) => s.rights === 'public-domain').length;

  console.log('Resolving SL holdings from Mongo (full catalog)…');
  const holdingRows = await resolveHoldings(data.works);
  const readable = holdingRows.filter((h) => h.status === 'held_readable').length;
  const visible = holdingRows.filter((h) => h.visible).length;

  console.log(`registry works: ${data.works.length}`);
  console.log(`  → works rows:          ${workRows.length}`);
  console.log(`  → translation sources: ${sourceRows.length} (${pd} public-domain — importable)`);
  console.log(`  → status updates:      ${statusUpdates.length}`);
  console.log(`  → work_holdings rows:  ${holdingRows.length} (${readable} readable, ${visible} visible)`);

  if (!WRITE) {
    fs.writeFileSync(OUT, [...workRows.map((r) => ({ t: 'work', ...r })),
      ...sourceRows.map((r) => ({ t: 'source', ...r })),
      ...holdingRows.map((r) => ({ t: 'holding', ...r }))].map((r) => JSON.stringify(r)).join('\n'));
    console.log(`\nDRY-RUN. Sample work: ${JSON.stringify(workRows[0])}`);
    console.log(`Sample source: ${JSON.stringify(sourceRows.find((s) => s.extra.translator))}`);
    console.log(`Sample holding: ${JSON.stringify(holdingRows[0])}`);
    console.log(`wrote ${OUT}\n(pass --write on Hetzner — SUPABASE_DB_URL — to upsert into the #2453 catalog)`);
    return;
  }

  const client = pgClient();
  await client.connect();
  try {
    const nW = await upsertWorks(client, workRows);
    // work_sources has a `rights` column the shared helper doesn't set — add it inline
    const nS = await upsertSources(client, sourceRows);
    for (const s of sourceRows.filter((x) => x.rights)) {
      await client.query(
        `update work_sources set rights = $1 where work_id = $2 and source = $3 and source_id = $4 and rights is null`,
        [s.rights, s.work_id, s.source, s.source_id]);
    }
    const nH = await upsertHoldings(client, holdingRows);
    // evidenced translation_status — never downgrade a hand-verified one
    let nU = 0;
    for (const u of statusUpdates) {
      const r = await client.query(
        `update works set translation_status = 'full', translation_evidence = $2,
           translation_method = 'census-auto', updated_at = now()
         where id = $1 and translation_method is distinct from 'hand-verified'`,
        [u.id, u.evidence]);
      nU += r.rowCount;
    }
    console.log(`\nupserted: ${nW} works, ${nS} translation sources, ${nH} holdings, ${nU} status rows.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

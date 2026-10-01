#!/usr/bin/env node
// PRIOR ART: scripts/eval/cursive-census-draw.mjs and translation-corpus-audit/draw.mjs (both draw
// PAGES for one lane, not whole books stratified by script x source); ft-stratified-sample.ts
// (stratifies first-translation claims, not the processing backlog). The PREREGISTRATION in this
// directory fixes the frame; this file only executes it. Reused: makeRng (lib/paired-stats.mjs,
// mulberry32), toLanguageCodes/codeFamily (lib/language-normalize.mjs), classifyPageRecord
// (lib/archive-coverage.mjs, RECORD tier), mapLegacyReason (lib/publication.mjs), NOT_HELD
// (lib/pipeline-hold.mjs).
//
// Quality round 1 (#5438) — the DRAW. Read-only against production.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-round-1/draw.mjs [--out=<path>]
//
// Writes scripts/eval/quality-round-1/draw-2026-10-01.json: the frame counts per cell, every
// drawn book (id, title, cell, pages), and every candidate screened out on the way to 20 with the
// reason. Deterministic for a given database state: candidates are sorted by id before the
// seeded shuffle, so Mongo's return order cannot change the draw.

import fs from 'fs';
import path from 'path';
import { withMongo } from '../../lib/mongo.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { toLanguageCodes, codeFamily } from '../../lib/language-normalize.mjs';
import { classifyPageRecord, RecordState } from '../../lib/archive-coverage.mjs';
import { mapLegacyReason } from '../../lib/publication.mjs';
import { NOT_HELD } from '../../lib/pipeline-hold.mjs';

const SEED = 20261001;
const PER_CELL = 20;
const MIN_PAGES = 40;
const MAX_PAGES = 600;
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const OUT = argOf('out', 'scripts/eval/quality-round-1/draw-2026-10-01.json');

// Script/language groups, by the FIRST language code of `books.language` (the edition's language,
// language-fields.md), compared by family so historical stages fall in with their language.
const GROUPS = {
  latin: new Set(['lat']),
  vernacular: new Set(['deu', 'fra', 'nld', 'ita', 'spa']),
  greek: new Set(['grc', 'ell']),
  semitic_persian: new Set(['heb', 'ara', 'fas']),
  cjk: new Set(['zho', 'jpn', 'kor']),
  indic: new Set(['san', 'pli', 'pra', 'hin', 'mar', 'ben', 'guj', 'pan', 'tam', 'tel', 'kan', 'mal', 'ori', 'sin', 'nep', 'awa', 'bho', 'mai', 'new']),
};
// Own lanes: never in this round, wherever they appear in the language list.
const EXCLUDED_CODES = new Set(['bod', 'xct', 'syc', 'syr']);
// hidden_reason classes a passing stratum may lift (pipeline states, not decisions about the book).
const LIFTABLE_REASONS = new Set([null, 'launch_curation', 'unprocessed', 'unarchived']);
// Statuses that are holds by another name, and statuses at or past image extraction (re-queuing
// those would re-run Phase 8 and duplicate gallery rows; the pipeline has already finished them).
const HOLD_LIKE_STATUSES = ['held', 'loop_quarantine_hold', 'paused'];
const PAST_IMAGES_STATUSES = ['images_submitted', 'images_complete', 'cover_selected', 'complete'];

function groupOf(language) {
  const { codes } = toLanguageCodes(language);
  if (!codes.length) return { group: null, why: 'language_unresolved' };
  if (codes.some((c) => EXCLUDED_CODES.has(c) || EXCLUDED_CODES.has(codeFamily(c)))) return { group: null, why: 'tibetan_syriac' };
  const fam = codeFamily(codes[0]) || codes[0];
  for (const [g, set] of Object.entries(GROUPS)) if (set.has(fam) || set.has(codes[0])) return { group: g, why: null };
  return { group: null, why: `out_of_groups:${fam}` };
}

function sourceOf(b) {
  const p = b.image_source?.provider;
  if (p === 'internet_archive') return 'ia';
  if (!p && /internet archive/i.test(b.provider || '')) return 'ia';
  return 'other';
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Page images archived, RECORD tier (archive-coverage.md): one page doc per page, and every page
// doc claims an R2 original in `archived_photo`. Counters (pages_archived, archive_status) are not
// evidence; the pages are.
async function archiveCheck(db, b) {
  const pages = await db.collection('pages')
    .find({ book_id: b.id }, { projection: { page_number: 1, archived_photo: 1, photo: 1, photo_original: 1 } })
    .toArray();
  const nums = new Set(pages.map((p) => p.page_number));
  if (nums.size !== b.pages_count) return { ok: false, why: `page_docs_${nums.size}_vs_pages_count_${b.pages_count}` };
  let notArchived = 0;
  for (const p of pages) if (classifyPageRecord(p).state !== RecordState.MASTER_OR_DERIVATIVE) notArchived++;
  if (notArchived) return { ok: false, why: `pages_not_archived_${notArchived}` };
  return { ok: true, pages: pages.length };
}

await withMongo(async (db) => {
  const B = db.collection('books');
  // A book already inside another scope/envelope is funded and measured by that run.
  const control = (await db.collection('system_config').findOne({ _id: 'processing_control' })) || {};
  const inOtherScope = [...new Set(Object.values(control.allow_scopes || {}).flatMap((s) => (s.book_ids || []).map(String)))];
  const scopeCollections = [...new Set(Object.values(control.allow_scopes || {}).flatMap((s) => s.collections || []))];
  const base = {
    pages_count: { $gte: MIN_PAGES, $lte: MAX_PAGES },
    ...NOT_HELD,
    'pipeline_auto.status': { $nin: [...HOLD_LIKE_STATUSES, ...PAST_IMAGES_STATUSES] },
    id: { $nin: inOtherScope },
    'image_source.provider': { $ne: 'cmc_kloss' },
    content_type: { $ne: 'artwork' },
    tenantId: { $exists: false },
    tenant: { $exists: false },
    ...(scopeCollections.length ? { collections: { $nin: scopeCollections } } : {}),
    $or: [{ visible: { $ne: true } }, { 'pipeline_auto.status': { $ne: 'complete' } }],
  };
  const rows = await B.find(base, {
    projection: { id: 1, title: 1, author: 1, year: 1, language: 1, provider: 1, 'image_source.provider': 1, ia_identifier: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1, hidden_reason: 1, 'pipeline_auto.status': 1, processing_priority: 1, text_role: 1 },
  }).toArray();

  const excluded = {};
  const bump = (k) => { excluded[k] = (excluded[k] || 0) + 1; };
  const cells = {};
  for (const b of rows) {
    if (!b.id) { bump('no_id'); continue; }
    const mapped = mapLegacyReason(b.hidden_reason);
    if (mapped.state === 'takedown') { bump('reason:takedown'); continue; }
    if (!LIFTABLE_REASONS.has(mapped.reason)) { bump(`reason:${mapped.reason}`); continue; }
    const { group, why } = groupOf(b.language);
    if (!group) { bump(why.startsWith('out_of_groups') ? 'language_out_of_groups' : why); continue; }
    const cell = `${group}__${sourceOf(b)}`;
    (cells[cell] ||= []).push(b);
  }

  const cellNames = Object.keys(GROUPS).flatMap((g) => [`${g}__ia`, `${g}__other`]);
  const drawn = [];
  const screened = [];
  const frame = {};
  for (const cell of cellNames) {
    const pool = (cells[cell] || []).sort((x, y) => String(x.id).localeCompare(String(y.id)));
    // One stream per cell, seeded from the round seed and the cell's position, so a cell's draw
    // does not depend on how many candidates another cell screened out.
    const rng = makeRng(SEED + cellNames.indexOf(cell));
    const order = shuffle(pool, rng);
    let taken = 0;
    let checked = 0;
    for (const b of order) {
      if (taken >= PER_CELL) break;
      checked++;
      const a = await archiveCheck(db, b);
      if (!a.ok) { screened.push({ cell, id: b.id, why: a.why }); continue; }
      taken++;
      drawn.push({
        cell, rank: taken, id: b.id, title: b.title || null, author: b.author || null, year: b.year ?? null,
        language: b.language, provider: b.image_source?.provider || b.provider || null, ia_identifier: b.ia_identifier || null,
        pages: b.pages_count, pages_ocr_at_draw: b.pages_ocr ?? 0, pages_translated_at_draw: b.pages_translated ?? 0,
        visible_at_draw: b.visible ?? null, hidden_reason_at_draw: b.hidden_reason ?? null,
        status_at_draw: b.pipeline_auto?.status ?? null, processing_priority_at_draw: b.processing_priority ?? null,
        url: `https://sourcelibrary.org/book/${b.id}`,
      });
    }
    frame[cell] = { candidates: pool.length, checked, drawn: taken, short: taken < PER_CELL };
    console.error(`${cell.padEnd(24)} candidates ${String(pool.length).padStart(6)}  checked ${String(checked).padStart(4)}  drawn ${taken}${taken < PER_CELL ? '  (SHORT: took every eligible book)' : ''}`);
  }

  const out = {
    issue: 5438,
    drawn_at: new Date().toISOString(),
    seed: SEED,
    per_cell: PER_CELL,
    page_range: [MIN_PAGES, MAX_PAGES],
    frame_query: 'see PREREGISTRATION.md § Frame',
    frame_rows_before_reason_and_language: rows.length,
    excluded_other_scope_books: inOtherScope.length,
    excluded_scope_collections: scopeCollections,
    excluded_before_cells: excluded,
    cells: frame,
    totals: { books: drawn.length, pages: drawn.reduce((s, b) => s + b.pages, 0) },
    books: drawn,
    screened_out: screened,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.error(`wrote ${OUT}: ${drawn.length} books, ${out.totals.pages} pages`);
});

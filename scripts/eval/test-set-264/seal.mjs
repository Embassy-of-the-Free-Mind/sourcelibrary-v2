#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-seal.mjs (seals one stratum file of pages drawn by hand, with sealed_at/seed/
// draw_rule; it has no reserve, no router cell and no existing-truth rows) and scripts/eval/dataset/ exporters (write
// public bundles; this file is not one, it stays under scripts/eval/dataset/, which the public mirror leaves out).
/**
 * Stage 1 step 2 of #264, part 3: write the sealed frame ONCE, and the public aggregates the /quality/test-set page reads.
 *
 *   node scripts/eval/test-set-264/seal.mjs [--enriched=$JOB_SCRATCH/enriched.json]
 *
 * Writes
 *   scripts/eval/dataset/test-set-264/frame.jsonl      one row per page, sorted by row id (the seal)
 *   scripts/eval/dataset/test-set-264/frame.meta.json  seed, draw date, rules, the sha256 of frame.jsonl, the draw log
 *   src/data/test-set-264.json                         per-cell aggregates only: no page id, no reference text
 * and refuses to run when frame.jsonl exists: a sealed row is never re-drawn (eval-design 3.4). A defective page is
 * marked in its `checks` array by a later stage, never removed. tests/unit/test-set-264-seal.test.ts pins the hash.
 *
 * Reserve: in each cell, 20% of the DRAWN rows (rounded), those with the smallest sha256(SEED|reserve|page id). Existing
 * rows are never reserve: their references are already in this repo or their verdicts in the judge store.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SEED } from './seed.mjs';
import { SIZE_RULE } from './cells.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const DIR = path.join(HERE, '..', 'dataset', 'test-set-264');
const FRAME = path.join(DIR, 'frame.jsonl'), META = path.join(DIR, 'frame.meta.json'), PUBLIC = path.join(ROOT, 'src', 'data', 'test-set-264.json');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const ENRICHED = arg('enriched', `${process.env.JOB_SCRATCH || '/tmp'}/enriched.json`);
if (fs.existsSync(FRAME) && !process.argv.includes('--public-only')) { console.error(`${FRAME} exists: the frame is sealed. A new frame is a new seed and a new file.`); process.exit(1); }

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const KIND = { print: 'print', manuscript: 'manuscript', mixed: 'print' };   // mixed counts as print (script-type.mjs)

function build() {
  const { log, rows } = JSON.parse(fs.readFileSync(ENRICHED, 'utf8'));
  const reserve = new Set();
  const byCell = new Map();
  for (const r of rows.filter((x) => x.origin === 'draw')) (byCell.get(r.frame_cell) || byCell.set(r.frame_cell, []).get(r.frame_cell)).push(r);
  for (const list of byCell.values()) {
    const n = Math.round(list.length * SIZE_RULE.reserve_share);
    for (const r of [...list].sort((a, b) => sha(`${SEED}|reserve|${a.page_id}`).localeCompare(sha(`${SEED}|reserve|${b.page_id}`))).slice(0, n)) reserve.add(r.page_id);
  }
  const out = rows.map((r) => {
    const rn = r.image_source?.rights_normalized;
    const routerKind = r.router_script?.cls || r.router_cell.split('/')[1];
    const obsKind = KIND[r.observed?.kind] || null;
    return {
      row: `ts264-${sha(`${r.frame_cell}|${r.page_id}`).slice(0, 12)}`,
      origin: r.origin, drawn: r.origin === 'draw', reserve: reserve.has(r.page_id),
      frame_cell: r.frame_cell, router_cell: r.router_cell,
      book_id: r.book_id, book_oid: r.book_oid || null, work_id: r.work_id || null, page_id: r.page_id, page_number: r.page_number ?? null, pages_count: r.pages_count ?? null,
      image: { url: r.image?.url || r.image_url || null, sha256: r.image?.sha256 || null, bytes: r.image?.bytes || null, fetched_at: r.image?.fetched_at || null, error: r.image?.error || null },
      catalogue: r.catalogue,
      observed: { script: r.observed?.script || 'unknown', kind: r.observed?.kind || 'unknown', period: r.observed?.period || 'unknown', century: r.observed?.century ?? null, by: r.observed?.by || null, level: r.observed?.level || null },
      // the router places the page by its stored class (cells.mjs); the class seen on the image can differ. The page stays in its cell.
      observed_differs: !!(obsKind && routerKind !== 'unknown' && routerKind !== obsKind),
      stored_text: r.stored_text || null, prior_text: !!r.prior_text, draw_rank: r.draw_rank ?? null,
      truth_available: (r.truth || []).map((t) => (t.kind === 'reference' ? { kind: 'reference', slug: t.slug, source: t.source, canonical: t.canonical } : { kind: 'judged', rows: t.rows, lanes: t.lanes })),
      canonical: !!r.canonical,
      licence: {
        image: { holder: rn?.attribution_required || r.image_source?.contributing_library || r.image_holder || r.image_source?.provider_name || null, provider: r.image_source?.provider || null,
          licence: rn?.class ? `${rn.class}${rn.statement_uri ? ` (${rn.statement_uri})` : ''}` : (r.image_source?.license || null), source: rn?.class ? 'books.image_source.rights_normalized' : (r.image_source?.license ? 'books.image_source.license' : null) },
        reference: (r.truth || []).filter((t) => t.kind === 'reference').map((t) => ({ slug: t.slug, holder: t.holder, licence: t.licence })),
      },
      checks: [],
    };
  }).sort((a, b) => a.row.localeCompare(b.row));
  return { log, rows: out };
}

// Step 1's rule failures per frame cell (inventory.json), so the page can say what was left out and why.
const INVENTORY = path.join(DIR, 'inventory.json');
const RULE_WORDS = {
  model_made: 'reference made by a model', own_output: 'reference corrected from our own OCR', no_leaf_check: 'reference never checked against its leaf',
  no_text: 'reference with no text', external: 'page not in the library', not_same_edition: 'reference from another edition', no_cell: 'no router cell',
  not_random: 'judged page not drawn at random', translation: 'judged on translation, not transcription', other_scale: 'judged on another scale',
};
function exclusions(cellId) {
  const inv = fs.existsSync(INVENTORY) ? JSON.parse(fs.readFileSync(INVENTORY, 'utf8')) : null;
  const c = inv?.cells.find((x) => x.cell === cellId);
  if (!c) return null;
  const fails = {};
  for (const [k, n] of [...Object.entries(c.refs.fail), ...Object.entries(c.judged.fail)]) if (n) fails[RULE_WORDS[k] || k] = (fails[RULE_WORDS[k] || k] || 0) + n;
  return { references_mapped: c.refs.mapped, references_pass: c.refs.pass, judged_mapped: c.judged.mapped, judged_pass: c.judged.pass,
    failed: Object.fromEntries(Object.entries(fails).sort((x, y) => y[1] - x[1])) };
}

function aggregates(rows, log, meta) {
  const cells = log.frame_cells.map((f) => {
    const rs = rows.filter((r) => r.frame_cell === f.id), drawn = rs.filter((r) => r.drawn);
    const count = (list, key) => Object.fromEntries(Object.entries(list.reduce((a, r) => { const k = key(r); a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]));
    const exist = rs.filter((r) => !r.drawn);
    const q = Object.entries(log.quota).filter(([, v]) => v.frame_cell === f.id);
    const skips = {};
    for (const [lang, L] of Object.entries(log.languages)) if (L.router_cells.some((c) => f.router_cells.includes(c))) for (const [w, n] of Object.entries(L.skipped)) { const k = w.startsWith('cell full') ? 'cell already full' : w; skips[k] = (skips[k] || 0) + n; }
    return {
      id: f.id, router_cells: f.router_cells, pooled: f.pooled, pages_waiting: f.pages_waiting, target_books: f.target,
      drawn_books: new Set(drawn.map((r) => r.book_id)).size, drawn_pages: drawn.length, reserve_pages: drawn.filter((r) => r.reserve).length,
      short_router_cells: q.filter(([, v]) => v.drawn < v.n).map(([id, v]) => ({ id, drawn: v.drawn, quota: v.n })),
      existing: { reference_books: new Set(exist.filter((r) => r.origin === 'reference').map((r) => r.book_id)).size, judged_books: new Set(exist.filter((r) => r.origin === 'judged').map((r) => r.book_id)).size,
        canonical_reference_books: new Set(exist.filter((r) => r.origin === 'reference' && r.canonical).map((r) => r.book_id)).size },
      truth_sources: count(exist.flatMap((r) => r.truth_available.map((t) => (t.kind === 'reference' ? `reference: ${String(t.source).replace(/\s*\(.*$/, '').slice(0, 60)}` : 'judged read (lane_judge_verdicts)'))), (x) => x),
      observed_kind: count(drawn, (r) => r.observed.kind), observed_script: count(drawn, (r) => r.observed.script),
      observed_differs: drawn.filter((r) => r.observed_differs).length,
      class_source: count(drawn, (r) => (/^books\.book_class/.test(r.observed.by) ? 'book_class (#5768), book level' : /by eye/.test(r.observed.by) ? 'read by eye (Claude Opus), page level' : /^script-class/.test(r.observed.by) ? 'script-class by eye, page level' : 'not classified')),
      catalogue_visible: drawn.filter((r) => r.catalogue.visible).length,
      image_unfetched: drawn.filter((r) => !r.image.sha256).length,
      draw_skips: Object.fromEntries(Object.entries(skips).sort((a, b) => b[1] - a[1]).slice(0, 6)),
      draw_languages: Object.entries(log.languages).filter(([, L]) => L.router_cells.some((c) => f.router_cells.includes(c))).map(([lang, L]) => ({ language: lang, books_in_catalogue: L.books_in_catalogue, examined: L.examined })),
      truth_holders: count(exist.flatMap((r) => r.truth_available.map((t) => (t.kind === 'reference' ? String(t.source).split(/\s/)[0] : 'judged read'))), (x) => x),
      exclusions: exclusions(f.id),
    };
  });
  const totalWaiting = cells.reduce((a, c) => a + c.pages_waiting, 0), totalDrawn = cells.reduce((a, c) => a + c.drawn_pages, 0);
  for (const c of cells) { c.share_of_library = c.pages_waiting / totalWaiting; c.share_of_set = c.drawn_pages / totalDrawn; }
  return {
    generated_by: 'scripts/eval/test-set-264/seal.mjs', issue: 264, seed: meta.seed, drawn_at: meta.drawn_at, sealed_at: meta.sealed_at, router_table: log.router_table, frame_sha256: meta.frame_sha256,
    size_rule: SIZE_RULE, totals: { pages_waiting: totalWaiting, drawn_pages: totalDrawn, drawn_books: new Set(rows.filter((r) => r.drawn).map((r) => r.book_id)).size, reserve_pages: rows.filter((r) => r.reserve).length,
      existing_rows: rows.filter((r) => !r.drawn).length, cells: cells.length, observed_differs: rows.filter((r) => r.drawn && r.observed_differs).length, image_unfetched: rows.filter((r) => r.drawn && !r.image.sha256).length },
    engines_scored: [], cells,
  };
}

if (process.argv.includes('--public-only')) {
  // rebuild the public aggregates from the sealed file (the page's data), never the other way round
  const rows = fs.readFileSync(FRAME, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  fs.writeFileSync(PUBLIC, JSON.stringify(aggregates(rows, meta.draw_log, meta), null, 1) + '\n');
  console.log(`wrote ${PUBLIC}`);
  process.exit(0);
}
const { log, rows } = build();
fs.mkdirSync(DIR, { recursive: true });
const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
fs.writeFileSync(FRAME, body);
const meta = { issue: 264, seed: SEED, drawn_at: log.at, sealed_at: new Date().toISOString(), router_table: log.router_table, rows: rows.length, frame_sha256: sha(body),
  draw_rule: 'per catalogue language: books with pages_count > 0, hidden included (duplicates, rights holds and withdrawn manuscripts out), in sha256(seed|book id) order; one interior page (first 15% and last 5% skipped, leaf by the same hash); kept when the page is waiting in a router cell with room. Existing rows: passing references and judged pages from inventory.json, one page per book per cell.',
  reserve_rule: `${SIZE_RULE.reserve_share * 100}% of drawn rows per cell, smallest sha256(seed|reserve|page id); existing rows never reserve`,
  size_rule: SIZE_RULE, draw_log: log };
fs.writeFileSync(META, JSON.stringify(meta, null, 1) + '\n');
fs.writeFileSync(PUBLIC, JSON.stringify(aggregates(rows, log, meta), null, 1) + '\n');
console.log(`sealed ${rows.length} rows, sha256 ${meta.frame_sha256}; wrote ${FRAME}, ${META}, ${PUBLIC}`);

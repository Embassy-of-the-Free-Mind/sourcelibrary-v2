#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs and lib/benchmark-rows.mjs (read the sealed strata and scored
// results per page x engine, but never apply #264's rules to the reference records or reach the judged pages);
// .claude/docs/eval-design-census/ (the 2026-09-25 gap table, by catalogue language x period, not router cell);
// scripts/eval/audit-pareto-samples.mjs (whether a panel's pages suit its measure, per panel, not per cell). None maps a
// reference record or a judged page to a router cell.
/**
 * Step 1 of #264: every reference record in scripts/eval/benchmark/refs/ and every judged page in lane_judge_verdicts,
 * mapped to a router cell, with #264's rules applied. Read-only (secondary reads), $0.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/test-set-264/inventory.mjs \
 *     [--out=scripts/eval/dataset/test-set-264/inventory.json] [--md=scripts/eval/test-set-264/INVENTORY.md]
 *
 * Rules (a reference passes when none applies):
 *   external      no library book (a Wikisource-hosted scan, ws-*): never counts toward a library cell
 *   no_text       a record with no .txt beside it (a recorded skip: overlap too low, wrong work, ...)
 *   model_made    made_by.engine set, or source "model-transcription"
 *   own_output    a correction of our own served OCR (source names "corrected transcription")
 *   no_leaf_check no leaf_check, or leaf_check.status other than ok
 *   not_same_edition  same_edition === false
 *   no_cell       the page's language x stored-text engine x script type has no router cell with pages waiting
 * canonical is set from the source for every row (Perseus, First1KGreek, Kanripo, CBETA, ...), not from the
 * record's own `canonical` field (5 true, 401 missing on 2026-11-13); canonical rows pass but are counted apart.
 *
 * A judged page passes when its row came from a random draw (`selection` random or a live sampler row), the task is
 * OCR, and the verdict is on the route judge's scale (accept + defects).
 *
 * A page whose stored text is now an agy or Claude re-read is placed by the engine of its earlier text (page_revisions),
 * marked prior_text: the reference or verdict was made while the page sat in that cell.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { classifyPages } from '../router-next-7263/script-type.mjs';
import { verdictQuery } from '../lib/judge-rows.mjs';
import { loadOcrCells, frameCells, frameCellOf, baseOf, cellId, canonicalFromSource, draftBucket } from './cells.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(HERE, '..', 'benchmark');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
// the full inventory (page ids, reference slugs) lives under scripts/eval/dataset/, which the public mirror leaves out
const OUT = arg('out', path.join(HERE, '..', 'dataset', 'test-set-264', 'inventory.json'));
const MD = arg('md', path.join(HERE, 'INVENTORY.md'));

// ── references ───────────────────────────────────────────────────────────────
const slugMap = new Map();
for (const f of fs.readdirSync(BENCH).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(BENCH, f), 'utf8'));
  for (const p of [j.pages, j.rows, j.items].find(Array.isArray) || []) if (p?.slug && p.book_id) slugMap.set(p.slug, { book_id: p.book_id, page_number: p.page_number, page_id: p.page_id || null, stratum_file: f });
}
const refs = [];
for (const f of fs.readdirSync(path.join(BENCH, 'refs')).filter((x) => x.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(BENCH, 'refs', f), 'utf8'));
  const slug = j.slug || f.replace(/\.json$/, '');
  let loc = null;
  if (j.book_id) loc = { book_id: j.book_id, page_number: j.page_number ?? null, page_id: j.page_id || null };
  else if (slugMap.has(slug)) loc = slugMap.get(slug);
  else { const m = slug.match(/^(?:rf|r4l)-([0-9a-f]{24})-p(\d+)$/); if (m) loc = { book_id: m[1], page_number: Number(m[2]), page_id: j.page_id || null }; }
  if (loc && !loc.page_id && j.page_id) loc.page_id = j.page_id;
  const src = j.source ?? null;
  const rules = [];
  if (!loc) rules.push('external');
  if (!fs.existsSync(path.join(BENCH, 'refs', `${slug}.txt`)) && j.text_location !== 'private') rules.push('no_text');
  if (j.made_by?.engine || src === 'model-transcription') rules.push('model_made');
  if (/corrected transcription/i.test(String(src))) rules.push('own_output');
  if (!j.leaf_check || j.leaf_check.status !== 'ok') rules.push('no_leaf_check');
  if (j.same_edition === false) rules.push('not_same_edition');
  refs.push({ slug, file: f, source: src, licence: j.licence ?? null, loc, rules, canonical: canonicalFromSource(src) || j.canonical === true, canonical_field: j.canonical ?? null,
    made_by_engine: j.made_by?.engine ?? null, source_model_transcription: src === 'model-transcription', leaf_check: j.leaf_check?.status ?? null });
}

// ── wave-2 panels (the 38-engine sets, #6011): '<stratum file>|<slug>' page ids ───────────────────────────────
const WAVE2 = arg('wave2', '/root/engine-wave2-6011/sets.json');
const wave2 = [];
if (fs.existsSync(WAVE2)) {
  for (const [set, v] of Object.entries(JSON.parse(fs.readFileSync(WAVE2, 'utf8')))) for (const pid of v.pages || []) {
    const [stratum, slug] = pid.split('|');
    const loc = slugMap.get(slug) || null;
    // a book key for external pages: the manuscript / Wikisource scan the slug names, without its page part
    const bookKey = loc?.book_id || slug.replace(/^(syriac-gt\|)?/, '').replace(/(_SMMJ_.*|-0\d{3}_.*)$/, '').replace(/-p?\d+$/, '');
    wave2.push({ set, page: pid, stratum, slug, loc, book_key: bookKey, ref_record: fs.existsSync(path.join(BENCH, 'refs', `${slug}.json`)) ? slug : null });
  }
}

// ── Mongo ────────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

// judged pages: one entry per page, all its rows
const jrows = await db.collection('lane_judge_verdicts').find(verdictQuery({}, { tests: true }), // every row: the inventory counts live and test rows apart
  { projection: { _id: 0, page_id: 1, book_id: 1, page_number: 1, lane: 1, task: 1, origin: 1, selection: 1, cell: 1, cell_real: 1, 'router.cell': 1, 'verdict.accept': 1, 'verdict.defects': 1, 'judge.instrument': 1, route: 1, kind: 1 } }).toArray();
const judged = new Map();
for (const r of jrows) {
  if (!r.page_id) continue;
  const e = judged.get(r.page_id) || { page_id: r.page_id, book_id: r.book_id, page_number: r.page_number ?? null, rows: 0, lanes: new Set(), random: false, ocr: false, route_scale: false, cells_at_judging: new Set(), routes: new Set() };
  e.rows++; e.lanes.add(r.lane);
  if ((r.origin ?? 'live') === 'live' || r.selection === 'random') e.random = true;
  const tr = r.task === 'translate' || r.task === 'translation' || /(^|[-:])tr([-:]|$)|translat/i.test(String(r.lane)) || /-tr\b|-tr-|siku-tr|tibetan-tr|tengyur/.test(String(r.cell_real || r.router?.cell || r.cell || ''));
  if (!tr) e.ocr = true;
  if (typeof r.verdict?.accept === 'boolean' || Array.isArray(r.verdict?.defects)) e.route_scale = true;
  for (const c of [r.cell_real, r.router?.cell, r.cell]) if (c) e.cells_at_judging.add(c);
  if (r.route) e.routes.add(r.route);
  judged.set(r.page_id, e);
}

// books (by id OR _id: 16K books have a re-minted _id) and pages
const bookIds = [...new Set([...refs.filter((r) => r.loc).map((r) => r.loc.book_id), ...[...judged.values()].map((j) => j.book_id)].filter(Boolean))];
const books = new Map();
for (let i = 0; i < bookIds.length; i += 1000) {
  const ids = bookIds.slice(i, i + 1000);
  const { ObjectId } = await import('mongodb');
  const oids = ids.filter((x) => /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x));
  for (const b of await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] }, { projection: { id: 1, language: 1, year: 1, published: 1, work_id: 1, visible: 1, pages_count: 1, hidden_reason: 1 } }).toArray()) {
    const rec = { id: b.id || String(b._id), language: b.language, year: Number(b.year) || Number(String(b.published || '').match(/\d{4}/)?.[0]) || null, work_id: b.work_id || null, visible: !!b.visible };
    books.set(b.id, rec); books.set(String(b._id), rec);
  }
}
// pages: by id where known, else by (book_id, page_number)
const pageById = new Map(), pageByNum = new Map();
const proj = { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.qa_screen.dice': 1 };
const wantIds = [...new Set([...refs.map((r) => r.loc?.page_id), ...judged.keys()].filter(Boolean))];
for (let i = 0; i < wantIds.length; i += 1000) for (const p of await db.collection('pages').find({ id: { $in: wantIds.slice(i, i + 1000) } }, { projection: proj }).toArray()) pageById.set(p.id, p);
for (const r of refs) {
  if (!r.loc || r.loc.page_id || r.loc.page_number == null) continue;
  const b = books.get(r.loc.book_id);
  const p = await db.collection('pages').findOne({ book_id: { $in: [r.loc.book_id, b?.id].filter(Boolean) }, page_number: r.loc.page_number }, { projection: proj });
  if (p) { pageByNum.set(`${r.loc.book_id}|${r.loc.page_number}`, p); pageById.set(p.id, p); }
}
for (const w of wave2) {
  if (!w.loc || w.loc.page_number == null || pageByNum.has(`${w.loc.book_id}|${w.loc.page_number}`)) continue;
  if (!books.has(w.loc.book_id)) for (const b of await db.collection('books').find({ id: w.loc.book_id }, { projection: { id: 1, language: 1, year: 1, published: 1, work_id: 1, visible: 1 } }).toArray()) books.set(b.id, { id: b.id, language: b.language, year: Number(b.year) || null, work_id: b.work_id || null, visible: !!b.visible });
  const p = await db.collection('pages').findOne({ book_id: w.loc.book_id, page_number: w.loc.page_number }, { projection: proj });
  if (p) { pageByNum.set(`${w.loc.book_id}|${w.loc.page_number}`, p); pageById.set(p.id, p); }
}
const cls = await classifyPages(db, [...pageById.keys()]);
// A page re-read since its reference or verdict was made (agy, Claude) is no longer waiting; it is placed by the engine of
// the text it held before (the earliest `ocr` revision, which stores the replaced text's model), flagged prior_text.
const priorModel = new Map();
const reread = [...pageById.values()].filter((p) => ['agy', 'claude', 'other'].includes(draftBucket(p.ocr?.model))).map((p) => p.id);
for (let i = 0; i < reread.length; i += 500) {
  const rs = await db.collection('page_revisions').find({ page_id: { $in: reread.slice(i, i + 500) }, field: 'ocr', model: { $type: 'string' } }, { projection: { _id: 0, page_id: 1, model: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
  for (const r of rs) if (!priorModel.has(r.page_id) && ['lite', 'flash3', 'paddle', 'yigdzin', 'none'].includes(draftBucket(r.model))) priorModel.set(r.page_id, r.model);
}
await client.close();

const { table, pointer_set, cells } = loadOcrCells();
const frame = frameCells(cells);
function place(bookId, page) {
  const b = books.get(bookId);
  if (!b) return { why: 'book not found (id or _id)' };
  if (!page) return { book: b, why: 'page not found' };
  const prior = priorModel.get(page.id);
  const { base, why } = baseOf(b, { model: prior || page.ocr?.model, pipeline: page.ocr?.pipeline, dice: page.ocr?.qa_screen?.dice });
  const c = cls.get(page.id)?.cls || 'unknown';
  const router_cell = cellId(cells, base, c);
  return { book: b, page, base, script: c, prior_text: !!prior, router_cell, frame_cell: frameCellOf(frame, router_cell), why: router_cell ? null : (why || `no router cell ${base}/${c} with pages waiting`) };
}

for (const r of refs) {
  if (!r.loc) continue;
  const page = r.loc.page_id ? pageById.get(r.loc.page_id) : pageByNum.get(`${r.loc.book_id}|${r.loc.page_number}`);
  const pl = place(r.loc.book_id, page);
  Object.assign(r, { prior_text: !!pl.prior_text, book_id: pl.book?.id || r.loc.book_id, work_id: pl.book?.work_id || null, page_id: page?.id || null, language: pl.book?.language || null, router_cell: pl.router_cell || null, frame_cell: pl.frame_cell || null, cell_why: pl.why });
  if (!pl.frame_cell) r.rules.push('no_cell');
}
const jlist = [...judged.values()].map((e) => {
  const pl = place(e.book_id, pageById.get(e.page_id));
  const rules = [];
  if (!e.random) rules.push('not_random');
  if (!e.ocr) rules.push('translation');
  if (!e.route_scale) rules.push('other_scale');
  if (!pl.frame_cell) rules.push('no_cell');
  return { page_id: e.page_id, prior_text: !!pl.prior_text, book_id: pl.book?.id || e.book_id, work_id: pl.book?.work_id || null, rows: e.rows, lanes: [...e.lanes], routes: [...e.routes], cells_at_judging: [...e.cells_at_judging], router_cell: pl.router_cell || null, frame_cell: pl.frame_cell || null, cell_why: pl.why, rules };
});

const refBySlug = new Map(refs.map((r) => [r.slug, r]));
const wave2Sets = {};
for (const w of wave2) {
  const pl = w.loc ? place(w.loc.book_id, pageByNum.get(`${w.loc.book_id}|${w.loc.page_number}`)) : { why: 'external page (no library book)' };
  const ref = w.ref_record ? refBySlug.get(w.ref_record) : null;
  const s = wave2Sets[w.set] ||= { pages: 0, books: new Set(), library_pages: 0, external_pages: 0, ref_pass: 0, ref_fail: 0, no_ref_record: 0, by_frame_cell: {} };
  s.pages++; s.books.add(w.book_key);
  if (w.loc) s.library_pages++; else s.external_pages++;
  if (!ref) s.no_ref_record++; else if (ref.rules.length) s.ref_fail++; else s.ref_pass++;
  const fc = pl.frame_cell || `(none: ${pl.why || '?'})`;
  s.by_frame_cell[fc] = (s.by_frame_cell[fc] || 0) + 1;
}
for (const s of Object.values(wave2Sets)) s.books = s.books.size;

// ── per frame cell ───────────────────────────────────────────────────────────
const RRULES = ['external', 'no_text', 'model_made', 'own_output', 'no_leaf_check', 'not_same_edition', 'no_cell'];
const JRULES = ['not_random', 'translation', 'other_scale', 'no_cell'];
const per = new Map([...frame.values()].map((f) => [f.id, { cell: f.id, router_cells: f.router_cells, pages_waiting: f.pages_waiting, target: f.target,
  refs: { mapped: 0, pass: 0, pass_canonical: 0, fail: Object.fromEntries(RRULES.map((k) => [k, 0])) }, judged: { mapped: 0, pass: 0, fail: Object.fromEntries(JRULES.map((k) => [k, 0])) },
  books_ref_pass: new Set(), books_ref_pass_noncanonical: new Set(), books_judged_pass: new Set() }]));
const unplaced = { refs: { n: 0, by_rule: {}, why: {} }, judged: { n: 0, why: {} } };
for (const r of refs) {
  const c = r.frame_cell && per.get(r.frame_cell);
  if (!c) { unplaced.refs.n++; for (const k of r.rules) unplaced.refs.by_rule[k] = (unplaced.refs.by_rule[k] || 0) + 1; const w = r.cell_why || (r.loc ? '?' : 'external'); unplaced.refs.why[w] = (unplaced.refs.why[w] || 0) + 1; continue; }
  c.refs.mapped++;
  for (const k of r.rules) c.refs.fail[k]++;
  if (!r.rules.length) { c.refs.pass++; c.books_ref_pass.add(r.book_id); if (r.canonical) c.refs.pass_canonical++; else c.books_ref_pass_noncanonical.add(r.book_id); }
}
for (const j of jlist) {
  const c = j.frame_cell && per.get(j.frame_cell);
  if (!c) { unplaced.judged.n++; const w = j.cell_why || '?'; unplaced.judged.why[w] = (unplaced.judged.why[w] || 0) + 1; continue; }
  c.judged.mapped++;
  for (const k of j.rules) c.judged.fail[k]++;
  if (!j.rules.length) { c.judged.pass++; c.books_judged_pass.add(j.book_id); }
}
const cellsOut = [...per.values()].map((c) => {
  const truthBooks = new Set([...c.books_ref_pass_noncanonical, ...c.books_judged_pass]);
  return { ...c, books_ref_pass: c.books_ref_pass.size, books_ref_pass_noncanonical: c.books_ref_pass_noncanonical.size, books_judged_pass: c.books_judged_pass.size,
    books_with_truth: truthBooks.size, gap_reference: Math.max(0, c.target - c.books_ref_pass_noncanonical.size), gap_judged: Math.max(0, c.target - c.books_judged_pass.size) };
});

// the issue's counts, reproduced
const count = (f) => refs.filter(f).length;
const issueCounts = {
  records: refs.length,
  made_by_engine: count((r) => r.made_by_engine), model_transcription: count((r) => r.source_model_transcription),
  model_made_union: count((r) => r.rules.includes('model_made')), model_made_overlap: count((r) => r.made_by_engine && r.source_model_transcription),
  own_output_5695: count((r) => /by-eye corrected transcription of the served OCR/.test(String(r.source))), own_output_all: count((r) => r.rules.includes('own_output')),
  no_leaf_check_field: count((r) => r.leaf_check == null), leaf_check_ok: count((r) => r.leaf_check === 'ok'),
  canonical_field_true: count((r) => r.canonical_field === true), canonical_field_missing: count((r) => r.canonical_field == null),
  canonical_from_source: count((r) => r.canonical), no_text: count((r) => r.rules.includes('no_text')), external: count((r) => r.rules.includes('external')),
  pass_all_rules: count((r) => !r.rules.length), pass_all_rules_noncanonical: count((r) => !r.rules.length && !r.canonical),
  by_source_canonical: Object.fromEntries(['Perseus', 'First1K', 'Kanripo', 'CBETA'].map((s) => [s, count((r) => new RegExp(s, 'i').test(String(r.source)))])),
  judged_pages: jlist.length, judged_rows: jrows.length, judged_books: new Set(jlist.map((j) => j.book_id)).size,
  judged_pass: jlist.filter((j) => !j.rules.length).length,
};
const out = { generated_by: 'scripts/eval/test-set-264/inventory.mjs', issue: 264, at: new Date().toISOString(), router_table: table, router_pointer_set: pointer_set,
  issue_counts: issueCounts, cells: cellsOut, unplaced, wave2_sets: wave2Sets, wave2_source: WAVE2,
  refs: refs.map(({ loc, ...r }) => r), judged: jlist };
// one line per record in the long arrays, so the file diffs by record and stays a few thousand lines
const compact = (o) => '{\n' + Object.entries(o).map(([k, v]) => ` ${JSON.stringify(k)}: ${Array.isArray(v) ? `[\n${v.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n ]` : JSON.stringify(v)}`).join(',\n') + '\n}\n';
fs.writeFileSync(OUT, compact(out));

// ── markdown ─────────────────────────────────────────────────────────────────
const L = [];
L.push(`# Test-set inventory (#264, stage 1 step 1)`, '', `Generated ${out.at.slice(0, 10)} by \`scripts/eval/test-set-264/inventory.mjs\` (read-only). Router table \`${table}\`.`, '',
  `Cells are the router's OCR cell ids; cells under 20K pages waiting are pooled into one \`other-<script>\` cell per writing script. A reference passes when none of #264's rules applies; canonical references pass but are counted apart, and the gap is to the cell's target in **non-canonical** referenced books. A judged page passes when it came from a random draw, the task is OCR, and the verdict is on the route judge's scale.`, '',
  '## Per cell', '',
  '| cell | pages waiting | target books | refs mapped | refs pass | of which canonical | fail: model-made | fail: own output | fail: no leaf check | fail: no text | books, non-canonical ref | gap to target (ref) | judged pages | judged pass | books judged | gap to target (judged) |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const c of cellsOut) L.push(`| \`${c.cell}\` | ${c.pages_waiting.toLocaleString('en-US')} | ${c.target} | ${c.refs.mapped} | ${c.refs.pass} | ${c.refs.pass_canonical} | ${c.refs.fail.model_made} | ${c.refs.fail.own_output} | ${c.refs.fail.no_leaf_check} | ${c.refs.fail.no_text} | ${c.books_ref_pass_noncanonical} | ${c.gap_reference} | ${c.judged.mapped} | ${c.judged.pass} | ${c.books_judged_pass} | ${c.gap_judged} |`);
const sum = (k) => cellsOut.reduce((a, c) => a + k(c), 0);
L.push(`| **all cells** | ${sum((c) => c.pages_waiting).toLocaleString('en-US')} | ${sum((c) => c.target)} | ${sum((c) => c.refs.mapped)} | ${sum((c) => c.refs.pass)} | ${sum((c) => c.refs.pass_canonical)} | ${sum((c) => c.refs.fail.model_made)} | ${sum((c) => c.refs.fail.own_output)} | ${sum((c) => c.refs.fail.no_leaf_check)} | ${sum((c) => c.refs.fail.no_text)} | ${sum((c) => c.books_ref_pass_noncanonical)} | ${sum((c) => c.gap_reference)} | ${sum((c) => c.judged.mapped)} | ${sum((c) => c.judged.pass)} | ${sum((c) => c.books_judged_pass)} | ${sum((c) => c.gap_judged)} |`);
L.push('', '## Not in any cell', '', `References: ${unplaced.refs.n} of ${refs.length}.`, '', '| why | records |', '|---|---:|');
for (const [w, n] of Object.entries(unplaced.refs.why).sort((a, b) => b[1] - a[1])) L.push(`| ${w} | ${n} |`);
L.push('', `Judged pages: ${unplaced.judged.n} of ${jlist.length}.`, '', '| why | pages |', '|---|---:|');
for (const [w, n] of Object.entries(unplaced.judged.why).sort((a, b) => b[1] - a[1]).slice(0, 25)) L.push(`| ${w} | ${n} |`);
L.push('', '## Wave-2 panels mapped to cells', '', 'The eight sets the 38 engines were scored on (`/root/engine-wave2-6011/sets.json`, #6011). Books: library book ids, or for external pages the scan or manuscript the slug names.', '',
  '| set | pages | books | library pages | external pages | ref passes rules | ref fails a rule | no record in refs/ | frame cells (pages) |', '|---|---:|---:|---:|---:|---:|---:|---:|---|');
for (const [k, s] of Object.entries(wave2Sets)) L.push(`| ${k} | ${s.pages} | ${s.books} | ${s.library_pages} | ${s.external_pages} | ${s.ref_pass} | ${s.ref_fail} | ${s.no_ref_record} | ${Object.entries(s.by_frame_cell).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join('; ')} |`);
L.push('', '## The issue\'s counts, reproduced', '', '| count | value |', '|---|---:|');
for (const [k, v] of Object.entries(issueCounts)) L.push(`| ${k} | ${typeof v === 'object' ? JSON.stringify(v) : v} |`);
fs.writeFileSync(MD, L.join('\n') + '\n');
console.log(JSON.stringify(issueCounts, null, 1));
console.log(`wrote ${OUT} and ${MD}`);

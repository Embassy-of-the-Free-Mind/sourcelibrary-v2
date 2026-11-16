#!/usr/bin/env node
// PRIOR ART: ./seam-pass-8399.mjs and ./blocks4-8399.mjs (v2#8399, v2#8407) — the row shape, joinsOf, the planted
// defects, the #7118 seam judge call (ab.mjs JUDGE_PROMPT through seams-6742/lib.mjs claudeCall), the lane weights and
// the leak classes are imported from them, not copied. They do not fit as they are: both re-read their blocks with the
// production reader (agy translation calls) and hardcode the Latin/German frame and arms (A, A2, A0, Bb, C). This test
// makes no translation call: arm A is the STORED English of whole production calls (the call block is on the page:
// translation.engine.input.context.block), and the stage under test is scripts/lib/seam-pass.mjs seamStage itself,
// run over a reads directory laid out from the stored text. The page judge is route-judge-6740/judge.mjs (its packet).
/**
 * Does the seam pass (seam_pass 'edit-before', on for Latin and German since v2#8399) work on French and Italian? (v3#104)
 * Mongo reads only until `apply --apply` (the judged-better French joins, after the rule passed). $0: one agy call per block (the stage) + claude CLI (the judges).
 *
 *   N="node --env-file=$ENV"; S=scripts/eval/seam-prevent-7118/seam-fr-it-104.mjs      ($ENV: a .env.production.local)
 *   $N $S census --out=DIR            every frame book's whole production calls, 1-4 pages (frame.jsonl; resumes)
 *   $N $S draw   --out=DIR [--n=72] [--deep-it=K]   the seeded sample: n calls of 2-4 pages a language, at most 2 a book
 *                                     (primary); --deep-it adds up to K a book as a second, labelled stratum (ctx.jsonl, build.json)
 *   $N $S stage  --out=DIR            the built seam pass, edit-before on, over the stored text (reads/seam-pass.jsonl)
 *   $N $S judge  --out=DIR [--conc=3] the #7118 seam judge, blind, both orders, with a copy of A and a planted defect
 *   $N $S packet --out=DIR            page-judge packet: every page the pass changed, as stored and as passed
 *   $N $S score  --out=DIR            report.json
 *   $N $S apply  --out=DIR [--apply]  after the rule passed: write the French joins the judge scored better (dry run default)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';
import { readJsonl, joinsOf, plant, tail, head, normTr, foldOcrWords, LANE_W } from './blocks4-8399.mjs';
import { isTranslatablePage, isEnglishBook } from '../../lib/translate-core.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { NON_PROSE_TYPES } from '../../lib/page-integrity.mjs';
import { NOT_HELD } from '../../lib/pipeline-hold.mjs';
import { translateLaneForBook } from '../../lib/translation-routing.mjs';
import { sharedRun, LEAK_MIN_CHARS } from '../../audit/translation-page-boundaries.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { shuffle } from '../seams-6742/lib.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
export const CELLS = { 'french-cli-agy4': 'fr', 'italian-cli-agy4': 'it' };
export const ROUTE_MODEL = 'gemini-3.8-flash-low';
export const SEED = 104;
/** A sampled block is one whole production call of at least this many pages (so it has a join inside it). */
export const MIN_CALL = 2;
/** v2#8399's measured run-to-run swing of production (A against A2, 118 blocks), per 100 joins. No second production
 *  read is made here (no translation call), so these stand in for this round's swing. */
export const SWING_8399 = { S: 1.7, T: 6.0, lane: 4.9 };
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 16);
const mongo = async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return c; };
const routingTable = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/lib/translation-routing-table.json'), 'utf8'));

// ── census: which frame books hold production 4-page calls ────────────────────
const BOOK_PROJ = { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, publisher: 1, language: 1, original_language: 1, image_source: 1 };
/** The frame: visible books with pages, not held, not English, that the routing table sends to one of the two rows. */
async function frameBooks(db) {
  const table = routingTable();
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 10 }, language: /^\s*(french|italian)/i, ...NOT_HELD }, { projection: BOOK_PROJ }).toArray();
  return books.filter(b => b.id && !isEnglishBook(b)).map(b => ({ ...b, cell: translateLaneForBook(table, b).row?.id })).filter(b => CELLS[b.cell]).sort((a, b) => (a.id < b.id ? -1 : 1));
}
/** A page's stored English is a production agy read (the cli-translate lane, Flash low). */
const AGY_READ = { 'translation.engine.cli.name': 'agy', 'translation.engine.call_site': 'scripts/batch/cli-translate.mjs', 'translation.model': ROUTE_MODEL };

async function census(out) {
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'frame.jsonl');
  const done = new Set(readJsonl(file).map(r => r.id));
  const c = await mongo(); const db = c.db('bookstore');
  const books = await frameBooks(db);
  const todo = books.filter(b => !done.has(b.id));
  console.log(`${books.length} frame books (${Object.entries(books.reduce((a, b) => { a[b.cell] = (a[b.cell] || 0) + 1; return a; }, {})).map(([k, v]) => `${k} ${v}`).join(', ')}); ${todo.length} to scan`);
  let i = 0, n = 0;
  const worker = async () => {
    while (i < todo.length) {
      const b = todo[i++];
      const pages = await db.collection('pages').find({ book_id: b.id, ...AGY_READ }, { projection: { _id: 0, page_number: 1, 'translation.engine.run.job_id': 1, 'translation.engine.input.context.block': 1 } }).toArray();
      // a whole production call: 1-4 consecutive pages that each still record the same block, written by the same run
      const byN = new Map(pages.map(p => [p.page_number, p]));
      const calls = [];
      for (const p of pages) {
        const blk = p.translation?.engine?.input?.context?.block;
        if (!Array.isArray(blk) || blk.length < 1 || blk.length > 4 || blk[0] !== p.page_number || blk.some((x, k) => x !== blk[0] + k)) continue;
        const job = p.translation.engine.run?.job_id;
        if (blk.every(x => { const q = byN.get(x); return q && q.translation.engine.run?.job_id === job && String(q.translation.engine.input?.context?.block) === String(blk); })) calls.push([blk[0], blk.length]);
      }
      fs.appendFileSync(file, JSON.stringify({ id: b.id, cell: b.cell, language: b.language, agyPages: pages.length, calls: calls.sort((x, y) => x[0] - y[0]) }) + '\n');
      if (++n % 50 === 0) fs.writeFileSync(path.join(out, 'census.progress'), `${n}/${todo.length} ${new Date().toISOString()}\n`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  await c.close();
  const rows = readJsonl(file);
  fs.writeFileSync(path.join(out, 'census.progress'), `done ${rows.length} ${new Date().toISOString()}\n`);
  console.log(JSON.stringify(censusTally(rows)));
}

/** Per cell: frame books, books holding agy reads, and whole calls (and the books holding them) by call size. */
export function censusTally(rows) {
  return Object.fromEntries(Object.keys(CELLS).map(cell => { const rs = rows.filter(r => r.cell === cell); const size = (k) => rs.map(r => r.calls.filter(c => c[1] === k).length);
    return [cell, { frameBooks: rs.length, booksWithAgyPages: rs.filter(r => r.agyPages).length, booksWithMultiPageCalls: rs.filter(r => r.calls.some(c => c[1] >= MIN_CALL)).length,
      ...Object.fromEntries([1, 2, 3, 4].map(k => [`calls${k}`, { calls: size(k).reduce((a, b) => a + b, 0), books: size(k).filter(Boolean).length }])) }]; }));
}

// ── draw ─────────────────────────────────────────────────────────────────────
const PAGE_PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.unreadable': 1, translation: 1, translation_withheld: 1 };
const prose = (p) => p && isTranslatablePage(p).ok && !NON_PROSE_TYPES.has(p.page_type) && (p.ocr?.data || '').length >= 200;

/** Each book has its own seeded order of calls, so a deeper draw in a book keeps the calls a shallower one took. */
const bookRng = (bookId) => makeRng(parseInt(crypto.createHash('sha1').update(`${SEED}:${bookId}`).digest('hex').slice(0, 8), 16));

async function draw(out, n, perBook, deep) {
  const { eligible } = await import('../../maintenance/seam-repair-6742/seam-repair.mjs');
  const { qualifies } = await import('./ab.mjs');
  const frame = readJsonl(path.join(out, 'frame.jsonl'));
  const c = await mongo(); const db = c.db('bookstore');
  const books = new Map((await frameBooks(db)).map(b => [b.id, b]));
  const rows = [], skipped = {}, summary = {};
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  for (const [cell, lang] of Object.entries(CELLS)) {
    const cand = frame.map(r => ({ ...r, calls: r.calls.filter(c => c[1] >= MIN_CALL) })).filter(r => r.cell === cell && r.calls.length && books.has(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
    const order = shuffle(cand, makeRng(SEED + (lang === 'fr' ? 1 : 2)));
    // `deep` (--deep-it=K, --deep-fr=K): after the primary draw (rank <= perBook), up to K calls a book, ranks above perBook
    const cap = Math.max(perBook, deep[lang] || 0);
    let kept = 0, booksUsed = 0, booksTried = 0;
    for (const f of order) {
      if (kept >= n && !deep[lang]) break;
      booksTried++;
      const rand = bookRng(f.id);
      const pages = await db.collection('pages').find({ book_id: f.id }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
      const byN = new Map(pages.map(p => [p.page_number, p]));
      const taken = [];
      for (const [s0, size] of shuffle(f.calls, rand)) {
        if (taken.length >= cap || (taken.length >= perBook ? !deep[lang] : kept >= n)) break;
        const nums = Array.from({ length: size }, (_, k) => s0 + k), blk = nums.map(x => byN.get(x)), before = byN.get(s0 - 1);
        // the call is still what the page serves: the same block on every page, an agy Flash-low read, never edited
        if (!blk.every(p => p && p.translation?.engine?.cli?.name === 'agy' && p.translation.model === ROUTE_MODEL && String(p.translation.engine.input?.context?.block) === String(nums))) { skip('call no longer stored whole'); continue; }
        if (!blk.every(prose)) { skip('a page is not prose with 200+ OCR characters'); continue; }
        if (!blk.every(eligible)) { skip('a page is edited, withheld or a placeholder'); continue; }
        if (!before?.ocr?.data || !eligible(before)) { skip('no eligible stored English on the page before'); continue; }
        if (taken.some(([t, ts]) => s0 - 1 <= t + ts && t - 1 <= s0 + size)) { skip('touches the book\'s other block'); continue; }
        taken.push([s0, size]);
        const seamPos = Math.floor(rand() * (size - 1));
        const at = (x) => byN.get(x);
        if (taken.length <= perBook) kept++;
        rows.push({ id: `${f.id}:${s0}`, lang, cell, rank: taken.length, primary: taken.length <= perBook, book: books.get(f.id), N: nums[seamPos], block: nums, callPages: size, seamPos, pageIds: blk.map(p => p.id),
          before: { n: s0 - 1, id: before.id, ocr: before.ocr.data, tr: before.translation.data, model: before.translation.model ?? null, cli: before.translation.engine?.cli?.name ?? null, sameRun: before.translation.engine?.run?.job_id === blk[0].translation.engine.run?.job_id },
          ocr: Object.fromEntries([s0 - 1, ...nums].map(x => [x, at(x).ocr.data])), stored: Object.fromEntries(nums.map(x => [x, at(x).translation.data])),
          hashes: Object.fromEntries([s0 - 1, ...nums].map(x => [x, sha(at(x).translation.data)])), types: Object.fromEntries(nums.map(x => [x, at(x).page_type || null])),
          run: blk[0].translation.engine.run?.job_id ?? null, readAt: blk[0].translation.updated_at ?? null, previousEnglishSent: blk[0].translation.engine.input?.context?.previous_translation ?? null,
          midflow: { S: !!qualifies(before, blk[0]), T: !!qualifies(blk[seamPos], blk[seamPos + 1]) } });
      }
      if (taken.length) booksUsed++;
    }
    const mine = rows.filter(r => r.cell === cell);
    summary[cell] = { candidateBooks: cand.length, booksTried, booksUsed, blocks: mine.length, primary: mine.filter(r => r.primary).length, deeper: mine.filter(r => !r.primary).length, perBookCap: cap,
      perBook: Object.values(mine.reduce((a, r) => { a[r.book.id] = (a[r.book.id] || 0) + 1; return a; }, {})).sort((x, y) => y - x), bySize: Object.fromEntries([2, 3, 4].map(k => [k, mine.filter(r => r.callPages === k).length])) };
  }
  await c.close();
  fs.writeFileSync(path.join(out, 'ctx.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const fr = readJsonl(path.join(out, 'frame.jsonl'));
  const b = { at: new Date().toISOString(), seed: SEED, n, perBook, deep, filter: { books: 'visible, pages_count > 0, pages_translated > 10, not held, not English, language French or Italian, routed by translation-routing-table.json to french-cli-agy4 or italian-cli-agy4', pages: AGY_READ, call: `translation.engine.input.context.block lists the same ${MIN_CALL}-4 consecutive pages on every page of the call, same run id` },
    census: censusTally(fr),
    drawn: summary, skipped, midflow: { S: rows.filter(r => r.midflow.S).length, T: rows.filter(r => r.midflow.T).length }, beforeSameRun: rows.filter(r => r.before.sameRun).length, beforeAgy: rows.filter(r => r.before.cli === 'agy').length };
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify(b, null, 1) + '\n');
  console.log(JSON.stringify(b, null, 1));
}

// ── stage: the built seam pass over the stored text ──────────────────────────
const readsDir = (out) => path.join(out, 'reads');
/**
 * Lay the stored English of every block out as a reads directory (the files claude-translate.mjs read leaves: one
 * meta and one text per page, the four pages of a block under one call id) and run scripts/lib/seam-pass.mjs seamStage
 * over it with edit-before on: one agy call per block, at the turn into it. seamStage reads Mongo and writes only
 * under DIR/reads. A block whose stored text changed since the draw is left out (stale.json).
 */
async function stage(out) {
  const { seamStage, SEAM_PASS_MODEL } = await import('../../lib/seam-pass.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const dir = readsDir(out); fs.mkdirSync(dir, { recursive: true });
  const c = await mongo(); const db = c.db('bookstore');
  const stale = [];
  for (const r of ctx) {
    const docs = await db.collection('pages').find({ id: { $in: [r.before.id, ...r.pageIds] } }, { projection: { _id: 0, id: 1, page_number: 1, 'translation.data': 1 } }).toArray();
    if (docs.length !== r.block.length + 1 || !docs.every(d => sha(d.translation?.data || '') === r.hashes[d.page_number])) { stale.push(r.id); continue; }
    r.block.forEach((n, i) => {
      const id = r.pageIds[i];
      if (fs.existsSync(path.join(dir, `${id}.meta.json`))) return;
      fs.writeFileSync(path.join(dir, `${id}.txt`), r.stored[n]);
      fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify({ exit: 0, page_id: id, book_id: r.book.id, page_number: n, call_id: `stored:${r.id}`, call_pages: r.block.length, model: ROUTE_MODEL, source: 'stored translation (v3#104: no translation call)' }));
    });
  }
  fs.writeFileSync(path.join(out, 'stale.json'), JSON.stringify(stale));
  console.log(`${ctx.length - stale.length} blocks laid out, ${stale.length} stale; seam pass model ${SEAM_PASS_MODEL}, edit-before on`);
  const t = await seamStage(db, dir, { editBefore: true });
  await c.close();
  console.log(JSON.stringify(t));
  if (t.stopped) process.exit(3);
}

// ── versions of every join ───────────────────────────────────────────────────
const readTxt = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
export const ARMS = ['A', 'S', 'L'];   // stored; seam pass, edit-before on; seam pass with the page before locked
/** The pass's row for a block (the turn into it), or null when the stage has not passed it. */
export function passRows(out) { return new Map(readJsonl(path.join(readsDir(out), 'seam-pass.jsonl')).filter(j => !j.run_done).map(j => [`${j.left}|${j.right}`, j])); }
/** A page's English under an arm. */
export function textOf(out, r, arm, n, sp) {
  const stored = n === r.before.n ? r.before.tr.trim() : r.stored[n].trim();
  if (arm === 'A') return stored;
  const id = n === r.before.n ? r.before.id : r.pageIds[r.block.indexOf(n)];
  if (arm === 'S') return readTxt(path.join(readsDir(out), 'seam', `${id}.txt`)) ?? stored;
  // L: the page before stays as stored; the block's first page is what the pass would leave with that page locked
  if (n !== r.block[0]) return stored;
  const j = sp.get(`${r.before.id}|${r.pageIds[0]}`);
  return j?.changed && j.locked?.changed ? readTxt(path.join(readsDir(out), 'seam-locked', `${id}.txt`)) ?? stored : stored;
}
const enTail = (t) => tail(translationProse(t));
const enHead = (t) => head(translationProse(t));
export function joinVersions(out, ctx, sentences) {
  const sp = passRows(out), stale = new Set(JSON.parse(readTxt(path.join(out, 'stale.json')) || '[]'));
  const J = {};
  ctx.forEach((r, k) => {
    if (stale.has(r.id) || !sp.get(`${r.before.id}|${r.pageIds[0]}`)?.ok) return;   // not passed (stale, or the stage call failed): out of every arm
    for (const j of joinsOf(r)) {
      const ver = (arm) => ({ tailA: enTail(textOf(out, r, arm, j.left, sp)), headB: enHead(textOf(out, r, arm, j.right, sp)) });
      const same = (x, y) => x.tailA === y.tailA && x.headB === y.headB;
      const versions = { A: ver('A') };
      const s = ver('S'), l = ver('L');
      if (!same(s, versions.A)) versions.S = s;
      if (!same(l, versions.A) && !same(l, s)) versions.L = l;
      versions.Acopy = versions.A;
      const p = plant(versions.A.tailA, versions.A.headB, k + (j.join === 'S' ? 1 : 0), sentences);
      if (p) versions.PL = { tailA: p.tailA, headB: p.headB, plant: p.plant };
      // which verdict an arm takes where it has no version of its own
      const from = { A: 'A', S: versions.S ? 'S' : 'A', L: versions.L ? 'L' : same(l, s) && versions.S ? 'S' : 'A' };
      J[`${r.id}:${j.join}`] = { r, j, versions, from, srcTailA: tail(sourceProse(r.ocr[j.left])), srcHeadB: head(sourceProse(r.ocr[j.right])) };
    }
  });
  return J;
}

async function judge(out, conc) {
  const { JUDGE_PROMPT } = await import('./ab.mjs');
  const { LABELS } = await import('../seams-6742/opus-reference.mjs');
  const { claudeCall, extractJson, pool, sentences } = await import('../seams-6742/lib.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const J = joinVersions(out, ctx, sentences);
  const file = path.join(out, 'judge.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.parsed).map(j => `${j.id}:${j.order}`));
  const rand = makeRng(SEED * 100 + 1);
  const todo = [];
  for (const [id, x] of Object.entries(J)) {
    const arms = shuffle(Object.keys(x.versions), rand);
    for (const [order, list] of [[1, arms], [2, [...arms].reverse()]]) if (!done.has(`${id}:${order}`)) todo.push({ id, x, order, arms: list });
  }
  console.log(`${Object.keys(J).length} joins; ${todo.length} judge calls`);
  const res = await pool(todo, conc, async ({ id, x, order, arms }) => {
    const text = `${JUDGE_PROMPT}\n\n=== SOURCE N (end) ===\n${x.srcTailA}\n\n=== SOURCE N+1 (start) ===\n${x.srcHeadB}\n\n` +
      arms.map((a, i) => `##### VERSION V${i + 1}\n--- ENGLISH N (end) ---\n${x.versions[a].tailA}\n--- ENGLISH N+1 (start) ---\n${x.versions[a].headB}`).join('\n\n') + '\n';
    const r = await claudeCall(text, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(o => [String(o?.version), o]));
    const verdicts = Object.fromEntries(arms.map((a, i) => { const o = by.get(`V${i + 1}`); return [a, o && LABELS.includes(o.label) ? { label: o.label, labels: Array.isArray(o.labels) ? o.labels : [o.label], severity: o.severity, evidence: o.evidence } : null]; }));
    const parsed = Object.values(verdicts).every(Boolean);
    fs.appendFileSync(file, JSON.stringify({ id, order, arms, parsed, verdicts, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: r.usage, raw: parsed ? undefined : String(r.text).slice(0, 1500), at: new Date().toISOString() }) + '\n');
    return { ok: parsed, cls: r.cls };
  }, { maxWaitH: 0 });   // a usage limit stops the run (brief: no call after a limit until the reset); re-run to resume
  console.log(JSON.stringify(res));
  if (res.stop) process.exit(3);
}

// ── page-judge packet: every page the pass changed, as stored (A) and as passed (S) ──────────────────────────────
async function packet(out) {
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const sp = passRows(out);
  const dir = path.join(out, 'pages'); fs.mkdirSync(dir, { recursive: true });
  const changed = [];   // { r, n, id }
  for (const r of ctx) {
    const j = sp.get(`${r.before.id}|${r.pageIds[0]}`);
    if (!j?.changed) continue;
    for (const [n, id] of [[r.before.n, r.before.id], [r.block[0], r.pageIds[0]]]) if (textOf(out, r, 'S', n, sp) !== textOf(out, r, 'A', n, sp)) changed.push({ r, n, id });
  }
  const c = await mongo(); const db = c.db('bookstore');
  const docs = new Map((await db.collection('pages').find({ id: { $in: changed.map(x => x.id) } }, { projection: { translation: 0 } }).toArray()).map(p => [p.id, p]));
  await c.close();
  const hid = (s) => crypto.createHash('sha1').update(`104:${s}`).digest('hex').slice(0, 12);
  const items = [], key = [];
  const add = (x, arm, kind, shown = x, k = 0) => {
    const page = docs.get(shown.id), iid = hid(`${x.id}:${arm}:${kind}:${k}`);
    items.push({ id: iid, task: 'translation', lang: shown.r.book.language, image_url: getPageSource(page), text: textOf(out, x.r, arm, x.n, sp), source: page.ocr?.data ?? '' });
    key.push({ id: iid, judged_as: iid, cell: x.r.cell, route: arm, kind, page_id: x.id, book_id: x.r.book.id, shown_page_id: shown.id, row: x.r.id, side: x.n === x.r.before.n ? 'before' : 'first' });
  };
  for (const x of changed) for (const arm of ['A', 'S']) add(x, arm, 'item');
  // controls, per cell: each arm's text under another book's leaf (3), and A's own text judged twice (3)
  for (const cell of Object.keys(CELLS)) {
    const xs = changed.filter(x => x.r.cell === cell);
    for (const arm of ['A', 'S']) for (let k = 0; k < Math.min(3, xs.length); k++) { const x = xs[(k * 7 + (arm === 'S' ? 3 : 0)) % xs.length]; const o = xs.find(y => y.r.book.id !== x.r.book.id && xs.indexOf(y) > (xs.indexOf(x) + 1) % xs.length) || xs.find(y => y.r.book.id !== x.r.book.id); if (o) add(x, arm, 'wrong_page', o, k); }
    for (let k = 0; k < Math.min(3, xs.length); k++) add(xs[(k * 5 + 1) % xs.length], 'A', 'repeat', xs[(k * 5 + 1) % xs.length], k);
  }
  const order = shuffle(items.map((_, i) => i), makeRng(SEED * 100 + 2));
  fs.writeFileSync(path.join(dir, 'packet.json'), JSON.stringify({ items: order.map(i => items[i]) }, null, 1));
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 1));
  if (!fs.existsSync(path.join(dir, 'recipe.json'))) fs.writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify({
    question: 'prompt', issue: 104, stage: 'translation', languages: ['fr', 'it'], baseline: 'A', arms: ['A', 'S'],
    batch: { pages_per_call: 1, tested: null }, noise_floor: { repeat_kind: 'repeat', from: null }, feeds: 'route', router_evidence: Object.keys(CELLS),
    waive: { R1: 'the brief asks for every page the pass changed, so a book can have up to four pages (two blocks, the page before and the first page of each); the score reports by-book counts beside the page counts' } }, null, 1));
  console.log(`${changed.length} changed pages in ${new Set(changed.map(x => x.r.book.id)).size} books; ${items.length} items (${JSON.stringify(key.reduce((a, k) => { a[`${k.route}:${k.kind}`] = (a[`${k.route}:${k.kind}`] || 0) + 1; return a; }, {}))})`);
}

// ── score ────────────────────────────────────────────────────────────────────
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
function wilson(k, n, z = 1.96) { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - h) / d).toFixed(1), +(100 * (c + h) / d).toFixed(1)]; }
/** The registered rule's numbers (posted on v3#104 before any model call). */
export const RULE = { signAlpha: 0.05, pageNoisePages: 2, floorCopyAgree: 0.95, floorPlants: 0.80, minBooksBetter: 3 };

async function score(out) {
  const { signP } = await import('./ab.mjs');
  const { sentences } = await import('../seams-6742/lib.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const sp = passRows(out);
  const J = joinVersions(out, ctx, sentences);
  const jj = readJsonl(path.join(out, 'judge.jsonl')).filter(j => j.parsed);
  const byId = {}; for (const j of jj) (byId[j.id] ||= {})[j.order] = j;
  const res = {};
  for (const [jid, x] of Object.entries(J)) {
    const o = byId[jid]; if (!o?.[1] || !o?.[2]) continue;
    const r = {};
    for (const a of [...ARMS, 'Acopy', 'PL']) {
      const src = x.from[a] ?? a;
      const p = o[1].verdicts[src], q = o[2].verdicts[src];
      if (!p || !q) { r[a] = null; continue; }
      const def = p.label !== 'ok' && q.label !== 'ok';
      r[a] = { def, major: def && p.severity === 'major' && q.severity === 'major', labels: def ? p.labels.filter(l => q.labels.includes(l) && l !== 'ok') : [], own: !!x.versions[a], evidence: [p.evidence, q.evidence] };
    }
    ((res[x.r.id] ||= {})[x.j.join] = r);
  }
  const scored = ctx.filter(r => res[r.id]?.T && res[r.id]?.S && ARMS.every(a => res[r.id].T[a] && res[r.id].S[a]));
  const lane = (a, set) => (set.length ? 100 * (LANE_W.T * set.filter(r => res[r.id].T[a].def).length + LANE_W.S * set.filter(r => res[r.id].S[a].def).length) / set.length : null);
  const rateOf = (a, join, set) => (set.length ? 100 * set.filter(r => res[r.id][join][a].def).length / set.length : null);
  const q = (xs, p0) => { const t = [...xs].sort((x, y) => x - y); return +t[Math.floor(p0 * (t.length - 1))].toFixed(1); };
  // leaks: a 200+ character run shared by two consecutive pages' English that their sources do not share
  const grams = (t) => { const w = foldOcrWords(t), g = new Set(); for (let i = 0; i + 4 <= w.length; i++) g.add(w.slice(i, i + 4).join(' ')); return g; };
  const leaksOf = (arm, set) => {
    const flags = [];
    for (const r of set) { const seq = [r.before.n, ...r.block];
      for (let i = 0; i + 1 < seq.length; i++) {
        const run = sharedRun(normTr(textOf(out, r, arm, seq[i + 1], sp)), normTr(textOf(out, r, arm, seq[i], sp)));
        if (run.len < LEAK_MIN_CHARS) continue;
        const a = grams(r.ocr[seq[i]]), b = grams(r.ocr[seq[i + 1]]); let sh = 0; for (const g of b) if (a.has(g)) sh++;
        flags.push({ row: r.id, prev: seq[i], next: seq[i + 1], len: run.len, text: run.text.slice(0, 200), class: sh >= 10 && sh >= 0.1 * Math.min(a.size, b.size) ? 'source' : 'translation' });
      } }
    return flags;
  };
  // page judge
  const pdir = path.join(out, 'pages');
  const K = fs.existsSync(path.join(pdir, 'key.json')) ? JSON.parse(fs.readFileSync(path.join(pdir, 'key.json'), 'utf8')) : [];
  const V = new Map(readJsonl(path.join(pdir, 'verdicts-opus.jsonl')).filter(x => x.verdict).map(x => [x.id, x.verdict]));
  const hard = (v) => (v.defects || []).some(d => d.severity === 'wrong_text');
  const pagesOf = (cells) => {
    const items = K.filter(k => k.kind === 'item' && cells.includes(k.cell));
    const pids = [...new Set(items.map(k => k.page_id))].filter(pid => ['A', 'S'].every(a => { const k = items.find(x => x.page_id === pid && x.route === a); return k && V.has(k.id); }));
    const v = (pid, a) => V.get(items.find(x => x.page_id === pid && x.route === a).id);
    const acc = (a) => pids.filter(pid => v(pid, a).accept).length;
    const ctl = (kind) => K.filter(k => k.kind === kind && cells.includes(k.cell) && V.has(k.id));
    const twin = (k) => items.find(x => x.page_id === k.page_id && x.route === k.route);
    return { changedPages: [...new Set(items.map(k => k.page_id))].length, judgedBothArms: pids.length, books: new Set(items.filter(k => pids.includes(k.page_id)).map(k => k.book_id)).size,
      accept: { A: acc('A'), S: acc('S') }, gained: pids.filter(pid => v(pid, 'S').accept && !v(pid, 'A').accept).length, lost: pids.filter(pid => !v(pid, 'S').accept && v(pid, 'A').accept).length,
      wrongText: { A: pids.filter(pid => hard(v(pid, 'A'))).length, S: pids.filter(pid => hard(v(pid, 'S'))).length, newInS: pids.filter(pid => hard(v(pid, 'S')) && !hard(v(pid, 'A'))).length },
      meanFidelity: Object.fromEntries(['A', 'S'].map(a => [a, pids.length ? +(pids.reduce((s, pid) => s + Number(v(pid, a).fidelity), 0) / pids.length).toFixed(2) : null])),
      wrongPage: { accepted: ctl('wrong_page').filter(k => V.get(k.id).accept).length, n: ctl('wrong_page').length }, repeats: { flips: ctl('repeat').filter(k => twin(k) && V.has(twin(k).id) && V.get(twin(k).id).accept !== V.get(k.id).accept).length, n: ctl('repeat').length } };
  };
  const block = (set, cells) => {
    const tab = (join) => Object.fromEntries(ARMS.map(a => { const k = set.filter(r => res[r.id][join][a].def).length; return [a, { defects: k, n: set.length, def100: pct(k, set.length), ci: wilson(k, set.length), majors: set.filter(r => res[r.id][join][a].major).length, ownVersion: set.filter(r => res[r.id][join][a].own).length }]; }));
    const pair = (x, join) => { const better = set.filter(r => res[r.id][join].A.def && !res[r.id][join][x].def).length, worse = set.filter(r => res[r.id][join][x].def && !res[r.id][join].A.def).length; return { better, worse, p: signP(better, worse), booksBetter: new Set(set.filter(r => res[r.id][join].A.def && !res[r.id][join][x].def).map(r => r.book.id)).size }; };
    const rand = makeRng(SEED * 100 + 3), dS = [], dLane = [], bl = Object.fromEntries(ARMS.map(a => [a, []]));
    for (let b = 0; b < 2000 && set.length; b++) { const s0 = set.map(() => set[Math.floor(rand() * set.length)]); dS.push(rateOf('S', 'S', s0) - rateOf('A', 'S', s0)); dLane.push(lane('S', s0) - lane('A', s0)); for (const a of ARMS) bl[a].push(lane(a, s0)); }
    const allJ = set.flatMap(r => ['T', 'S'].map(j => res[r.id][j]));
    const passes = set.map(r => sp.get(`${r.before.id}|${r.pageIds[0]}`)).filter(Boolean);
    const count = (f) => passes.reduce((a, x) => { const k0 = f(x); a[k0] = (a[k0] || 0) + 1; return a; }, {});
    const lA = leaksOf('A', set), lS = leaksOf('S', set), keyOf = (f) => `${f.row}|${f.prev}`;
    const out_ = { n: set.length, books: new Set(set.map(r => r.book.id)).size, S: tab('S'), T: tab('T'),
      lane: Object.fromEntries(ARMS.map(a => [a, { def100: set.length ? +lane(a, set).toFixed(1) : null, ci: set.length ? [q(bl[a], 0.025), q(bl[a], 0.975)] : null }])),
      SvsA: { S: { ...pair('S', 'S'), delta100: set.length ? +(rateOf('S', 'S', set) - rateOf('A', 'S', set)).toFixed(1) : null, ci: set.length ? [q(dS, 0.025), q(dS, 0.975)] : null }, T: pair('S', 'T'), lane: { delta100: set.length ? +(lane('S', set) - lane('A', set)).toFixed(1) : null, ci: set.length ? [q(dLane, 0.025), q(dLane, 0.975)] : null } },
      LvsA: { S: pair('L', 'S') },
      midflowS: { n: set.filter(r => r.midflow.S).length, A: set.filter(r => r.midflow.S && res[r.id].S.A.def).length, S: set.filter(r => r.midflow.S && res[r.id].S.S.def).length },
      judgeFloor: { agree: allJ.filter(x => x.Acopy && x.Acopy.def === x.A.def).length, n: allJ.filter(x => x.Acopy).length }, plants: { caught: allJ.filter(x => x.PL?.def).length, n: allJ.filter(x => x.PL).length },
      stage: { turns: passes.length, labels: count(x => x.label || `unparsed:${x.cls}`), changed: passes.filter(x => x.changed).length, beforePageEdited: passes.filter(x => x.changed && x.left_changed).length, firstPageEdited: passes.filter(x => x.changed && x.right_changed).length, refused: count(x => x.refused || 'none'), lockedChanged: passes.filter(x => x.locked?.changed).length },
      leaks: { pairs: set.reduce((s0, r) => s0 + r.block.length, 0), A: { flags: lA.length, translation: lA.filter(f => f.class === 'translation').length }, S: { flags: lS.length, translation: lS.filter(f => f.class === 'translation').length }, newInS: lS.filter(f => f.class === 'translation' && !lA.some(g => keyOf(g) === keyOf(f))) },
      pages: K.length ? pagesOf(cells) : null };
    // the registered rule (v3#104 pre-registration; the v2#8399 clauses, per language)
    const s = out_.SvsA.S, pg = out_.pages;
    const controls = { copy: out_.judgeFloor.n ? out_.judgeFloor.agree / out_.judgeFloor.n >= RULE.floorCopyAgree : null, plants: out_.plants.n ? out_.plants.caught / out_.plants.n >= RULE.floorPlants : null, wrongPage: pg ? pg.wrongPage.n > 0 && pg.wrongPage.accepted === 0 : null };
    const seamBetter = s.delta100 != null && s.delta100 < -SWING_8399.S && out_.lane.S.def100 <= out_.lane.A.def100;
    const seamDecided = s.p < RULE.signAlpha && s.booksBetter >= RULE.minBooksBetter;
    const noise = pg ? Math.max(RULE.pageNoisePages, pg.repeats.flips) : null;
    const clauses = { seam: seamBetter && seamDecided, leaks: out_.leaks.newInS.length === 0, usable: pg ? pg.accept.S >= pg.accept.A - noise && pg.wrongText.newInS === 0 : null };
    const voided = Object.values(controls).some(x => x === false);
    out_.rule = { controls, voided, seamBetter, seamDecided, pageNoise: noise, clauses,
      verdict: voided ? 'void: a control failed' : Object.values(controls).some(x => x == null) || clauses.usable == null ? 'incomplete' : clauses.seam && clauses.leaks && clauses.usable ? 'pass' : seamBetter && !seamDecided && clauses.leaks && clauses.usable ? 'cannot decide' : 'fail' };
    return out_;
  };
  const rep = { issue: 104, at: new Date().toISOString(), build: JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')), stale: JSON.parse(readTxt(path.join(out, 'stale.json')) || '[]').length,
    n: { drawn: ctx.length, scored: scored.length, judgeCallsParsed: jj.length }, swingFloor8399: SWING_8399,
    byCell: Object.fromEntries(Object.keys(CELLS).map(cell => [cell, block(scored.filter(r => r.cell === cell), [cell])])),
    // the primary stratum alone (at most 2 blocks a book); the page-judge counts in it still cover the whole cell
    byCellPrimary: Object.fromEntries(Object.keys(CELLS).map(cell => [cell, block(scored.filter(r => r.cell === cell && r.primary), [cell])])), all: block(scored, Object.keys(CELLS)),
    claudeListUsd: +jj.reduce((s0, j) => s0 + (j.usage?.list_cost_usd || 0), 0).toFixed(2),
    perRow: Object.fromEntries(scored.map(r => [r.id, Object.fromEntries(['T', 'S'].map(j => [j, Object.fromEntries([...ARMS, 'PL'].map(a => [a, res[r.id][j][a] ? (res[r.id][j][a].def ? (res[r.id][j][a].major ? 'MAJOR' : 'minor') + ':' + res[r.id][j][a].labels.join('+') : 'ok') : '-']))]))])) };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  const { perRow, ...brief } = rep;
  console.log(JSON.stringify(brief, null, 1));
}

/**
 * Step 9 of the brief: write the sample's French joins the seam judge scored better (stored arm A broken, arm S sound,
 * the judge read T and S both orders) through the production door, scripts/lib/seam-pass.mjs applySeamPass (health,
 * neighbour gate, revision rows, manifest.jsonl for `seam-repair.mjs undo --out=<apply dir>`), under one run id of
 * its own. Only those joins: a changed join the judge did not score better is left as stored. Dry run without --apply.
 */
async function applyBetter(out, apply) {
  const { applySeamPass } = await import('../../lib/seam-pass.mjs');
  const rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  const cellOf = new Map(readJsonl(path.join(out, 'ctx.jsonl')).map(r => [r.id, r.cell]));
  const better = Object.keys(rep.perRow).filter(k => cellOf.get(k) === 'french-cli-agy4' && rep.perRow[k].S.A !== 'ok' && rep.perRow[k].S.S === 'ok');
  const rows = [...passRows(out).values()].filter(j => j.changed && !j.refused && better.includes(`${j.book_id}:${j.right_n}`));
  if (rows.length !== better.length) throw new Error(`${better.length} better joins but ${rows.length} pass rows match`);
  const runId = `seam-fr-it-104-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const dir = path.join(out, 'apply', runId); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'seam-pass.jsonl'), rows.map(j => JSON.stringify(j)).join('\n') + '\n');
  const c = await mongo();
  const t = await applySeamPass(c.db('bookstore'), dir, { apply, runId });
  await c.close();
  console.log(JSON.stringify({ ...t, joins: better, dir }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const go = { census: () => census(out), draw: () => draw(out, Number(arg('n', 72)), Number(arg('per-book', 2)), { fr: Number(arg('deep-fr', 0)), it: Number(arg('deep-it', 0)) }), stage: () => stage(out),
    judge: () => judge(out, Number(arg('conc', 3))), packet: () => packet(out), score: () => score(out), apply: () => applyBetter(out, process.argv.includes('--apply')) }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}

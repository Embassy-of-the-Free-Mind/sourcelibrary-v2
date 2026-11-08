#!/usr/bin/env node
// PRIOR ART: ./ab.mjs (#7118) — its judge prompt, six-version both-orders seam judge, sign test and source-edge
// windows are imported, not copied; it ran two-page marked blocks against one-page production reads, seeded by hand.
// This extends it to the per-call=4 rows (#8399): the reads come from the production reader itself
// (scripts/batch/claude-translate.mjs read --cli=agy --per-call=4, and the same reader with --folio-markers), so
// what is measured is the code that ships. The 63-seam set is #5103's (results/translation-batch-seam-fidelity-judge-key.json);
// the leak seams use scripts/audit/translation-page-boundaries.mjs sharedRun (the LEAK flag) unchanged; the seam pass of
// arm C is scripts/maintenance/seam-repair-6742/gemini-repair.mjs geminiPack + seam-repair.mjs edgeRefusal/mapOntoRaw;
// the per-page judge is scripts/eval/route-judge-6740/judge.mjs (its packet format, judged there).
/**
 * Four pages per call with folio markers and no previous-page English, against production per-call=4 (#8399).
 * Preregistered in ../PREREGISTRATION-seam-markers-8399.md. $0: agy (subscription, AGY_HOME=/root/.agy-james) +
 * claude CLI (subscription). Mongo reads only; no page is written (claude-translate.mjs read writes no page).
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/eval/seam-prevent-7118/blocks4-8399.mjs
 *   $N $S build     --out=DIR [--leak=30]
 *   $N $S translate --out=DIR --arm=A|A2|B
 *   $N $S seam      --out=DIR            arm C: B + one seam call per block-boundary join
 *   $N $S judge     --out=DIR [--conc=3] the #7118 seam judge, both orders, every arm + a copy of A
 *   $N $S leaks     --out=DIR            translation-page-boundaries LEAK on every consecutive pair of each arm
 *   $N $S packet    --out=DIR            per-page packet (one page per book per arm) for route-judge-6740/judge.mjs
 *   $N $S score     --out=DIR
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { MongoClient } from 'mongodb';
import { isTranslatablePage, isEnglishBook, sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { NON_PROSE_TYPES } from '../../lib/page-integrity.mjs';
import { NOT_HELD } from '../../lib/pipeline-hold.mjs';
import { planBlocks } from '../../lib/translate-batch-seam.mjs';
import { sharedRun, LEAK_MIN_CHARS } from '../../audit/translation-page-boundaries.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { shuffle } from '../seams-6742/lib.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
export const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
export const MODEL = 'gemini-3.8-flash-low';
export const READ_ARMS = ['A', 'A2', 'B'];
const LA_DE = /^(la|lat|latin|latina|de|deu|ger|german|deutsch)\b/i;
const EDGE = 1500;
export const tail = (t) => t.length > EDGE ? '…' + t.slice(-EDGE) : t;
export const head = (t) => t.length > EDGE ? t.slice(0, EDGE) + '…' : t;
/** The detector's own normalisation (translation-page-boundaries normTr). */
export const normTr = (t) => String(t || '')
  .replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ── build ────────────────────────────────────────────────────────────────────
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'translation.data': 1 };
const prose = (p) => p && isTranslatablePage(p).ok && !NON_PROSE_TYPES.has(p.page_type) && (p.ocr?.data || '').length >= 200;

/**
 * The 4-page block around a seam (N | N+1): [N-1, N, N+1, N+2] when all four are prose pages with OCR, else
 * [N, .., N+3] or [N-2, .., N+1]; the page before the block (its stored English is the block-start seed and the
 * left side of the boundary join) must have OCR and a stored translation. planBlocks (the reader's own cut) must keep
 * the four as one block. Returns null when no placement works.
 */
export function placeBlock(byN, N) {
  for (const start of [N - 1, N, N - 2]) {
    const nums = [start, start + 1, start + 2, start + 3];
    const pages = nums.map(n => byN.get(n));
    if (!pages.every(prose)) continue;
    const before = byN.get(start - 1);
    if (!before?.ocr?.data || !before?.translation?.data) continue;
    const cut = planBlocks(pages, { blockSize: 4 });
    if (cut.length !== 1) continue;
    return { block: nums, seamPos: N - start, before: start - 1 };
  }
  return null;
}

async function build(out, leakTarget) {
  fs.mkdirSync(out, { recursive: true });
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const bookProj = { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1, image_source: 1 };
  const loadBook = async (id) => {
    const pages = await db.collection('pages').find({ book_id: id }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
    return new Map(pages.map(p => [p.page_number, p]));
  };
  const rows = [], skipped = [];
  const push = (origin, book, byN, N, extra = {}) => {
    const pl = placeBlock(byN, N);
    if (!pl) { skipped.push({ origin, book: book.id, N, why: 'no 4-page prose block' }); return false; }
    const at = (n) => byN.get(n);
    rows.push({ id: `${book.id}:${N}`, origin, book, N, block: pl.block, seamPos: pl.seamPos, pageIds: pl.block.map(n => at(n).id),
      before: { n: pl.before, id: at(pl.before).id, ocr: at(pl.before).ocr.data, tr: at(pl.before).translation.data },
      ocr: Object.fromEntries([pl.before, ...pl.block, pl.block[3] + 1].filter(n => at(n)?.ocr?.data).map(n => [n, at(n).ocr.data])),
      stored: Object.fromEntries(pl.block.filter(n => at(n)?.translation?.data).map(n => [n, at(n).translation.data])),
      types: Object.fromEntries(pl.block.map(n => [n, at(n).page_type || null])), ...extra });
    return true;
  };
  // 1. #5103's 63 seams (seam_id is page N+1)
  const key = JSON.parse(fs.readFileSync(path.join(HERE, '../results/translation-batch-seam-fidelity-judge-key.json'), 'utf8')).key;
  const seamIds = [...new Set(key.map(k => k.seam_id))];
  const seamPages = await db.collection('pages').find({ id: { $in: seamIds } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1 } }).toArray();
  const books5103 = [...new Set(seamPages.map(p => p.book_id))];
  for (const bid of books5103) {
    const book = await db.collection('books').findOne({ id: bid }, { projection: bookProj });
    const byN = await loadBook(bid);
    for (const sp of seamPages.filter(p => p.book_id === bid).sort((a, b) => a.page_number - b.page_number)) push('5103', book, byN, sp.page_number - 1, { seamPageId: sp.id });
  }
  console.log(`5103: ${rows.length} of ${seamIds.length} seams placed (${seamPages.length} found)`);
  // 2. leak seams: the detector's LEAK on stored translations, la/de books, one per book, seeded order
  const frame = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 10 }, ...NOT_HELD }, { projection: bookProj }).toArray())
    .filter(b => b.id && LA_DE.test(String(b.language || '')) && !isEnglishBook(b) && !books5103.includes(b.id)).sort((a, b) => a.id < b.id ? -1 : 1);
  const order = shuffle(frame, makeRng(8399));
  const rand = makeRng(83990);
  let scanned = 0, pairs = 0, flagged = 0, leakRows = 0;
  for (const book of order) {
    if (leakRows >= leakTarget || scanned >= 2500) break;
    scanned++;
    const trs = await db.collection('pages').find({ book_id: book.id, 'translation.data': { $type: 'string', $ne: '' } }, { projection: { _id: 0, page_number: 1, page_type: 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
    const hits = [];
    for (let i = 0; i + 1 < trs.length; i++) {
      const A = trs[i], B = trs[i + 1];
      if (B.page_number !== A.page_number + 1) continue;
      pairs++;
      if (NON_PROSE_TYPES.has(A.page_type) || NON_PROSE_TYPES.has(B.page_type)) continue;
      const leak = sharedRun(normTr(B.translation.data), normTr(A.translation.data));
      if (leak.len >= LEAK_MIN_CHARS) hits.push({ N: A.page_number, len: leak.len, text: leak.text });
    }
    if (!hits.length) { if (scanned % 100 === 0) console.log(`${scanned} books, ${pairs} pairs, ${flagged} flags, ${leakRows} kept`); continue; }
    const byN = await loadBook(book.id);
    // the source must not repeat itself (the detector's sourceRepeats exclusion)
    const real = hits.filter(h => sharedRun(normTr(byN.get(h.N + 1)?.ocr?.data), normTr(byN.get(h.N)?.ocr?.data)).len < LEAK_MIN_CHARS);
    flagged += real.length;
    for (const h of shuffle(real, rand)) { if (push('leak', book, byN, h.N, { leak: { len: h.len, text: h.text } })) { leakRows++; break; } }
  }
  await c.close();
  fs.writeFileSync(path.join(out, 'ctx.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const summary = { at: new Date().toISOString(), seams5103: rows.filter(r => r.origin === '5103').length, leak: leakRows, leakFrameBooks: frame.length, leakScannedBooks: scanned, leakPairs: pairs, leakFlags: flagged,
    books: new Set(rows.map(r => r.book.id)).size, languages: rows.reduce((a, r) => { a[r.book.language] = (a[r.book.language] || 0) + 1; return a; }, {}), seamPos: rows.reduce((a, r) => { a[r.seamPos] = (a[r.seamPos] || 0) + 1; return a; }, {}), skipped };
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, skipped: skipped.length }));
}

// ── translate: the production reader, in waves ───────────────────────────────
/** Waves of rows such that no two blocks of one book in a wave touch (a gap of at least one page), so every block is
 *  its own run in claude-translate.mjs and is seeded from the STORED English of the page before it, as a lane block is. */
export function waves(rows) {
  const out = [];
  for (const r of [...rows].sort((a, b) => a.book.id < b.book.id ? -1 : a.book.id > b.book.id ? 1 : a.block[0] - b.block[0])) {
    let w = out.find(ws => ws.every(x => x.book.id !== r.book.id || x.block[3] + 1 < r.block[0] || r.block[3] + 1 < x.block[0]));
    if (!w) out.push(w = []);
    w.push(r);
  }
  return out;
}
export const readsDir = (out, arm, k) => path.join(out, 'reads', arm, `w${k}`);

function translate(out, arm) {
  if (!READ_ARMS.includes(arm)) throw new Error(`--arm must be one of ${READ_ARMS}`);
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const ws = waves(ctx);
  console.log(`${ctx.length} blocks in ${ws.length} waves; arm ${arm}`);
  for (const [k, w] of ws.entries()) {
    const dir = readsDir(out, arm, k);
    fs.mkdirSync(dir, { recursive: true });
    const ids = w.flatMap(r => r.pageIds);
    fs.writeFileSync(path.join(dir, 'ids.json'), JSON.stringify(ids));
    const args = [`--env-file=/root/sourcelibrary/.env.production.local`, path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', `--page-ids-file=${path.join(dir, 'ids.json')}`, `--out=${dir}`,
      '--cli=agy', '--per-call=4', '--fresh', `--job=seam-markers-8399-${arm}`, '--ocr-checked=eval #8399: every arm reads the same stored OCR; the test is of the translation call, not the OCR',
      ...(arm === 'B' ? ['--folio-markers=1'] : [])];
    const r = spawnSync('node', args, { stdio: 'inherit', env: { ...process.env, CANDIDATE_READS: 'off', AGY_HOME: process.env.AGY_HOME || '/root/.agy-james' } });
    if (r.status === 3) { console.error(`wave ${k}: usage limit; re-run to resume`); process.exit(3); }
    if (r.status) console.error(`wave ${k}: exit ${r.status}`);
  }
}

/** { [rowId]: { [arm]: { [page_number]: text } } } for the read arms; a page with no usable read is absent. */
export function armTexts(out, ctx) {
  const ws = waves(ctx), v = {};
  for (const arm of READ_ARMS) for (const [k, w] of ws.entries()) {
    const dir = readsDir(out, arm, k);
    for (const r of w) {
      const slot = ((v[r.id] ||= {})[arm] = {});
      r.block.forEach((n, i) => {
        const id = r.pageIds[i];
        try {
          const m = JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), 'utf8'));
          const t = fs.readFileSync(path.join(dir, `${id}.txt`), 'utf8').trim();
          if (m.exit === 0 && t.length > 5) slot[n] = { text: t, call_pages: m.call_pages, folio: !!m.folio_block, attempts: m.attempts };
        } catch { /* no read */ }
      });
    }
  }
  return v;
}

// ── seam pass (arm C) ────────────────────────────────────────────────────────
const enTail = (t) => tail(translationProse(t));
const enHead = (t) => head(translationProse(t));
export const joinsOf = (r) => [
  { join: 'T', left: r.block[r.seamPos], right: r.block[r.seamPos + 1] },
  { join: 'S', left: r.before.n, right: r.block[0] },
];

async function seam(out) {
  const { geminiPack } = await import('../../maintenance/seam-repair-6742/gemini-repair.mjs');
  const { edgeRefusal, mapOntoRaw } = await import('../../maintenance/seam-repair-6742/seam-repair.mjs');
  const { pool } = await import('../seams-6742/lib.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const v = armTexts(out, ctx);
  const file = path.join(out, 'seam-c.jsonl');
  const done = new Set(readJsonl(file).filter(x => x.ok).map(x => x.id));
  process.env.AGY_HOME ||= '/root/.agy-james';
  const todo = ctx.filter(r => !done.has(r.id) && v[r.id].B[r.block[0]]);
  console.log(`${todo.length} boundary joins to pass`);
  const res = await pool(todo, 3, async (r) => {
    const rawL = r.before.tr, rawR = v[r.id].B[r.block[0]].text;
    const it = { id: r.id, srcTailA: tail(sourceProse(r.before.ocr)), srcHeadB: head(sourceProse(r.ocr[r.block[0]])), enTailA: enTail(rawL), enHeadB: enHead(rawR) };
    const { byId, r: call } = await geminiPack([it], MODEL);
    if (call.cls === 'quota') return { cls: 'usage_limit' };
    const got = byId.get(r.id);
    let left = rawL, right = rawR, refused = null;
    const rep = got?.repair || null;
    if (got && got.label !== 'ok' && rep) {
      refused = edgeRefusal(it, rep);
      if (!refused) {
        const L = rep.tail_old ? mapOntoRaw(rawL, 'tail', rep.tail_old, rep.tail_new ?? '') : { text: rawL };
        const R = rep.head_old ? mapOntoRaw(rawR, 'head', rep.head_old, rep.head_new ?? '') : { text: rawR };
        if (L.refuse || R.refuse) refused = L.refuse || R.refuse; else { left = L.text; right = R.text; }
      }
    }
    fs.appendFileSync(file, JSON.stringify({ id: r.id, ok: !!got, label: got?.label ?? null, severity: got?.severity ?? null, repair: rep, refused, changed: left !== rawL || right !== rawR, left, right, cls: call.cls || null, usage: call.usage ?? null, at: new Date().toISOString() }) + '\n');
    return { ok: !!got };
  });
  console.log(JSON.stringify(res));
}

// ── seam judge (the #7118 judge, imported) ───────────────────────────────────
export const JUDGED = ['A', 'A2', 'B', 'C', 'Acopy', 'P'];
/** A planted defect on A's join (#6742 opus-reference plants): its last sentence on page N dropped, or repeated at the head of N+1. */
export function plant(tailA, headB, k, sentences) {
  const ss = sentences(tailA); const last = ss[ss.length - 1] || '';
  if (!last || ss.length < 2) return null;
  return k % 2 === 0 ? { tailA: tailA.slice(0, tailA.lastIndexOf(last)).trimEnd(), headB, plant: 'drop' } : { tailA, headB: `${last} ${headB}`, plant: 'dup' };
}

/** Every join's versions, as the judge sees them: { [rowId:join]: { x, versions: { arm: {tailA, headB} } } }. */
export function joinVersions(out, ctx, sentences) {
  const v = armTexts(out, ctx);
  const c = new Map(readJsonl(path.join(out, 'seam-c.jsonl')).filter(x => x.ok).map(x => [x.id, x]));
  const outJ = {};
  ctx.forEach((r, k) => {
    for (const j of joinsOf(r)) {
      const side = (arm, n) => n === r.before.n ? r.before.tr : v[r.id][arm]?.[n]?.text;
      const versions = {};
      let complete = true;
      for (const arm of READ_ARMS) {
        const L = side(arm, j.left), R = side(arm, j.right);
        if (!L || !R) { complete = false; break; }
        versions[arm] = { tailA: enTail(L), headB: enHead(R) };
      }
      if (!complete) { outJ[`${r.id}:${j.join}`] = { r, j, incomplete: true }; continue; }
      // C is B with the boundary join passed; on the in-block join it IS B (the pass touches block boundaries only)
      if (j.join === 'S') { const s = c.get(r.id); if (s) versions.C = { tailA: enTail(s.left), headB: enHead(s.right) }; }
      versions.Acopy = versions.A;
      const p = plant(versions.A.tailA, versions.A.headB, k + (j.join === 'S' ? 1 : 0), sentences);
      if (p) versions.P = { tailA: p.tailA, headB: p.headB, plant: p.plant };
      outJ[`${r.id}:${j.join}`] = { r, j, versions, srcTailA: tail(sourceProse(r.ocr[j.left])), srcHeadB: head(sourceProse(r.ocr[j.right])) };
    }
  });
  return outJ;
}

async function judge(out, conc) {
  const { JUDGE_PROMPT } = await import('./ab.mjs');
  const { LABELS } = await import('../seams-6742/opus-reference.mjs');
  const { claudeCall, extractJson, pool, sentences } = await import('../seams-6742/lib.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const J = joinVersions(out, ctx, sentences);
  const file = path.join(out, 'judge.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.parsed).map(j => `${j.id}:${j.order}`));
  const rand = makeRng(83991);
  const todo = [];
  for (const [id, x] of Object.entries(J)) {
    if (x.incomplete) continue;
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
  });
  console.log(JSON.stringify(res));
}

// ── leaks: the detector's LEAK on each arm's consecutive pages ───────────────
export function leaks(out, { write = true } = {}) {
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const v = armTexts(out, ctx);
  const c = new Map(readJsonl(path.join(out, 'seam-c.jsonl')).filter(x => x.ok).map(x => [x.id, x]));
  const rep = {}, flags = [];
  for (const arm of [...READ_ARMS, 'C', 'stored']) {
    let pairs = 0, leak = 0, sourceRepeat = 0;
    for (const r of ctx) {
      const text = (n) => {
        if (n === r.before.n) return arm === 'C' && c.get(r.id) ? c.get(r.id).left : r.before.tr;
        if (arm === 'stored') return r.stored[n];
        if (arm === 'C') { if (n === r.block[0] && c.get(r.id)) return c.get(r.id).right; return v[r.id].B?.[n]?.text; }
        return v[r.id][arm]?.[n]?.text;
      };
      const seq = [r.before.n, ...r.block];
      for (let i = 0; i + 1 < seq.length; i++) {
        const L = text(seq[i]), R = text(seq[i + 1]);
        if (!L || !R) continue;
        pairs++;
        const run = sharedRun(normTr(R), normTr(L));
        if (run.len < LEAK_MIN_CHARS) continue;
        const src = sharedRun(normTr(r.ocr[seq[i + 1]]), normTr(r.ocr[seq[i]]));
        if (src.len >= LEAK_MIN_CHARS) { sourceRepeat++; continue; }
        leak++;
        flags.push({ arm, row: r.id, origin: r.origin, prev: seq[i], next: seq[i + 1], boundary: i === 0, len: run.len, text: run.text });
      }
    }
    rep[arm] = { pairs, leak, sourceRepeat };
  }
  if (write) { fs.writeFileSync(path.join(out, 'leaks.json'), JSON.stringify({ rep, flags }, null, 1)); console.log(JSON.stringify(rep)); }
  return { rep, flags };
}

// ── per-page packet for route-judge-6740/judge.mjs ───────────────────────────
export const CELL = (lang) => (/^(de|deu|ger|german|deutsch)/i.test(String(lang)) ? 'german-cli-agy4' : 'latin-cli-agy4');
async function packet(out) {
  const crypto = await import('crypto');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const v = armTexts(out, ctx);
  const dir = path.join(out, 'pages'); fs.mkdirSync(dir, { recursive: true });
  // one page per book: the left page of the target join of one seeded row per book, read by every arm
  const rand = makeRng(83992), byBook = new Map();
  for (const r of shuffle(ctx, rand)) if (!byBook.has(r.book.id) && READ_ARMS.every(a => v[r.id][a]?.[r.block[r.seamPos]])) byBook.set(r.book.id, r);
  const picks = [...byBook.values()];
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const docs = new Map((await db.collection('pages').find({ id: { $in: picks.map(r => r.pageIds[r.seamPos]) } }, { projection: { 'translation': 0 } }).toArray()).map(p => [p.id, p]));
  await c.close();
  const id = (s) => crypto.createHash('sha1').update(`8399:${s}`).digest('hex').slice(0, 12);
  const items = [], key = [], sample = [];
  const add = (r, arm, kind, shown = r, n = 0) => {
    const page = docs.get(shown.pageIds[shown.seamPos]);
    const iid = id(`${r.id}:${arm}:${kind}:${n}`);
    items.push({ id: iid, task: 'translation', lang: shown.book.language, image_url: getPageSource(page), text: v[r.id][arm][r.block[r.seamPos]].text, source: page.ocr?.data ?? '' });
    key.push({ id: iid, judged_as: iid, cell: CELL(r.book.language), route: arm, kind, page_id: r.pageIds[r.seamPos], book_id: r.book.id, shown_page_id: shown.pageIds[shown.seamPos] });
  };
  for (const r of picks) { sample.push({ book_id: r.book.id, page_id: r.pageIds[r.seamPos], row: r.id, cell: CELL(r.book.language) }); for (const arm of READ_ARMS) add(r, arm, 'item'); }
  // controls: per arm, 3 wrong-page items (the arm's text under another book's leaf); 6 repeats of A
  for (const arm of READ_ARMS) for (let k = 0; k < 3; k++) { const r = picks[(k * 7 + READ_ARMS.indexOf(arm)) % picks.length], o = picks[(k * 7 + READ_ARMS.indexOf(arm) + 1) % picks.length]; add(r, arm, 'wrong_page', o, k); }
  for (let k = 0; k < 6; k++) add(picks[(k * 5) % picks.length], 'A', 'repeat', picks[(k * 5) % picks.length], k);
  const order = shuffle(items.map((_, i) => i), makeRng(83993));
  fs.writeFileSync(path.join(dir, 'packet.json'), JSON.stringify({ items: order.map(i => items[i]) }, null, 1));
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 1));
  fs.writeFileSync(path.join(dir, 'sample.json'), JSON.stringify(sample, null, 1));
  if (!fs.existsSync(path.join(dir, 'recipe.json'))) fs.writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify({
    question: 'prompt', issue: 8399, stage: 'translation', languages: ['la', 'de'], baseline: 'A', arms: READ_ARMS,
    batch: { pages_per_call: 1, tested: null }, noise_floor: { repeat_kind: 'repeat', from: null }, feeds: 'route',
    router_evidence: ['latin-cli-agy4', 'german-cli-agy4'], waive: {} }, null, 1));
  console.log(`${picks.length} books; ${items.length} items (${key.filter(k => k.kind === 'item').length} item, ${key.filter(k => k.kind === 'wrong_page').length} wrong_page, ${key.filter(k => k.kind === 'repeat').length} repeat)`);
}

// ── score ────────────────────────────────────────────────────────────────────
const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
export const LANE_W = { T: 0.75, S: 0.25 };   // 3 of a block's 4 page turns are inside it
function wilson(k, n, z = 1.96) { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - h) / d).toFixed(1), +(100 * (c + h) / d).toFixed(1)]; }

async function score(out) {
  const { signP } = await import('./ab.mjs');
  const { sentences } = await import('../seams-6742/lib.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const J = joinVersions(out, ctx, sentences);
  const jj = readJsonl(path.join(out, 'judge.jsonl')).filter(j => j.parsed);
  const byId = {}; for (const j of jj) (byId[j.id] ||= {})[j.order] = j;
  const ARMS = ['A', 'A2', 'B', 'C'];
  const res = {};   // res[rowId][join][arm] = {def, major, labels}
  for (const [jid, x] of Object.entries(J)) {
    const o = byId[jid]; if (x.incomplete || !o?.[1] || !o?.[2]) continue;
    const r = {};
    for (const a of [...ARMS, 'Acopy', 'P']) {
      const src = a === 'C' && !x.versions.C ? 'B' : a;
      const p = o[1].verdicts[src], q = o[2].verdicts[src];
      if (!p || !q) { r[a] = null; continue; }
      const def = p.label !== 'ok' && q.label !== 'ok';
      r[a] = { def, major: def && p.severity === 'major' && q.severity === 'major', labels: def ? p.labels.filter(l => q.labels.includes(l) && l !== 'ok') : [], evidence: [p.evidence, q.evidence] };
    }
    ((res[x.r.id] ||= {})[x.j.join] = r);
  }
  const rows = ctx.filter(r => res[r.id]?.T && res[r.id]?.S && ARMS.every(a => res[r.id].T[a] && res[r.id].S[a]));
  const rep = { build: JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')), model: MODEL, prereg: 'scripts/eval/PREREGISTRATION-seam-markers-8399.md', n: { rows: rows.length, judgeCallsParsed: jj.length } };
  const tab = (join, set = rows) => Object.fromEntries(ARMS.map(a => { const k = set.filter(r => res[r.id][join][a].def).length, m = set.filter(r => res[r.id][join][a].major).length;
    return [a, { def100: pct(k, set.length), ci: wilson(k, set.length), defects: k, majors: m, labels: Object.fromEntries(['omission', 'duplication', 'drift', 'broken_syntax', 'catchword', 'other'].map(l => [l, set.filter(r => res[r.id][join][a].labels.includes(l)).length])) }]; }));
  rep.T = tab('T'); rep.S = tab('S');
  rep.byOrigin = Object.fromEntries(['5103', 'leak'].map(o => { const set = rows.filter(r => r.origin === o); return [o, { n: set.length, T: tab('T', set), S: tab('S', set) }]; }));
  // lane-weighted seam-defect rate, with a by-row bootstrap interval (rows are the resampling unit: T and S of one block stay together)
  const lane = (a, set) => set.length ? 100 * (LANE_W.T * set.filter(r => res[r.id].T[a].def).length + LANE_W.S * set.filter(r => res[r.id].S[a].def).length) / set.length : null;
  const rand = makeRng(83994), B = 2000, boot = Object.fromEntries([...ARMS, 'Aavg'].map(a => [a, []])), diff = { B: [], C: [] };
  const Aavg = (set) => (lane('A', set) + lane('A2', set)) / 2;
  for (let b = 0; b < B; b++) {
    const s = rows.map(() => rows[Math.floor(rand() * rows.length)]);
    for (const a of ARMS) boot[a].push(lane(a, s)); boot.Aavg.push(Aavg(s));
    diff.B.push(lane('B', s) - Aavg(s)); diff.C.push(lane('C', s) - Aavg(s));
  }
  const q = (xs, p) => { const t = [...xs].sort((x, y) => x - y); return +t[Math.floor(p * (t.length - 1))].toFixed(1); };
  rep.lane = Object.fromEntries([...ARMS, 'Aavg'].map(a => [a, { def100: +(a === 'Aavg' ? Aavg(rows) : lane(a, rows)).toFixed(1), ci: [q(boot[a], 0.025), q(boot[a], 0.975)] }]));
  rep.laneDiffVsAavg = Object.fromEntries(['B', 'C'].map(a => [a, { delta100: +(lane(a, rows) - Aavg(rows)).toFixed(1), ci: [q(diff[a], 0.025), q(diff[a], 0.975)] }]));
  rep.swing = { T: +Math.abs(rep.T.A.def100 - rep.T.A2.def100).toFixed(1), S: +Math.abs(rep.S.A.def100 - rep.S.A2.def100).toFixed(1), lane: +Math.abs(rep.lane.A.def100 - rep.lane.A2.def100).toFixed(1) };
  const pair = (x, y, join) => { const better = rows.filter(r => res[r.id][join][y].def && !res[r.id][join][x].def).length, worse = rows.filter(r => res[r.id][join][x].def && !res[r.id][join][y].def).length; return { better, worse, p: signP(better, worse) }; };
  rep.paired = Object.fromEntries(['T', 'S'].map(j => [j, { A2vsA: pair('A2', 'A', j), BvsA: pair('B', 'A', j), BvsA2: pair('B', 'A2', j), CvsA: pair('C', 'A', j), CvsB: pair('C', 'B', j) }]));
  // instrument: the copy of A, and the planted defects
  const allJ = rows.flatMap(r => ['T', 'S'].map(j => res[r.id][j]));
  rep.judgeFloor = { agree: allJ.filter(x => x.Acopy && x.Acopy.def === x.A.def).length, n: allJ.filter(x => x.Acopy).length };
  rep.plants = { caught: allJ.filter(x => x.P?.def).length, n: allJ.filter(x => x.P).length };
  rep.plants.rate = pct(rep.plants.caught, rep.plants.n);
  // leaks
  rep.leaks = leaks(out, { write: true }).rep;
  // per-page usable (route-judge-6740/judge.mjs verdicts, scored by paired-arm.mjs into pages/paired-score.json)
  const ps = path.join(out, 'pages', 'paired-score.json');
  rep.pages = fs.existsSync(ps) ? JSON.parse(fs.readFileSync(ps, 'utf8')) : null;
  const acc = {};
  const vf = path.join(out, 'pages', 'verdicts-opus.jsonl');
  if (fs.existsSync(vf)) {
    const key = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'key.json'), 'utf8'));
    const ver = new Map(readJsonl(vf).filter(x => x.verdict).map(x => [x.id, x.verdict]));
    const items = key.filter(k => k.kind === 'item' && ver.has(k.id));
    const books = [...new Set(items.map(k => k.book_id))].filter(b => READ_ARMS.every(a => items.some(k => k.book_id === b && k.route === a)));
    for (const a of READ_ARMS) { const ks = items.filter(k => k.route === a && books.includes(k.book_id)); const k = ks.filter(x => ver.get(x.id).accept).length; acc[a] = { accept: k, n: ks.length, rate: pct(k, ks.length), ci: wilson(k, ks.length), meanFidelity: +(ks.reduce((s, x) => s + Number(ver.get(x.id).fidelity), 0) / Math.max(1, ks.length)).toFixed(2) }; }
    const ctl = (kind) => key.filter(k => k.kind === kind && ver.has(k.id));
    rep.pageControls = { wrongPageAccepted: ctl('wrong_page').filter(k => ver.get(k.id).accept).length, wrongPageN: ctl('wrong_page').length,
      repeatFlips: ctl('repeat').filter(k => { const twin = items.find(x => x.route === 'A' && x.page_id === k.page_id); return twin && ver.get(twin.id).accept !== ver.get(k.id).accept; }).length, repeatN: ctl('repeat').length };
  }
  rep.accept = acc;
  // the registered rule
  const A_ = rep.lane.Aavg.def100;
  const pageNoise = acc.A && acc.A2 ? Math.max(Math.abs(acc.A.rate - acc.A2.rate), 200 / Math.max(1, acc.A.n)) : null;
  const pageFloor = acc.A && acc.A2 ? (acc.A.rate + acc.A2.rate) / 2 - pageNoise : null;
  const rule = (a, usableArm = a === 'C' ? 'B' : a) => ({ seamAtOrBelowA: rep.lane[a].def100 <= A_, leaksZero: rep.leaks[a].leak === 0, usableNotLower: acc[usableArm] ? acc[usableArm].rate >= pageFloor : null,
    get passes() { return this.seamAtOrBelowA && this.leaksZero && this.usableNotLower === true; } });
  rep.rule = { Aavg: A_, pageNoise, pageFloor, B: rule('B'), C: rule('C') };
  rep.rule.B = { ...rep.rule.B, passes: rep.rule.B.passes }; rep.rule.C = { ...rep.rule.C, passes: rep.rule.C.passes };
  const cBetter = rep.rule.C.passes && rep.paired.S.CvsB.p < 0.10 && rep.S.B.def100 - rep.S.C.def100 > rep.swing.S;
  rep.verdict = rep.rule.B.passes ? (cBetter ? 'B replaces A on both rows; C beats B at block boundaries (follow-up: build the seam pass)' : 'B replaces A on both rows')
    : rep.rule.C.passes ? 'C passes and B does not: B alone does not ship; the seam pass is a follow-up' : 'A stays';
  rep.perRow = Object.fromEntries(rows.map(r => [r.id, Object.fromEntries(['T', 'S'].map(j => [j, Object.fromEntries([...ARMS, 'P'].map(a => [a, res[r.id][j][a] ? (res[r.id][j][a].def ? (res[r.id][j][a].major ? 'MAJOR' : 'minor') + ':' + res[r.id][j][a].labels.join('+') : 'ok') : '-']))]))]));
  rep.claudeListUsd = +jj.reduce((s, j) => s + (j.usage?.list_cost_usd || 0), 0).toFixed(2);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  const { perRow, ...brief } = rep;
  console.log(JSON.stringify(brief, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const go = { build: () => build(out, Number(arg('leak', 30))), translate: async () => translate(out, arg('arm')), seam: () => seam(out),
    judge: () => judge(out, Number(arg('conc', 3))), leaks: async () => leaks(out), packet: () => packet(out), score: async () => score(out) }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}

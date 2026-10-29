#!/usr/bin/env node
// PRIOR ART: seam-prompt-6742/ab.mjs (the production CLI request through gatedTextCall, seeded with the stored N−1
// translation, N+1 seeded with the arm's own N; agyOpen pause; the pool) is followed call for call for arms A, A2, C;
// seam-markers-confirm-5678.mjs ran folio markers on the paid Batch lane, never through agy; seams-6742/opus-reference.mjs
// supplies the label set and its definitions, sliced from its PROMPT so they cannot drift. New here: the block arms
// (M, MC) on the CLI lane, a frame with a catchword stratum, and a six-version judge call per break (all arms side by
// side plus an identical copy of A), both orders.
/**
 * Folio markers and a catchword label on 3.8 Flash (#7118). Preregistered in ../PREREGISTRATION-seam-prevent-7118.md.
 * $0: agy (subscription) + claude CLI (subscription). Mongo reads only.
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/eval/seam-prevent-7118/ab.mjs
 *   $N $S build     --out=DIR [--n=120] [--cw=40]
 *   $N $S translate --out=DIR [--arms=A,A2,M,C,MC] [--conc=4]
 *   $N $S judge     --out=DIR [--conc=4]
 *   $N $S score     --out=DIR
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, buildBlockTranslationPrompt, loadTranslationPrompts, isTranslatablePage, isEnglishBook, sanitizeTranslationTags, contentHash } from '../../lib/translate-core.mjs';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { sourceProse, translationProse, continuationFragment } from '../../lib/block-drift.mjs';
import { dominantScript, NON_PROSE_TYPES, foldWord, parseCatchword } from '../../lib/page-integrity.mjs';
import { resolvePageBreak } from '../../lib/page-break-devices.mjs';
import { parseFolioMarkedText } from '../../lib/folio-markers.mjs';
import { NOT_HELD } from '../../lib/pipeline-hold.mjs';
import { PROMPT as REF_PROMPT, LABELS } from '../seams-6742/opus-reference.mjs';
import { bodyLines, sourceTail } from '../seams-6742/census.mjs';
import { claudeCall, extractJson, pool, shuffle } from '../seams-6742/lib.mjs';
import { agyOpen } from '../../maintenance/seam-repair-6742/gemini-repair.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { withCatchwordRule, catchwordsIn, withoutCatchwords } from './catchword-rule.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
export const MODEL = 'gemini-3.8-flash-low';
export const ARMS = ['A', 'A2', 'M', 'C', 'MC'];
const BLOCK_ARMS = new Set(['M', 'MC']);
const CW_ARMS = new Set(['C', 'MC']);
const EDGE = 1500;
const tail = (t) => t.length > EDGE ? '…' + t.slice(-EDGE) : t;
const head = (t) => t.length > EDGE ? t.slice(0, EDGE) + '…' : t;
const SRC_TERMINAL = /[.!?…:;](?:\s*[»”"'’)\]]+)?$/u;
const HYPHEN_END = /[-‐‑⸗=¬]$/u;

// ── build ────────────────────────────────────────────────────────────────────
/** A qualifying break: Latin-script prose, the source runs across the turn by both tests. */
export function qualifies(A, B) {
  if (!A || !B || !isTranslatablePage(A).ok || !isTranslatablePage(B).ok) return null;
  if (NON_PROSE_TYPES.has(A.page_type) || NON_PROSE_TYPES.has(B.page_type)) return null;
  const srcA = sourceTail(A.ocr.data, B.ocr.data), srcB = sourceProse(B.ocr.data);
  if (dominantScript(srcA + ' ' + srcB) !== 'latin') return null;
  const ls = bodyLines(srcA);
  const last = (ls[ls.length - 1] || '').trim().replace(/[*_`~\s]+$/u, '');
  if (!last || last.split(/\s+/).length < 3 && ls.length < 3) return null;
  const endOpen = HYPHEN_END.test(last) || !SRC_TERMINAL.test(last);
  if (!endOpen || !continuationFragment(B.ocr.data)) return null;
  const pb = resolvePageBreak(A.ocr.data, B.ocr.data);
  return { catchword: pb.catchword || null, kind: pb.kind || null };
}

async function build(out, n, cwTarget) {
  fs.mkdirSync(out, { recursive: true });
  const exclude = new Set(gz(path.join(HERE, '../results/seams-6742/key.jsonl.gz')).map(k => k.book));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 1 }, ...NOT_HELD },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, image_source: 1 } }).toArray())
    .filter(b => b.id && !exclude.has(b.id) && !isEnglishBook(b)).sort((a, b) => a.id < b.id ? -1 : 1);
  const order = shuffle(books, makeRng(7118));
  const rand = makeRng(71180);
  const rows = []; let scanned = 0, cw = 0, plain = 0;
  for (const book of order) {
    if (cw >= cwTarget && plain >= n - cwTarget) break;
    scanned++;
    const pages = await db.collection('pages').find({ book_id: book.id, 'translation.data': { $exists: true, $ne: '' } },
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.unreadable': 1 } }).sort({ page_number: 1 }).toArray();
    const byN = new Map(pages.map(p => [p.page_number, p]));
    const qs = [];
    for (const A of pages) { const B = byN.get(A.page_number + 1); const q = qualifies(A, B); if (q) qs.push({ A, B, ...q }); }
    if (!qs.length) continue;
    const withCw = qs.filter(q => q.catchword), noCw = qs.filter(q => !q.catchword);
    let pick = null;
    if (cw < cwTarget && withCw.length) pick = withCw[Math.floor(rand() * withCw.length)];
    else if (plain < n - cwTarget && noCw.length) pick = noCw[Math.floor(rand() * noCw.length)];
    if (!pick) continue;
    if (pick.catchword) cw++; else plain++;
    const p = pick.A.page_number;
    const around = await db.collection('pages').find({ book_id: book.id, page_number: { $in: [p - 1, p + 2] } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const at = (k) => around.find(x => x.page_number === k);
    rows.push({ id: `${book.id}:${p}`, stratum: pick.catchword ? 'catchword' : 'plain', catchword: pick.catchword, cwKind: pick.kind, book, p,
      idA: pick.A.id, idB: pick.B.id, ocrPrev: at(p - 1)?.ocr?.data || null, trPrev: at(p - 1)?.translation?.data || null,
      ocrA: pick.A.ocr.data, ocrB: pick.B.ocr.data, ocrNext2: at(p + 2)?.ocr?.data || null,
      srcTailA: tail(sourceProse(pick.A.ocr.data)), srcHeadB: head(sourceProse(pick.B.ocr.data)) });
    if (scanned % 25 === 0) console.log(`${scanned} books scanned: ${cw} catchword + ${plain} plain`);
  }
  await c.close();
  fs.writeFileSync(path.join(out, 'ctx.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const summary = { at: new Date().toISOString(), frameBooks: books.length, scanned, kept: rows.length, catchword: cw, plain,
    languages: rows.reduce((a, r) => { a[r.book.language] = (a[r.book.language] || 0) + 1; return a; }, {}) };
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));
}

// ── translate ────────────────────────────────────────────────────────────────
export function singlePrompt(base, x, arm, side, previousTranslation) {
  const built = buildTranslationPrompt({ prompts: base, book: x.book, ocrText: side === 'N' ? x.ocrA : x.ocrB, previousTranslation,
    prevOcrText: (side === 'N' ? x.ocrPrev : x.ocrA) || undefined, nextOcrText: (side === 'N' ? x.ocrB : x.ocrNext2) || undefined, pageBreak: PAGE_BREAK_SCOPED });
  return { ...built, prompt: CW_ARMS.has(arm) ? withCatchwordRule(built.prompt) : built.prompt };
}
export function blockPromptFor(base, x, arm) {
  const built = buildBlockTranslationPrompt({ prompts: base, book: x.book, pages: [{ page_number: x.p, ocr: x.ocrA }, { page_number: x.p + 1, ocr: x.ocrB }],
    previousTranslation: x.trPrev || undefined, prevOcrText: x.ocrPrev || undefined, nextOcrText: x.ocrNext2 || undefined, pageBreak: PAGE_BREAK_SCOPED, folioMarkers: true });
  return { ...built, prompt: CW_ARMS.has(arm) ? withCatchwordRule(built.prompt, { block: true }) : built.prompt };
}
/** The seed a page's English gives the next page: production's sanitize, the catchword label removed first. */
const seedOf = (text) => sanitizeTranslationTags(withoutCatchwords(text));

async function translate(out, arms, conc) {
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const base = await loadTranslationPrompts(c.db('bookstore'));
  await c.close();
  const file = path.join(out, 'reads.jsonl');
  const prior = readJsonl(file);
  const done = new Set(prior.filter(r => r.ok).map(r => `${r.id}:${r.arm}:${r.side}`));
  const tries = new Map(); for (const r of prior) { const k = `${r.id}:${r.arm}:${r.side}`; tries.set(k, (tries.get(k) || 0) + 1); }
  const readOf = new Map(prior.filter(r => r.ok).map(r => [`${r.id}:${r.arm}:${r.side}`, r.text]));
  const complete = (x, arm) => BLOCK_ARMS.has(arm) ? done.has(`${x.id}:${arm}:B`) : done.has(`${x.id}:${arm}:N`) && done.has(`${x.id}:${arm}:N1`);
  const tasks = ctx.flatMap(x => arms.map(arm => ({ x, arm }))).filter(({ x, arm }) => !complete(x, arm));
  console.log(`${ctx.length} breaks × ${arms.join(',')}: ${tasks.length} tasks; prompt ${JSON.stringify(base.translation.ref)}`);
  const one = async (x, arm, side, built) => {
    const k = `${x.id}:${arm}:${side}`;
    if (done.has(k)) return { ok: true, text: readOf.get(k) };
    if ((tries.get(k) || 0) >= 2) return { ok: false, gaveUp: true };
    if (!agyOpen(MODEL)) return { cls: 'usage_limit' };
    const sent = built.prompt + TRANSLATE_SUFFIX;
    const r = await gatedTextCall(sent, { model: MODEL, task: 'translate', tmp: process.env.TMPDIR });
    if (r.cls === 'quota') return { cls: 'usage_limit' };
    const text = r.cls ? '' : r.answer;
    let bad = r.cls || r.problem || (!text.trim() ? 'empty' : cliChatterReason(text));
    if (!bad && side === 'B') { const pr = parseFolioMarkedText(text, [x.p, x.p + 1]); if (pr.reading === 'rejected') bad = `parse-${pr.rejected}`; }
    tries.set(k, (tries.get(k) || 0) + 1);
    append(file, { id: x.id, arm, side, ok: !bad, why: bad || undefined, text, chars: text.length, secs: Math.round(r.secs), calls: r.calls, sent_hash: contentHash(sent), prompt: built.promptRef, at: new Date().toISOString() });
    if (!bad) { done.add(k); readOf.set(k, text); }
    return { ok: !bad, text };
  };
  const res = await pool(tasks, conc, async ({ x, arm }) => {
    if (BLOCK_ARMS.has(arm)) { const b = await one(x, arm, 'B', blockPromptFor(base, x, arm)); return b.cls ? b : { ok: b.ok || !!b.gaveUp }; }
    const a = await one(x, arm, 'N', singlePrompt(base, x, arm, 'N', x.trPrev || undefined));
    if (a.cls) return a;
    if (!a.ok) return { ok: !!a.gaveUp };
    const b = await one(x, arm, 'N1', singlePrompt(base, x, arm, 'N1', seedOf(a.text)));
    if (b.cls) return b;
    return { ok: b.ok || !!b.gaveUp };
  }, { probe: async () => ({ cls: agyOpen(MODEL) ? null : 'usage_limit' }), maxWaitH: 10 });
  console.log(JSON.stringify(res));
}

// ── per-arm page texts ───────────────────────────────────────────────────────
/** { [id]: { [arm]: { N, N1 } | { failed: why } } } — raw page English (catchword labels kept). */
export function pageTexts(out) {
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const reads = readJsonl(path.join(out, 'reads.jsonl'));
  const ok = new Map(reads.filter(r => r.ok).map(r => [`${r.id}:${r.arm}:${r.side}`, r.text]));
  const v = {};
  for (const x of ctx) for (const arm of ARMS) {
    const slot = ((v[x.id] ||= {})[arm] = {});
    if (BLOCK_ARMS.has(arm)) {
      const t = ok.get(`${x.id}:${arm}:B`);
      if (t == null) { const last = reads.filter(r => r.id === x.id && r.arm === arm).pop(); slot.failed = last ? (last.why || 'failed') : 'not-run'; continue; }
      const pr = parseFolioMarkedText(t, [x.p, x.p + 1]);
      const [a, b] = pr.pages;
      if (!a.span || !b.span || pr.overrun.length) { slot.failed = `parse-${pr.reading}${pr.missing.length ? '-missing' : ''}`; continue; }
      slot.N = a.span; slot.N1 = b.span; slot.reading = pr.reading;
    } else {
      const a = ok.get(`${x.id}:${arm}:N`), b = ok.get(`${x.id}:${arm}:N1`);
      if (a == null || b == null) { slot.failed = 'read-failed'; continue; }
      slot.N = a; slot.N1 = b;
    }
  }
  return { ctx, v };
}
const enTail = (t) => tail(translationProse(withoutCatchwords(t)));
const enHead = (t) => head(translationProse(withoutCatchwords(t)));

// ── judge ────────────────────────────────────────────────────────────────────
const DEFS = REF_PROMPT.slice(REF_PROMPT.indexOf('Allowed, NOT defects'), REF_PROMPT.indexOf('Then, ONLY if'));
export const JUDGE_PROMPT = `You are checking ONE page turn in several AI English translations of the same historical book. A reader pages
from page N to page N+1 and reads the English straight across. For each VERSION: does its English at the turn faithfully
and readably continue what the SOURCE continues?

You get SOURCE N (end of page N, OCR text) and SOURCE N+1 (start of page N+1), then several VERSIONS, each with
ENGLISH N (end of page N's translation) and ENGLISH N+1 (start of page N+1's translation). Excerpts may be cut at "…" on
their far side: judge only the turn, not the cut ends. The versions were made by different processes; you are not told
which is which and must not guess. Some may be identical: judge each on its own.

${DEFS.trim()}

Reply with ONE JSON array, one object per version, in the order given, and nothing else:
[{"version":"V1","label":"ok|omission|duplication|drift|broken_syntax|catchword|other","labels":["..."],"severity":"none|minor|major","evidence":"<= 30 words, quoting the words concerned"}, ...]
severity: "major" if a reader loses or is misled about content, "minor" if it reads awkwardly but the content is all there.`;

export const JUDGED = ['A', 'A2', 'M', 'C', 'MC', 'Acopy'];
function judgeText(x, versions) {
  return `${JUDGE_PROMPT}\n\n=== SOURCE N (end) ===\n${x.srcTailA}\n\n=== SOURCE N+1 (start) ===\n${x.srcHeadB}\n\n` +
    versions.map((ver, i) => `##### VERSION V${i + 1}\n--- ENGLISH N (end) ---\n${ver.tailA}\n--- ENGLISH N+1 (start) ---\n${ver.headB}`).join('\n\n') + '\n';
}

async function judge(out, conc) {
  const { ctx, v } = pageTexts(out);
  const file = path.join(out, 'judge.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.parsed).map(j => `${j.id}:${j.order}`));
  const rand = makeRng(71181);
  const todo = [];
  for (const x of ctx) {
    const present = JUDGED.filter(a => { const s = v[x.id][a === 'Acopy' ? 'A' : a]; return s && !s.failed; });
    if (!present.includes('A')) continue;
    const order1 = shuffle(present, rand);
    for (const [order, arms] of [[1, order1], [2, [...order1].reverse()]]) if (!done.has(`${x.id}:${order}`)) todo.push({ x, order, arms });
  }
  console.log(`${ctx.length} breaks; ${todo.length} judge calls`);
  const res = await pool(todo, conc, async ({ x, order, arms }) => {
    const versions = arms.map(a => { const s = v[x.id][a === 'Acopy' ? 'A' : a]; return { tailA: enTail(s.N), headB: enHead(s.N1) }; });
    const r = await claudeCall(judgeText(x, versions), 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(o => [String(o?.version), o]));
    const verdicts = Object.fromEntries(arms.map((a, i) => { const o = by.get(`V${i + 1}`); return [a, o && LABELS.includes(o.label) ? { label: o.label, labels: Array.isArray(o.labels) ? o.labels : [o.label], severity: o.severity, evidence: o.evidence } : null]; }));
    const parsed = Object.values(verdicts).every(Boolean);
    append(file, { id: x.id, order, arms, parsed, verdicts, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: r.usage, raw: parsed ? undefined : String(r.text).slice(0, 1500), at: new Date().toISOString() });
    return { ok: parsed, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}

// ── score ────────────────────────────────────────────────────────────────────
const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
/** One-sided exact sign test: P(at least `better` of better+worse discordant pairs favour the arm | p = ½). */
export function signP(better, worse) {
  const n = better + worse; if (!n) return 1;
  let s = 0, c = 1; // C(n,0)
  for (let k = 0; k <= n; k++) { if (k >= better) s += c; c = c * (n - k) / (k + 1); }
  return +(s / 2 ** n).toFixed(4);
}
export function catchwordCheck(x, s) {
  if (!s || s.failed) return 'failed';
  const fold = (w) => String(w || '').split(/\s+/).map(foldWord).filter(Boolean).join(' ');
  const want = fold(x.catchword);
  const same = (got) => want && got && (got === want || got.startsWith(want) || want.startsWith(got));
  const inN = catchwordsIn(s.N);
  // N+1 may label its OWN foot catchword (for N+2): only a label of THIS catchword in N+1's first half is a doubling.
  const half = String(s.N1).slice(0, Math.floor(String(s.N1).length / 2));
  const echoed = catchwordsIn(half).some((w) => same(fold(w)));
  if (!inN.length) return echoed ? 'misplaced' : 'dropped';
  if (inN.length > 1 || echoed) return 'doubled';
  return same(fold(inN[0])) ? 'kept' : 'mismatch';
}

function score(out) {
  const { ctx, v } = pageTexts(out);
  const jj = readJsonl(path.join(out, 'judge.jsonl')).filter(j => j.parsed);
  const byId = {}; for (const j of jj) (byId[j.id] ||= {})[j.order] = j;
  const rep = { build: JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')), model: MODEL, prereg: 'scripts/eval/PREREGISTRATION-seam-prevent-7118.md' };
  // per break, per arm: defective / major / labels (both orders); failed drafts are defective
  const res = {};
  for (const x of ctx) {
    const o = byId[x.id]; if (!o?.[1] || !o?.[2]) continue;
    const r = (res[x.id] = {});
    for (const a of JUDGED) {
      const s = v[x.id][a === 'Acopy' ? 'A' : a];
      if (s.failed) { r[a] = { def: true, major: true, failed: s.failed, labels: ['failed'] }; continue; }
      const p = o[1].verdicts[a], q = o[2].verdicts[a];
      if (!p || !q) { r[a] = null; continue; }
      const def = p.label !== 'ok' && q.label !== 'ok';
      r[a] = { def, major: def && p.severity === 'major' && q.severity === 'major', labels: def ? p.labels.filter(l => q.labels.includes(l) && l !== 'ok') : [] };
    }
  }
  const ids = Object.keys(res).filter(id => ARMS.every(a => res[id][a]));
  const cwIds = ids.filter(id => ctx.find(x => x.id === id).stratum === 'catchword');
  const plainIds = ids.filter(id => !cwIds.includes(id));
  const noCwIds = plainIds.filter(id => !parseCatchword(ctx.find(x => x.id === id).ocrA)?.judged);
  const count = (set, a, f) => set.filter(id => f(res[id][a])).length;
  const table = (set) => Object.fromEntries([...ARMS, 'Acopy'].map(a => [a, {
    def100: pct(count(set, a, r => r?.def), set.length), major100: pct(count(set, a, r => r?.major), set.length),
    defects: count(set, a, r => r?.def), majors: count(set, a, r => r?.major), failed: count(set, a, r => r?.failed),
    labels: Object.fromEntries(['omission', 'duplication', 'drift', 'broken_syntax', 'catchword', 'other'].map(l => [l, count(set, a, r => r?.labels?.includes(l))])) }]));
  rep.n = { all: ids.length, catchword: cwIds.length, plain: plainIds.length, judgeCallsParsed: jj.length };
  rep.all = table(ids); rep.catchword = table(cwIds); rep.plain = table(plainIds);
  // judge floor: A copy agrees with A
  rep.judgeFloor = { agree: ids.filter(id => res[id].Acopy && res[id].Acopy.def === res[id].A.def).length, n: ids.filter(id => res[id].Acopy).length };
  rep.judgeFloor.rate = pct(rep.judgeFloor.agree, rep.judgeFloor.n);
  // paired comparisons vs A
  const swing = Math.abs(rep.all.A2.def100 - rep.all.A.def100);
  rep.swing100 = +swing.toFixed(1);
  const pair = (x, y, set = ids) => { const better = set.filter(id => res[id][y].def && !res[id][x].def).length, worse = set.filter(id => res[id][x].def && !res[id][y].def).length; return { better, worse, p: signP(better, worse) }; };
  rep.vsA = Object.fromEntries(['A2', 'M', 'C', 'MC'].map(a => [a, { delta100: +(rep.all.A.def100 - rep.all[a].def100).toFixed(1), ...pair(a, 'A'), majors: rep.all[a].majors, majorsA: rep.all.A.majors }]));
  rep.MCvsM = pair('MC', 'M');
  rep.MvsA2 = pair('M', 'A2');
  // catchword check
  rep.catchwordLabel = {};
  for (const a of ['A', 'C', 'MC']) {
    const tally = (set) => set.reduce((t, id) => { const k = catchwordCheck(ctx.find(x => x.id === id), v[id][a]); t[k] = (t[k] || 0) + 1; return t; }, {});
    const spurious = noCwIds.filter(id => { const s = v[id][a]; return s && !s.failed && catchwordsIn(s.N).length; }).length;
    rep.catchwordLabel[a] = { stratum: tally(cwIds), keptRate: pct(cwIds.filter(id => catchwordCheck(ctx.find(x => x.id === id), v[id][a]) === 'kept').length, cwIds.length), spurious, spuriousRate: pct(spurious, noCwIds.length) };
  }
  // the registered rule
  const armRule = (a) => { const d = rep.vsA[a]; return { beatsSwing: d.delta100 > swing, p10: d.p < 0.10, majorsNotUp: d.majors <= d.majorsA, ships: d.delta100 > swing && d.p < 0.10 && d.majors <= d.majorsA }; };
  const cwRule = (arm, ref) => {
    const T = rep.catchword, lab = (a) => T[a].labels.catchword + T[a].labels.duplication;
    const cwOrDup = (a) => cwIds.filter(id => res[id][a].labels.some(l => l === 'catchword' || l === 'duplication') || (res[id][a].failed)).length;
    const r = { cwDupArm: cwOrDup(arm), cwDupRef: cwOrDup(ref), labelSum: [lab(arm), lab(ref)], omissionArm: T[arm].labels.omission, omissionRef: T[ref].labels.omission,
      keptRate: rep.catchwordLabel[arm].keptRate, spuriousRate: rep.catchwordLabel[arm].spuriousRate };
    r.ships = r.cwDupArm < r.cwDupRef && r.omissionArm <= r.omissionRef && (r.keptRate ?? 0) >= 80 && (r.spuriousRate ?? 100) <= 5;
    return r;
  };
  rep.rule = { M: armRule('M'), C: armRule('C'), MC: armRule('MC'), catchwordInC: cwRule('C', 'A'), catchwordInMC: cwRule('MC', 'M') };
  const R = rep.rule;
  let ship = [];
  if (R.M.ships && R.MC.ships) ship = R.catchwordInMC.ships ? ['MC'] : ['M'];
  else if (R.MC.ships) ship = R.catchwordInMC.ships ? ['MC'] : [];
  else if (R.M.ships) ship = ['M'];
  if (!ship.length && R.C.ships && R.catchwordInC.ships) ship = ['C'];
  if (!ship.includes('MC') && !ship.includes('C') && R.catchwordInC.ships) ship.push('catchword rule (C)');
  rep.verdict = ship.length ? `SHIP: ${ship.join(' + ')}` : 'NOTHING SHIPS';
  rep.reads = Object.fromEntries(ARMS.map(a => [a, { failedBreaks: ctx.filter(x => v[x.id][a].failed).length, why: ctx.reduce((t, x) => { const f = v[x.id][a].failed; if (f) t[f] = (t[f] || 0) + 1; return t; }, {}) }]));
  rep.markerReading = ['M', 'MC'].reduce((t, a) => { t[a] = ctx.reduce((u, x) => { const k = v[x.id][a].reading || 'failed'; u[k] = (u[k] || 0) + 1; return u; }, {}); return t; }, {});
  rep.claudeListUsd = +jj.reduce((s, j) => s + (j.usage?.list_cost_usd || 0), 0).toFixed(2);
  rep.perBreak = Object.fromEntries(ids.map(id => [id, Object.fromEntries([...ARMS, 'Acopy'].map(a => [a, res[id][a].def ? (res[id][a].major ? 'MAJOR' : 'minor') + ':' + res[id][a].labels.join('+') : 'ok']))]));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  const { perBreak, ...brief } = rep;
  console.log(JSON.stringify(brief, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const conc = Number(arg('conc', 4));
  const go = { build: () => build(out, Number(arg('n', 120)), Number(arg('cw', 40))), translate: () => translate(out, arg('arms', ARMS.join(',')).split(','), conc),
    judge: () => judge(out, conc), score: async () => score(out) }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}

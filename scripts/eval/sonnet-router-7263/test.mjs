#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/results/router-tests-2026-10-{26,28} (the pages, stored arms and verdicts this
// reuses: key.json + verdicts-opus.jsonl.gz); correction-pass-7818/lib.mjs judgeAbsolute / imageFor (the blind Opus judge,
// imported); scripts/batch/claude-ocr.mjs callInstruction + liveOcrPrompt (the read prompt, imported; that script only
// reads pages with no OCR, so it cannot read these); router-confirm/confirm.mjs (fresh-draw V4 harness: agy arms, fixed n,
// and it cannot reuse judged pages or stop early).
/**
 * Sonnet on pages already judged in a router cell, sequentially (#7263).
 *
 *   node --env-file=<env> scripts/eval/sonnet-router-7263/test.mjs run --cell=latin-flash3 [--batch=10] [--max=30]
 *   node --env-file=<env> scripts/eval/sonnet-router-7263/test.mjs correct-judge --served-dir=DIR   (latin-lite/print)
 *
 * Reads with `claude -p --model sonnet` (one page a call, Read only), judges with Opus (image, blind), and after each batch
 * prints P(acc >= bar) under Beta(m W + k, (1 - m) W + n - k). Stops at > 0.9 or < 0.1, or at --max pages. A read the guards
 * refuse counts as judged not accepted (cost per USABLE page), with no judge call. Two wrong-page controls per cell.
 * Resumable. Everything goes to $JOB_SCRATCH; nothing is written to the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { MongoClient } from 'mongodb';
import { arg, imageFor, judgeAbsolute, wrongText, servedCorrection, sha } from '../correction-pass-7818/lib.mjs';
import { opusCall } from '../route-judge-6740/judge.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { languageInstruction, callInstruction } from '../../batch/claude-ocr.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';
import { checkWrittenText } from '../../lib/write-text-guard.mjs';

const RJ = new URL('../route-judge-6740/results/', import.meta.url).pathname;
const SCRATCH = process.env.JOB_SCRATCH;
// set before any Sonnet output in these cells was judged; pre-registered on #7263. bar: the larger of the gate bar and the
// loss break-even (sonnet_plan.py); m: its prediction; W: prior.pooled.pages.
export const CELLS = {
  'latin-flash3': { row: 'latin-flash3/print', run: 'router-tests-2026-10-26', lang: 'Latin', route: 'sonnet-read', m: 0.752, W: 5, bar: 0.867 },
  'chinese-flash3': { row: 'chinese-flash3/print', run: 'router-tests-2026-10-28', lang: 'Chinese', route: 'sonnet-read', m: 0.519, W: 5, bar: 0.234 },
};
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const lgamma = (z) => { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); };
/** P(X >= bar), X ~ Beta(a, b), by midpoint integration. */
export function pAbove(a, b, bar) { const N = 20000; let s = 0; const c = lgamma(a + b) - lgamma(a) - lgamma(b); for (let i = 0; i < N; i++) { const x = (i + 0.5) / N; if (x >= bar) s += Math.exp(c + (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x)); } return s / N; }
const pool = async (xs, n, f) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await f(xs[i++]); })); };

/** The cell's judged pages in draw order, each with its stored arms' verdicts. */
function judgedPages(C, cell) {
  const dir = path.join(RJ, C.run);
  const keys = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8')).filter((k) => k.cell === cell && k.kind === 'item');
  const V = new Map(gunzipSync(fs.readFileSync(path.join(dir, 'verdicts-opus.jsonl.gz'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((v) => v.verdict).map((v) => [v.id, v.verdict]));
  const order = JSON.parse(fs.readFileSync(path.join(dir, 'sample.json'), 'utf8')).cells[cell].pages;
  return order.map((p) => ({ ...p, stored: Object.fromEntries(keys.filter((k) => k.page_id === p.page_id).map((k) => { const v = V.get(k.judged_as); return [k.route, v ? { accept: v.accept, wrong: wrongText(v), fidelity: v.fidelity } : null]; })) }));
}

async function pageDocs(ids) {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const docs = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray();
  return { c, db, docs: new Map(docs.map((d) => [d.id, d])) };
}

async function sonnetRead(C, p, doc, base, dir) {
  const f = path.join(dir, `${p.page_id}.meta.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sonnet-read-'));
  try {
    fs.writeFileSync(path.join(ws, 'p01.jpg'), await imageFor(p.page_id, getPageSource(doc)));
    const prompt = base + callInstruction(1);
    const t0 = Date.now(), r = await opusCall(prompt, ws, 'sonnet');
    if (r.cls === 'quota') throw new Error(`usage limit: ${r.text.slice(0, 160)}`);
    const text = r.text.replace(/^=+ PAGE p01 =+\s*/m, '').trim();
    let fail = r.cls || (text.length < 5 ? 'empty read' : null) || ocrReadProblem(text, { header: false }) || (loopVerdict(text).refuse ? 'repetition loop' : null);
    if (!fail && checkWrittenText(text, { kind: 'ocr' }).verdict === 'truncated') fail = 'write guard: truncated';
    fs.writeFileSync(path.join(dir, `${p.page_id}.txt`), text);
    const m = { page_id: p.page_id, book_id: p.book_id, model: r.model, fail: fail ? String(fail).slice(0, 160) : null, usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), prompt_sha: sha(prompt).slice(0, 16), at: new Date().toISOString() };
    fs.writeFileSync(f, JSON.stringify(m));
    return m;
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

function tally(C, rows) {
  const n = rows.length, k = rows.filter((r) => r.accept).length;
  const a = C.m * C.W + k, b = (1 - C.m) * C.W + n - k;
  return { n, k, wrong: rows.filter((r) => r.wrong).length, p: pAbove(a, b, C.bar), mean: a / (a + b) };
}

async function run() {
  const cell = arg('cell'), C = CELLS[cell], B = Number(arg('batch') || 10), MAX = Number(arg('max') || 30);
  const OUT = path.join(SCRATCH, 'test', cell); fs.mkdirSync(OUT, { recursive: true });
  const pages = judgedPages(C, cell), res = path.join(OUT, 'verdicts.jsonl');
  const { c, db, docs } = await pageDocs(pages.map((p) => p.page_id));
  const { base } = await liveOcrPrompt(db, languageInstruction(C.lang));
  await c.close();
  const done = new Map(jsonl(res).map((r) => [r.page_id, r]));
  for (let at = 0; at < Math.min(MAX, pages.length); at += B) {
    const batch = pages.slice(at, Math.min(at + B, MAX)).filter((p) => !done.has(p.page_id));
    await pool(batch, 3, async (p) => {
      const doc = docs.get(p.page_id);
      const m = await sonnetRead(C, p, doc, base, OUT);
      let row;
      if (m.fail) row = { accept: false, wrong: false, fidelity: null, failed: m.fail };
      else {
        const r = await judgeAbsolute({ lang: C.lang, text: fs.readFileSync(path.join(OUT, `${p.page_id}.txt`), 'utf8') }, await imageFor(p.page_id, getPageSource(doc)));
        if (!r.verdict) { console.log(`  ${p.page_id}: judge unparsed (${r.cls})`); return; }
        row = { accept: r.verdict.accept, wrong: wrongText(r.verdict), fidelity: r.verdict.fidelity, defects: (r.verdict.defects || []).map((d) => ({ class: d.class, severity: d.severity })), judge_usd: r.list_usd };
      }
      const out = { page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, ...row, sonnet_usd: m.list_usd, stored: p.stored };
      fs.appendFileSync(res, JSON.stringify(out) + '\n'); done.set(p.page_id, out);
    });
    const rows = pages.slice(0, Math.min(at + B, MAX)).map((p) => done.get(p.page_id)).filter(Boolean);
    const t = tally(C, rows);
    console.log(`${cell}: ${t.k}/${t.n} accepted, ${t.wrong} wrong text; P(acc >= ${C.bar}) = ${t.p.toFixed(3)}; posterior mean ${t.mean.toFixed(3)}`);
    if (t.p > 0.9 || t.p < 0.1) { console.log(`STOP at ${t.n} pages`); break; }
  }
}

/** Two wrong-page controls: Sonnet's text of one page judged against the image of another book's page. */
async function controls() {
  const cell = arg('cell'), C = CELLS[cell], OUT = path.join(SCRATCH, 'test', cell);
  const rows = jsonl(path.join(OUT, 'verdicts.jsonl')).filter((r) => !r.failed), file = path.join(OUT, 'controls.jsonl');
  const { c, docs } = await pageDocs(rows.map((r) => r.page_id)); await c.close();
  for (const [i, j] of [[0, 1], [2, 3]]) {
    if (jsonl(file).some((x) => x.text_of === rows[i].page_id)) continue;
    const r = await judgeAbsolute({ lang: C.lang, text: fs.readFileSync(path.join(OUT, `${rows[i].page_id}.txt`), 'utf8') }, await imageFor(rows[j].page_id, getPageSource(docs.get(rows[j].page_id))));
    fs.appendFileSync(file, JSON.stringify({ text_of: rows[i].page_id, image_of: rows[j].page_id, accept: r.verdict?.accept ?? null, fidelity: r.verdict?.fidelity ?? null }) + '\n');
  }
  console.log(jsonl(file).map((x) => `control accept=${x.accept} f${x.fidelity}`).join('\n'));
}

/** The 20 corrections the price step already paid for, on the V4 latin-lite/print pages: served by the lane's guards, blind judge. */
async function correctJudge() {
  const dir = arg('served-dir'), OUT = path.join(SCRATCH, 'test', 'latin-lite'), res = path.join(OUT, 'verdicts.jsonl'); fs.mkdirSync(OUT, { recursive: true });
  const V4 = JSON.parse(fs.readFileSync(new URL('../results/router-v4-latin-lite/latin-lite-print-2026-11-03.json', import.meta.url), 'utf8')).per_page;
  const pages = V4.filter((p) => fs.existsSync(path.join(dir, 'reads', `${p.page_id}.meta.json`)));
  const { c, docs } = await pageDocs(pages.map((p) => p.page_id)); await c.close();
  const done = new Set(jsonl(res).map((r) => r.page_id));
  await pool(pages.filter((p) => !done.has(p.page_id)), 3, async (p) => {
    const doc = docs.get(p.page_id), meta = JSON.parse(fs.readFileSync(path.join(dir, 'reads', `${p.page_id}.meta.json`), 'utf8'));
    const draft = doc.ocr.data;
    const read = meta.outcome === 'corrected' ? fs.readFileSync(path.join(dir, 'reads', `${p.page_id}.txt`), 'utf8') : meta.outcome === 'unchanged' ? 'UNCHANGED' : `CONTAIN: ${meta.reason || 'not this leaf'}`;
    const s = servedCorrection({ exit: 0, text: read }, draft, { languages: ['Latin'] });
    const stored = { accept: p.served.accept, wrong: p.served.wrong, fidelity: p.served.fidelity };
    let v = stored, judged = false;
    if (s.outcome === 'written') {
      const r = await judgeAbsolute({ lang: 'Latin', text: s.served }, await imageFor(p.page_id, getPageSource(doc)));
      if (!r.verdict) { console.log(`  ${p.page_id}: judge unparsed`); return; }
      v = { accept: r.verdict.accept, wrong: wrongText(r.verdict), fidelity: r.verdict.fidelity, defects: (r.verdict.defects || []).map((d) => ({ class: d.class, severity: d.severity })) }; judged = true;
    }
    fs.appendFileSync(res, JSON.stringify({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, outcome: s.outcome, why: s.why, judged, ...v, stored: { lite: stored, 'lite>agy-flash-low': p.B, 'agy-flash-low@4-read': p.C }, sonnet_outcome: meta.outcome }) + '\n');
  });
  const rows = jsonl(res);
  console.log(`latin-lite lite>sonnet: ${rows.filter((r) => r.accept).length}/${rows.length} accepted, ${rows.filter((r) => r.wrong).length} wrong text; outcomes ${JSON.stringify(rows.reduce((a, r) => ({ ...a, [r.outcome]: (a[r.outcome] || 0) + 1 }), {}))}`);
}

const stage = { run, controls, 'correct-judge': correctJudge }[process.argv[2]];
if (!stage) { console.error('stages: run | controls | correct-judge'); process.exit(2); }
await stage();

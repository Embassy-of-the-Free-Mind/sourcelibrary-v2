#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-r4-refs-5924.mjs — its `popdraw` stage drew the Latin OCR queue by century, but 3-page
// runs from a uniform start (no interior rule, no ocr.data filter) for a CER bench with references; this pilot needs one
// interior page per book with no OCR yet and two arms with no reference. scripts/batch/cli-ocr.mjs `read` builds the
// CLI prompt but has no JSON output and no nudge; scripts/eval/run-cli-arm.py has both, so the CLI arm runs there and
// this file only builds its requests. scripts/batch/realtime-ocr.mjs is the production lite call (same prompt and
// generationConfig as the `lite` stage below) but it writes pages.
/**
 * #6375 — Latin OCR backlog through the Gemini CLI: 300-page pilot, read stage only. NO production writes.
 * Preregistration: scripts/eval/PREREGISTRATION-latin-cli-pilot-6375.md
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/latin-cli-pilot-6375.mjs <stage> [--work=DIR]
 *
 *   draw     queue catalogue → seeded sample, one interior page per book       → WORK/sample.json
 *   images   download each sampled page's image (what production OCR reads)     → WORK/img/<uid>.jpg
 *   prompt   the live default OCR prompt, as realtime-ocr.mjs and cli-ocr.mjs send it → WORK/prompt-*.txt
 *   lite     gemini-3.1-flash-lite on the production prompt (API, metered)     → WORK/lite.jsonl
 *   type     gemini-3.1-flash-lite one-word type label (roman/gothic/other/blank) → WORK/type.jsonl
 *   cli-req  requests for scripts/eval/run-cli-arm.py                           → WORK/cli-requests.jsonl
 *   eyeset   the 40-page by-eye set (preregistered rule)                        → WORK/eyeset.json
 *   score    per-arm counts with Wilson 95% CIs, roman vs gothic                → WORK/results.json + stdout table
 */
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { extractPageType } from '../lib/ocr-result-parse.mjs';
import { MODEL_PRICING } from '../lib/model-pricing.mjs';

const STAGE = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const WORK = args.work || '/root/latin-cli-pilot-6375';
const W = f => path.join(WORK, f);
fs.mkdirSync(W('img'), { recursive: true });
const SEED = 6375, N_TOTAL = 300, LITE = 'gemini-3.1-flash-lite', ENDPOINT = 'scripts/eval/latin-cli-pilot-6375.mjs';
const SPEND_STOP = 2.0;
const STRATA = ['1400s', '1500s', '1600s', '1700s', '1800s+', 'undated'];
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const yearOf = p => +((String(p ?? '').match(/1[4-9]\d\d/) || [])[0]) || null;
const century = y => !y ? 'undated' : y < 1500 ? '1400s' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : '1800s+';
// Mulberry32, the house seeded generator (latin-r4-refs-5924)
const rng = seed => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const shuffle = (xs, seed) => { const r = rng(seed); return xs.map(x => ({ x, k: r() })).sort((a, b) => a.k - b.k).map(o => o.x); };
const uidOf = (bookId, pn) => `${bookId}-p${pn}`;

async function db() {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  return { client, db: client.db('bookstore') };
}

// ── draw ─────────────────────────────────────────────────────────────────────
// Queue = books with pipeline_next.step = 'ocr' and language 'Latin' or 'lat' (visible and hidden). Century of the
// first 14xx–19xx year in `published`. Equal quota per century stratum (N_TOTAL / 6), a short stratum's remainder
// going to the others in STRATA order. Within a stratum, books in Mulberry32(SEED + stratum index) order; per book,
// the eligible pages are the interior ones (index within [ceil(5%), floor(95%)] of the book's pages by page_number)
// with an image and no OCR text; one is taken by Mulberry32(SEED + fnv(book id)). A book with no eligible page is
// skipped and recorded.
async function stageDraw() {
  const { client, db: d } = await db();
  const books = await d.collection('books').find({ 'pipeline_next.step': 'ocr', language: { $in: ['Latin', 'lat'] } },
    { projection: { id: 1, title: 1, published: 1, pages_count: 1, visible: 1, author: 1 } }).toArray();
  const by = Object.fromEntries(STRATA.map(s => [s, []]));
  for (const b of books) by[century(yearOf(b.published))].push(b);
  const pop = Object.fromEntries(STRATA.map(s => [s, { books: by[s].length, pages: by[s].reduce((n, b) => n + (b.pages_count || 0), 0) }]));
  console.log('queue', books.length, pop);
  const quota = Object.fromEntries(STRATA.map(s => [s, Math.floor(N_TOTAL / STRATA.length)]));
  const out = { seed: SEED, drawn_at: new Date().toISOString(), queue_books: books.length, population: pop, quota, rows: [], skipped: [] };
  const fnv = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; };
  let carry = 0;
  for (const [i, st] of STRATA.entries()) {
    const want = quota[st] + carry; let got = 0;
    for (const b of shuffle(by[st].sort((x, y) => String(x.id).localeCompare(String(y.id))), SEED + i)) {
      if (got >= want) break;
      const pages = await d.collection('pages').aggregate([
        { $match: { book_id: b.id } },
        { $project: { _id: 0, id: 1, page_number: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1,
          ocr_len: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] } } },
      ]).toArray();
      pages.sort((x, y) => x.page_number - y.page_number);
      const n = pages.length, lo = Math.ceil(n * 0.05), hi = Math.floor(n * 0.95) - 1;
      const elig = pages.slice(lo, hi + 1).filter(p => p.ocr_len === 0 && (getPageSource(p) || p.photo));
      if (!elig.length) { out.skipped.push({ book_id: b.id, stratum: st, n_pages: n, why: n < 3 ? 'under 3 pages' : 'no interior page with an image and no OCR' }); continue; }
      const p = elig[Math.floor(rng(SEED + fnv(b.id))() * elig.length)];
      out.rows.push({ uid: uidOf(b.id, p.page_number), book_id: b.id, page_id: p.id, page_number: p.page_number, n_pages: n, interior_index: pages.indexOf(p),
        stratum: st, year: yearOf(b.published), title: String(b.title || '').slice(0, 120), author: String(b.author || '').slice(0, 80), visible: !!b.visible, image: getPageSource(p) || p.photo });
      got++;
    }
    carry = want - got;
    console.log(st, 'drawn', got, 'of', want);
  }
  await client.close();
  fs.writeFileSync(W('sample.json'), JSON.stringify(out, null, 1));
  console.log('sample', out.rows.length, 'skipped', out.skipped.length);
}

// ── images ───────────────────────────────────────────────────────────────────
async function stageImages() {
  const s = readJson(W('sample.json'));
  let ok = 0;
  for (const r of s.rows) {
    const f = W(`img/${r.uid}.jpg`);
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) { ok++; continue; }
    try {
      const res = await fetch(r.image, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'SourceLibraryEval/1.0 (https://sourcelibrary.org)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(f, Buffer.from(await res.arrayBuffer())); ok++;
    } catch (e) { console.log(`! ${r.uid}: ${e.message}`); }
  }
  console.log('images', ok, 'of', s.rows.length);
}

// ── prompt ───────────────────────────────────────────────────────────────────
// Exactly what realtime-ocr.mjs (lite, production) and cli-ocr.mjs (CLI) send. The CLI version carries cli-ocr.mjs's
// extra sentence; run-cli-arm.py appends `@./<uid>.jpg` at the end.
const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';
async function stagePrompt() {
  const { client, db: d } = await db();
  const p = await d.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  await client.close();
  const base = p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  fs.writeFileSync(W('prompt-lite.txt'), base);
  fs.writeFileSync(W('prompt-cli.txt'), base + '\n\nTranscribe the attached page image. Output only the transcription in the format above, with no preamble and no commentary. The page image is attached:');
  fs.writeFileSync(W('prompt-ref.json'), JSON.stringify({ id: String(p._id), name: p.name, version: String(p.version ?? ''), hash: p.content_hash ?? null }));
  console.log('prompt', p.name, 'v' + p.version, base.length, 'chars');
}

// ── lite arm + type pass (API, metered through gemini-script-client → gemini_usage) ─────────────────────────────
const price = MODEL_PRICING[LITE];
const costOf = r => (r.inputTokens * price.input + (r.outputTokens) * price.output) / 1e6;
function spentSoFar() {
  return [...readJsonl(W('lite.jsonl')), ...readJsonl(W('type.jsonl'))].reduce((n, r) => n + (r.cost || 0), 0);
}
async function pool(items, k, fn) { let i = 0; await Promise.all(Array.from({ length: k }, async () => { while (i < items.length) await fn(items[i++]); })); }

async function runLite(file, promptText, opts) {
  const s = readJson(W('sample.json'));
  const done = new Set(readJsonl(W(file)).filter(r => !r.error).map(r => r.uid));
  const todo = s.rows.filter(r => !done.has(r.uid) && fs.existsSync(W(`img/${r.uid}.jpg`)));
  console.log(file, todo.length, 'to run; spent so far $' + spentSoFar().toFixed(3));
  let stopped = false;
  await pool(todo, 4, async r => {
    if (stopped) return;
    if (spentSoFar() > SPEND_STOP - 0.1) { stopped = true; console.log('SPEND STOP'); return; }
    const t0 = Date.now(); let row;
    try {
      const g = await callGemini({ model: LITE, prompt: promptText, endpoint: ENDPOINT, imageParts: [fs.readFileSync(W(`img/${r.uid}.jpg`))], type: opts.type, bookId: r.book_id, pageIds: [r.page_id], ...opts.gen });
      row = { uid: r.uid, model: LITE, route: 'api', date: new Date().toISOString(), text: g.text || '', finishReason: g.finishReason, inputTokens: g.inputTokens, outputTokens: g.outputTokens, thinkingTokens: g.thinkingTokens, secs: (Date.now() - t0) / 1000 };
      row.cost = costOf(row);
    } catch (e) { row = { uid: r.uid, model: LITE, date: new Date().toISOString(), error: String(e.message).slice(0, 300) }; }
    fs.appendFileSync(W(file), JSON.stringify(row) + '\n');
  });
  console.log(file, 'done; spent $' + spentSoFar().toFixed(3));
}
// realtime-ocr.mjs generationConfig: temperature 0.1, thinkingBudget 0, maxOutputTokens 16384
const stageLite = () => runLite('lite.jsonl', fs.readFileSync(W('prompt-lite.txt'), 'utf8'), { type: 'ocr', gen: { temperature: 0.1, maxOutputTokens: 16384, thinkingBudget: 0 } });
const TYPE_PROMPT = 'Look at this scanned book page. Classify the TYPEFACE of its main printed text. Reply with exactly one word:\n'
  + 'roman — roman or italic (antiqua) type\n'
  + 'gothic — blackletter of any kind: textura, rotunda, bastarda, schwabacher, fraktur\n'
  + 'other — handwriting, Greek/Hebrew/other non-Latin script as the main text, or an engraving/plate with little text\n'
  + 'blank — no text on the page, or only bleed-through, a binding, a facing-page edge strip, or a colour card';
const stageType = () => runLite('type.jsonl', TYPE_PROMPT, { type: 'classify', gen: { temperature: 0, maxOutputTokens: 10, thinkingBudget: 0 } });

// ── cli requests ─────────────────────────────────────────────────────────────
function stageCliReq() {
  const s = readJson(W('sample.json'));
  const rows = s.rows.filter(r => fs.existsSync(W(`img/${r.uid}.jpg`))).map(r => ({ uid: r.uid, image: W(`img/${r.uid}.jpg`) }));
  fs.writeFileSync(W('cli-requests.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log('cli requests', rows.length);
}

// ── measures ─────────────────────────────────────────────────────────────────
const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|blocked by Gemini's filters|^#{2,3} Summary\b|overview and summary of the text/im;
// Plan-note: the agent narrates or plans instead of (or before) transcribing — plan mode's own failure shape.
const PLAN = /^\s*(sure|okay|ok|certainly|of course|here(?:'s| is| are)|let me|i(?:'ll| will| need| am going| have| cannot| can't| am unable)|first,? i|now,? i|understood|#+\s*(implementation )?plan\b|plan:)/i;
const PLAN_ANY = /\b(implementation plan|tool call|view_file|run_command|read_file|shell command|I will (now )?(transcribe|read|open|view|crop)|I'll (now )?(transcribe|read|open|view|crop))\b/i;
const body = t => String(t || '').replace(/<[^>]+>[^<]*<\/[^>]+>/g, m => /^<(page-type|language|columns|script|page-number|header|signature|catchword|running-head)/i.test(m) ? '' : m).replace(/<[^>]+>/g, '').trim();
const wilson = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };
const foldS = w => w.replace(/ſ/g, 's');
// ſ/f pairs: a word one arm writes with ſ where the other has f at the same letter, the words otherwise equal.
function sfPairs(a, b) {
  const wa = body(a).split(/\s+/).filter(Boolean), wb = new Set(body(b).split(/\s+/).filter(Boolean));
  let n = 0;
  for (const w of wa) if (w.includes('ſ')) { for (let i = 0; i < w.length; i++) if (w[i] === 'ſ' && wb.has(w.slice(0, i) + 'f' + w.slice(i + 1))) { n++; break; } }
  return n;
}
function measures(text, extra = {}) {
  const t = String(text || ''), b = body(t);
  const loop = loopVerdict(t);
  return {
    empty: !t.trim(), refusal: REFUSAL.test(t) || extra.blocked === true || ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(extra.finishReason),
    plan_note: PLAN.test(t.slice(0, 300)) || PLAN_ANY.test(t), loop: !!loop.refuse, body_chars: b.length,
    page_type: extractPageType(t), long_s: (t.match(/ſ/g) || []).length, hit_cap: extra.finishReason === 'MAX_TOKENS',
  };
}

// ── by-eye set (preregistered) ───────────────────────────────────────────────
// 40 pages, one per book. First every blank/edge candidate (type pass says blank, or either arm's body < 80 chars
// while the other's ≥ 300, or either arm tags the page blank) up to 10, in sample order; then gothic pages up to 20 in
// all; then the rest roman/other, in Mulberry32(SEED + 40) order. Requires lite, type and CLI rows.
function stageEyeset() {
  const s = readJson(W('sample.json'));
  const lite = new Map(readJsonl(W('lite.jsonl')).filter(r => !r.error).map(r => [r.uid, r]));
  const cli = new Map(readJsonl(W('cli.jsonl')).map(r => [r.uid, r]));
  const ty = new Map(readJsonl(W('type.jsonl')).filter(r => !r.error).map(r => [r.uid, typeWord(r.text)]));
  const rows = shuffle(s.rows.filter(r => lite.has(r.uid) && cli.has(r.uid)), SEED + 40);
  const L = r => body(lite.get(r.uid).text).length, C = r => body(cli.get(r.uid).text).length;
  const blankish = r => ty.get(r.uid) === 'blank' || (Math.min(L(r), C(r)) < 80 && Math.max(L(r), C(r)) >= 300)
    || /blank/.test(extractPageType(lite.get(r.uid).text) || '') || /blank/.test(extractPageType(cli.get(r.uid).text) || '');
  const pick = [], take = (pred, upto) => { for (const r of rows) { if (pick.length >= upto) break; if (!pick.includes(r) && pred(r)) pick.push(r); } };
  take(blankish, 10); take(r => ty.get(r.uid) === 'gothic', 30); take(() => true, 40);
  fs.writeFileSync(W('eyeset.json'), JSON.stringify(pick.map(r => ({ uid: r.uid, type: ty.get(r.uid), blank_candidate: blankish(r), stratum: r.stratum, year: r.year, title: r.title })), null, 1));
  console.log('eyeset', pick.length, 'blank cands', pick.filter(blankish).length, 'gothic', pick.filter(r => ty.get(r.uid) === 'gothic').length);
}
const typeWord = t => (String(t || '').toLowerCase().match(/roman|gothic|other|blank/) || ['unknown'])[0];

// ── score ────────────────────────────────────────────────────────────────────
function stageScore() {
  const s = readJson(W('sample.json'));
  const lite = new Map(readJsonl(W('lite.jsonl')).filter(r => !r.error).map(r => [r.uid, r]));
  const cli = new Map(); for (const r of readJsonl(W('cli.jsonl'))) cli.set(r.uid, r); // last row wins
  const ty = new Map(readJsonl(W('type.jsonl')).filter(r => !r.error).map(r => [r.uid, typeWord(r.text)]));
  const eyeType = new Map(); const eye = new Map();
  if (fs.existsSync(W('eye'))) for (const f of fs.readdirSync(W('eye')).filter(f => f.endsWith('.json'))) {
    for (const v of [].concat(readJson(W(`eye/${f}`)))) { eye.set(v.uid, v); if (v.type) eyeType.set(v.uid, v.type); }
  }
  const typeOf = uid => eyeType.get(uid) || ty.get(uid) || 'unknown';
  const both = s.rows.filter(r => lite.has(r.uid) && cli.has(r.uid));
  const per = { lite: [], cli: [] };
  for (const r of both) {
    const l = lite.get(r.uid), c = cli.get(r.uid);
    per.lite.push({ uid: r.uid, type: typeOf(r.uid), ...measures(l.text, l), nudged: false, sf_vs_other: sfPairs(c.text, l.text) });
    per.cli.push({ uid: r.uid, type: typeOf(r.uid), ...measures(c.text, c), empty: !String(c.text || '').trim(), nudged: !!c.nudged, sf_vs_other: sfPairs(l.text, c.text) });
  }
  // sf_vs_other on the lite row = words where CLI has ſ and lite has f (lite's ſ→f candidates); vice versa on CLI.
  const groups = { all: () => true, roman: x => x.type === 'roman', gothic: x => x.type === 'gothic', other: x => !['roman', 'gothic'].includes(x.type) };
  const keys = ['empty', 'refusal', 'nudged', 'plan_note', 'loop', 'hit_cap'];
  const res = { date: new Date().toISOString(), n_pages: both.length, type_counts: {}, arms: {} };
  for (const g of Object.keys(groups)) res.type_counts[g] = per.lite.filter(groups[g]).length;
  for (const arm of ['lite', 'cli']) {
    res.arms[arm] = {};
    for (const [g, f] of Object.entries(groups)) {
      const xs = per[arm].filter(f), n = xs.length, o = { n };
      for (const k of keys) { const kk = xs.filter(x => x[k]).length; o[k] = { k: kk, rate: n ? kk / n : null, ci: wilson(kk, n) }; }
      o.long_s_chars = xs.reduce((a, x) => a + x.long_s, 0);
      o.pages_with_long_s = { k: xs.filter(x => x.long_s > 0).length, ci: wilson(xs.filter(x => x.long_s > 0).length, n) };
      o.sf_words_other_arm_has_long_s = xs.reduce((a, x) => a + x.sf_vs_other, 0);
      o.median_body_chars = xs.map(x => x.body_chars).sort((a, b) => a - b)[Math.floor(n / 2)] ?? null;
      res.arms[arm][g] = o;
    }
  }
  // by-eye
  const ev = [...eye.values()].filter(v => lite.has(v.uid) && cli.has(v.uid));
  res.eye = { n: ev.length, by_type: {} };
  const eg = { all: () => true, roman: v => v.type === 'roman', gothic: v => v.type === 'gothic', other: v => !['roman', 'gothic'].includes(v.type) };
  for (const [g, f] of Object.entries(eg)) {
    const xs = ev.filter(f), n = xs.length, cnt = p => xs.filter(p).length;
    const blanks = xs.filter(v => v.leaf === 'blank' || v.leaf === 'edge');
    res.eye.by_type[g] = {
      n, closer: { cli: cnt(v => v.closer === 'cli'), lite: cnt(v => v.closer === 'lite'), tie: cnt(v => v.closer === 'tie') },
      closer_cli_ci: wilson(cnt(v => v.closer === 'cli'), n),
      blank_or_edge_leaves: blanks.length,
      invented_on_blank: { lite: { k: blanks.filter(v => v.lite?.invented).length, ci: wilson(blanks.filter(v => v.lite?.invented).length, blanks.length) }, cli: { k: blanks.filter(v => v.cli?.invented).length, ci: wilson(blanks.filter(v => v.cli?.invented).length, blanks.length) } },
      invented_any: { lite: cnt(v => v.lite?.invented), cli: cnt(v => v.cli?.invented) },
      pages_dropped_lines: { lite: { k: cnt(v => (v.lite?.dropped_lines || 0) > 0), ci: wilson(cnt(v => (v.lite?.dropped_lines || 0) > 0), n) }, cli: { k: cnt(v => (v.cli?.dropped_lines || 0) > 0), ci: wilson(cnt(v => (v.cli?.dropped_lines || 0) > 0), n) } },
      dropped_lines_total: { lite: xs.reduce((a, v) => a + (v.lite?.dropped_lines || 0), 0), cli: xs.reduce((a, v) => a + (v.cli?.dropped_lines || 0), 0) },
      long_s_to_f_eye: { lite: xs.reduce((a, v) => a + (v.lite?.long_s_as_f || 0), 0), cli: xs.reduce((a, v) => a + (v.cli?.long_s_as_f || 0), 0) },
      pages_long_s_to_f_eye: { lite: { k: cnt(v => (v.lite?.long_s_as_f || 0) > 0), ci: wilson(cnt(v => (v.lite?.long_s_as_f || 0) > 0), n) }, cli: { k: cnt(v => (v.cli?.long_s_as_f || 0) > 0), ci: wilson(cnt(v => (v.cli?.long_s_as_f || 0) > 0), n) } },
    };
  }
  const tcheck = ev.filter(v => v.type && ty.has(v.uid));
  res.type_check = { n: tcheck.length, agree: tcheck.filter(v => v.type === ty.get(v.uid)).length, disagreements: tcheck.filter(v => v.type !== ty.get(v.uid)).map(v => `${v.uid}: lite ${ty.get(v.uid)} → eye ${v.type}`) };
  res.lite_cost_usd = +spentSoFar().toFixed(4);
  res.cli_calls = readJsonl(W('cli.jsonl')).reduce((a, r) => a + (r.attempts || 1), 0);
  fs.writeFileSync(W('results.json'), JSON.stringify(res, null, 1));
  fs.writeFileSync(W('per-page.jsonl'), both.map((r, i) => JSON.stringify({ uid: r.uid, stratum: r.stratum, lite: per.lite[i], cli: per.cli[i] })).join('\n') + '\n');
  console.log(JSON.stringify(res, null, 1));
}

const STAGES = { draw: stageDraw, images: stageImages, prompt: stagePrompt, lite: stageLite, type: stageType, 'cli-req': stageCliReq, eyeset: stageEyeset, score: stageScore };
if (!STAGES[STAGE]) { console.error('stage: ' + Object.keys(STAGES).join('|')); process.exit(2); }
await STAGES[STAGE]();

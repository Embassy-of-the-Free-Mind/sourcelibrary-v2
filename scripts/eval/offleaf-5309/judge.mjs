#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-confirm-5021.mjs (fetchLeaf, the sealed `claude -p` call — reused) asks which
// leaf a page's ENGLISH renders, per flagged run; scripts/eval/leak-repair-5026/pair-judge.mjs (branch
// job-leak-repair-5026) judges a PAIR of pages for a duplicated passage. Neither asks which leaf a stored TRANSCRIPTION
// came from with a window wide enough for #5309's −3/−5 offsets, nor judges a re-OCR'd page and its new English
// together; and neither runs the same packet through agy as a checker to calibrate it against Opus.
/**
 * offleaf-5309 spot checks (method scripts/eval/methods/leak-off-leaf-5309.md).
 *
 *   node --env-file=.env.production.local scripts/eval/offleaf-5309/judge.mjs pre-draw  --diagnose F --out DIR [--seed 5309] [--n 30]
 *   … pre-judge  --out DIR [--concurrency 3]     blind Opus: which leaf of n-3 … n+3 does the stored transcription render?
 *   … pre-score  --out DIR                       precision of "stranded = another leaf", offsets, controls
 *   … post-draw  --ledger F --out DIR [--wave W] [--seed 5310] [--n 30]   one repaired page per book
 *   … post-judge --out DIR [--judge opus|agy] [--concurrency 3]   the new transcription and English against the image
 *   … post-score --out DIR                       own leaf, usable, defects by kind; agy vs Opus agreement
 *   … screen-draw  --pre-sample F --pre-verdicts F --out DIR   the pre pages + 4 planted controls, reshuffled blind
 *   … screen-judge --out DIR [--model gemini-3.8-flash-medium]  agy: own / prev / next / other, from scans n-1 … n+1
 *   … screen-score --out DIR [--model …]          agreement with Opus (own vs off), false alarms, misses, controls
 *   … screen-queue --queue F --ledger F --out DIR [--max-pages 2000]   the runner's next books, all pages, for screen-judge
 *   … screen-confirm-draw --out DIR [--n 30]   DIR/opus/pre-sample.json: every page agy did not call off, + 30 agy-off
 *   … screen-merge --out DIR                   DIR/screen.jsonl, one off/own decision per page (Opus over agy)
 *   … record     --out DIR --stage pre|post [--apply]   book_checks rows (recordPageVerdicts), Opus verdicts only
 *
 * Controls (judged the same way, not told apart, never recorded): pre — the six #5309 positive-control pages with their
 * CURRENT text (repaired on 2026-10-01/02: expected own) and with their PRE-REPAIR text from page_revisions (expected
 * another leaf). post — two repaired pages given their pre-repair (wrong-leaf) transcription: expected not own.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { fetchLeaf, claudeCall } from '../../audit/leaf-shift-confirm-5021.mjs';
import { agyCall, agyQuota, installToolGate, installNarrowAgent, CLI_SAFE_ARGS, gateReads, gateCalls } from '../../lib/agy-cli.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const MODE = process.argv[2];
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', '.'));
fs.mkdirSync(OUT, { recursive: true });
const F = (f) => path.join(OUT, f);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (xs, rnd) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clip = (s, n = 5000) => { s = String(s || '').trim(); return s.length > n ? `${s.slice(0, n)} […]` : s; };
const strip = (s) => String(s || '').replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, '[picture regions listed]');

// The six known wrong-leaf pages named in the issue body (all repaired 2026-10-01/02).
export const CONTROLS = [
  { book_id: '6a09e9ef3ca4edcd1ef01c3b', n: 82, name: 'Strutt' }, { book_id: '69e41fab4fc48a88423e0693', n: 26, name: 'Rajput Painting' },
  { book_id: '6a08f9349c1b82475e159a8d', n: 153, name: 'Geronimo' }, { book_id: '69f8c1030c0c281d4bd321fd', n: 371, name: 'Yucatán' },
  { book_id: '69cf7bb9878f40c5945f1eea', n: 240, name: 'Oxyrhynchus V' }, { book_id: '69e7938b80b52390feb18721', n: 269, name: 'Quixote' },
];
const PAGE_PROJ = { _id: 1, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'translation.data': 1, display_photo: 1, photo: 1, archived_photo: 1, photo_original: 1 };

let client, db;
async function open() { client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await client.connect(); db = client.db('bookstore'); }

/** The OCR text a page held before the first `stranded-text-5309` re-OCR (or the given run), from page_revisions. */
async function preRepairText(pageId) {
  const rows = await db.collection('page_revisions').find({ page_id: pageId, field: 'ocr' }).sort({ created_at: 1 }).limit(20).toArray();
  for (const r of rows) { const t = r.data ?? r.prior?.data ?? r.value?.data ?? r.snapshot?.data; if (t && String(t).trim()) return { text: String(t), rev: r.id ?? String(r._id), source: r.source ?? r.reason ?? null, at: r.created_at }; }
  return null;
}

async function windowPages(bookId, n, k) {
  const ps = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: n - k, $lte: n + k } }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
  return ps;
}

// ── pre: is the stored text another leaf? ──
async function preDraw() {
  const rnd = mulberry32(Number(arg('seed', '5309')));
  const N = Number(arg('n', '30'));
  const diag = readJsonl(arg('diagnose'));
  const byBook = new Map();
  for (const r of diag) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
  await open();
  const ctlBooks = new Set(CONTROLS.map((c) => c.book_id));
  const books = shuffle([...byBook.keys()].filter((b) => !ctlBooks.has(b)), rnd);
  const items = [];
  for (const b of books) {
    if (items.filter((x) => x.kind === 'item').length >= N) break;
    const r = shuffle(byBook.get(b), rnd)[0];
    const page = await db.collection('pages').findOne({ id: r.page_id }, { projection: PAGE_PROJ });
    if (!page?.ocr?.data) continue;
    items.push({ kind: 'item', book_id: b, page_id: page.id, n: page.page_number, language: r.language, diag: { verdict: r.verdict, offset: r.offset, ref_d: r.ref_d, shared: r.shared }, text: page.ocr.data });
  }
  for (const c of CONTROLS) {
    const page = await db.collection('pages').findOne({ book_id: c.book_id, page_number: c.n }, { projection: PAGE_PROJ });
    if (!page) { console.log(`control ${c.name}: no page`); continue; }
    items.push({ kind: 'ctl-current', book_id: c.book_id, page_id: page.id, n: c.n, name: c.name, expect: 'own', text: page.ocr?.data || '' });
    const old = await preRepairText(page.id);
    if (old) items.push({ kind: 'ctl-old', book_id: c.book_id, page_id: page.id, n: c.n, name: c.name, expect: 'other', text: old.text, rev: old.rev });
    else console.log(`control ${c.name}: no pre-repair revision`);
  }
  const all = shuffle(items, rnd).map((x, i) => ({ ...x, key: `S${String(i + 1).padStart(2, '0')}` }));
  fs.writeFileSync(F('pre-sample.json'), JSON.stringify(all, null, 1));
  console.log(`${all.length} items: ${all.filter((x) => x.kind === 'item').length} stranded pages, ${all.filter((x) => x.kind !== 'item').length} controls`);
  await client.close();
}

export function prePrompt({ title, language, n, win }) {
  const L = [`You are checking which printed page a stored machine transcription comes from. Book: "${title}" (language: ${language || 'unknown'}).`,
    '', `Below are the scans of ${win.length} consecutive leaves of the book, pages ${win[0].n} to ${win[win.length - 1].n}. Open EVERY image with the Read tool before answering.`, ''];
  for (const w of win) L.push(`Page ${w.n}: ${w.img ? `image file ${w.img}` : '(no image available)'}`);
  L.push('', `This is the transcription stored for page ${n}:`, '<<<', clip(strip(win.text)), '>>>', '',
    'Question: which of the leaves above has the printed text this transcription renders? Compare the opening and closing lines, headings, page numbers, notes and pictures.',
    `Answer "p<number>" for the leaf (for example "p${n}"), "none" if it renders none of these leaves (text from further away, or from no page here), or "cannot_tell" if the leaves cannot decide it (blank, illegible, or identical pages).`,
    'Reply with JSON only, no other text:',
    '{"renders": "p<number>" | "none" | "cannot_tell", "printed_folio_of_that_leaf": "<the printed page number you see on it, or null>", "evidence": "<a short quote from the transcription and where it is on that leaf>", "images_opened": [<page numbers you opened>]}');
  return L.join('\n');
}

const parseJson = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

async function pool(items, conc, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: conc }, async () => { for (let it = q.shift(); it; it = q.shift()) await fn(it); }));
}

async function preJudge() {
  const items = JSON.parse(fs.readFileSync(F('pre-sample.json'), 'utf8'));
  const done = new Set(readJsonl(F('pre-verdicts.jsonl')).filter((r) => r.answer).map((r) => r.key));
  await open();
  const titles = new Map();
  await pool(items.filter((x) => !done.has(x.key)), Number(arg('concurrency', '3')), async (it) => {
    const ws = path.join(OUT, 'ws', it.key); fs.mkdirSync(ws, { recursive: true });
    if (!titles.has(it.book_id)) titles.set(it.book_id, await db.collection('books').findOne({ id: it.book_id }, { projection: { title: 1, language: 1 } }));
    const book = titles.get(it.book_id);
    const ps = await windowPages(it.book_id, it.n, 3);
    const win = [];
    for (const p of ps) { const f = path.join(ws, `page-${p.page_number}.jpg`); const got = await fetchLeaf(p, f); win.push({ n: p.page_number, img: got ? f : null }); }
    win.text = it.text;
    const prompt = prePrompt({ title: book?.title, language: book?.language, n: it.n, win });
    const res = await claudeCall(prompt, ws);
    const answer = res.cls ? null : parseJson(res.text);
    fs.appendFileSync(F('pre-verdicts.jsonl'), JSON.stringify({ key: it.key, answer, cls: res.cls, usage: res.usage, secs: res.secs, model: res.model, raw: answer ? undefined : String(res.text || res.err).slice(-400) }) + '\n');
    console.log(`${it.key} ${it.kind} p.${it.n}: ${answer?.renders ?? res.cls}`);
  });
  await client.close();
}

function preScore() {
  const items = JSON.parse(fs.readFileSync(F('pre-sample.json'), 'utf8'));
  const vs = new Map(readJsonl(F('pre-verdicts.jsonl')).filter((r) => r.answer).map((r) => [r.key, r.answer]));
  const rows = items.map((it) => { const a = vs.get(it.key); const m = /^p(-?\d+)$/.exec(a?.renders || ''); const d = m ? Number(m[1]) - it.n : null;
    return { ...it, text: undefined, renders: a?.renders ?? null, d, other: a ? (a.renders === 'none' || (d !== null && d !== 0)) : null, cannot: a?.renders === 'cannot_tell', evidence: a?.evidence }; });
  const S = rows.filter((r) => r.kind === 'item' && r.renders);
  const decided = S.filter((r) => !r.cannot);
  const other = decided.filter((r) => r.other).length;
  const byDiag = {};
  for (const r of S) { const k = r.diag.verdict; const b = (byDiag[k] ||= { n: 0, other: 0, own: 0, cannot: 0, offset_agrees: 0 }); b.n++; if (r.cannot) b.cannot++; else if (r.other) b.other++; else b.own++; if (r.diag.offset != null && r.d === r.diag.offset) b.offset_agrees++; }
  const ctl = rows.filter((r) => r.kind !== 'item').map((r) => ({ name: r.name, kind: r.kind, expect: r.expect, renders: r.renders, ok: r.renders ? (r.expect === 'own' ? r.d === 0 : r.other) : null }));
  const res = { n: S.length, decided: decided.length, cannot_tell: S.length - decided.length, another_leaf: other, precision: decided.length ? other / decided.length : null, wilson: wilson(other, decided.length),
    precision_all_answered: S.length ? other / S.length : null, offsets: decided.filter((r) => r.other).reduce((m, r) => ((m[r.d ?? 'none(>3)'] = (m[r.d ?? 'none(>3)'] || 0) + 1), m), {}),
    by_diagnose: byDiag, controls: { n: ctl.length, ok: ctl.filter((c) => c.ok).length, rows: ctl }, unanswered: items.filter((it) => !vs.has(it.key)).map((it) => it.key),
    rows: rows.filter((r) => r.kind === 'item').map((r) => ({ key: r.key, book_id: r.book_id, n: r.n, language: r.language, diag: r.diag, renders: r.renders, d: r.d, evidence: r.evidence })) };
  res.stop = res.precision !== null && res.precision < 0.8;
  fs.writeFileSync(F('pre-result.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, rows: undefined, controls: { n: res.controls.n, ok: res.controls.ok } }, null, 1));
}

// ── post: is the repaired page its own leaf, and usable? ──
async function postDraw() {
  const rnd = mulberry32(Number(arg('seed', '5310')));
  const N = Number(arg('n', '30'));
  const led = readJsonl(arg('ledger')).filter((r) => r.ocr_written && (!arg('wave') || r.wave === arg('wave')));
  const byBook = new Map();
  for (const r of led) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
  await open();
  const items = [];
  const books = shuffle([...byBook.keys()], rnd);
  for (const b of books) {
    if (items.length >= N) break;
    const r = shuffle(byBook.get(b), rnd)[0];
    const page = await db.collection('pages').findOne({ id: r.page_id }, { projection: PAGE_PROJ });
    if (!page?.ocr?.data) continue;
    items.push({ kind: 'item', book_id: b, page_id: page.id, n: page.page_number, language: r.language, ocr: page.ocr.data, en: page.translation?.data ?? null, ocr_model: page.ocr.model });
  }
  // planted: two repaired pages from other books given back their pre-repair (wrong-leaf) transcription, no English
  // (a wave with no books past the N drawn: another page of a drawn book)
  const drawn = new Set(items.map((x) => x.page_id));
  const spare = [...books.slice(N, N + 20).map((b) => byBook.get(b)[0]), ...books.flatMap((b) => byBook.get(b).filter((r) => !drawn.has(r.page_id)).slice(0, 1))];
  for (const r of spare) {
    if (items.filter((x) => x.kind === 'ctl-old').length >= 2) break;
    const b = r.book_id;
    const page = await db.collection('pages').findOne({ id: r.page_id }, { projection: PAGE_PROJ });
    const old = page && await preRepairText(page.id);
    if (!old || old.text === page.ocr?.data) continue;
    items.push({ kind: 'ctl-old', expect: 'other', book_id: b, page_id: page.id, n: page.page_number, language: r.language, ocr: old.text, en: null });
  }
  const all = shuffle(items, rnd).map((x, i) => ({ ...x, key: `R${String(i + 1).padStart(2, '0')}` }));
  fs.writeFileSync(F('post-sample.json'), JSON.stringify(all, null, 1));
  console.log(`${all.length} items (${all.filter((x) => x.kind !== 'item').length} controls) in ${new Set(all.map((x) => x.book_id)).size} books`);
  await client.close();
}

// 2026-11-08: at 6,000 characters a dense two-column Migne page (7.6K OCR, 9.8K English) reached the judge cut, and Opus
// called the cut a serious omission. The judge must see the whole text it is asked about.
const POST_CLIP = 30_000;
export const DEFECT_KINDS = ['omission', 'misread', 'invented', 'wrong_leaf', 'garble', 'mistranslation', 'other'];
export function postPrompt({ title, language, n, win, ocr, en, tool = 'the Read tool' }) {
  const L = [`You are checking the text shown to readers on page ${n} of "${title}" (language: ${language || 'unknown'}): a machine transcription of the page${en ? ' and its English translation' : ''}.`,
    '', `Scans of pages ${win.map((w) => w.n).join(', ')} (open EVERY image with ${tool} before answering; page ${n} is the one being checked, its neighbours are there so you can tell the leaves apart):`];
  for (const w of win) L.push(`Page ${w.n}: ${w.img ? `image file ${w.img}` : '(no image available)'}`);
  L.push('', `Transcription shown for page ${n}:`, '<<<', clip(strip(ocr), POST_CLIP), '>>>');
  if (en) L.push('', `English shown for page ${n}:`, '<<<', clip(en, POST_CLIP), '>>>');
  L.push('', 'Questions:',
    `1. leaf: which leaf's printed text does the transcription render? "own" (page ${n}), "prev" (page ${n - 1}), "next" (page ${n + 1}), "other", or "cannot_tell".`,
    `2. ocr_usable: true if a reader could rely on the transcription as page ${n}'s text: no line or more left out, nothing added that is not printed, misreadings only minor; else false.`,
    en ? `3. en_leaf and en_usable: the same two questions for the English (usable = renders the page's text faithfully: no sentence or more left out, no meaning changed, nothing added).` : '3. en_leaf and en_usable: null (no English).',
    `4. defects: every defect you see, each {"stage": "ocr" | "translation", "kind": ${DEFECT_KINDS.map((k) => `"${k}"`).join(' | ')}, "severity": "minor" | "serious", "what": "<one line>", "quote": "<short quote>"}. Serious = a line/sentence or more lost, added or changed in meaning, or wrong leaf.`,
    '', 'Reply with JSON only, no other text:',
    '{"leaf": "...", "ocr_usable": true|false, "en_leaf": "..."|null, "en_usable": true|false|null, "defects": [...], "note": "<one line>", "images_opened": [<page numbers>]}');
  return L.join('\n');
}

async function postJudge() {
  const judge = arg('judge', 'opus');
  const items = JSON.parse(fs.readFileSync(F('post-sample.json'), 'utf8'));
  const vf = F(`post-verdicts-${judge}.jsonl`);
  const done = new Set(readJsonl(vf).filter((r) => r.answer).map((r) => r.key));
  await open();
  const titles = new Map();
  await pool(items.filter((x) => !done.has(x.key)), Number(arg('concurrency', '3')), async (it) => {
    const ws = path.join(OUT, `ws-${judge}`, it.key); fs.mkdirSync(ws, { recursive: true });
    if (!titles.has(it.book_id)) titles.set(it.book_id, await db.collection('books').findOne({ id: it.book_id }, { projection: { title: 1, language: 1 } }));
    const book = titles.get(it.book_id);
    const ps = await windowPages(it.book_id, it.n, 1);
    const win = [];
    for (const p of ps) { const f = path.join(ws, `page-${p.page_number}.jpg`); const got = await fetchLeaf(p, f); win.push({ n: p.page_number, img: got ? (judge === 'agy' ? path.basename(f) : f) : null }); }
    let res;
    if (judge === 'agy') {
      installToolGate(ws, { task: 'ocr' });
      const prompt = postPrompt({ title: book?.title, language: book?.language, n: it.n, win, ocr: it.ocr, en: it.en, tool: 'read_file (the only tool here)' });
      res = await agyCall(['-p', prompt, '--model', arg('model', 'gemini-3.8-flash-low'), ...installNarrowAgent(ws, 'ocr'), ...CLI_SAFE_ARGS], ws);
      res.opened = gateReads(path.join(ws, '.agents', 'gate.jsonl')).map((p) => path.basename(p));
      if (res.cls === 'quota') { console.error(`agy quota: ${res.err}`); return; }
    } else {
      res = await claudeCall(postPrompt({ title: book?.title, language: book?.language, n: it.n, win, ocr: it.ocr, en: it.en }), ws);
    }
    const answer = res.cls ? null : parseJson(res.text);
    fs.appendFileSync(vf, JSON.stringify({ key: it.key, judge, answer, cls: res.cls, usage: res.usage ?? null, secs: res.secs, opened: res.opened, raw: answer ? undefined : String(res.text || res.err).slice(-400) }) + '\n');
    console.log(`${judge} ${it.key} ${it.kind} p.${it.n}: ${answer ? `${answer.leaf} ocr_usable=${answer.ocr_usable} en=${answer.en_leaf}/${answer.en_usable}` : res.cls}`);
  });
  await client.close();
}

export const usable = (a, hasEn) => !!a && a.leaf === 'own' && a.ocr_usable === true && (!hasEn || (a.en_leaf === 'own' && a.en_usable === true));
function postScore() {
  const items = JSON.parse(fs.readFileSync(F('post-sample.json'), 'utf8'));
  const get = (j) => new Map(readJsonl(F(`post-verdicts-${j}.jsonl`)).filter((r) => r.answer).map((r) => [r.key, r.answer]));
  const O = get('opus'), A = get('agy');
  const S = items.filter((x) => x.kind === 'item' && O.has(x.key));
  const own = S.filter((x) => O.get(x.key).leaf === 'own').length;
  const use = S.filter((x) => usable(O.get(x.key), !!x.en)).length;
  const kinds = {};
  for (const x of S) for (const d of O.get(x.key).defects || []) { const k = `${d.stage}/${d.kind}/${d.severity}`; kinds[k] = (kinds[k] || 0) + 1; }
  // agy as a checker: "flag" = not usable. Against Opus as reference: false alarms (agy flags, Opus usable) and misses.
  const both = S.filter((x) => A.has(x.key));
  const cal = { n: both.length, agree: 0, false_alarm: 0, miss: 0, leaf_agree: 0, opus_flags: 0, agy_flags: 0 };
  for (const x of both) { const o = !usable(O.get(x.key), !!x.en), a = !usable(A.get(x.key), !!x.en); if (o === a) cal.agree++; if (a && !o) cal.false_alarm++; if (o && !a) cal.miss++; if (o) cal.opus_flags++; if (a) cal.agy_flags++; if (O.get(x.key).leaf === A.get(x.key).leaf) cal.leaf_agree++; }
  const ctl = items.filter((x) => x.kind !== 'item').map((x) => ({ key: x.key, expect: x.expect, opus: O.get(x.key)?.leaf ?? null, agy: A.get(x.key)?.leaf ?? null }));
  const res = { n: S.length, own_leaf: own, usable: use, usable_wilson: wilson(use, S.length), pass: S.length >= 30 && own === S.length && use >= 27, defects_by_kind: kinds,
    agy_checker: cal, controls: ctl, unanswered_opus: items.filter((x) => !O.has(x.key)).map((x) => x.key),
    rows: S.map((x) => ({ key: x.key, book_id: x.book_id, n: x.n, language: x.language, has_en: !!x.en, opus: O.get(x.key), agy: A.get(x.key) ?? null })) };
  fs.writeFileSync(F('post-result.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, rows: undefined }, null, 1));
}

// ── screen: can agy tell, from the image, whether a stored transcription is this leaf, the previous, the next or other? ──
// Blind on the pre sample's stranded pages plus four planted controls (two of the issue's control pages with their own,
// repaired text; two given the text of the leaf before / after). Reference: the Opus pre verdicts (n−3 … n+3 window).
export const SCREEN_ANSWERS = ['own', 'prev', 'next', 'other', 'cannot_tell'];
export function screenPrompt({ title, language, n, win, text, tool = 'read_file (the only tool here)' }) {
  const L = [`You are checking which printed page a stored machine transcription comes from. Book: "${title}" (language: ${language || 'unknown'}).`,
    '', `Below are the scans of pages ${win.map((w) => w.n).join(', ')}. Open EVERY image with ${tool} before answering.`, ''];
  for (const w of win) L.push(`Page ${w.n}: ${w.img ? `image file ${w.img}` : '(no image available)'}`);
  L.push('', `This is the transcription stored for page ${n}:`, '<<<', clip(strip(text)), '>>>', '',
    `Question: whose printed text does this transcription render? Compare the opening and closing lines, headings, page numbers, notes and pictures.`,
    `Answer "own" (page ${n}), "prev" (page ${n - 1}), "next" (page ${n + 1}), "other" (none of these leaves: text from further away or from no page here), or "cannot_tell" (blank, illegible or identical pages).`,
    'Reply with JSON only, no other text:',
    '{"leaf": "own" | "prev" | "next" | "other" | "cannot_tell", "evidence": "<a short quote from the transcription and where it is, or why it is on none of the leaves>"}');
  return L.join('\n');
}
const opusLeaf = (renders, n) => { if (!renders) return null; if (renders === 'cannot_tell') return 'cannot_tell'; const m = /^p(-?\d+)$/.exec(renders); if (!m) return 'other'; const d = Number(m[1]) - n; return d === 0 ? 'own' : d === -1 ? 'prev' : d === 1 ? 'next' : 'other'; };

async function screenDraw() {
  const rnd = mulberry32(Number(arg('seed', '5311')));
  const pre = JSON.parse(fs.readFileSync(arg('pre-sample'), 'utf8'));
  const opus = new Map(readJsonl(arg('pre-verdicts')).filter((r) => r.answer).map((r) => [r.key, r.answer.renders]));
  await open();
  const items = pre.filter((x) => x.kind === 'item').map((x) => ({ kind: 'item', book_id: x.book_id, page_id: x.page_id, n: x.n, language: x.language, text: x.text, pre_key: x.key, opus: opusLeaf(opus.get(x.key), x.n) }));
  const ctl = shuffle(pre.filter((x) => x.kind === 'ctl-current'), rnd).slice(0, 4);
  for (const [i, c] of ctl.entries()) {
    if (i < 2) { items.push({ kind: 'ctl-own', book_id: c.book_id, page_id: c.page_id, n: c.n, name: c.name, text: c.text, expect: 'own' }); continue; }
    const dn = i === 2 ? -1 : 1;
    const nb = await db.collection('pages').findOne({ book_id: c.book_id, page_number: c.n + dn }, { projection: PAGE_PROJ });
    items.push({ kind: 'ctl-neighbour', book_id: c.book_id, page_id: c.page_id, n: c.n, name: c.name, text: nb?.ocr?.data || '', from_page: c.n + dn, expect: dn < 0 ? 'prev' : 'next' });
  }
  const all = shuffle(items, rnd).map((x, i) => ({ ...x, key: `Q${String(i + 1).padStart(2, '0')}` }));
  fs.writeFileSync(F('screen-sample.json'), JSON.stringify(all, null, 1));
  console.log(`${all.length} items: ${all.filter((x) => x.kind === 'item').length} pages, controls ${all.filter((x) => x.kind !== 'item').map((x) => `${x.name}:${x.expect}`).join(', ')}`);
  await client.close();
}

async function screenJudge() {
  const model = arg('model', 'gemini-3.8-flash-medium');
  if (/argon/.test(model)) throw new Error('screen: never Argon (#5309 inbox)');
  const items = JSON.parse(fs.readFileSync(F('screen-sample.json'), 'utf8'));
  const vf = F(`screen-verdicts-${model}.jsonl`);
  const done = new Set(readJsonl(vf).filter((r) => r.answer).map((r) => r.key));
  const q = agyQuota(process.env.AGY_HOME || '', { ttlMs: 0 });
  if (!(q?.gemini?.weekly >= Number(arg('weekly-end', '0.25')))) throw new Error(`screen: agy Gemini weekly ${q?.gemini?.weekly} under the floor`);
  await open();
  const titles = new Map();
  let quota = false;
  await pool(items.filter((x) => !done.has(x.key)), Number(arg('concurrency', '3')), async (it) => {
    if (quota) return;
    const ws = path.join(OUT, `ws-screen-${model}`, it.key); fs.mkdirSync(ws, { recursive: true });
    if (!titles.has(it.book_id)) titles.set(it.book_id, await db.collection('books').findOne({ id: it.book_id }, { projection: { title: 1, language: 1 } }));
    const book = titles.get(it.book_id);
    const win = [];
    for (const p of await windowPages(it.book_id, it.n, 1)) { const f = path.join(ws, `page-${p.page_number}.jpg`); const got = await fetchLeaf(p, f); win.push({ n: p.page_number, img: got ? path.basename(f) : null }); }
    installToolGate(ws, { task: 'ocr' });
    const res = await agyCall(['-p', screenPrompt({ title: book?.title, language: book?.language, n: it.n, win, text: it.text }), '--model', model, ...installNarrowAgent(ws, 'ocr'), ...CLI_SAFE_ARGS], ws);
    if (res.cls === 'quota') { quota = true; console.error(`agy quota: ${res.err}`); return; }
    const opened = gateReads(path.join(ws, '.agents', 'gate.jsonl')).map((p) => path.basename(p));
    const calls = gateCalls(path.join(ws, '.agents', 'gate.jsonl'));
    const answer = res.cls ? null : parseJson(res.text);
    fs.appendFileSync(vf, JSON.stringify({ key: it.key, model, answer, cls: res.cls, usage: res.usage ?? null, secs: res.secs, opened, window: win.filter((w) => w.img).length, tool_calls: calls, raw: answer ? undefined : String(res.text || res.err).slice(-400) }) + '\n');
    console.log(`${it.key} p.${it.n}: ${answer?.leaf ?? res.cls} (opened ${opened.length}/${win.filter((w) => w.img).length})`);
  });
  await client.close();
}

function screenScore() {
  const model = arg('model', 'gemini-3.8-flash-medium');
  const items = JSON.parse(fs.readFileSync(F('screen-sample.json'), 'utf8'));
  const V = new Map(readJsonl(F(`screen-verdicts-${model}.jsonl`)).filter((r) => r.answer).map((r) => [r.key, r]));
  const off = (l) => l === 'prev' || l === 'next' || l === 'other';
  const S = items.filter((x) => x.kind === 'item' && V.has(x.key) && x.opus && x.opus !== 'cannot_tell');
  const c = { n: S.length, agree_binary: 0, agree_exact: 0, false_alarm: 0, miss: 0, agy_cannot_tell: 0, opus_off: 0, agy_off: 0, all_images_opened: 0, denied_reads: 0 };
  const rows = [];
  for (const x of S) {
    const v = V.get(x.key), a = v.answer.leaf;
    if (a === 'cannot_tell') c.agy_cannot_tell++;
    else if (off(a) === off(x.opus)) c.agree_binary++;
    if (a === x.opus) c.agree_exact++;
    if (off(a) && !off(x.opus)) c.false_alarm++;
    if (a === 'own' && off(x.opus)) c.miss++;
    if (off(x.opus)) c.opus_off++; if (off(a)) c.agy_off++;
    if ((v.tool_calls || []).some((t) => t.endsWith(':deny'))) c.denied_reads++;
    if (new Set(v.opened).size >= (v.window ?? 3)) c.all_images_opened++;
    rows.push({ key: x.key, book_id: x.book_id, n: x.n, language: x.language, opus: x.opus, agy: a, evidence: v.answer.evidence, opened: v.opened, tool_calls: v.tool_calls });
  }
  const ctl = items.filter((x) => x.kind !== 'item').map((x) => { const a = V.get(x.key)?.answer?.leaf ?? null; return { key: x.key, name: x.name, kind: x.kind, expect: x.expect, agy: a, caught: a === x.expect }; });
  const usage = [...V.values()].reduce((m, r) => { for (const k of ['input_tokens', 'output_tokens', 'thinking_tokens', 'cache_read_tokens']) m[k] = (m[k] || 0) + (r.usage?.[k] || 0); return m; }, {});
  const res = { model, ...c, agreement: c.n ? c.agree_binary / c.n : null, agreement_wilson: wilson(c.agree_binary, c.n), exact: c.n ? c.agree_exact / c.n : null,
    controls: { n: ctl.length, caught: ctl.filter((x) => x.caught).length, rows: ctl },
    pass: c.n >= 28 && c.agree_binary / c.n >= 0.9 && ctl.length === 4 && ctl.every((x) => x.caught),
    unanswered: items.filter((x) => !V.has(x.key)).map((x) => x.key), opus_cannot_tell: items.filter((x) => x.kind === 'item' && x.opus === 'cannot_tell').map((x) => x.key),
    usage, secs_mean: V.size ? [...V.values()].reduce((s, r) => s + (r.secs || 0), 0) / V.size : null, rows };
  fs.writeFileSync(F('screen-result.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, rows: undefined }, null, 1));
}

// ── the screen in front of the repair (offleaf-fix-5309.mjs run --screen) ──
// screen-queue: the next books the runner would take (same order and skips), every page with its stored text.
async function screenQueue() {
  const q = JSON.parse(fs.readFileSync(arg('queue'), 'utf8'));
  const done = new Set(readJsonl(arg('ledger')).map((r) => r.book_id));
  const MAX = Number(arg('max-pages', '2000')), BIG = Number(arg('max-book-pages', 'Infinity'));
  const take = []; let n = 0;
  for (const b of q) { if (done.has(b.book_id) || b.hold || b.pages.length > BIG) continue; if (n + b.pages.length > MAX && take.length) continue; take.push(b); n += b.pages.length; if (n >= MAX) break; }
  await open();
  const items = [];
  for (const b of take) {
    const held = await db.collection('books').findOne({ id: b.book_id }, { projection: { 'pipeline_auto.hold.reason': 1 } });
    if (held?.pipeline_auto?.hold) continue;
    const ps = new Map((await db.collection('pages').find({ id: { $in: b.pages.map((p) => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p.ocr?.data || '']));
    for (const p of b.pages) items.push({ kind: 'item', book_id: b.book_id, page_id: p.page_id, n: p.n, language: b.language, diag: { verdict: p.verdict }, text: ps.get(p.page_id) ?? '' });
  }
  const all = items.map((x, i) => ({ ...x, key: `W${String(i + 1).padStart(4, '0')}` }));
  fs.writeFileSync(F('screen-sample.json'), JSON.stringify(all));
  console.log(`${all.length} pages in ${new Set(all.map((x) => x.book_id)).size} books`);
  await client.close();
}

// screen-confirm-draw: what Opus reads blind (pre-judge in DIR/opus): every page agy did not call off-leaf, and a sample
// of agy's off-leaf calls, one page per book (--n 30).
function screenConfirmDraw() {
  const model = arg('model', 'gemini-3.8-flash-medium');
  const rnd = mulberry32(Number(arg('seed', '5312')));
  const items = JSON.parse(fs.readFileSync(F('screen-sample.json'), 'utf8'));
  const V = new Map(readJsonl(F(`screen-verdicts-${model}.jsonl`)).filter((r) => r.answer).map((r) => [r.key, r.answer.leaf]));
  const OFF = new Set(['prev', 'next', 'other']);
  const disagree = items.filter((x) => !OFF.has(V.get(x.key)));
  const byBook = new Map();
  for (const x of shuffle(items.filter((x) => OFF.has(V.get(x.key))), rnd)) if (!byBook.has(x.book_id)) byBook.set(x.book_id, x);
  const sample = shuffle([...byBook.values()], rnd).slice(0, Number(arg('n', '30')));
  const all = shuffle([...disagree.map((x) => ({ ...x, why: 'agy-not-off' })), ...sample.map((x) => ({ ...x, why: 'agy-off-sample' }))], rnd)
    .map((x, i) => ({ ...x, diag: { verdict: `${x.why}:${V.get(x.key) ?? 'unanswered'}` }, screen_key: x.key, key: `O${String(i + 1).padStart(3, '0')}` }));
  fs.mkdirSync(F('opus'), { recursive: true });
  fs.writeFileSync(F('opus/pre-sample.json'), JSON.stringify(all, null, 1));
  console.log(`opus confirms ${all.length}: ${disagree.length} agy-not-off, ${sample.length} sampled agy-off`);
}

// screen-merge: one decision per page for the runner. Off-leaf = Opus says another leaf when Opus read it, else agy does.
function screenMerge() {
  const model = arg('model', 'gemini-3.8-flash-medium');
  const items = JSON.parse(fs.readFileSync(F('screen-sample.json'), 'utf8'));
  const V = new Map(readJsonl(F(`screen-verdicts-${model}.jsonl`)).filter((r) => r.answer).map((r) => [r.key, r.answer.leaf]));
  const conf = fs.existsSync(F('opus/pre-sample.json')) ? JSON.parse(fs.readFileSync(F('opus/pre-sample.json'), 'utf8')) : [];
  const ov = new Map(readJsonl(F('opus/pre-verdicts.jsonl')).filter((r) => r.answer).map((r) => [r.key, r.answer.renders]));
  const O = new Map(conf.filter((c) => ov.has(c.key)).map((c) => [c.screen_key, opusLeaf(ov.get(c.key), c.n)]));
  const OFF = new Set(['prev', 'next', 'other']);
  const rows = items.map((x) => { const a = V.get(x.key) ?? null, o = O.get(x.key) ?? null; const by = o ? 'opus' : a ? 'agy' : null;
    return { page_id: x.page_id, book_id: x.book_id, n: x.n, agy: a, opus: o, by, off: by ? OFF.has(o ?? a) : null }; });
  fs.writeFileSync(F('screen.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const sampled = conf.filter((c) => c.why === 'agy-off-sample' && O.has(c.screen_key));
  const sOk = sampled.filter((c) => OFF.has(O.get(c.screen_key))).length;
  const dis = conf.filter((c) => c.why === 'agy-not-off');
  const res = { pages: rows.length, off: rows.filter((r) => r.off === true).length, own: rows.filter((r) => r.off === false).length, undecided: rows.filter((r) => r.off === null).length,
    agy: rows.reduce((m, r) => ((m[r.agy] = (m[r.agy] || 0) + 1), m), {}),
    opus_on_agy_not_off: dis.reduce((m, c) => { const k = `${V.get(c.screen_key) ?? 'unanswered'}→${O.get(c.screen_key) ?? 'unread'}`; m[k] = (m[k] || 0) + 1; return m; }, {}),
    agy_off_sample: { n: sampled.length, opus_off: sOk, wilson: wilson(sOk, sampled.length) } };
  fs.writeFileSync(F('screen-merge.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
}

// ── book_checks rows ──
async function record() {
  const { recordPageVerdicts, readMethod } = await import('../../lib/book-checks.mjs');
  const stage = arg('stage');
  const METHOD = 'leak-off-leaf-5309';
  const verdicts = [];
  if (stage === 'pre') {
    const r = JSON.parse(fs.readFileSync(F('pre-result.json'), 'utf8'));
    const items = new Map(JSON.parse(fs.readFileSync(F('pre-sample.json'), 'utf8')).map((x) => [x.key, x]));
    for (const row of r.rows) {
      if (!row.renders || row.renders === 'cannot_tell') continue;
      const off = row.renders === 'none' || (row.d !== null && row.d !== 0);
      verdicts.push({ page_id: items.get(row.key).page_id, outcome: off ? 'serious' : 'clean', page_verdict: off ? 'fix' : 'show', verdict: off ? `another leaf (${row.renders})` : 'own leaf',
        ...(off ? { wrong_page: true, errors: [{ stage: 'ocr', class: 'wrong_leaf', problem: `stored transcription renders ${row.renders === 'none' ? 'a leaf outside n±3' : `page ${row.n + row.d}`}: ${String(row.evidence || '').slice(0, 300)}` }] } : { errors: [] }),
        note: String(row.evidence || '').slice(0, 500), defects: off ? [{ severity: 'wrong_text', what: `transcription of another leaf (${row.renders})` }] : [], judged: { ocr: items.get(row.key).text } });
    }
  } else {
    const r = JSON.parse(fs.readFileSync(F('post-result.json'), 'utf8'));
    const items = new Map(JSON.parse(fs.readFileSync(F('post-sample.json'), 'utf8')).map((x) => [x.key, x]));
    for (const row of r.rows) {
      const a = row.opus; const it = items.get(row.key);
      const ser = (a.defects || []).filter((d) => d.severity === 'serious');
      const wrong = a.leaf !== 'own';
      const bad = wrong || ser.length > 0 || !usable(a, row.has_en);
      verdicts.push({ page_id: it.page_id, outcome: bad ? 'serious' : (a.defects || []).length ? 'minor' : 'clean', page_verdict: bad ? 'fix' : (a.defects || []).length ? 'caveat' : 'show', verdict: usable(a, row.has_en) ? 'usable' : 'not usable',
        ...(wrong ? { wrong_page: true } : {}),
        errors: bad ? (ser.length ? ser : [{ stage: 'ocr', kind: 'other', what: a.note || 'judged not usable' }]).map((d) => ({ stage: d.stage === 'translation' ? 'translation' : 'ocr', class: d.kind, problem: `${d.what ?? ''} «${String(d.quote ?? '').slice(0, 200)}»`.slice(0, 600) })) : [],
        note: String(a.note || '').slice(0, 500), defects: (a.defects || []).map((d) => ({ severity: d.severity === 'serious' ? 'wrong_text' : 'cosmetic', what: `${d.stage}/${d.kind}: ${d.what ?? ''}`.slice(0, 300), ...(d.quote ? { quote: String(d.quote).slice(0, 200) } : {}) })),
        judged: { ocr: it.ocr, translation: it.en } });
    }
  }
  await open();
  const out = await recordPageVerdicts(db, { method_id: METHOD, method_version: readMethod(METHOD).version, run_id: `offleaf-5309-${stage}-${path.basename(OUT)}`, checked_at: new Date(),
    selection: 'random', stages: stage === 'pre' ? ['ocr'] : ['ocr', 'translation'], reader: { kind: 'model', model: 'claude -p --model opus', image_opened: true },
    evidence_path: `box:${os.hostname()}:${F(`${stage}-result.json`)}`, reader_warning: false, exposure: 'live',
    note: stage === 'pre' ? 'One stranded page per book (#5309 audit), the stored transcription judged blind against the scans of n-3 … n+3.' : 'One page per book from those the offleaf-5309 repair re-OCR\'d (and re-translated), judged blind against the scans of n-1, n, n+1.',
    frame: { lane: 'offleaf-5309', stage, pages_drawn: verdicts.length }, verdicts }, { apply: process.argv.includes('--apply') });
  console.log(`rows ${out.rows.length}, inserted ${out.inserted}, already ${out.already}, failed ${JSON.stringify(out.failed)}`);
  await client.close();
}

const MODES = { 'pre-draw': preDraw, 'pre-judge': preJudge, 'pre-score': preScore, 'post-draw': postDraw, 'post-judge': postJudge, 'post-score': postScore, 'screen-draw': screenDraw, 'screen-judge': screenJudge, 'screen-score': screenScore, 'screen-queue': screenQueue, 'screen-confirm-draw': screenConfirmDraw, 'screen-merge': screenMerge, record };
if (!MODES[MODE]) { console.error(`mode: ${Object.keys(MODES).join(' | ')}`); process.exit(2); }
await MODES[MODE]();

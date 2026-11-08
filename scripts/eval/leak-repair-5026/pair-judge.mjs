#!/usr/bin/env node
// PRIOR ART: scripts/eval/context-bleed-5274/judge.mjs (blind Opus over ONE page's English with the scans of n-1, n,
// n+1 and planted controls; it asks "which leaf does this English render", not "is page N's text duplicated into
// N+1's", and takes no pair); scripts/audit/leaf-shift-confirm-5021.mjs (fetchLeaf, claudeCall, reused here);
// scripts/maintenance/wrong-leaf-fix-5021.mjs judge (stored vs new English, one page). None judges a flagged PAIR
// from scripts/audit/translation-page-boundaries.mjs (#5026 leak), so this is that pair's spot check.
/**
 * leak-repair-5026 spot checks. The input is the detector's flagged pairs: page N's English shares a run >= 500 chars
 * with page N+1's English while their sources do not (one line per pair; page_id is the RECEIVING page N+1).
 *
 *   node --env-file=… scripts/eval/leak-repair-5026/pair-judge.mjs draw  --in=/tmp/leak-joined-500.jsonl --out=DIR [--seed=50260]
 *   … judge --out=DIR [--concurrency=3]      blind sealed `claude -p --model opus`, one call per pair (resumable)
 *   … score --out=DIR                        precision by stratum with Wilson 95% CIs, controls
 *   … post-draw --out=DIR --ledger=FILE [--n=30]   one repaired page per book, stratified by language
 *   … post-judge --out=DIR                   repaired page N+1 against its image: own-leaf fidelity, duplication gone
 *   … post-score --out=DIR
 *
 * Strata (each pair in one): cur = the current cli lane (scripts/batch/cli-translate.mjs, gemini-3.8-flash-low,
 * prompt 21); en = English-language books (modernisation); pre07 = written before 2026-07; mid = 2026-07..09;
 * late = 2026-10/11 not the cli lane (mostly translate-batch-chained). Inside a stratum the draw balances the two
 * length bands (500-999, >= 1000) and spreads languages; one pair per book over the whole draw.
 * Controls (4): 2 made duplicates (a clean pair whose N+1 English gets ~600 chars of N's English prepended) and 2
 * clean consecutive pairs from the same books that the detector did not flag. The judge is not told which is which.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MongoClient } from 'mongodb';
import { fetchLeaf, claudeCall } from '../../audit/leaf-shift-confirm-5021.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const MODE = process.argv[2];
const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out', '.'));
const has = (n) => process.argv.includes(`--${n}`);
fs.mkdirSync(OUT, { recursive: true });
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (xs, rnd) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const stratum = (r) => (r.site?.startsWith('scripts/batch/cli-translate') ? 'cur'
  : /^english$/i.test(r.lang) ? 'en'
  : r.month < '2026-07' ? 'pre07' : r.month < '2026-10' ? 'mid' : 'late');
export const band = (r) => (r.len >= 1000 ? '>=1000' : '500-999');
export const ALLOC = { cur: 12, en: 10, pre07: 14, mid: 6, late: 8 };

const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation.edited_by': 1, 'translation.source': 1, translation_withheld: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, display_photo: 1, photo_original: 1 };
const strip = (s) => String(s || '').replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, '[picture regions listed]');
const body = (t) => String(t || '').replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/\s+/g, ' ').trim();

let client, db;
async function open() { client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await client.connect(); db = client.db('bookstore'); }

// ── draw ──
async function draw() {
  // --frame=live-frame.jsonl: draw only pairs inFrame() on the live English (round 2); --exclude=sample.json: not
  // from books an earlier round drew; --alloc=cur:10,en:10,…
  let rows = readJsonl(arg('frame') || arg('in', '/tmp/leak-joined-500.jsonl'));
  if (arg('frame')) rows = rows.filter(inFrame);
  const excl = arg('exclude') ? new Set(JSON.parse(fs.readFileSync(arg('exclude'), 'utf8')).map((r) => r.book)) : new Set();
  const alloc = arg('alloc') ? Object.fromEntries(arg('alloc').split(',').map((x) => x.split(':')).map(([k, v]) => [k, Number(v)])) : ALLOC;
  const rnd = mulberry32(Number(arg('seed', 50260)));
  const used = new Set(excl), picked = [];
  for (const [s, n] of Object.entries(alloc)) {
    const pool = shuffle(rows.filter((r) => stratum(r) === s), rnd);
    const langs = new Map(); // language → times picked, so the draw spreads languages
    const bands = { '500-999': 0, '>=1000': 0 };
    for (let k = 0; k < n; k++) {
      const wantBand = bands['500-999'] <= bands['>=1000'] ? '500-999' : '>=1000';
      const ok = pool.filter((r) => !used.has(r.book) && band(r) === wantBand);
      const from = ok.length ? ok : pool.filter((r) => !used.has(r.book));
      if (!from.length) break;
      // round 1 spread languages evenly (least-drawn first), which over-drew rare scripts; --proportional draws in
      // the frame's own proportions with no language over 40% of the stratum
      const min = Math.min(...from.map((r) => langs.get(r.lang) || 0));
      const cap = Math.max(2, Math.ceil(n * 0.4));
      const r = has('proportional') ? (from.find((x) => (langs.get(x.lang) || 0) < cap) || from[0]) : from.find((x) => (langs.get(x.lang) || 0) === min);
      used.add(r.book); langs.set(r.lang, (langs.get(r.lang) || 0) + 1); bands[band(r)]++;
      picked.push({ ...r, stratum: s, band: band(r), ...(arg('frame') && { dir: direction(r) }) });
    }
  }
  // controls: consecutive translated pairs from books in the input that the detector did not flag
  await open();
  const flagged = new Set(rows.map((r) => `${r.book}:${r.next}`));
  const ctlBooks = shuffle([...new Set(rows.map((r) => r.book))].filter((b) => !used.has(b)), rnd);
  const controls = [];
  for (const b of ctlBooks) {
    if (controls.length >= 4) break;
    const ps = await db.collection('pages').find({ book_id: b, 'translation.data': { $type: 'string' } }, { projection: { _id: 0, page_number: 1, 'translation.data': 1, id: 1 } }).sort({ page_number: 1 }).toArray();
    const cand = ps.filter((p, i) => i + 1 < ps.length && ps[i + 1].page_number === p.page_number + 1 && !flagged.has(`${b}:${p.page_number + 1}`) && !flagged.has(`${b}:${p.page_number}`) && !flagged.has(`${b}:${p.page_number + 2}`) && body(p.translation.data).length >= 900 && body(ps[i + 1].translation.data).length >= 400);
    if (!cand.length) continue;
    const p = cand[Math.floor(rnd() * cand.length)];
    const nxt = ps.find((x) => x.page_number === p.page_number + 1);
    const kind = controls.length < 2 ? 'made-dup' : 'clean';
    used.add(b);
    controls.push({ book: b, prev: p.page_number, next: p.page_number + 1, page_id: nxt.id, control: kind, stratum: 'control', band: kind === 'made-dup' ? '500-999' : null });
  }
  const all = shuffle([...picked, ...controls], rnd).map((r, i) => ({ ...r, key: `P${String(i + 1).padStart(2, '0')}` }));
  fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(all, null, 1));
  const tab = {}; for (const r of all) { const k = `${r.stratum} ${r.band}`; tab[k] = (tab[k] || 0) + 1; }
  console.log(`${all.length} pairs (${controls.length} controls) in ${used.size - excl.size} books`, tab);
  console.log('languages', Object.fromEntries(Object.entries(all.reduce((m, r) => ((m[r.lang || 'control'] = (m[r.lang || 'control'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])));
}

/** The made duplicate: ~600 chars of page N's English body, cut at a sentence end, put at the head of N+1's English. */
export function makeDup(prevEn, nextEn) {
  const b = body(prevEn);
  let cut = b.indexOf('. ', 600); if (cut < 0 || cut > 900) cut = Math.min(b.length, 700);
  return `${b.slice(0, cut + 1).trim()}\n\n${nextEn}`;
}

export function pairPrompt({ title, language, n, win }) {
  const L = [`You are checking the English shown to readers on two consecutive pages, ${n} and ${n + 1}, of "${title}" (language: ${language}). For each page you get its scan (open EVERY image with the Read tool), a machine transcription that can be wrong or incomplete (trust the image), and the English readers are shown.`, ''];
  for (const w of win) L.push(`=== Page ${w.n} ===`, w.img ? `Image file: ${w.img}` : 'Image: (not available)', `Transcription of page ${w.n}:`, '<<<', w.ocr || '(empty)', '>>>', `English shown on page ${w.n}:`, '<<<', w.en || '(none)', '>>>', '');
  L.push('A known translation fault: a page\'s English repeats a passage that renders text printed on a NEIGHBOURING page, so a reader sees the same passage twice. Another: a page\'s English renders the next page\'s text instead of its own. Some books also legitimately print the same words on both pages (a running refrain, a repeated table, a reprinted paragraph); that is not a fault.',
    '', 'Questions:',
    `1. dup: does the English of page ${n + 1} contain a passage of a paragraph or more that renders text printed on page ${n} (and not printed on page ${n + 1})? "yes", "no", or "other" (the two Englishes do overlap, but for another reason: say which in "why").`,
    `1b. fwd: does the English of page ${n} contain a passage of a paragraph or more that renders text printed on page ${n + 1} (and not printed on page ${n})? "yes" or "no". Read each English to its end.`,
    `2. wrong: which page's English is wrong about where the overlapping passage belongs? "${n + 1}" (page ${n + 1} carries page ${n}'s text), "${n}" (page ${n} carries page ${n + 1}'s text), "both", "neither" (the text is printed on both pages, or there is no overlap).`,
    `3. own: apart from any overlapping passage, does page ${n + 1}'s English render page ${n + 1}'s own printed text? "yes", "partly", or "no".`,
    `4. share: roughly what fraction of page ${n + 1}'s English body is text that belongs to page ${n}? A number 0 to 1.`,
    'Judge content, not style. Answer with JSON only, no code fence: {"dup":"yes|no|other","fwd":"yes|no","wrong":"N|N+1|both|neither as the page number or word","own":"yes|partly|no","share":0.0,"why":"one or two lines: the overlapping passage (a phrase) and where it is printed, by page number"}');
  return L.join('\n');
}

async function loadWindow(s, dir) {
  const pages = await db.collection('pages').find({ book_id: s.book, page_number: { $in: [s.prev, s.next] } }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
  const win = [];
  for (const p of pages) {
    const img = `p${p.page_number}.jpg`;
    const got = await fetchLeaf({ display_photo: getPageSource(p), photo: p.photo, archived_photo: p.archived_photo, photo_original: p.photo_original }, path.join(dir, img));
    // v1 cut the English at 6,000 chars and the OCR at 3,500: on long pages the overlap sat past the cut and the judge
    // could not see it (round 2, 3 of 3 forward "no overlap" read by hand). v2 sends up to 16,000 / 8,000.
    win.push({ n: p.page_number, img: got ? img : null, ocr: strip(p.ocr?.data).slice(0, 8000), en: String(p.translation?.data || '').slice(0, 16000), tr_at: p.translation?.updated_at ?? null, withheld: !!p.translation_withheld, id: p.id });
  }
  return win;
}

// ── judge ──
async function judge() {
  await open();
  const sample = JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8'));
  const RES = path.join(OUT, 'verdicts.jsonl');
  const done = new Set(readJsonl(RES).filter((r) => r.verdict).map((r) => r.key));
  const items = sample.filter((s) => !done.has(s.key));
  console.log(`${items.length} to judge (${done.size} done)`);
  const worker = async () => {
    for (let s = items.shift(); s; s = items.shift()) {
      const dir = path.join(OUT, 'pairs', s.key);
      fs.mkdirSync(dir, { recursive: true });
      const win = await loadWindow(s, dir);
      if (win.length !== 2 || win.some((w) => !w.img)) { fs.appendFileSync(RES, JSON.stringify({ ...s, cls: win.length !== 2 ? 'missing_page' : 'no_image' }) + '\n'); continue; }
      if (s.control === 'made-dup') win[1].en = makeDup(win[0].en, win[1].en).slice(0, 16000);
      const book = await db.collection('books').findOne({ id: s.book }, { projection: { title: 1, language: 1 } });
      const prompt = pairPrompt({ title: book?.title, language: book?.language, n: s.prev, win });
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
      const res = await claudeCall(prompt, dir);
      let v = null;
      try { const a = res.text.indexOf('{'), b = res.text.lastIndexOf('}'); v = JSON.parse(res.text.slice(a, b + 1)); } catch { /* unparsed */ }
      fs.appendFileSync(RES, JSON.stringify({ ...s, verdict: v, stored_changed: win[1].tr_at && new Date(win[1].tr_at) > new Date('2026-11-07T00:00:00Z'), withheld: win[1].withheld, cls: res.cls || (v ? null : 'unparsed'), model: res.model, usage: res.usage, secs: res.secs, ...(v ? {} : { raw: String(res.text).slice(0, 600), err: res.err }) }) + '\n');
      console.log(`  ${s.key} ${s.stratum} ${s.band} ${s.lang || s.control}: ${v ? `${v.dup}/${v.wrong}/${v.own}/${v.share}` : res.cls}`);
      if (res.cls === 'usage_limit') { items.length = 0; console.log('usage limit: stopping; re-run to resume'); }
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 3)) }, worker));
}

/** A pair is a true positive for THIS repair when page N's text is duplicated into page N+1's English and N+1 is
 * (one of) the wrong page(s): re-translating N+1 from its own leaf is then the right fix. */
export const positive = (r) => r.verdict?.dup === 'yes' && [String(r.next), 'both', 'N+1'].includes(String(r.verdict.wrong));
/** v2 (round 2 on): a REAL duplicate in either direction: N's text in N+1's English (the leak) or N+1's text in N's
 * (the forward shape). The repair re-translates the wrong page(s) from their own leaf, so either is a hit. */
export const defect = (r) => r.verdict?.dup === 'yes' || r.verdict?.fwd === 'yes';
/** Which page(s) the judge says carry the other's text. */
export const wrongPages = (r) => { const v = r.verdict || {}; const a = v.fwd === 'yes', b = v.dup === 'yes'; return a && b ? 'both' : a ? 'N' : b ? 'N+1' : 'none'; };

function score() {
  // --metric=leak: v1's count (N's text in N+1 only); default: a duplicate in either direction (v2)
  const hit = arg('metric') === 'leak' ? positive : defect;
  const last = new Map(); for (const r of readJsonl(path.join(OUT, arg('verdicts', 'verdicts.jsonl')))) last.set(r.key, r);
  const rs = [...last.values()];
  const judged = rs.filter((r) => r.verdict);
  const ci = (k, n) => { if (!n) return null; const [lo, hi] = wilson(k, n); return [+lo.toFixed(2), +hi.toFixed(2)]; };
  const row = (xs) => { const k = xs.filter(hit).length; const w = {}; for (const r of xs.filter(hit)) w[wrongPages(r)] = (w[wrongPages(r)] || 0) + 1; return { n: xs.length, positive: k, wrong_page: w, precision: xs.length ? +(k / xs.length).toFixed(2) : null, ci95: ci(k, xs.length) }; };
  const real = judged.filter((r) => !r.control);
  const out = { judged: judged.length, of: rs.length, unjudged: rs.filter((r) => !r.verdict).map((r) => ({ key: r.key, cls: r.cls })),
    controls: judged.filter((r) => r.control).map((r) => ({ key: r.key, control: r.control, dup: r.verdict.dup, wrong: r.verdict.wrong, caught: r.control === 'made-dup' ? hit(r) : !hit(r) })),
    all: row(real), by_stratum: {}, by_band: {}, by_stratum_band: {}, by_language: {},
    forward_dup: real.filter((r) => r.verdict.dup !== 'no' && String(r.verdict.wrong) === String(r.prev)).map((r) => r.key),
    negatives: real.filter((r) => !hit(r)).map((r) => ({ key: r.key, stratum: r.stratum, lang: r.lang, book: r.book, next: r.next, dup: r.verdict.dup, wrong: r.verdict.wrong, why: r.verdict.why })) };
  for (const s of Object.keys(ALLOC)) out.by_stratum[s] = row(real.filter((r) => r.stratum === s));
  for (const b of ['500-999', '>=1000']) out.by_band[b] = row(real.filter((r) => r.band === b));
  for (const s of Object.keys(ALLOC)) for (const b of ['500-999', '>=1000']) out.by_stratum_band[`${s} ${b}`] = row(real.filter((r) => r.stratum === s && r.band === b));
  for (const l of [...new Set(real.map((r) => r.lang))]) out.by_language[l] = row(real.filter((r) => r.lang === l));
  out.passing = Object.entries(out.by_stratum).filter(([, v]) => v.precision != null && v.precision >= 0.8).map(([k]) => k);
  if (real.some((r) => r.dir)) { out.by_direction = {}; for (const d of ['ident', 'leak', 'forward', 'unclear']) out.by_direction[d] = row(real.filter((r) => r.dir === d)); }
  fs.writeFileSync(path.join(OUT, arg('score-file', 'score.json')), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, negatives: out.negatives.length }, null, 1));
}

// ── refresh: the flagged pairs re-measured on the LIVE English (the mirror can be days behind a repair) ──
const toks = (s) => { const t = String(s || '').toLowerCase(); const w = t.match(/[\p{L}\p{N}]{3,}/gu) || []; const han = t.match(/\p{Script=Han}/gu) || []; for (let i = 0; i + 1 < han.length; i++) w.push(han[i] + han[i + 1]); return new Set(w); };
const flat = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Share of a's distinct tokens found in b. */
export const tokShare = (a, b) => { const A = toks(a), B = toks(b); if (A.size < 12) return null; let k = 0; for (const x of A) if (B.has(x)) k++; return k / A.size; };
/** Is the shared English printed on either page (a facing or bilingual translation; an English page)? share of the
 * run's word 4-grams found in the pages' OCR. */
export function printedShare(run, ocrA, ocrB) {
  const w = flat(run).split(' '); if (w.length < 8) return 0;
  const o = ` ${flat(ocrA)} ${flat(ocrB)} `; let k = 0, n = 0;
  for (let i = 0; i + 4 <= w.length; i += 2) { n++; if (o.includes(` ${w.slice(i, i + 4).join(' ')} `)) k++; }
  return n ? k / n : 0;
}

/** The pair's shape on the live text: the run's length and where it sits in N and in N+1. */
export function pairShape(enA, enB, ocrA, ocrB) {
  const normTr = (t) => String(t || '').replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const A = normTr(enA), B = normTr(enB);
  const s = sharedRunFn(B, A, 200);
  if (!s.len) return { len: 0, a: A.length, b: B.length };
  const probe = s.text.slice(0, 60), offA = A.indexOf(probe), offB = B.indexOf(probe);
  // the whole run (not only its 200-char excerpt) for the printed check
  const run = offB >= 0 ? B.slice(offB, offB + s.len) : s.text;
  return { len: s.len, a: A.length, b: B.length, posA: +(offA / A.length).toFixed(2), endA: +((offA + s.len) / A.length).toFixed(2), posB: +(offB / B.length).toFixed(2), endB: +((offB + s.len) / B.length).toFixed(2),
    printed: +printedShare(run, ocrA, ocrB).toFixed(2), ocr_share: tokShare(ocrB, ocrA) == null ? null : +tokShare(ocrB, ocrA).toFixed(2) };
}
let sharedRunFn;

async function refresh() {
  ({ sharedRun: sharedRunFn } = await import('../../audit/translation-page-boundaries.mjs'));
  await open();
  const rows = readJsonl(arg('in', '/tmp/leak-joined-500.jsonl'));
  const byBook = new Map(); for (const r of rows) { const a = byBook.get(r.book) || []; a.push(r); byBook.set(r.book, a); }
  const books = new Map((await db.collection('books').find({ id: { $in: [...byBook.keys()] } }, { projection: { _id: 0, id: 1, human_read_count: 1, visible: 1, title: 1 } }).toArray()).map((b) => [b.id, b]));
  const out = fs.createWriteStream(path.join(OUT, 'live-frame.jsonl'));
  let k = 0;
  const ids = [...byBook.keys()];
  const worker = async () => {
    for (let b = ids.shift(); b; b = ids.shift()) {
      const rs = byBook.get(b);
      const nums = [...new Set(rs.flatMap((r) => [r.prev, r.next]))];
      const ps = new Map((await db.collection('pages').find({ book_id: b, page_number: { $in: nums } }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation.edited_by': 1, 'translation.source': 1, 'translation.model': 1, translation_withheld: 1 } }).toArray()).map((p) => [p.page_number, p]));
      for (const r of rs) {
        const A = ps.get(r.prev), B = ps.get(r.next);
        const bk = books.get(b);
        const base = { ...r, reads: bk?.human_read_count || 0, visible: !!bk?.visible };
        if (!A || !B) { out.write(JSON.stringify({ ...base, live: 'missing' }) + '\n'); continue; }
        const sh = pairShape(A.translation?.data, B.translation?.data, strip(A.ocr?.data), strip(B.ocr?.data));
        out.write(JSON.stringify({ ...base, prev_id: A.id, ocr_a: strip(A.ocr?.data).length, ocr_b: strip(B.ocr?.data).length, ...sh,
          tr_at_a: A.translation?.updated_at ?? null, tr_at_b: B.translation?.updated_at ?? null, model_a: A.translation?.model ?? null, model_b: B.translation?.model ?? null,
          human: !!(A.translation?.edited_by || B.translation?.edited_by || A.translation?.source === 'manual' || B.translation?.source === 'manual'), withheld: !!(A.translation_withheld || B.translation_withheld) }) + '\n');
      }
      if (++k % 500 === 0) console.log(`  ${k} books`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await new Promise((r) => out.end(r));
  console.log('done', k, 'books');
}

/** The repair's frame, from the live shape. A pair is in it when the leak is still there and none of the measured
 * legitimate or out-of-scope shapes explains it (see the experiment write-up for how each rule was found):
 * - the run is on the live English (len >= 500);
 * - both leaves carry text (OCR >= 300): a blank or near-blank leaf with composed English is #5274's, not this;
 * - the leaves are not one text (OCR token share < 0.5): a duplicated scan or a reprinted page;
 * - the shared English is not printed on either page (printed < 0.3): a facing or bilingual translation;
 * - real pages (page_number > 0), no human edit, nothing withheld. */
export function inFrame(r) {
  if (r.live === 'missing' || !(r.len >= 500)) return false;
  if (r.prev <= 0 || r.human || r.withheld) return false;
  if (r.ocr_a < 300 || r.ocr_b < 300) return false;
  if (r.ocr_share != null && r.ocr_share >= 0.5) return false;
  if (r.printed >= 0.3) return false;
  return true;
}
/** Which page the run belongs to, from where it sits: at the head of N (continuity English, #5026) → N+1 is wrong;
 * at the tail of N and the head of N+1 (N+1's opening on N, the #5021 forward shape) → N is wrong; else both. */
export const direction = (r) => (r.len >= 0.8 * Math.min(r.a, r.b) ? 'ident' : r.posA <= 0.15 ? 'leak' : r.endA >= 0.85 && r.posB <= 0.35 ? 'forward' : 'unclear');

// ── post-repair check ──
async function postDraw() {
  await open();
  const rnd = mulberry32(Number(arg('seed', 50263)));
  const led = new Map(); for (const r of readJsonl(arg('ledger'))) led.set(r.page_id, r);
  // The repaired page is N+1 of a "-N1" pair (its duplicate came from page N, before it) or N of a "-N" pair (ident /
  // forward / unclear: its duplicate came from page N+1, after it). The judge compares it with THAT neighbour. Pages
  // repaired from both sides are left out of the draw (no single neighbour to ask about).
  const side = (r) => { const t = (r.src || []).filter((x) => x.startsWith('leak5026-')); const n1 = t.some((x) => x.endsWith('-N1')), n0 = t.some((x) => x.endsWith('-N')); return n1 && n0 ? null : n1 ? -1 : n0 ? 1 : null; };
  const done = shuffle([...led.values()].filter((r) => r.state === 'retranslated' && side(r)), rnd);
  const byLang = new Map(); for (const r of done) { const a = byLang.get(r.language) || []; a.push(r); byLang.set(r.language, a); }
  const N = Number(arg('n', 30)), used = new Set(), picked = [];
  // round-robin over languages so the 30 spread the way the pilot does, one page per book
  const langs = [...byLang.keys()].sort((a, b) => byLang.get(b).length - byLang.get(a).length);
  const quota = new Map(langs.map((l) => [l, Math.max(1, Math.round((byLang.get(l).length / done.length) * N))]));
  for (const l of langs) for (const r of byLang.get(l)) { if (picked.length >= N || (quota.get(l) || 0) <= 0) break; if (used.has(r.book_id)) continue; used.add(r.book_id); picked.push(r); quota.set(l, quota.get(l) - 1); }
  for (const r of done) { if (picked.length >= N) break; if (!used.has(r.book_id)) { used.add(r.book_id); picked.push(r); } }
  const pair = (r) => { const nb = r.page + side(r); return { book: r.book_id, prev: Math.min(r.page, nb), next: Math.max(r.page, nb), checked: r.page, nb, page_id: r.page_id, lang: r.language }; };
  const sample = picked.map((r) => pair(r));
  // controls: 2 made duplicates on repaired pages from other books, 2 stored pages from the input's flagged set
  // that are NOT repaired (the leak still there), so the judge must say "duplicated" there
  const rest = done.filter((r) => !used.has(r.book_id)).slice(0, 2);
  for (const r of rest) sample.push({ ...pair(r), control: 'made-dup' });
  const unrepaired = shuffle(readJsonl(arg('in', '/tmp/leak-joined-500.jsonl')).filter((r) => !led.has(r.page_id) && !used.has(r.book) && r.site?.startsWith('scripts/batch/cli-translate') === false && r.len >= 1000), rnd).slice(0, 2);
  for (const r of unrepaired) sample.push({ book: r.book, prev: r.prev, next: r.next, checked: r.next, nb: r.prev, page_id: r.page_id, lang: r.lang, control: 'stored-leak' });
  const all = shuffle(sample, rnd).map((r, i) => ({ ...r, key: `Q${String(i + 1).padStart(2, '0')}` }));
  fs.writeFileSync(path.join(OUT, 'post-sample.json'), JSON.stringify(all, null, 1));
  console.log(`${all.length} pages`, all.reduce((m, r) => ((m[r.control || r.lang] = (m[r.control || r.lang] || 0) + 1), m), {}));
}

/** win = [P, Q]: P the neighbour page (before or after), Q the page being checked. */
export function postPrompt({ title, language, n, win }) {
  const [P, Q] = win;
  const nb = P.n, where = nb < n ? 'previous' : 'next';
  const L = [`You are checking the English translation readers are shown for page ${n} of "${title}" (language: ${language}), against the page itself. The ${where} page, ${nb}, is given too. Open BOTH images with the Read tool; the transcriptions are machine readings that can be wrong (trust the images).`, ''];
  L.push(`=== Page ${P.n} (the ${where} page, for reference) ===`, P.img ? `Image file: ${P.img}` : 'Image: (not available)', `Transcription of page ${P.n}:`, '<<<', P.ocr || '(empty)', '>>>', `English shown on page ${P.n}:`, '<<<', P.en || '(none)', '>>>', '');
  L.push(`=== Page ${Q.n} (the page being checked) ===`, `Image file: ${Q.img}`, `Transcription of page ${Q.n}:`, '<<<', Q.ocr || '(empty)', '>>>', `English shown on page ${Q.n}:`, '<<<', Q.en, '>>>', '');
  L.push('Questions, about the English of page ' + n + ':',
    `1. dup: does it contain a passage of a paragraph or more that renders text printed on page ${nb} and not on page ${n}? "yes" or "no".`,
    `2. leaf: whose printed text does its body mainly render? "own" (page ${n}), "neighbour" (page ${nb}), "mixed", or "other".`,
    `3. usable: would a reader who cannot read the original get a faithful account of what page ${n} says? "yes" or "no". "no" if a major defect: a sentence or more of the page left out, meaning changed so the reader is misled, or text added that is not on the page.`,
    '4. defects: each real error against page ' + n + '\'s printed text: type omitted|mistranslated|invented|other, severity major|minor, a short note. Do not count style.',
    'Answer with JSON only, no code fence: {"dup":"yes|no","leaf":"own|neighbour|mixed|other","usable":"yes|no","defects":[{"type":"…","severity":"major|minor","note":"…"}],"evidence":"one phrase of the English and the original words it renders"}');
  return L.join('\n');
}

async function postJudge() {
  await open();
  const sample = JSON.parse(fs.readFileSync(path.join(OUT, 'post-sample.json'), 'utf8'));
  const RES = path.join(OUT, 'post-verdicts.jsonl');
  const done = new Set(readJsonl(RES).filter((r) => r.verdict).map((r) => r.key));
  const items = sample.filter((s) => !done.has(s.key));
  console.log(`${items.length} to judge (${done.size} done)`);
  const worker = async () => {
    for (let s = items.shift(); s; s = items.shift()) {
      const dir = path.join(OUT, 'post', s.key);
      fs.mkdirSync(dir, { recursive: true });
      const got = await loadWindow(s, dir);
      const chk = s.checked ?? s.next, win = [got.find((w) => w.n !== chk), got.find((w) => w.n === chk)];
      if (got.length !== 2 || !win[1]?.img) { fs.appendFileSync(RES, JSON.stringify({ ...s, cls: 'no_image' }) + '\n'); continue; }
      if (s.control === 'made-dup') win[1].en = makeDup(win[0].en, win[1].en).slice(0, 6000);
      const book = await db.collection('books').findOne({ id: s.book }, { projection: { title: 1, language: 1 } });
      const prompt = postPrompt({ title: book?.title, language: book?.language, n: chk, win });
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
      const res = await claudeCall(prompt, dir);
      let v = null;
      try { const a = res.text.indexOf('{'), b = res.text.lastIndexOf('}'); v = JSON.parse(res.text.slice(a, b + 1)); } catch { /* unparsed */ }
      fs.appendFileSync(RES, JSON.stringify({ ...s, verdict: v, cls: res.cls || (v ? null : 'unparsed'), model: res.model, secs: res.secs, ...(v ? {} : { raw: String(res.text).slice(0, 600), err: res.err }) }) + '\n');
      console.log(`  ${s.key} ${s.lang} ${s.control || ''}: ${v ? `dup ${v.dup} leaf ${v.leaf} usable ${v.usable} (${(v.defects || []).length})` : res.cls}`);
      if (res.cls === 'usage_limit') { items.length = 0; console.log('usage limit: stopping; re-run to resume'); }
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 3)) }, worker));
}

function postScore() {
  const last = new Map(); for (const r of readJsonl(path.join(OUT, 'post-verdicts.jsonl'))) last.set(r.key, r);
  const rs = [...last.values()].filter((r) => r.verdict);
  const real = rs.filter((r) => !r.control);
  const usable = real.filter((r) => r.verdict.usable === 'yes').length;
  const dupGone = real.filter((r) => r.verdict.dup === 'no').length;
  const [lo, hi] = wilson(usable, real.length || 1);
  const out = { judged: real.length, dup_gone: dupGone, usable, usable_ci95: [+lo.toFixed(2), +hi.toFixed(2)], own_leaf: real.filter((r) => r.verdict.leaf === 'own').length,
    defects: real.reduce((m, r) => { for (const d of r.verdict.defects || []) { const k = `${d.type}/${d.severity}`; m[k] = (m[k] || 0) + 1; } return m; }, {}),
    pass: real.length >= 30 && dupGone === real.length && usable >= 28,
    controls: rs.filter((r) => r.control).map((r) => ({ key: r.key, control: r.control, dup: r.verdict.dup, caught: r.verdict.dup === 'yes' })),
    fails: real.filter((r) => r.verdict.dup !== 'no' || r.verdict.usable !== 'yes').map((r) => ({ key: r.key, book: r.book, page: r.checked ?? r.next, nb: r.nb ?? r.prev, lang: r.lang, dup: r.verdict.dup, leaf: r.verdict.leaf, usable: r.verdict.usable, defects: r.verdict.defects })) };
  fs.writeFileSync(path.join(OUT, 'post-score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

// ── agy judge (Derek 2026-11-08 05:19Z): the SAME sealed prompts Opus answered, to an agy Flash judge ──
/** --out=DIR (a judged round: pairs/<key>/prompt.txt + images, sample.json) --model=gemini-3.8-flash-medium
 * [--prefix=pairs --res=verdicts-agy.jsonl --concurrency=3]. Each call is a fresh gated workspace holding the two page
 * images; the prompt goes in on stdin, word for word, with "Read tool" said as agy's read_file. Resumable. */
async function agyJudge() {
  const { agyCall, installToolGate, installNarrowAgent, stdinArgs, stdinMessage, replyEnvelope, isQuotaError } = await import('../../lib/agy-cli.mjs');
  const model = arg('model', 'gemini-3.8-flash-medium');
  const prefix = arg('prefix', 'pairs');
  const RES = path.join(OUT, arg('res', 'verdicts-agy.jsonl'));
  const sample = JSON.parse(fs.readFileSync(path.join(OUT, arg('sample', 'sample.json')), 'utf8'));
  const done = new Set(readJsonl(RES).filter((r) => r.verdict).map((r) => r.key));
  const items = sample.filter((s) => !done.has(s.key) && fs.existsSync(path.join(OUT, prefix, s.key, 'prompt.txt')));
  console.log(`${items.length} to judge with ${model} (${done.size} done)`);
  let stop = false;
  const worker = async () => {
    for (let s = items.shift(); s && !stop; s = items.shift()) {
      const src = path.join(OUT, prefix, s.key);
      const prompt = fs.readFileSync(path.join(src, 'prompt.txt'), 'utf8').replace(/the Read tool/g, 'read_file');
      let v = null, r = null;
      for (let i = 0; i < 2 && !v; i++) {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-leakjudge-'));
        for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.jpg'))) fs.copyFileSync(path.join(src, f), path.join(ws, f));
        installToolGate(ws, { task: 'ocr' });
        const agentArgs = installNarrowAgent(ws, 'ocr');
        r = await agyCall([...stdinArgs(300), '--model', model, ...agentArgs], ws, { input: stdinMessage(prompt), killAfterMs: 360e3 });
        fs.rmSync(ws, { recursive: true, force: true });
        const text = String(replyEnvelope(r.text)?.text ?? replyEnvelope(r.text)?.response ?? r.text ?? '');
        try { const a = text.indexOf('{'), b = text.lastIndexOf('}'); v = JSON.parse(text.slice(a, b + 1)); } catch { /* unparsed */ }
        if (!v) r.raw = text.slice(0, 600);
        if (r.cls === 'quota' || isQuotaError({ out: r.text, err: r.err })) { stop = true; break; }
      }
      fs.appendFileSync(RES, JSON.stringify({ ...s, verdict: v, judge: model, cls: r.cls || (v ? null : 'unparsed'), secs: r.secs, ...(v ? {} : { raw: r.raw, err: String(r.err || '').slice(0, 300) }) }) + '\n');
      console.log(`  ${s.key} ${s.stratum || ''} ${s.lang || s.control}: ${v ? `${v.dup}/${v.fwd}/${v.wrong}` : r.cls || 'unparsed'}`);
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 3)) }, worker));
  if (stop) console.log('quota: stopped; re-run to resume');
}

/** Agreement of the agy verdicts with Opus's on the same pairs: defect yes/no (dup or fwd), per stratum; agy false
 * alarms (agy yes, Opus no) and misses (agy no, Opus yes) apart; controls caught. */
function agyScore() {
  const last = (f) => { const m = new Map(); for (const r of readJsonl(path.join(OUT, f))) if (r.verdict) m.set(r.key, r); return m; };
  const O = last(arg('opus', 'verdicts.jsonl')), A = last(arg('res', 'verdicts-agy.jsonl'));
  const sample = JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8'));
  const by = {}, controls = [];
  for (const s of sample) {
    const o = O.get(s.key), a = A.get(s.key);
    if (!a) continue;
    if (s.control) { controls.push({ key: s.key, control: s.control, agy: defect(a) ? 'dup' : 'clean', caught: defect(a) === (s.control === 'made-dup') }); continue; }
    if (!o) continue;
    for (const k of ['all', s.stratum]) {
      const t = (by[k] ||= { n: 0, agree: 0, false_alarm: 0, miss: 0, same_page: 0 });
      t.n++;
      if (defect(a) === defect(o)) { t.agree++; if (defect(o) && wrongPages(a) === wrongPages(o)) t.same_page++; } else if (defect(a)) t.false_alarm++; else t.miss++;
    }
  }
  for (const t of Object.values(by)) { const [lo, hi] = wilson(t.agree, t.n); Object.assign(t, { rate: +(t.agree / t.n).toFixed(2), ci95: [+lo.toFixed(2), +hi.toFixed(2)] }); }
  const out = { judge: [...A.values()][0]?.judge, unjudged: sample.filter((s) => !A.has(s.key)).map((s) => s.key), by_stratum: by, controls,
    pass: (by.all?.rate ?? 0) >= 0.9 && controls.length === 4 && controls.every((c) => c.caught) };
  fs.writeFileSync(path.join(OUT, 'agy-score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

// ── record: the judged pages into book_checks (#8069), method leak-repair-5026 ──
/** --round=spot (pair verdicts: pages N and N+1 each get a page verdict) | post (the repaired page). Controls are not
 * recorded. --apply writes; without it the rows are built and checked only. */
async function record() {
  await open();
  const { recordPageVerdicts, readMethod } = await import('../../lib/book-checks.mjs');
  const post = arg('round', 'spot') === 'post';
  const file = path.join(OUT, arg('verdicts', post ? 'post-verdicts.jsonl' : 'verdicts.jsonl'));
  const last = new Map(); for (const r of readJsonl(file)) last.set(r.key, r);
  const rs = [...last.values()].filter((r) => r.verdict && !r.control);
  const ids = new Map((await db.collection('pages').find({ $or: rs.map((r) => ({ book_id: r.book, page_number: { $in: [r.prev, r.next] } })) }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1 } }).toArray()).map((p) => [`${p.book_id}:${p.page_number}`, p.id]));
  const verdicts = [];
  const sev = (d) => (d.severity === 'major' ? 'misleads' : 'cosmetic');
  for (const r of rs) {
    const v = r.verdict;
    if (post) {
      const carry = v.dup === 'yes', unusable = v.usable !== 'yes';
      const major = (v.defects || []).filter((d) => d.severity === 'major');
      const errors = [...(carry ? [{ stage: 'translation', kind: 'carry_over', problem: `the re-translated English still carries page ${r.nb ?? r.prev}'s text: ${String(v.evidence || '').slice(0, 300)}` }] : []),
        ...(unusable ? (major.length ? major : [{ note: 'judged not usable' }]).map((d) => ({ stage: 'translation', problem: `${d.type || 'not usable'}: ${String(d.note || '').slice(0, 300)}` })) : [])];
      const minor = (v.defects || []).length > 0;
      verdicts.push({ page_id: r.page_id, outcome: errors.length ? 'serious' : minor ? 'minor' : 'clean', page_verdict: errors.length ? 'fix' : minor ? 'caveat' : 'show',
        verdict: `leaf ${v.leaf}, usable ${v.usable}, duplicate ${v.dup}`, note: String(v.evidence || '').slice(0, 500),
        errors, defects: (v.defects || []).map((d) => ({ severity: sev(d), what: `${d.type}: ${String(d.note || '').slice(0, 300)}` })) });
      continue;
    }
    const wp = wrongPages(r);
    for (const [n, isWrong] of [[r.prev, wp === 'N' || wp === 'both'], [r.next, wp === 'N+1' || wp === 'both']]) {
      const id = ids.get(`${r.book}:${n}`); if (!id) continue;
      const other = n === r.prev ? r.next : r.prev;
      verdicts.push({ page_id: id, outcome: isWrong ? 'serious' : 'clean', page_verdict: isWrong ? 'fix' : 'show',
        verdict: isWrong ? `carries page ${other}'s text` : `no text of page ${other}`, note: String(v.why || '').slice(0, 500),
        errors: isWrong ? [{ stage: 'translation', kind: 'carry_over', problem: `English repeats a passage printed on page ${other}: ${String(v.why || '').slice(0, 300)}` }] : [], defects: [] });
    }
  }
  const res = await recordPageVerdicts(db, { method_id: 'leak-repair-5026', method_version: readMethod('leak-repair-5026').version, run_id: `leak-repair-5026-${path.basename(OUT)}`, checked_at: new Date(),
    selection: 'random', stages: ['translation'], reader: { kind: 'model', model: 'claude -p --model opus', image_opened: true },
    evidence_path: `box:${os.hostname()}:${file}`, reader_warning: false, exposure: 'live',
    note: post ? 'One page per book from the pages the #5026 leak repair re-translated; judged blind against the page image with the neighbour its duplicate came from for reference.' : 'Pairs drawn from the #5026 leak detector\'s flagged pairs (seeded, stratified); both pages judged blind against their images.',
    frame: { round: path.basename(OUT), pairs: rs.length }, verdicts }, { apply: has('apply') });
  console.log(`book_checks: ${res.inserted} inserted, ${res.already} already, ${res.rows.length} rows, ${res.failed.length} failed`, res.failed.slice(0, 5));
}

try {
  if (MODE === 'record') await record();
  else if (MODE === 'draw') await draw();
  else if (MODE === 'judge') await judge();
  else if (MODE === 'score') score();
  else if (MODE === 'refresh') await refresh();
  else if (MODE === 'post-draw') await postDraw();
  else if (MODE === 'post-judge') await postJudge();
  else if (MODE === 'post-score') postScore();
  else if (MODE === 'agy-judge') await agyJudge();
  else if (MODE === 'agy-score') agyScore();
  else { console.error('usage: pair-judge.mjs draw|judge|score|post-draw|post-judge|post-score --out=DIR'); process.exitCode = 2; }
} finally { await client?.close(); }

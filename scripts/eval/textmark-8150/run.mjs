#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/recovery-matrix-8150/text.mts (slice 9: its draw, its agy paraphrase prompt and cache, and
 * its Gutenberg not-ours set are reused here so the two results compare; it tests marks that already exist, not a
 * new one); scripts/eval/route-judge-6740/judge.mjs (the blind Opus judge against the page image: this script writes
 * its packet.json/key.json format and its `judge` stage does the judging, unchanged); src/lib/steganographia.ts and
 * src/lib/provenance.ts (the zero-width and colophon marks, which one regex strips and a paraphrase destroys).
 *
 * Slice 6 of #8150, a TEST ONLY: a probabilistic text mark carried by the translation's WORDING. For each sentence of
 * a served translation, a model (agy, gemini-3.8-flash-low, subscription; never the paid Gemini or Claude API) writes
 * three alternative renderings that say exactly the same thing. A keyed choice picks, per sentence, the rendering
 * richest in "green" words, where green = a secret-keyed hash of the word's lowercase form lands in the lower half.
 * Detection needs no position, no alignment and no reference: count green content words in any text and take the
 * z-score against one half. Paraphrase keeps some of the chosen words, so the question is how much survives.
 *
 * Nothing here writes to production. Marked text lives only under --out ($JOB_SCRATCH). The key is a local file
 * (TEXTMARK_KEY_FILE, default $JOB_SCRATCH/textmark.key, created on first use, mode 600) and is never printed.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/textmark-8150/run.mjs draw     --out=DIR [--n=12]
 *   node scripts/eval/textmark-8150/run.mjs mark       --out=DIR     # agy: alternatives, keyed choice
 *   node scripts/eval/textmark-8150/run.mjs paraphrase --out=DIR     # agy: paraphrase marked AND unmarked
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/textmark-8150/run.mjs fpset --out=DIR [--m=40]
 *   node scripts/eval/textmark-8150/run.mjs detect     --out=DIR     # z-scores, pooled, false positives -> detect.json
 *   node scripts/eval/textmark-8150/run.mjs packet     --out=DIR     # judge.mjs packet: live vs marked, controls, repeats
 *   node scripts/eval/route-judge-6740/judge.mjs judge --out=DIR     # blind Opus, one output a call, the image attached
 *   node scripts/eval/route-judge-6740/paired-arm.mjs score --out=DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gatedTextCall } from '../../lib/agy-cli.mjs';
import { getTranslationText } from '../../lib/translation-text.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const stage = process.argv[2];
const OUT = path.resolve(arg('out', `${process.env.JOB_SCRATCH || '/tmp'}/textmark-8150`));
const MODEL = arg('model', 'gemini-3.8-flash-low');
fs.mkdirSync(path.join(OUT, 'agy-cache'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'tmp'), { recursive: true });
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, v) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(v, null, 1));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- the key and the green list -------------------------------------------------------------------------------
function loadKey() {
  const f = process.env.TEXTMARK_KEY_FILE || path.join(process.env.JOB_SCRATCH || OUT, 'textmark.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
}
let KEY = null;
// Function words carry no free choice and would only dilute the count; the mark lives in content words.
const STOP = new Set(('also aber after again against all almost along already although always among another anything are because been before being below between both but came can cannot could did does doing done down during each either else even ever every few from further had has have having her here hers herself him himself his how however into its itself just least less like made make many may might more most much must neither never nor not now off once one only onto other others ought our ours out over own same shall she should since some still such than that the their theirs them themselves then there these they this those though through thus too under unless until upon very was were what whatever when where whether which while who whom whose why will with within without would yet you your yours yourself').split(' '));
export function norm(w) { return w.toLowerCase().replace(/[’']s$/, '').replace(/(?<=\w{3})s$/, ''); }
export function contentWords(text) {
  return (String(text).match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ’'-]*/g) || []).map(norm).filter((w) => w.length >= 4 && !STOP.has(w));
}
const greenCache = new Map();
export function isGreen(w) {
  let g = greenCache.get(w);
  if (g === undefined) { g = crypto.createHmac('sha256', KEY ??= loadKey()).update(w).digest()[0] < 128; greenCache.set(w, g); }
  return g;
}
export function score(text) {
  const ws = contentWords(text);
  const g = ws.filter(isGreen).length, n = ws.length;
  // Secondary (not pre-registered): each distinct word once. Repeated words are not independent draws, so the token
  // z overstates evidence on any text, marked or not; the type z is the honest one if the two disagree.
  const ts = [...new Set(ws)], gt = ts.filter(isGreen).length, nt = ts.length;
  return { n, g, frac: n ? g / n : null, z: n ? (g - n / 2) / Math.sqrt(n / 4) : null, nt, zt: nt ? (gt - nt / 2) / Math.sqrt(nt / 4) : null };
}
const pooled = (texts) => score(texts.join('\n'));

// ---- agy ------------------------------------------------------------------------------------------------------
async function agy(kind, prompt) {
  const f = path.join(OUT, 'agy-cache', `${kind}-${sha(prompt).slice(0, 20)}.txt`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const r = await gatedTextCall(prompt, { model: MODEL, task: 'translate', attempts: 2, tmp: path.join(OUT, 'tmp') });
  if (r.cls === 'quota') throw new Error('agy quota reached: stop and resume later');
  const a = typeof r.answer === 'string' ? r.answer.trim() : '';
  if (!a) return null;
  fs.writeFileSync(f, a);
  return a;
}
const NO_TOOLS = 'Do not open, read or write any file and do not use any tool: the text is above.';

// Slice 9's paraphrase prompt, word for word, so its result and this one compare.
const PARAPHRASE = 'Rewrite the following passage in your own words. Keep every idea and the order of ideas, change the wording and sentence structure throughout, as someone would before republishing it.';
async function paraphrase(text) {
  const a = await agy('paraphrase', `${PARAPHRASE}\n\n${text}\n\n${NO_TOOLS} Write the result between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.`);
  if (!a || a.length < text.length * 0.3) return null;
  return a;
}

// ---- segmentation: only plain prose sentences are varied; markup, headings and table rows pass through ------------
const PROSE = (line) => line.trim().length > 0 && !/^\s*(<|#|\||\[|!\[|[-*]\s*$)/.test(line) && !/<\/?[a-z-]+[^>]*>/i.test(line);
function segment(text) {
  // Returns [{ text, vary }] whose concatenation is the input exactly.
  const segs = [];
  for (const line of text.split(/(\n)/)) {
    if (line === '\n' || !PROSE(line)) { segs.push({ text: line, vary: false }); continue; }
    const parts = line.split(/(?<=[.!?;])(\s+)(?=[A-Z"“‘'(])/);
    for (const p of parts) segs.push({ text: p, vary: /\S/.test(p) && contentWords(p).length >= 3 });
  }
  return segs;
}

// ---- stages ---------------------------------------------------------------------------------------------------
async function db() { const { MongoClient } = await import('mongodb'); const c = await MongoClient.connect(process.env.MONGODB_URI); return { c, d: c.db('bookstore') }; }

async function drawPages(d, n, exclude = new Set(), seed = 'textmark-8150') {
  // One page per book, a served translation of 900-3,500 characters (slice 9's window), non-English books.
  const out = [];
  const books = await d.collection('books').aggregate([
    { $match: { visible: true, pages_count: { $gt: 10 }, language: { $nin: ['English', 'en', 'eng'] } } },
    { $sample: { size: n * 8 } }, { $project: { id: 1, title: 1, language: 1 } },
  ]).toArray();
  for (const b of books) {
    if (out.length >= n) break;
    if (!b.id || exclude.has(b.id)) continue;
    const p = await d.collection('pages').aggregate([
      { $match: { book_id: b.id, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } } },
      { $project: { page_number: 1, len: { $strLenCP: { $ifNull: ['$translation.data', ''] } } } },
      { $match: { len: { $gte: 900, $lte: 3500 } } }, { $sample: { size: 1 } },
    ], { maxTimeMS: 60_000 }).toArray();
    if (!p.length) continue;
    const page = await d.collection('pages').findOne({ _id: p[0]._id });
    const tr = getTranslationText(page);
    const img = getPageSource(page);
    if (!tr || tr.length < 800 || !img) continue;
    // A page that is mostly markup or a table gives the mark nothing to vary; slice 9 kept prose pages too.
    if (segment(tr).filter((s) => s.vary).length < 4) continue;
    out.push({ book_id: b.id, title: b.title, language: b.language, page_number: page.page_number, page_id: String(page._id), image_url: img, source: page.ocr?.data ?? '', live: tr });
    exclude.add(b.id);
  }
  return out;
}

async function draw() {
  const { c, d } = await db();
  try { W('sample.json', await drawPages(d, Number(arg('n', '12')))); } finally { await c.close(); }
  console.log(`drew ${J('sample.json').length} pages`);
}

async function mark() {
  const sample = J('sample.json');
  for (const s of sample) {
    const segs = segment(s.live);
    const idx = segs.map((x, i) => (x.vary ? i : -1)).filter((i) => i >= 0);
    const numbered = idx.map((i, k) => `${k + 1}. ${segs[i].text.trim()}`).join('\n');
    const prompt = `Below are numbered sentences from an English translation of a historical book. For EACH sentence, write three alternative English renderings that say exactly the same thing: the same claims, names, numbers, negations, qualifiers, tense and person, nothing added and nothing left out. Vary only word choice and phrasing, as three careful translators might. Keep any bracketed text, italics markers or quotation marks as they are.

${numbered}

${NO_TOOLS} Answer with one JSON object only: {"alts": [["alt1","alt2","alt3"], ...]} with exactly ${idx.length} entries, in order.`;
    const a = await agy('alts', prompt);
    let alts = null;
    try { alts = JSON.parse(a.slice(a.indexOf('{'), a.lastIndexOf('}') + 1)).alts; } catch { /* below */ }
    if (!Array.isArray(alts) || alts.length !== idx.length) { console.log(`  ${s.page_id}: alternatives unparsed or misaligned (${alts?.length} vs ${idx.length})`); s.marked = null; continue; }
    const out = segs.map((x) => x.text);
    let changed = 0;
    idx.forEach((i, k) => {
      const orig = segs[i].text;
      const lead = orig.match(/^\s*/)[0], trail = orig.match(/\s*$/)[0];
      const cands = [orig.trim(), ...(alts[k] || []).filter((t) => typeof t === 'string' && t.trim())].map((t) => t.trim());
      // A rendering more than 40% shorter or longer than the original is not "the same thing": not eligible.
      const ok = cands.filter((t, j) => j === 0 || (t.length > orig.trim().length * 0.6 && t.length < orig.trim().length * 1.4));
      const excess = (t) => { const ws = contentWords(t); return ws.filter(isGreen).length - ws.length / 2; };
      let best = ok[0], bs = excess(ok[0]);
      for (const t of ok.slice(1)) { const e = excess(t); if (e > bs + 0.25) { best = t; bs = e; } }
      if (best !== ok[0]) changed++;
      out[i] = lead + best + trail;
    });
    s.marked = out.join('');
    s.sentences = idx.length; s.changed = changed;
    console.log(`  ${s.page_id}: ${changed}/${idx.length} sentences changed; z live ${score(s.live).z.toFixed(2)} -> marked ${score(s.marked).z.toFixed(2)}`);
  }
  W('sample.json', sample);
}

async function para() {
  const sample = J('sample.json');
  for (const s of sample) {
    if (!s.marked) continue;
    s.marked_para = await paraphrase(s.marked);
    s.live_para = await paraphrase(s.live);
    console.log(`  ${s.page_id}: paraphrased ${s.marked_para ? 'marked' : '-'} ${s.live_para ? 'live' : '-'}`);
  }
  W('sample.json', sample);
}

async function fpset() {
  // Unmarked text: other books' served translations, slice 9's not-ours Gutenberg paragraphs, and (in detect) the
  // live and paraphrased-live twins of the marked pages themselves.
  const sample = J('sample.json');
  const { c, d } = await db();
  let other;
  try { other = await drawPages(d, Number(arg('m', '40')), new Set(sample.map((s) => s.book_id))); } finally { await c.close(); }
  const gut = [];
  const gdir = path.join(process.env.JOB_SCRATCH || OUT, 's9', 'gutenberg');
  if (fs.existsSync(gdir)) for (const f of fs.readdirSync(gdir).filter((x) => x.endsWith('.txt'))) {
    const raw = fs.readFileSync(path.join(gdir, f), 'utf8');
    const body = raw.split(/\*\*\* ?START OF[^\n]*\n/)[1]?.split(/\*\*\* ?END OF/)[0] || raw;
    const paras = body.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 900 && p.length < 3500);
    for (let k = 0; k < Math.min(8, paras.length); k++) gut.push({ src: f, text: paras[Math.floor((k * paras.length) / 8)] });
  }
  W('fpset.json', { other: other.map(({ book_id, page_id, language, live }) => ({ book_id, page_id, language, text: live })), gutenberg: gut });
  console.log(`fp set: ${other.length} other pages, ${gut.length} Gutenberg paragraphs`);
}

function detect() {
  const sample = J('sample.json').filter((s) => s.marked && s.marked_para && s.live_para);
  const fp = J('fpset.json');
  const per = sample.map((s) => ({ page_id: s.page_id, book_id: s.book_id, language: s.language, sentences: s.sentences, changed: s.changed,
    live: score(s.live), marked: score(s.marked), marked_para: score(s.marked_para), live_para: score(s.live_para) }));
  const unmarked = [
    ...fp.other.map((o) => ({ kind: 'other_page', text: o.text })),
    ...fp.gutenberg.map((g) => ({ kind: 'gutenberg', text: g.text })),
    ...sample.map((s) => ({ kind: 'live_twin', text: s.live })),
    ...sample.map((s) => ({ kind: 'live_twin_paraphrased', text: s.live_para })),
  ];
  const uz = unmarked.map((u) => ({ kind: u.kind, ...score(u.text) }));
  // Pooled false positives: 2,000 random ten-text pools of unmarked text, seeded.
  let x = 0x8150; const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const K = Math.min(10, sample.length), pools = [], poolsT = [];
  for (let t = 0; t < 2000; t++) { const pick = new Set(); while (pick.size < K) pick.add(Math.floor(rnd() * unmarked.length)); const r = pooled([...pick].map((i) => unmarked[i].text)); pools.push(r.z); poolsT.push(r.zt); }
  pools.sort((a, b) => a - b); poolsT.sort((a, b) => a - b);
  const q = (p) => pools[Math.floor(p * (pools.length - 1))];
  const at = (arr, th) => arr.filter((v) => v >= th).length;
  const res = {
    n_pages: per.length,
    pooled: { live: pooled(sample.map((s) => s.live)), marked: pooled(sample.map((s) => s.marked)), marked_para: pooled(sample.map((s) => s.marked_para)), live_para: pooled(sample.map((s) => s.live_para)) },
    per_page_detect: { marked_z_ge2: at(per.map((p) => p.marked.z), 2), marked_para_z_ge2: at(per.map((p) => p.marked_para.z), 2), of: per.length },
    unmarked_single: { n: uz.length, z_ge2: at(uz.map((u) => u.z), 2), z_ge3: at(uz.map((u) => u.z), 3), max: Math.max(...uz.map((u) => u.z)), mean: uz.reduce((a, u) => a + u.z, 0) / uz.length, by_kind: Object.fromEntries([...new Set(uz.map((u) => u.kind))].map((k) => [k, { n: uz.filter((u) => u.kind === k).length, z_ge2: at(uz.filter((u) => u.kind === k).map((u) => u.z), 2), max: Math.max(...uz.filter((u) => u.kind === k).map((u) => u.z)) }])) },
    unmarked_pools: { pools: pools.length, size: K, z_ge3: at(pools, 3), z_ge4: at(pools, 4), p50: q(0.5), p99: q(0.99), max: pools[pools.length - 1],
      type_z: { z_ge3: at(poolsT, 3), z_ge4: at(poolsT, 4), p50: poolsT[999], p99: poolsT[1979], max: poolsT[1999] } },
    unmarked_single_type_z: { z_ge2: at(uz.map((u) => u.zt), 2), z_ge3: at(uz.map((u) => u.zt), 3), max: Math.max(...uz.map((u) => u.zt)), mean: uz.reduce((a, u) => a + u.zt, 0) / uz.length },
    per_page_detect_type_z: { marked_zt_ge2: at(per.map((p) => p.marked.zt), 2), marked_para_zt_ge2: at(per.map((p) => p.marked_para.zt), 2), of: per.length },
    per_page: per,
    changed_sentences: { changed: per.reduce((a, p) => a + p.changed, 0), of: per.reduce((a, p) => a + p.sentences, 0) },
  };
  W('detect.json', res);
  console.log(JSON.stringify({ ...res, per_page: undefined }, null, 1));
}

function packet() {
  // judge.mjs's format: opaque ids, one output a call, the image and the source OCR attached. Arms: live, marked.
  const sample = J('sample.json').filter((s) => s.marked);
  if (sample.length < 5) throw new Error(`packet needs at least 5 marked pages (controls and repeats), got ${sample.length}`);
  const id = (...p) => 'tm-' + sha(p.join('|')).slice(0, 10);
  const items = [], key = [];
  const add = (kind, route, s, text, imgOf = s, rep = '') => {
    const jid = id(kind, route, s.page_id, imgOf.page_id, rep);
    items.push({ id: jid, task: 'translation', lang: imgOf.language, image_url: imgOf.image_url, source: imgOf.source, text });
    key.push({ id: jid, judged_as: jid, cell: 'textmark', route, kind, page_id: imgOf.page_id, book_id: imgOf.book_id, text_page_id: s.page_id });
  };
  for (const s of sample) { add('item', 'live', s, s.live); add('item', 'marked', s, s.marked); }
  // Wrong-page controls: page i's text against page i+1's image, two per arm.
  for (const [k, route] of [[0, 'live'], [2, 'marked'], [1, 'live'], [3, 'marked']]) {
    const s = sample[k], o = sample[(k + 1) % sample.length];
    add('wrong_page', route, s, route === 'live' ? s.live : s.marked, o);
  }
  // Noise floor: five marked outputs judged twice (same text, same image, a new opaque id).
  for (const s of sample.slice(0, 5)) add('repeat', 'marked', s, s.marked, s, 'r1');
  // judge.mjs shuffles nothing: interleave so arms do not run in blocks.
  const order = items.map((it) => [sha('ord' + it.id), it]).sort((a, b) => a[0].localeCompare(b[0])).map((x) => x[1]);
  W('packet.json', { items: order });
  W('key.json', key);
  console.log(`packet: ${items.length} judge calls`);
}

const STAGES = { draw, mark, paraphrase: para, fpset, detect, packet };
if (!STAGES[stage]) { console.error(`usage: run.mjs ${Object.keys(STAGES).join('|')} --out=DIR`); process.exit(2); }
await STAGES[stage]();

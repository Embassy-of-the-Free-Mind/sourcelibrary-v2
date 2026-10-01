#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/translation-recitation-5523.mjs — the nearest study (does a
 * model recite a published text?), but it scores served TRANSLATIONS against Gutenberg
 * with string overlap and makes no model call; this asks a model to CONTINUE a
 * transcription and scores the first tokens against a confirmed misread. Also checked
 * scripts/lib/dataset-canary.mjs (#5524) — the GUID canary, which §3.4 calls the weaker
 * detector this one is meant to replace; and scripts/eval/numbers-5224.mjs, whose
 * fixture supplies the misreads but which only scores engines against the image.
 *
 * fingerprint-5549 — do models continue our transcriptions with OUR misreads? (#5549)
 *
 * A misread that exists only in our served text is a fingerprint: a model that, given
 * the words before it, continues with the misread rather than the printed reading has
 * probably trained on our page. Misreads come ONLY from adjudicated sources:
 *   - numbers fixture (#5224): `printed` read blind from the image; we fetch the SERVED
 *     page text and read what it has at the same place;
 *   - #5313 by-eye arbitration anchors (eye/joined.jsonl), where the eye reader named
 *     the served letter's reading and the image's reading (hand-copied in EYE below,
 *     each with its anchor quoted).
 * Positive control: the Internet Archive's own confirmed number misreads, continued
 * from the Archive's `_djvu` text (public on archive.org for years, so plausibly in
 * training data). If models never reproduce those either, the test has no power.
 *
 * measure: agreement (with our text). Never a quality claim.
 *
 * Stages:
 *   --stage=build     items.jsonl (reads Mongo read-only, maxTimeMS 20000)
 *   --stage=gemini --model=<id>   continuations via gemini-script-client (thinking off)
 *   --stage=packets   Claude packets (prefix only) for Haiku subagents
 *   --stage=ingest --model=claude-haiku  read packets-out/*.jsonl
 *   --stage=score     report.json + report.md
 *
 * node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fingerprint-5549.mjs --stage=build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng } from './lib/paired-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'results', 'fingerprint-5549-2026-10-01');
const FIXTURE = path.join(HERE, 'benchmark', 'numbers-en-5224.json');
const N5224 = path.join(HERE, 'results', 'numbers-5224');
const TEXTS = path.join(N5224, 'texts'); // restore: see results/numbers-5224/ARTIFACTS.md
const SEED = 5549;
const PREFIX_WORDS = 40;
const PREFIX_CHARS_CJK = 80;
const TODAY = '2026-10-01';
// Published knowledge cutoffs (vendor model cards). A text first public after the
// cutoff cannot be in that model's pre-training data.
const CUTOFF = {
  'gemini-3.1-flash-lite': '2025-01-31',
  'gemini-3-flash-preview': '2025-01-31',
  'claude-haiku': '2025-02-28',
};
const MODELS_GEMINI = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'];

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
fs.mkdirSync(OUT, { recursive: true });

// ---- #5313 by-eye anchors where the SERVED letter's reading differs from the image ----
// `anchor` is quoted verbatim from eye/joined.jsonl; `served_letter` from eye/key.json.
// Pages whose served text has since been re-OCR'd lose the misread and drop out at build.
const EYE = [
  { n: '11', page_id: '695004e3f426a210d109a55a', served_letter: 'B', ours: 'hēc', correct: 'hēt',
    anchor: 'line 3 image hēt (habet): A hec, B hēc, C habet' },
  { n: '15', page_id: '695004c9f426a210d1098905', served_letter: 'A', ours: 'che per la uia', correct: 'cheron inuia',
    anchor: 'verse 8 cheron inuia: A has che per la uia' },
  { n: '18', page_id: '69e961542beefe2f6f72b1c9', served_letter: 'B', ours: 'Qualsou', correct: 'Oualsou', occurrence: 0,
    anchor: 'image Ouaisoua ou Oualsou and later peuples de Oualsou: A and C write Qualsou both times, B Qualsou first then Oualsou' },
  { n: '19', page_id: '69dbca481040d1d5e20aabbe', served_letter: 'A', ours: 'et palpebratos', correct: 'ex palpebratos',
    anchor: 'heading image oculos ex palpebratos: A and B et, C ex', shared_with_fresh_read: true },
  { n: '20', page_id: '69b3e5e9304c1c6b3950a8ec', served_letter: 'C', ours: 'εὐθείας', correct: 'ἰθυτενοῦς',
    anchor: 'line 3 ends ἰθυτενοῦς, C substitutes εὐθείας' },
  { n: '26', page_id: '6a2032e718654bf8e1903bc2', served_letter: 'B', ours: 'القدرات', correct: 'القزات',
    anchor: 'left line 6 القزات: A has القذات, B القدرات, C القران' },
  { n: '30', page_id: '69b3e5b8304c1c6b39509d67', served_letter: 'A', ours: 'בבחינתו', correct: 'בכתיבתו',
    anchor: 'last line image עיקרו רחמים בכתיבתו: C matches, A בבחינתו' },
  // Dropped by hand (recorded so the exclusion is visible): 01/04/07 romanized anchors over
  // non-Latin pages (cannot be located exactly); 06 omission, not a misread; 12 normalisation;
  // 13 all three engines print "piety" for the printed "diety" (an emendation any model makes);
  // 14/24/29 served text re-OCR'd by ndl-koten after the eye check; others: served matched image.
];

const NUM = /^\d{2,4}$/;
const norm = (s) => s.normalize('NFKC').toLowerCase();
function tokens(text) { // [{t, start, end}] over letters+digits, matching the #5224 number rule
  const out = []; const re = /[\p{L}\p{N}\p{M}]+/gu; let m;
  while ((m = re.exec(text))) out.push({ t: norm(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}
function cleanServed(raw) { // what a reader sees: drop metadata lines and tags
  return (raw || '')
    .replace(/^<(scan-quality|language|script|page-type|page-num|header|meta|warning|vocab)>[\s\S]*?<\/\1>\s*$/gim, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
const isCJK = (s) => /[぀-ヿ㐀-鿿]/.test(s);
function prefixBefore(text, at) {
  const head = text.slice(0, at);
  if (isCJK(head.slice(-20))) return head.slice(-PREFIX_CHARS_CJK);
  const words = head.split(/\s+/).filter(Boolean);
  const p = words.slice(-PREFIX_WORDS).join(' ');
  return head.endsWith(' ') || head.endsWith('\n') ? p + ' ' : p; // keep a split mid-word visible
}

// Locate the item's number in a token stream from its 7-token ctx window.
function locate(toks, ctx, values) {
  const c = ctx.split(' ');
  let k = c.findIndex((t, i) => values.includes(t) && i > 0 && i < c.length - 1);
  if (k < 0) k = c.findIndex((t) => values.includes(t));
  if (k < 0) return null;
  const before = c.slice(Math.max(0, k - 3), k);
  const after = c.slice(k + 1, k + 4);
  let best = null;
  for (let j = 0; j < toks.length; j++) {
    for (const L of [1, 2]) {
      let s = 0;
      for (let b = 1; b <= before.length; b++) if (toks[j - b]?.t === before[before.length - b]) s++;
      for (let a = 0; a < after.length; a++) if (toks[j + L + a]?.t === after[a]) s++;
      const cand = { j, L, s, value: toks.slice(j, j + L).map((x) => x.t).join('') };
      if (L === 2 && !(toks[j]?.t && /^\d+$/.test(toks[j].t) && /^\d+$/.test(toks[j + 1]?.t || ''))) continue;
      if (!best || s > best.s) { best = cand; best.tie = false; } else if (s === best.s && j !== best.j) best.tie = true;
    }
  }
  const need = Math.max(3, Math.ceil(0.66 * (before.length + after.length)));
  if (!best || best.s < need || best.tie) return null;
  return best;
}

// Is `v` what a list or sequence in the prefix predicts next (last+1, or last + the last
// step)? A misread a reader could guess from the list is no fingerprint: #5549's first
// pass found every hit on the post-cutoff arm was one ("52. … 53.").
function seqPredicts(prefix, v) {
  const nums = (prefix.match(/\d+/g) || []).map(Number).slice(-6);
  const t = Number(v); const c = new Set();
  for (let a = 0; a < nums.length; a++) {
    c.add(nums[a] + 1);
    for (let b = a + 1; b < nums.length; b++) { const d = nums[b] - nums[a]; if (d > 0 && d < 20) c.add(nums[b] + d); }
  }
  return c.has(t) || nums.includes(t);
}

async function build() {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (!fs.existsSync(TEXTS)) throw new Error(`restore ${TEXTS} first (results/numbers-5224/ARTIFACTS.md)`);
  const meta = new Map();
  for (const f of ['pairs.jsonl', 'breadth.jsonl']) for (const l of fs.readFileSync(path.join(N5224, f), 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(l); meta.set(j.book_id, j);
  }
  // Clean items only: high confidence, a plain 2–4 digit printed number, no reader note
  // (notes mark ranges, fractions and boxes that cut a number — not misreads).
  const clean = fx.items.filter((i) => i.confidence === 'high' && NUM.test(i.printed || '') && !i.note);
  const pageIds = [...new Set(clean.map((i) => i.page_id)), ...EYE.map((e) => e.page_id)];
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const pages = new Map();
  for (let i = 0; i < pageIds.length; i += 60) {
    const rows = await db.collection('pages').find({ id: { $in: pageIds.slice(i, i + 60) } }, {
      projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.source': 1 }, maxTimeMS: 20000,
    }).toArray();
    for (const r of rows) pages.set(r.id, r);
  }
  const bookIds = [...new Set([...pages.values()].map((p) => p.book_id))];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, {
    projection: { id: 1, title: 1, visible: 1, created_at: 1 }, maxTimeMS: 20000,
  }).toArray()).map((b) => [b.id, b]));
  await c.close();

  const items = []; const drops = [];
  const drop = (id, why) => drops.push({ id, why });
  // (1) OURS from the numbers fixture: what does the served text say at this place?
  for (const i of clean) {
    const p = pages.get(i.page_id);
    if (!p?.ocr?.data) { drop(i.id, 'no served text'); continue; }
    const text = cleanServed(p.ocr.data); const toks = tokens(text);
    const vals = [i.engines['ia-djvu'], i.engines['gemini-lite-realtime'], i.printed].filter(Boolean);
    const loc = locate(toks, i.ctx, vals);
    if (!loc) { drop(i.id, 'served: not located'); continue; }
    const served = loc.value;
    if (served === i.printed) continue; // served is right here: no fingerprint
    if (!NUM.test(served)) { drop(i.id, `served: non-numeric "${served}"`); continue; }
    if (i.printed.includes(served) || served.includes(i.printed)) { drop(i.id, 'served/printed split or prefix-ambiguous'); continue; }
    const ia = i.engines['ia-djvu'];
    items.push({
      id: `ours:${i.id}`, arm: i.engines['ia-djvu'] === served ? 'ours-shared-with-archive' : 'ours', source: 'numbers-5224',
      book_id: i.book_id, page_id: i.page_id, language: 'English', kind: 'number',
      ours: served, correct: i.printed, archive_value: ia ?? null,
      prefix: prefixBefore(text, toks[loc.j].start),
      published_text: p.ocr.updated_at ? new Date(p.ocr.updated_at).toISOString().slice(0, 10) : null,
      served_model: p.ocr.model, book_visible: books.get(i.book_id)?.visible ?? null,
    });
  }
  // (2) OURS from the #5313 by-eye anchors
  for (const e of EYE) {
    const p = pages.get(e.page_id);
    const text = cleanServed(p?.ocr?.data);
    let at = -1; for (let k = 0, from = 0; k <= (e.occurrence ?? 0); k++) { at = text.indexOf(e.ours, from); from = at + 1; if (at < 0) break; }
    if (at < 0) { drop(`eye-${e.n}`, 'served text no longer carries the misread (re-OCR?)'); continue; }
    items.push({
      id: `ours:eye-${e.n}`, arm: 'ours', source: 'two-read-garble-5313 eye', book_id: p.book_id, page_id: e.page_id,
      language: null, kind: 'word', ours: e.ours, correct: e.correct, anchor: e.anchor,
      shared_with_fresh_read: !!e.shared_with_fresh_read, prefix: prefixBefore(text, at),
      published_text: new Date(p.ocr.updated_at).toISOString().slice(0, 10), served_model: p.ocr.model,
      book_visible: books.get(p.book_id)?.visible ?? null,
    });
  }
  // (3) POSITIVE CONTROL: the Archive's own confirmed misreads, from its djvu text.
  for (const i of clean) {
    const ia = i.engines['ia-djvu'];
    if (!ia || !NUM.test(ia) || ia === i.printed) continue;
    if (i.printed.includes(ia) || ia.includes(i.printed)) { drop(`archive:${i.id}`, 'split or prefix-ambiguous'); continue; }
    const slug = i.id.split('#')[0];
    const f = path.join(TEXTS, `${slug}.ia-djvu.txt`);
    if (!fs.existsSync(f)) { drop(`archive:${i.id}`, 'no djvu text'); continue; }
    const text = fs.readFileSync(f, 'utf8'); const toks = tokens(text);
    const loc = locate(toks, i.ctx, [ia]);
    if (!loc || loc.value !== ia) { drop(`archive:${i.id}`, 'djvu: not located'); continue; }
    const m = meta.get(i.book_id)?.ia_meta || {};
    items.push({
      id: `archive:${i.id}`, arm: 'archive-control', source: 'numbers-5224', book_id: i.book_id, page_id: i.page_id,
      language: 'English', kind: 'number', ours: ia, correct: i.printed, ia: meta.get(i.book_id)?.ia,
      prefix: prefixBefore(text, toks[loc.j].start),
      published_text: m.ocr_date || (m.scandate ? `${m.scandate.slice(0, 4)}-${m.scandate.slice(4, 6)}-${m.scandate.slice(6, 8)}` : null),
      archive_ocr: m.ocr || null,
    });
  }
  // Order is seeded; the per-book cap keeps one big book from carrying an arm.
  const rng = makeRng(SEED);
  const keyed = items.map((x) => ({ x, r: rng() })).sort((a, b) => a.r - b.r).map((o) => o.x);
  const perBook = new Map(); const kept = [];
  for (const x of keyed) {
    const k = `${x.arm}|${x.book_id}`; const n = perBook.get(k) || 0;
    if (n >= 5) { drop(x.id, 'per-book cap 5'); continue; }
    perBook.set(k, n + 1); kept.push(x);
  }
  for (const x of kept) {
    x.words_in_prefix = x.prefix.split(/\s+/).filter(Boolean).length;
    if (x.kind === 'number') { x.ours_predictable = seqPredicts(x.prefix, x.ours); x.correct_predictable = seqPredicts(x.prefix, x.correct); }
  }
  fs.writeFileSync(path.join(OUT, 'items.jsonl'), kept.map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'drops.jsonl'), drops.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const by = {}; for (const x of kept) { by[x.arm] ??= { items: 0, books: new Set() }; by[x.arm].items++; by[x.arm].books.add(x.book_id); }
  console.log(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { items: v.items, books: v.books.size }])), 'drops', drops.length);
}

const PROMPT = (prefix) => `The text below is the beginning of a passage from a historical book, cut off mid-passage. Continue it VERBATIM from exactly where it stops, as the original document reads. Output only the next 15 words of the document, nothing else — no commentary, no quotation marks.\n\n${prefix}`;

const readItems = () => fs.readFileSync(path.join(OUT, 'items.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const outFile = (model) => path.join(OUT, `continuations-${model}.jsonl`);

async function gemini(model) {
  const { callGemini } = await import('../lib/gemini-script-client.mjs');
  const { costOf } = await import('../lib/model-pricing.mjs');
  const cap = Number(args.cap ?? 1.0);
  const done = new Set(fs.existsSync(outFile(model)) ? fs.readFileSync(outFile(model), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((r) => !r.error).map((r) => r.id) : []);
  let spent = 0;
  for (const x of readItems()) {
    if (done.has(x.id)) continue;
    if (spent > cap) { console.error(`cap $${cap} reached`); break; }
    let row;
    try {
      const r = await callGemini({ model, prompt: PROMPT(x.prefix), endpoint: 'eval/fingerprint-5549', maxOutputTokens: 80, temperature: 0 });
      const usd = costOf(model, r.inputTokens, r.outputTokens);
      spent += usd;
      row = { id: x.id, model, text: r.text, input_tokens: r.inputTokens, output_tokens: r.outputTokens, thinking_tokens: r.thinkingTokens, usd, finish: r.finishReason };
    } catch (e) { row = { id: x.id, model, error: String(e.message || e).slice(0, 200) }; }
    fs.appendFileSync(outFile(model), JSON.stringify(row) + '\n');
  }
  console.log(model, 'spent this run $', spent.toFixed(4));
}

// Prefix only — never the answer — for blind Haiku subagents. A subagent reads its
// whole packet, so NO TWO ITEMS FROM ONE BOOK may share a packet: v1 packed a page's
// items together and Haiku copied a later item's prefix (which carries the misread)
// into an earlier item's continuation. Packet k holds the k-th item of every book.
function packets() {
  const dir = path.join(OUT, 'packets-v2'); fs.mkdirSync(dir, { recursive: true });
  const byBook = new Map();
  for (const x of readItems()) { if (!byBook.has(x.book_id)) byBook.set(x.book_id, []); byBook.get(x.book_id).push(x); }
  const max = Math.max(...[...byBook.values()].map((v) => v.length));
  for (let k = 0; k < max; k++) {
    const xs = [...byBook.values()].map((v) => v[k]).filter(Boolean);
    fs.writeFileSync(path.join(dir, `packet-${String(k + 1).padStart(2, '0')}.jsonl`),
      xs.map((x) => JSON.stringify({ id: x.id, prefix: x.prefix })).join('\n') + '\n');
  }
  console.log(max, 'packets written to', dir);
}

function ingest(model) {
  const dir = path.join(OUT, args.dir || 'packets-v2-out');
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
      const j = JSON.parse(l); rows.push({ id: j.id, model, text: j.continuation ?? j.text ?? '', packet: f });
    }
  }
  fs.writeFileSync(outFile(model), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(model, rows.length, 'continuations');
}

// ---- scoring ----
function classify(x, text) {
  const ct = tokens(text || '').map((t) => t.t);
  const o = tokens(x.ours).map((t) => t.t); const c = tokens(x.correct).map((t) => t.t);
  const startsWith = (seq) => seq.length && seq.every((t, i) => ct[i] === t);
  if (!ct.length) return 'empty';
  if (startsWith(o)) return 'ours';
  if (startsWith(c)) return 'correct';
  return 'other';
}
function wilson(k, n) {
  if (!n) return [null, null]; const z = 1.96; const p = k / n;
  const d = 1 + z * z / n; const m = p + z * z / (2 * n); const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [+((m - s) / d).toFixed(3), +((m + s) / d).toFixed(3)];
}
function bookBoot(rows, key, iters = 5000) { // book-cluster bootstrap of a share
  const books = [...new Set(rows.map((r) => r.book_id))]; if (books.length < 2) return null;
  const by = new Map(books.map((b) => [b, rows.filter((r) => r.book_id === b)]));
  const rng = makeRng(SEED); const vals = [];
  for (let it = 0; it < iters; it++) {
    let k = 0, n = 0;
    for (let b = 0; b < books.length; b++) { const rs = by.get(books[Math.floor(rng() * books.length)]); n += rs.length; k += rs.filter((r) => r.cls === key).length; }
    vals.push(k / n);
  }
  vals.sort((a, b) => a - b);
  return [+vals[Math.floor(iters * 0.025)].toFixed(3), +vals[Math.floor(iters * 0.975)].toFixed(3)];
}
function band(x, model) {
  const d = x.published_text;
  if (!d) return { age: 'unknown', cutoff: 'unknown' };
  const days = (Date.parse(TODAY) - Date.parse(d)) / 864e5;
  const cut = CUTOFF[model];
  return { age: days < 30 ? 'public < 30 days' : 'public >= 30 days', cutoff: d <= cut ? 'before model cutoff' : 'after model cutoff' };
}

function score() {
  const xs = readItems(); const byId = new Map(xs.map((x) => [x.id, x]));
  const models = fs.readdirSync(OUT).filter((f) => f.startsWith('continuations-')).map((f) => f.slice(14, -6));
  const report = { run_id: 'fingerprint-5549-2026-10-01', measure: 'agreement', seed: SEED, cutoffs: CUTOFF, models: {}, items: xs.length };
  const scored = [];
  for (const model of models) {
    const rows = fs.readFileSync(outFile(model), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
      .filter((r) => byId.has(r.id) && !r.error)
      .filter((r, i, all) => all.findLastIndex((q) => q.id === r.id) === i)
      .map((r) => { const x = byId.get(r.id); return { ...r, arm: x.arm, book_id: x.book_id, cls: classify(x, r.text), ...band(x, model) }; });
    scored.push(...rows.map((r) => ({ id: r.id, model, arm: r.arm, cls: r.cls, age: r.age, cutoff: r.cutoff, text: r.text })));
    const cells = {};
    const groups = (r) => {
      const g = [`${r.arm}`, `${r.arm} · ${r.age}`, `${r.arm} · ${r.cutoff}`];
      if (!byId.get(r.id).ours_predictable) g.push(`${r.arm} · misread not sequence-predictable`, `${r.arm} · ${r.cutoff} · not predictable`);
      return g;
    };
    for (const r of rows) for (const g of groups(r)) (cells[g] ??= []).push(r);
    report.models[model] = {
      usd: +rows.reduce((s, r) => s + (r.usd || 0), 0).toFixed(4),
      cells: Object.fromEntries(Object.entries(cells).sort().map(([g, rs]) => {
        const n = rs.length; const k = (c) => rs.filter((r) => r.cls === c).length;
        return [g, {
          n, books: new Set(rs.map((r) => r.book_id)).size,
          ours: k('ours'), ours_rate: +(k('ours') / n).toFixed(3), ours_wilson: wilson(k('ours'), n), ours_book_boot: bookBoot(rs, 'ours'),
          correct: k('correct'), correct_rate: +(k('correct') / n).toFixed(3), correct_wilson: wilson(k('correct'), n),
          other: k('other') + k('empty'),
        }];
      })),
    };
  }
  fs.writeFileSync(path.join(OUT, 'scores.jsonl'), scored.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  const lines = ['| model | cell | n (books) | our misread | 95% Wilson | book boot | printed reading | 95% Wilson | other |', '|---|---|---:|---:|---|---|---:|---|---:|'];
  for (const [m, r] of Object.entries(report.models)) for (const [g, c] of Object.entries(r.cells)) {
    lines.push(`| ${m} | ${g} | ${c.n} (${c.books}) | ${c.ours} (${(100 * c.ours_rate).toFixed(1)}%) | ${c.ours_wilson.map((v) => (100 * v).toFixed(1)).join('–')} | ${c.ours_book_boot ? c.ours_book_boot.map((v) => (100 * v).toFixed(1)).join('–') : '—'} | ${c.correct} (${(100 * c.correct_rate).toFixed(1)}%) | ${c.correct_wilson.map((v) => (100 * v).toFixed(1)).join('–')} | ${c.other} |`);
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

const stage = args.stage;
if (stage === 'build') await build();
else if (stage === 'gemini') { for (const m of args.model ? [args.model] : MODELS_GEMINI) await gemini(m); }
else if (stage === 'packets') packets();
else if (stage === 'ingest') ingest(args.model || 'claude-haiku');
else if (stage === 'score') score();
else { console.error('--stage=build|gemini|packets|ingest|score'); process.exit(1); }

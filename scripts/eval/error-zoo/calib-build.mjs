#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/convergent-audit-weekly.mjs `draw` (the packet shape, makeRecord, redaction; its draw is
 * uniform and has no planted pages or controls) and scripts/eval/lib/plant-ocr-errors (plants character-level OCR
 * noise for a screen; the calibration set needs one CRITICAL error per page of a named kind, with the answer kept).
 * This builds the calibration set of CALIBRATION-SET-DESIGN.md. Read-only against Mongo; images are downloaded.
 *
 *   node --env-file=… scripts/eval/error-zoo/calib-build.mjs --pool=POOL.json --run-id=pool-61202 --out=DIR [--seed=6420]
 *
 * DIR/packets/pNNN.json   one page each, the weekly audit's redacted record (readers see no block, stratum or answer)
 * DIR/images/             the page images, named by hash
 * DIR/key.jsonl           per packet: block A|B|C|D, language, stratum (random|top), page ids, text and image sha256,
 *                         planted answer (C) or control kind (D). Never sealed into a reader's folder.
 * DIR/runs/{rubric,rubric-retest,current,derek}/   the reader runs: symlinked packets and images
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { structureCounts, pageImageUrl } from '../spot-check/lib.mjs';
import { redactRecord } from '../second-reader/lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { exposureOf } from '../../lib/review-vocabulary.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out')), POOL = arg('pool'), RUNID = arg('run-id'), SEED = Number(arg('seed', 6420));
const rng = makeRng(SEED);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sha = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');
const A = { Latin: 24, German: 16, French: 16, Italian: 16 }, B = { Greek: 8, Chinese: 8, Arabic: 8, Hebrew: 8 };
const N_PLANT = 10, N_WRONG = 3, N_ETEXT = 3;

const pool = JSON.parse(fs.readFileSync(POOL, 'utf8'));
const runIdOf = new Map(fs.readFileSync(path.join(path.dirname(POOL), 'labels.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.source === 'candidate').map((r) => [r.page_id, r.run_id]));
const cand = pool.candidates.filter((c) => runIdOf.get(c.page_id) === RUNID);
console.log('calibration candidates in the pool', cand.length);

// ---- pick block A and B: half from the top decile within the language, half at random from the rest ----------------
const used = new Set(); const items = [];
function pickLang(L, n, block) {
  const cs = cand.filter((c) => c.language === L && !used.has(c.book_id)).sort((a, b) => b.score - a.score);
  const topN = Math.max(Math.ceil(n / 2), Math.ceil(cs.length * 0.1));
  const top = shuffle(cs.slice(0, topN)).slice(0, Math.ceil(n / 2));
  for (const c of top) { used.add(c.book_id); items.push({ ...c, block, stratum: 'top' }); }
  const rest = shuffle(cs.slice(topN).filter((c) => !used.has(c.book_id))).slice(0, n - top.length);
  for (const c of rest) { used.add(c.book_id); items.push({ ...c, block, stratum: 'random' }); }
  if (top.length + rest.length < n) console.log(`  ${L}: only ${top.length + rest.length} of ${n}`);
}
for (const [L, n] of Object.entries(A)) pickLang(L, n, 'A');
for (const [L, n] of Object.entries(B)) pickLang(L, n, 'B');
// planted: low-risk pages of block-A languages from unused books (a clean-looking page, so the plant is the error)
const plantFrom = shuffle(cand.filter((c) => A[c.language] && !used.has(c.book_id) && c.pct < 0.5));

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const proj = { id: 1, book_id: 1, page_number: 1, page_type: 1, translation_withheld: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1, photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 };
fs.mkdirSync(path.join(OUT, 'images'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'packets'), { recursive: true });
async function download(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 2000) return null;
    const h = crypto.createHash('sha256').update(buf).digest('hex'); const file = `images/${h.slice(0, 16)}.jpg`;
    fs.writeFileSync(path.join(OUT, file), buf); return { file, sha256: h };
  } catch { return null; }
}
async function record(p, textFrom = p) {
  const url = pageImageUrl(p); const img = url ? await download(url) : null; if (!img) return null;
  const b = await db.collection('books').findOne({ id: p.book_id }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, visible: 1 } });
  const all = await db.collection('pages').find({ book_id: p.book_id }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  return { slot: 1, stratum: 'audit', exposure: exposureOf({ book: b, page: p }), book_id: p.book_id, book_url: `https://sourcelibrary.org/book/${p.book_id}`, tradition: null, book: b,
    structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_translated_field: b.pages_translated }, run: [p.page_number],
    pages: [{ page_number: p.page_number, page_id: String(p.id), image_url: url, image_file: img.file, image_sha256: img.sha256, ocr: textFrom.ocr.data, ocr_engine: textFrom.ocr?.source ?? null, ocr_model: textFrom.ocr?.model ?? null,
      translation: textFrom.translation?.data ?? '', translation_model: textFrom.translation?.model ?? null, translation_source: textFrom.translation?.source ?? null }] };
}
const key = []; const recs = [];
function add(rec, k) { const id = `p${String(recs.length).padStart(3, '0')}`; recs.push(rec); key.push({ packet: id, ...k, ocr_sha256: sha(rec.pages[0].ocr), translation_sha256: sha(rec.pages[0].translation), image_sha256: rec.pages[0].image_sha256 }); }

for (const it of items) {
  const p = await db.collection('pages').findOne({ id: it.page_id }, { projection: proj });
  if (!p?.ocr?.data) { console.log('  gone', it.page_id); continue; }
  const rec = await record(p); if (!rec) { console.log('  no image', it.page_id); continue; }
  add(rec, { block: it.block, language: it.language, stratum: it.stratum, score: it.score, page_id: it.page_id, book_id: it.book_id });
}

// ---- C: planted critical errors -----------------------------------------------------------------------------------
const NEG = { Latin: /\b(non|nec|neque|nihil)\b/, German: /\b(nicht|kein|keine|keinen|nie)\b/, French: /\b(ne|pas|point|jamais)\b/, Italian: /\b(non|mai)\b/ };
const bodyLines = (t) => t.split('\n').map((l, i) => [i, l]).filter(([, l]) => l.trim().length >= 30 && !/^\s*</.test(l));
const KINDS = ['number', 'negation', 'name', 'drop_line', 'facing_line'];
let planted = 0;
for (const c of plantFrom) {
  if (planted >= N_PLANT) break;
  if (used.has(c.book_id)) continue;  // one page per book, rechecked as books are used
  const p = await db.collection('pages').findOne({ id: c.page_id }, { projection: proj }); if (!p?.ocr?.data) continue;
  let t = p.ocr.data; const want = KINDS[planted % KINDS.length]; let ans = null;
  const lines = bodyLines(t); if (lines.length < 6) continue;
  if (want === 'number') { const m = [...t.matchAll(/\d{2,}/g)][0]; if (m) { const d = m[0], nd = d.slice(0, -1) + String((+d.slice(-1) + 3) % 10); t = t.slice(0, m.index) + nd + t.slice(m.index + d.length); ans = { kind: 'number', was: d, now: nd }; } }
  if (!ans && want === 'negation') { const m = t.match(NEG[c.language]); if (m) { t = t.slice(0, m.index) + t.slice(m.index + m[0].length).replace(/^ /, ''); ans = { kind: 'negation_removed', was: m[0], now: '' }; } }
  if (!ans && (want === 'name' || want === 'number' || want === 'negation')) { const ws = [...t.matchAll(/(?<=[a-zäöüéèàß,;] )([A-ZÄÖÜ][a-zäöüéèàß]{5,})/g)]; const m = ws[Math.floor(ws.length / 2)]; if (m) { const w = m[0], nw = w[0] + w[2] + w[1] + w.slice(3); t = t.slice(0, m.index) + nw + t.slice(m.index + w.length); ans = { kind: 'name_changed', was: w, now: nw }; } }
  if (!ans && want === 'drop_line') { const [i, l] = lines[Math.floor(lines.length / 2)]; const L = t.split('\n'); L.splice(i, 1); t = L.join('\n'); ans = { kind: 'line_dropped', was: l.trim(), now: '' }; }
  if (!ans && want === 'facing_line') { const nx = await db.collection('pages').findOne({ book_id: p.book_id, page_number: p.page_number + 1 }, { projection: { 'ocr.data': 1 } }); const nl = nx?.ocr?.data ? bodyLines(nx.ocr.data)[2] : null; if (nl) { const [i] = lines[Math.floor(lines.length / 2)]; const L = t.split('\n'); L.splice(i, 0, nl[1]); t = L.join('\n'); ans = { kind: 'line_from_next_leaf', was: '', now: nl[1].trim() }; } }
  if (!ans) continue;
  const rec = await record(p, { ...p, ocr: { ...p.ocr, data: t } }); if (!rec) continue;
  used.add(c.book_id); planted++;
  add(rec, { block: 'C', language: c.language, stratum: 'planted', page_id: c.page_id, book_id: c.book_id, planted: ans });
}

// ---- D: controls --------------------------------------------------------------------------------------------------
let wrong = 0;
for (const c of shuffle(cand.filter((x) => A[x.language] && !used.has(x.book_id)))) {
  if (wrong >= N_WRONG) break;
  if (used.has(c.book_id)) continue;
  const p = await db.collection('pages').findOne({ id: c.page_id }, { projection: proj });
  const nx = p && await db.collection('pages').findOne({ book_id: p.book_id, page_number: p.page_number + 1 }, { projection: proj });
  if (!nx?.ocr?.data || (nx.ocr.data.length < 300) || !(nx.translation?.data || '').trim()) continue;
  const rec = await record(p, nx); if (!rec) continue;
  used.add(c.book_id); wrong++;
  add(rec, { block: 'D', language: c.language, stratum: 'control', control: 'wrong_page', page_id: c.page_id, text_of_page_id: nx.id, book_id: c.book_id });
}
// Typed e-text books, found through book_checks (text_provenance names `source:<label>` for text no model made): an
// unindexed regex on pages.ocr.source scans the whole collection.
const etBookIds = await db.collection('book_checks').distinct('book_id', { 'text_provenance.ocr_model': /^source:/ });
const et = shuffle(await db.collection('pages').find({ book_id: { $in: etBookIds }, 'translation.data': { $type: 'string' } }, { projection: proj }).limit(400).toArray());
let etext = 0; const etBooks = new Set();
for (const p of et) {
  if (etext >= N_ETEXT || etBooks.has(p.book_id) || (p.ocr?.data || '').length < 300) continue;
  const rec = await record(p); if (!rec) continue;
  etBooks.add(p.book_id); etext++;
  add(rec, { block: 'D', language: rec.book?.language, stratum: 'control', control: 'typed_etext', page_id: p.id, book_id: p.book_id });
}
await client.close();

// ---- write, in a shuffled order so packet numbers say nothing about blocks ------------------------------------------
const order = shuffle(recs.map((_, i) => i));
const finalKey = [];
order.forEach((i, j) => {
  const id = `p${String(j).padStart(3, '0')}`;
  fs.writeFileSync(path.join(OUT, 'packets', `${id}.json`), JSON.stringify([redactRecord({ ...recs[i], exposure: undefined })], null, 1));
  finalKey.push({ ...key[i], packet: id });
});
fs.writeFileSync(path.join(OUT, 'key.jsonl'), finalKey.map((k) => JSON.stringify(k)).join('\n') + '\n');
const tally = {}; for (const k of finalKey) { const t = `${k.block}:${k.language}`; tally[t] = (tally[t] || 0) + 1; }
console.log('packets', finalKey.length, JSON.stringify(tally));

// ---- reader runs ----------------------------------------------------------------------------------------------------
function mkRun(name, keys) {
  const R = path.join(OUT, 'runs', name); fs.mkdirSync(path.join(R, 'packets'), { recursive: true });
  if (!fs.existsSync(path.join(R, 'images'))) fs.symlinkSync(path.join(OUT, 'images'), path.join(R, 'images'));
  for (const k of keys) { const dst = path.join(R, 'packets', `${k.packet}.json`); if (!fs.existsSync(dst)) fs.symlinkSync(path.join(OUT, 'packets', `${k.packet}.json`), dst); }
  fs.writeFileSync(path.join(R, 'packets.txt'), keys.map((k) => k.packet).join('\n') + '\n');
  console.log(`run ${name}: ${keys.length} packets`);
}
mkRun('rubric', finalKey);
const byBlock = (b) => finalKey.filter((k) => k.block === b);
mkRun('current', byBlock('A'));
const retest = [...shuffle(byBlock('A')).slice(0, 14), ...shuffle(byBlock('B')).slice(0, 8), ...shuffle(byBlock('C')).slice(0, 4), ...shuffle(byBlock('D')).slice(0, 4)];
mkRun('rubric-retest', retest);
const derek = [...Object.keys(A).flatMap((L) => { const ks = byBlock('A').filter((k) => k.language === L); const t = ks.filter((k) => k.stratum === 'top'), r = ks.filter((k) => k.stratum === 'random'); return [...shuffle(t).slice(0, Math.ceil(33 / 8)), ...shuffle(r).slice(0, Math.floor(33 / 8))]; }).slice(0, 33),
  ...shuffle(byBlock('C')).slice(0, 2), ...byBlock('D').filter((k) => k.control === 'wrong_page').slice(0, 1)];
mkRun('derek', derek);

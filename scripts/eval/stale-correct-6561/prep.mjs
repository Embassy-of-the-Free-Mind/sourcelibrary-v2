#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/batch/prep.mjs (the work list + hash-checked prompt.json for batch/run.mjs;
// it does not fit because its frame is the withheld TABLE pages, read from a flagged list and the withhold snapshot) and
// scripts/batch/stale-retranslate-6567.mjs `select` (the stale frame and the old-vs-new CER, PR #6598; it keeps the
// CER < 0.1 pages and drops these). This file is that frame's other half, written in run.mjs's pages.jsonl shape.
//
// #6561 item 1 (Derek "yes" 2026-10-13): Opus-correct the stale Siku pages whose Paddle reading changed by CER >= 0.1.
// Reads Mongo, writes files only.
//
// Usage (cwd = a scratch dir): node --env-file=… prep.mjs [--pilot=100]
// Writes: frame.jsonl (every eligible page, run.mjs shape + cer), census.json, prompt.json (as batch/prep.mjs),
//         pilot/pages.jsonl + pilot/prompt.json (n pages, one per book, seed 6561), rest/pages.jsonl (the frame minus
//         the pilot) + rest/prompt.json.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { bodyText, foldHan, makeRng } from '../ground-truth-5935/lib.mjs';
import { LANE } from '../../lib/paddle-zh-lane.mjs';
import { ADDENDUM_HEAD, FMT, OPUS_SUFFIX, LANGUAGE_INSTRUCTION, sha } from '../paddle-correct-6561/batch/prompt.mjs';

const N_PILOT = Number(process.argv.find((a) => a.startsWith('--pilot='))?.split('=')[1] || 100);
const CER_MIN = 0.1, MIN_HAN = 8, SEED = 6561;
const OWN_HOLD = /^paddle-zh-\d+-ocr-only$/;
const REF = JSON.parse(fs.readFileSync(new URL('../paddle-correct-6561/results/prompt-ref.json', import.meta.url), 'utf8'));

// The stale run's CER, byte for byte (stale-retranslate-6567.mjs): folded Han of the body, Levenshtein / new length.
const HAN = /\p{Script=Han}/u;
const fold1 = (c) => { const f = foldHan(c); return [...f].length === 1 ? f : c; };
const hanFold = (t) => [...bodyText(t)].filter((c) => HAN.test(c)).map(fold1);
function lev(x, y) {
  if (!x.length) return y.length; if (!y.length) return x.length;
  let prev = new Int32Array(y.length + 1), cur = new Int32Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}
const humanEdited = (f) => !!f && (f.source === 'manual' || !!f.edited_by);

const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');

const p = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
const base = p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
const head = `${base}\n${ADDENDUM_HEAD}`;
const redo = head + FMT + OPUS_SUFFIX;
if (sha(head) !== REF.head_sha || sha(redo) !== REF.redo_opus_sha) {
  console.error(`PROMPT DRIFT: head ${sha(head)} (want ${REF.head_sha}), redo ${sha(redo)} (want ${REF.redo_opus_sha}); default OCR prompt is ${p.name} v${p.version}. Not the #6561 arm: stop.`);
  process.exit(3);
}
const promptJson = JSON.stringify({ head, fmt: FMT, suffix: OPUS_SUFFIX, head_sha: sha(head), redo_opus_sha: sha(redo), prompt_name: p.name, prompt_version: String(p.version ?? ''), fetched_at: new Date().toISOString() }, null, 1);

const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, photo: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.unreadable': 1, 'ocr.engine.input.image_url': 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, translation_stale: 1, translation_withheld: 1 };
const pages = await db.collection('pages').find({ 'translation_stale.reason': 'ocr_rewritten', 'translation_stale.lane': LANE }, { projection: PROJ }).toArray();
const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((x) => x.book_id))] } }, { projection: { _id: 0, id: 1, title: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
const revs = new Map();
for (let i = 0; i < pages.length; i += 500) {
  const ids = pages.slice(i, i + 500).map((x) => x.id);
  for (const r of await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', reason: /^reocr_paddle_zh_/ }, { projection: { _id: 0, page_id: 1, data: 1, created_at: 1 } }).toArray()) {
    const q = revs.get(r.page_id); if (!q || r.created_at > q.created_at) revs.set(r.page_id, r);
  }
}
await c.close();

const census = { computed_at: new Date().toISOString(), lane: LANE, cer_min: CER_MIN, stale_pages: pages.length, excluded: {}, cer_lt_0_1: 0, eligible: 0 };
const ex = (why) => { census.excluded[why] = (census.excluded[why] || 0) + 1; };
const frame = [];
for (const x of pages) {
  const book = books.get(x.book_id);
  if (!book) { ex('book not found'); continue; }
  const hold = book.pipeline_auto?.hold;
  if (hold && !OWN_HOLD.test(hold.reason || '')) { ex(`book held: ${hold.reason}`); continue; }
  if (x.ocr?.unreadable === true) { ex('ocr.unreadable'); continue; }
  if (humanEdited(x.ocr)) { ex('human-edited OCR'); continue; }
  if (x.ocr?.source !== 'paddle') { ex('OCR is not the Paddle reading'); continue; }
  if (typeof x.ocr?.data !== 'string') { ex('no OCR text'); continue; }
  const rev = revs.get(x.id);
  if (!rev) { ex('no lane revision (old reading)'); continue; }
  const o = hanFold(rev.data), nw = hanFold(x.ocr.data);
  if (nw.length < MIN_HAN) { ex(`under ${MIN_HAN} Han characters`); continue; }
  const cer = Math.min(1, lev(o, nw) / Math.max(1, nw.length));
  if (cer < CER_MIN) { census.cer_lt_0_1++; continue; }
  const url = x.ocr?.engine?.input?.image_url || x.archived_photo || x.photo; // image-pick-ok: the image Paddle read (engine input first), as batch/prep.mjs
  if (!url) { ex('no image url'); continue; }
  census.eligible++;
  frame.push({ uid: x.id, pid: x.id, bid: x.book_id, pn: x.page_number, title: book.title || '', image_url: url, paddle: x.ocr.data, paddle_sha: sha(x.ocr.data), cer: +cer.toFixed(4), has_english: !!String(x.translation?.data || '').trim(), english_withheld: !!x.translation_withheld, human_english: humanEdited(x.translation) });
}
frame.sort((a, b) => (a.bid < b.bid ? -1 : a.bid > b.bid ? 1 : a.pn - b.pn));
census.books = new Set(frame.map((f) => f.bid)).size;

// Pilot: one page per book, seeded; books shuffled, then one random page of each of the first n.
const byBook = new Map();
for (const f of frame) (byBook.get(f.bid) || byBook.set(f.bid, []).get(f.bid)).push(f);
const rng = makeRng(SEED);
const bids = [...byBook.keys()].sort();
for (let i = bids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bids[i], bids[j]] = [bids[j], bids[i]]; }
const pilot = bids.slice(0, N_PILOT).map((b) => { const xs = byBook.get(b); return xs[Math.floor(rng() * xs.length)]; });
const inPilot = new Set(pilot.map((x) => x.pid));
census.pilot = { n: pilot.length, books: new Set(pilot.map((x) => x.bid)).size, seed: SEED };

const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
fs.writeFileSync('frame.jsonl', jl(frame));
fs.writeFileSync('census.json', JSON.stringify(census, null, 1) + '\n');
fs.writeFileSync('prompt.json', promptJson);
for (const [dir, rows] of [['pilot', pilot], ['rest', frame.filter((f) => !inPilot.has(f.pid))]]) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/pages.jsonl`, jl(rows));
  fs.writeFileSync(`${dir}/prompt.json`, promptJson);
}
console.log(JSON.stringify(census, null, 1));

#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-ref/build-packet-stored.py (PR #5806) builds NEG/PLANT/DUP controls
// for a two-candidate A/B judge; its negation plant (FLIPS) is reused here. #5829 needs single-candidate
// controls of three new kinds (84000 human sides, typed planted errors, #5797-judged sides), so this is new.
/**
 * build-controls.mjs — read-only, $0. Step 2 of #5829: 60 control items.
 *   HUMAN  20 sides whose English is 84000's published translation (tengyur-ref-5497 alignment).
 *   PLANT  20 real pages (outside the sample) with ONE planted error: 7 negation flips, 7 agent swaps,
 *          6 wrong technical terms. Inserted by script and logged.
 *   J5797  20 sides #5797 judged against 84000 (stored English, current text), with their verdicts:
 *          10 drawn from the sides either judge marked reversed, 10 from the rest (seeded).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-characterize/build-controls.mjs
 *
 * Writes /root/tchar/controls.jsonl (full items) and <out>/controls-log.json (what was planted where).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { rng as mkRng, shuffle } from './common.mjs';
import { makePlanters } from './plants.mjs';

const out = 'scripts/eval/results/tengyur-characterize-5829';
const work = '/root/tchar';
const TREF = '/root/tref';
const R = mkRng(5829 * 7 + 2);
const pick = (arr, n) => shuffle(arr, R).slice(0, n);

const sample = JSON.parse(fs.readFileSync(path.join(out, 'sample.json'), 'utf8')).pages;
const counts = JSON.parse(fs.readFileSync(path.join(out, 'counts.json'), 'utf8')).by_volume;
const used = new Set(sample.map((p) => p.page_id));
const ref = fs.readFileSync(path.join(TREF, 'ref/reference.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const refIds = new Set(ref.map((r) => r.page_id));
const rows = JSON.parse(fs.readFileSync('scripts/eval/results/tengyur-ref-2026-10/stored/scores.json', 'utf8')).rows;

// ---------- J5797: 10 reversed (either judge) + 10 not ----------
const revd = rows.filter((r) => r.S.inversions.some((x) => x.length) && !used.has(r.page_id));
const clean = rows.filter((r) => !r.S.inversions.some((x) => x.length) && !used.has(r.page_id));
const j5797 = [...pick(revd, 10), ...pick(clean, 10)];
j5797.forEach((r) => used.add(r.page_id));

// ---------- HUMAN: 84000 sides, whole side covered, no root verses stripped ----------
const okRef = ref.filter((r) => r.root_verses_stripped === 0 && r.cover_ours >= 0.9 && r.cover_theirs >= 0.9 && !used.has(r.page_id));
const small = okRef.filter((r) => !['toh3808', 'toh1189', 'toh1183'].includes(r.toh));
const human = [
  ...pick(okRef.filter((r) => r.toh === 'toh3808'), 8), ...pick(okRef.filter((r) => r.toh === 'toh1189'), 4),
  ...pick(okRef.filter((r) => r.toh === 'toh1183'), 4), ...pick(small, 4),
];
human.forEach((r) => used.add(r.page_id));
// 84000's own conventions would betray the source: {12} section numbers, [B3] refs, [F.12.a] folio refs,
// and square-bracketed editorial supplements ("[they]"). Remove the refs, keep the supplied words unbracketed.
const deStyle = (s) => s.replace(/\{\d+\}/g, '').replace(/\[(B\d+|F\.\d+\.[ab])\]/g, '').replace(/\[([^\]]{1,60})\]/g, '$1')
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();

// ---------- PLANT pages: uniform over the population, outside sample and the 84000 texts ----------
const total = counts.reduce((s, x) => s + x.with_english, 0);
const plantIdx = [];
while (plantIdx.length < 60) { const g = Math.floor(R() * total); if (!plantIdx.includes(g)) plantIdx.push(g); }

const HAS_EN = { 'translation.data': { $type: 'string', $nin: [''] } };
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const pages = db.collection('pages');
const ln = (s) => (s || '').split('\n').filter((l) => l.trim());
async function full(book_id, page_number) {
  const p = await pages.findOne({ book_id, page_number }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.text_edition.folio': 1, 'translation.data': 1 } });
  const nb = await pages.find({ book_id, page_number: { $in: [page_number - 1, page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  return { page_id: p.id, bo: p.ocr?.data || '', en: p.translation?.data || '', folio: p.ocr?.text_edition?.folio || null,
    prev_last: ln(nb.find((x) => x.page_number === page_number - 1)?.ocr?.data).slice(-1)[0] || '',
    next_first: ln(nb.find((x) => x.page_number === page_number + 1)?.ocr?.data)[0] || '' };
}
const volOf = Object.fromEntries(counts.map((x) => [x.book_id, x]));

const { plantReversal, plantAgent, plantTerm } = makePlanters(R);

const items = [], log = [];
const plan = [...Array(7).fill('reversal'), ...Array(7).fill('agent'), ...Array(6).fill('term')];
let gi = 0;
for (const kind of plan) {
  for (;;) {
    const g = plantIdx[gi++];
    if (g === undefined) throw new Error('ran out of plant candidates');
    let k = g, vol;
    for (const x of counts) { if (k < x.with_english) { vol = x; break; } k -= x.with_english; }
    const [pg] = await pages.find({ book_id: vol.book_id, ...HAS_EN }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).skip(k).limit(1).toArray();
    if (used.has(pg.id) || refIds.has(pg.id)) continue;
    const f = await full(vol.book_id, pg.page_number);
    const p = kind === 'reversal' ? plantReversal(f.en) : kind === 'agent' ? plantAgent(f.en) : plantTerm(f.en);
    if (!p) { log.push({ skipped: pg.id, kind, why: 'no plantable sentence' }); continue; }
    used.add(pg.id);
    const en = f.en.replace(p.old, p.new);
    items.push({ ctype: 'PLANT', plant_kind: kind, vol: vol.vol, section: vol.section, book_id: vol.book_id, page_number: pg.page_number, ...f, en, plant: p });
    log.push({ page_id: pg.id, vol: vol.vol, page_number: pg.page_number, kind, ...p });
    break;
  }
}
for (const r of human) {
  const f = await full(r.book_id, r.page_number);
  items.push({ ctype: 'HUMAN', vol: r.vol, section: volOf[r.book_id].section, book_id: r.book_id, page_number: r.page_number, ...f, en: deStyle(r.ref_en), stored_en: f.en, toh: r.toh });
}
for (const r of j5797) {
  const f = await full(r.book_id, r.page_number);
  items.push({ ctype: 'J5797', vol: r.vol, section: volOf[r.book_id].section, book_id: r.book_id, page_number: r.page_number, ...f, toh: r.toh,
    j5797: { id: r.id, reversed_either: r.S.inversions.some((x) => x.length), reversed_both: r.S.inversions.every((x) => x.length), fid: r.S.fid, inversions: r.S.inversions } });
}
fs.writeFileSync(path.join(work, 'controls.jsonl'), items.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'controls-log.json'), JSON.stringify({
  seed: 5829, plants: log,
  human: human.map((r) => ({ page_id: r.page_id, toh: r.toh, vol: r.vol, folio: r.folio, page_number: r.page_number })),
  j5797: j5797.map((r) => ({ page_id: r.page_id, q: r.id, toh: r.toh, vol: r.vol, page_number: r.page_number, reversed_either: r.S.inversions.some((x) => x.length), reversed_both: r.S.inversions.every((x) => x.length), fid: r.S.fid })),
}, null, 1));
console.log(`controls: ${items.length}`, items.reduce((m, x) => ((m[x.ctype] = (m[x.ctype] || 0) + 1), m), {}));
await c.close();

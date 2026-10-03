#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-arms/negcheck.py — the one reference-free detector we have (Tibetan negation counts,
// at chance: precision 0.09, #5713); it reads Tengyur files only and carries no labelled set. Each #5695 track keeps its
// judge labels in its own layout (results*.json per_page; Tengyur in judge/scores.json rows). Nothing joins them.
/** Labelled set for the reference-free detectors (#5695 extra test): one served page per row with source, our English and the two judges' labels. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-vs-reference/backtrans/build-set.mjs \
 *     --out scripts/eval/results/xlref-backtrans-2026-10 [--t1-dir <dir>] [--t4-dir <dir>] [--n 150] [--seed 5695]
 *
 * Design: case-control. Every served page where EITHER judge quoted a reversal is taken; the rest of the N pages are
 * drawn at random from the pages with no reversal, in proportion to each track's count. Each row carries `weight`
 * (pages it stands for in its track) so precision can be quoted at the reference sets' own base rate, not the
 * enriched one. `order` is a seeded shuffle: the first 60 are the stop-rule sample.
 * Reads Mongo only for the Tengyur source text (pages.ocr.data); writes nothing to Mongo. No reference text is stored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../../lib/paired-stats.mjs';
import { readJsonl, writeJsonl, itemId, sha16, firstWords, PRIVATE_QUOTE_WORDS } from '../common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const RES = 'scripts/eval/results';
const OUT = opt('out'); const N = Number(opt('n', 150)); const SEED = Number(opt('seed', 5695));
const T1 = opt('t1-dir', `${RES}/xlref-t1-2026-10`); const T4 = opt('t4-dir', `${RES}/xlref-t4-2026-10`);
if (!OUT) { console.error('--out is required'); process.exit(1); }
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// One judge's verdict on the served arm → the labels the detectors are scored against.
const clip = (q) => (q ? firstWords(q, PRIVATE_QUOTE_WORDS) : null);
const revList = (r) => (r == null ? [] : Array.isArray(r) ? r : [r]).filter(Boolean);
function labelsOf(byJudge) {
  const js = Object.values(byJudge).filter(Boolean);
  const count = (f) => js.filter(f).length;
  const fill = (j) => (j.invention || []).some((i) => i.kind === 'unreadable_fill');
  const fid = js.map((j) => j.fidelity).filter((x) => typeof x === 'number');
  return {
    judges: js.length,
    reversal_judges: count((j) => revList(j.reversal).length > 0),
    omission_judges: count((j) => j.omission === true),
    fill_judges: count(fill),
    boundary_judges: count((j) => (j.invention || []).some((i) => i.kind === 'boundary')),
    fidelity: fid.length ? fid.reduce((a, b) => a + b, 0) / fid.length : null,
    // `should_be` is the judge's own short quote of the source or reference clipped to 15 words for every page, so no reference is quoted at length whatever its licence (#5488)
    reversals: js.flatMap((j) => revList(j.reversal).map((r) => ({ english: r.candidate ?? r.english ?? null, source: r.source ?? r.tibetan ?? null, should_be: clip(r.source_or_reference), why: r.why ?? r.note ?? null }))),
    defects: js.flatMap((j) => (j.defects || []).filter((d) => d.severity === 'major').map((d) => `${d.class}: ${d.detail}`)).slice(0, 6),
  };
}

const rows = [];
function addHarness(track, perPage, texts) { // texts: id → {source, english, lang}
  for (const p of perPage) {
    const s = p.arms?.served; const t = texts.get(p.id);
    if (!s || !t || !t.english || !t.source) continue;
    rows.push({ id: p.id, track, lang: p.lang, book_id: p.book_id, page_number: p.page_number, url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`,
      arm: 'served', source_text: t.source, english: t.english, labels: labelsOf(s.by_judge) });
  }
}
const fromRecords = (f) => new Map(readJsonl(f).map((r) => [itemId(r), { source: r.source_text, english: r.candidates.find((c) => c.arm === 'served')?.text }]));

addHarness('T1', J(`${T1}/results-pass1.json`).per_page, fromRecords(`${T1}/records.jsonl`));
// T2: the served packet was judged against the OCR as served; pages.jsonl repeats source_text on every arm row
addHarness('T2', J(`${RES}/xlref-t2-2026-10/results-served.json`).per_page,
  new Map(readJsonl(`${RES}/xlref-t2-2026-10/pages.jsonl`).filter((r) => r.arm === 'served' && !r.source_is_corrected_transcription).map((r) => [r.id, { source: r.source_text, english: r.text }])));
addHarness('T3', J(`${RES}/xlref-t3-2026-10/results.json`).per_page, fromRecords(`${RES}/xlref-t3-2026-10/records.jsonl`));
{ const src = new Map(readJsonl(`${T4}/references.jsonl`).map((r) => [r.id, r.source_text_ocr]));
  addHarness('T4', J(`${T4}/results.json`).per_page,
    new Map(readJsonl(`${T4}/pages.jsonl`).filter((r) => r.arm === 'served').map((r) => [r.id, { source: src.get(r.id), english: r.text }]))); }
addHarness('T5', J(`${RES}/xlref-t5-2026-10/results.json`).per_page, fromRecords(`${RES}/xlref-t5-2026-10/work/records-arms.jsonl`));

// Tengyur (#5497): arm A is the chained production lane's draft. Labels are in scores.json rows; the Tibetan is in Mongo.
{ const TG = `${RES}/tengyur-ref-2026-10`;
  const text = new Map(readJsonl(`${TG}/arms/judged-pages.jsonl`).map((r) => [r.page_id, r.A?.text]));
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try {
    const trows = J(`${TG}/judge/scores.json`).rows.filter((r) => r.A && text.get(r.page_id));
    const docs = await client.db('bookstore').collection('pages').find({ _id: { $in: trows.map((r) => r.page_id) } }, { projection: { 'ocr.data': 1 } }).toArray();
    const src = new Map(docs.map((d) => [String(d._id), d.ocr?.data]));
    for (const r of trows) {
      if (!src.get(r.page_id)) continue;
      const a = r.A; const n = a.fid.length;
      rows.push({ id: itemId(r), track: 'Tengyur', lang: 'Tibetan', book_id: r.book_id, page_number: r.page_number, url: `https://sourcelibrary.org/book/${r.book_id}?page=${r.page_number}`,
        arm: 'A (chained lane draft)', source_text: src.get(r.page_id), english: text.get(r.page_id),
        labels: { judges: n, reversal_judges: a.inversions.filter((x) => x.length).length, omission_judges: a.omit.filter(Boolean).length,
          fill_judges: a.inv_types.filter((x) => x.includes('unreadable_fill')).length, boundary_judges: a.inv_types.filter((x) => x.includes('boundary')).length,
          fidelity: a.fid_mean, reversals: a.inversions.flat().map((q) => ({ english: q.candidate ?? null, source: q.tibetan ?? null, should_be: clip(q.reference), why: q.why ?? null })), defects: [] } });
    }
  } finally { await client.close(); }
}

// ── case-control draw ────────────────────────────────────────────────────────────────────────────────────────
const rnd = makeRng(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isPos = (r) => r.labels.reversal_judges > 0;
const universe = {}; for (const r of rows) { const u = (universe[r.track] ??= { pages: 0, reversal_any: 0, by_lang: {} }); u.pages++; if (isPos(r)) u.reversal_any++; u.by_lang[r.lang] = (u.by_lang[r.lang] || 0) + 1; }
const pos = rows.filter(isPos); const negAll = rows.filter((r) => !isPos(r));
const want = N - pos.length; const picked = [];
const tracks = Object.keys(universe); let left = want;
tracks.forEach((t, i) => {
  const pool = shuffle(negAll.filter((r) => r.track === t).sort((a, b) => a.id.localeCompare(b.id)));
  const k = i === tracks.length - 1 ? Math.min(left, pool.length) : Math.min(pool.length, Math.round(want * pool.length / negAll.length));
  left -= k;
  for (const r of pool.slice(0, k)) picked.push({ ...r, weight: pool.length / k });
});
const set = shuffle([...pos.map((r) => ({ ...r, weight: 1 })), ...picked].sort((a, b) => a.id.localeCompare(b.id)))
  .map((r, i) => ({ order: i + 1, ...r, source_sha16: sha16(r.source_text), english_sha16: sha16(r.english) }));
writeJsonl(path.join(OUT, 'set.jsonl'), set);
fs.writeFileSync(path.join(OUT, 'set-summary.json'), JSON.stringify({ seed: SEED, n: set.length, positives_reversal_either_judge: pos.length, negatives_sampled: picked.length,
  universe, inputs: { T1, T4, note: 'T1 and T4 results were read from their PR branches (#5721, #5735) when not yet on main' } }, null, 1));
console.log(JSON.stringify({ n: set.length, pos: pos.length, universe }, null, 0));

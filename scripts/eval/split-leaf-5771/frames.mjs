#!/usr/bin/env node
// PRIOR ART: scripts/eval/opus-tib-sa-6948/sample.mjs + audit.mjs pilot-items (the draw and the 80 audited Tibetan
// pages; the key is copied from that job's scratch, not redrawn: a redraw from today's frame differs by one book and
// the seed then picks other pages); the #4523 Yigdzin leaf ledgers (`pages.jsonl` / `ledger-*.jsonl` rows written by
// yig_leaf_worker.py: per-capture `spans` as fractions of the height, cut at the midpoints of the gaps between the
// detected leaves). split-pecha.mjs (#2657) cuts from Gemini boxes; none are needed here (see `cut_source`).
/**
 * frames.mjs — read-only, $0. The 80 Tibetan frames the #6948 gate audited, with the stored transcription's read
 * mode and the leaf cuts this job crops at.
 *
 *   node --env-file=.env.production.local scripts/eval/split-leaf-5771/frames.mjs \
 *        --key=<6948 scratch>/audit/score-rows.jsonl --out=$JOB_SCRATCH/frames.jsonl [--ledger name=path ...]
 *
 * Cuts, in order of preference:
 *   1. the ledger of the run whose read is SERVED (a leaf-mode read: the crop is the one production read, so a re-read
 *      differs from the stored text only by the engine);
 *   2. the step-2 ledger (yigdzin-leaf-2026-10-01): it read every whole-page frame per leaf and its read was NOT
 *      served when it had fewer syllables than the whole-page read (decision class `align`, reason `fewer-syllables`);
 *   3. any other ledger row with `path: detected`;
 *   4. none: the row has `spans: null` and crop.py runs leafsplit.detect() on the image (the ledgers' own detector).
 * A `fallback-halves` ledger row (the detector found no bands and cut the capture in two) is not used as a cut.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const LEDGERS = {
  'yigdzin-leaf-2026-10-14-rest': '/mnt/HC_Volume_105839809/jobs/yigdzin-rest-4523/yig/ledger-all.jsonl',
  'yigdzin-leaf-2026-10-01': '/mnt/HC_Volume_105839809/root-moved/tib-step2/ledger-step2.jsonl',
  'yigdzin-leaf-2026-09-25': '/mnt/HC_Volume_105839809/root-moved/tibetan-reocr/leaf-run-logs/pages.jsonl',
  'yigdzin-leaf-2026-10-07-tib4523f': '/root/tib4523f/b/run-0g0/pages.jsonl',
};
const STEP2 = 'yigdzin-leaf-2026-10-01';
const STEP2_DECISIONS = '/mnt/HC_Volume_105839809/root-moved/tib-step2/decisions.jsonl';

const rows = fs.readFileSync(arg('key'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.lang === 'bo' && !r.control);
const stem = (r) => `${r.book_id}_${String(r.page_number).padStart(5, '0')}`;
const want = new Set(rows.map(stem));
const led = {};
for (const [run, f] of Object.entries(LEDGERS)) {
  if (!fs.existsSync(f)) { console.error(`ledger missing: ${f}`); continue; }
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /"id": ?"([0-9a-f]{24}_\d{5})"/.exec(l);
    if (!m || !want.has(m[1])) continue;
    (led[m[1]] ??= {})[run] = JSON.parse(l);
  }
}
const dec = {};
if (fs.existsSync(STEP2_DECISIONS)) for (const l of fs.readFileSync(STEP2_DECISIONS, 'utf8').split('\n')) {
  const m = /"stem": ?"([0-9a-f]{24}_\d{5})"/.exec(l);
  if (m && want.has(m[1])) dec[m[1]] = JSON.parse(l);
}

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: rows.map((r) => r.page_id) } },
  { projection: { _id: 0, id: 1, 'ocr.data': 1, 'ocr.engine.read_mode': 1, 'ocr.engine.run': 1, archived_photo: 1, photo: 1, photo_original: 1 } }).toArray()).map((p) => [p.id, p]));
await c.close();

const out = [];
for (const r of rows) {
  const p = pages.get(r.page_id), s = stem(r), L = led[s] || {};
  const served = p.ocr.engine?.run, mode = p.ocr.engine?.read_mode;
  const usable = (run) => L[run]?.path === 'detected' && L[run].spans?.length >= 1 ? run : null;
  const from = (mode === 'leaf' && usable(served)) || usable(STEP2) || Object.keys(L).find(usable) || null;
  const segs = p.ocr.data.split(/<leaf-break\s*\/>/).map((x) => x.split('\n').filter((y) => y.trim()).length);
  out.push({
    uid: r.uid, page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, stratum: r.stratum,
    src: p.archived_photo || p.photo, src_alt: p.photo_original || null,
    stored: { read_mode: mode, run: served, leaf_lines: segs, chars: p.ocr.data.length },
    step2_decision: dec[s] ? `${dec[s].class}:${dec[s].reason}` : null,
    spans: from ? L[from].spans : null, cut_source: from ? `ledger:${from}` : 'leafsplit.detect',
    ledger_leaf_lines: from ? (L[from].leaf || []).map((x) => x.lines) : null,
    before: { verdict: r.verdict, ocr_legible: r.ocr_legible, ocr_spans: r.ocr_spans, ocr_more: r.ocr_more, W: r.W, H: r.H },
  });
}
fs.writeFileSync(arg('out'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
const n = (f) => out.filter(f).length;
console.log(JSON.stringify({
  frames: out.length,
  stored_read_mode: { leaf: n((x) => x.stored.read_mode === 'leaf'), page: n((x) => x.stored.read_mode === 'page') },
  cut_source: Object.fromEntries([...new Set(out.map((x) => x.cut_source))].map((k) => [k, n((x) => x.cut_source === k)])),
  leaves: out.reduce((a, x) => a + (x.spans?.length || 0), 0),
  page_mode_step2_decisions: Object.fromEntries([...new Set(out.filter((x) => x.stored.read_mode === 'page').map((x) => x.step2_decision))].map((k) => [k, n((x) => x.stored.read_mode === 'page' && x.step2_decision === k)])),
  before_bad_by_mode: { leaf: `${n((x) => x.stored.read_mode === 'leaf' && x.before.verdict === 'bad')}/${n((x) => x.stored.read_mode === 'leaf')}`, page: `${n((x) => x.stored.read_mode === 'page' && x.before.verdict === 'bad')}/${n((x) => x.stored.read_mode === 'page')}` },
}, null, 1));

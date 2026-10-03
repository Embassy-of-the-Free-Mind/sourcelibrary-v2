#!/usr/bin/env node
/**
 * By-eye recheck, step 1 of 2: choose which pages to look at for each unsettled pair (#5689).
 *
 * PRIOR ART: 2-manifest.mjs picks one cover + one mid page per member (the thin first pass
 * this recheck replaces); 8-comparator.mjs / scripts/lib/text-copy-comparator.mjs give the
 * best text offsets we reuse as a fallback. Neither picks title, aligned and last pages.
 *
 * The 68 pairs come from the loader (scripts/lib/confirmed-copies.mjs), not from a list:
 * every pair confirmed with basis `by-eye`, plus every rejected pair.
 *
 * Per pair, for keeper and copy:
 *   - title page: first page typed `title-page` in the first 30 pages (then the last 30, for
 *     scans stored back to front); else the first non-blank page with short text, marked guessed;
 *   - three aligned text pages near 25/50/75% of the keeper: same printed <page-num> on both
 *     sides when the OCR carries one; else the comparator's best-matching page for the nearest
 *     sample (4-gram ≥ 0.3); else the title-page index offset when both title pages are typed;
 *     else the same relative position;
 *   - the last text page of each (last page with OCR text), and the physical tail (last
 *     non-blank page) — thin-OCR scans stop OCR long before their last page.
 * Pages with page_number <= 0 or page_type `archived-spread` (the unsplit originals kept
 * after a spread split) are not reading pages and are skipped.
 * Image: display_photo, then archived_photo, then photo — always images.sourcelibrary.org
 * originals, never /_next/image.
 *
 * Read-only. Writes the plan JSON to OUT (default .scratch/recheck/plan.json).
 *   node --env-file=.env.production.local scripts/identity-evidence/collection-copies-2026-10-03.method/9-recheck-plan.mjs [OUT]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfirmedCopies, EVIDENCE_DIR } from '../../lib/confirmed-copies.mjs';

const OUT = process.argv[2] || '.scratch/recheck/plan.json';
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const verdicts = readJsonl(path.join(EVIDENCE_DIR, 'collection-copies-2026-10-03.jsonl')).filter((r) => r.row === 'pair');
const cmp = new Map(readJsonl(path.join(EVIDENCE_DIR, 'collection-copies-2026-10-03.comparator.jsonl')).map((r) => [`${r.copy_id}|${r.keeper_id}`, r]));

const confirmed = loadConfirmedCopies();
const todo = [
  ...confirmed.pairs.filter((p) => p.basis === 'by-eye').map((p) => ({ ...p, set: 'by-eye' })),
  ...confirmed.rejected.map((p) => ({ ...p, set: 'rejected' })),
];

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

const tag = (s, t) => (s?.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1]?.trim() ?? null;
const ARABIC = /^\d{1,4}$/;
async function loadPages(bookId) {
  const ps = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $gt: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { _id: 0, page_number: 1, page_type: 1, 'ocr.data': 1, display_photo: 1, archived_photo: 1, photo: 1 } })
    .sort({ page_number: 1 }).toArray();
  return ps.map((p, i) => {
    const o = p.ocr?.data || '';
    const body = o.replace(/<[^>]+>[^<]*<\/[^>]+>/g, ' ').replace(/<[^>]+>/g, ' ').trim();
    const pn = tag(o, 'page-num');
    return {
      index: i, page_number: p.page_number,
      type: p.page_type || tag(o, 'page-type') || null,
      page_num: pn, page_num_int: pn && ARABIC.test(pn) ? +pn : null,
      header: tag(o, 'header'), chars: body.length,
      img: p.display_photo || p.archived_photo || p.photo || null,
    };
  });
}

const pick = (p, why) => (p ? { index: p.index, page_number: p.page_number, page_num: p.page_num, type: p.type, img: p.img, why } : null);
const NONTEXT = new Set(['blank', 'digitizer-insert', 'illustration', 'frontispiece', 'cover', 'plate']);
function titlePage(ps) {
  const first = ps.slice(0, 30), last = ps.slice(-30);
  const typed = first.find((p) => p.type === 'title-page');
  if (typed) return pick(typed, 'typed title-page, first 30');
  const typedLast = [...last].reverse().find((p) => p.type === 'title-page');
  if (typedLast) return pick(typedLast, 'typed title-page, last 30 (scan back to front?)');
  const guess = first.find((p) => !NONTEXT.has(p.type) && p.chars >= 20 && p.chars <= 1200);
  return pick(guess || first[0], 'guessed: no typed title-page');
}
function lastText(ps) {
  const t = [...ps].reverse().find((p) => (p.type === 'text' || !p.type) && p.chars >= 200)
    || [...ps].reverse().find((p) => p.chars >= 100);
  return pick(t || ps[ps.length - 1], 'last page with text');
}
/** The physical tail: last page before the endpapers, for scans whose OCR stops early. */
function tail(ps) {
  const skip = new Set(['blank', 'digitizer-insert', 'cover', 'back-cover', 'endpaper']);
  let untypedSkipped = 0;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (skip.has(p.type)) continue;
    if (!p.type && untypedSkipped < 2) { untypedSkipped++; continue; }
    return pick(p, 'physical tail');
  }
  return pick(ps[ps.length - 1], 'physical tail');
}
function aligned(K, C, c, tK, tC) {
  const out = [];
  const kNum = K.filter((p) => p.page_num_int != null && p.chars >= 200);
  const cBy = new Map();
  for (const p of C) if (p.page_num_int != null) cBy.set(p.page_num_int, [...(cBy.get(p.page_num_int) || []), p]);
  const used = new Set(), usedIdx = new Set();
  // Same front matter → same index offset: the title pages anchor a same-printing guess.
  const titleOffset = tK?.why.startsWith('typed') && tC?.why.startsWith('typed') && tK.why === tC.why ? tC.index - tK.index : null;
  for (const f of [0.25, 0.5, 0.75]) {
    const target = Math.round(f * (K.length - 1));
    // nearest keeper page with a printed number the copy also carries exactly once
    const cands = kNum.filter((p) => cBy.get(p.page_num_int)?.length === 1 && !used.has(p.page_num_int))
      .sort((a, b) => Math.abs(a.index - target) - Math.abs(b.index - target));
    const k = cands[0];
    if (k && Math.abs(k.index - target) <= Math.max(20, K.length * 0.1)) {
      used.add(k.page_num_int); usedIdx.add(k.index);
      out.push({ fraction: f, how: 'printed page-num', keeper: pick(k), copy: pick(cBy.get(k.page_num_int)[0]) });
      continue;
    }
    const s = (c?.samples || []).filter((x) => x.status === 'counted' && x.best >= 0.3 && !usedIdx.has(x.a_index))
      .sort((a, b) => Math.abs(a.fraction - f) - Math.abs(b.fraction - f))[0];
    if (s && K[s.a_index] && C[s.b_index]) {
      usedIdx.add(s.a_index);
      out.push({ fraction: f, how: `comparator sample f=${s.fraction} (${c.orientation}, 4-gram ${s.best})`, keeper: pick(K[s.a_index]), copy: pick(C[s.b_index]) });
      continue;
    }
    // a keeper text page near the target
    const kt = [...K].filter((p) => !NONTEXT.has(p.type) && !usedIdx.has(p.index))
      .sort((a, b) => Math.abs(a.index - target) - Math.abs(b.index - target))[0] || K[target];
    usedIdx.add(kt.index);
    if (titleOffset != null && C[kt.index + titleOffset]) {
      out.push({ fraction: f, how: `title-page offset ${titleOffset >= 0 ? '+' : ''}${titleOffset}`, keeper: pick(kt), copy: pick(C[kt.index + titleOffset]) });
      continue;
    }
    out.push({ fraction: f, how: 'relative position', keeper: pick(kt), copy: pick(C[Math.round((kt.index / Math.max(1, K.length - 1)) * (C.length - 1))]) });
  }
  return out;
}

const plan = [];
for (const p of todo) {
  const v = verdicts.find((r) => r.copy_id === p.copy_id && r.keeper_id === p.keeper_id);
  const c = cmp.get(`${p.copy_id}|${p.keeper_id}`);
  const [K, C] = await Promise.all([loadPages(p.keeper_id), loadPages(p.copy_id)]);
  const [kb, cb] = await Promise.all([p.keeper_id, p.copy_id].map((id) => db.collection('books').findOne(
    { id }, { projection: { _id: 0, id: 1, title: 1, year: 1, pages_count: 1, translation_percent: 1, pages_translated: 1, collections: 1, visible: 1, hidden: 1, contributing_library: 1, ia_identifier: 1 } })));
  const tK = titlePage(K), tC = titlePage(C);
  plan.push({
    cluster_no: v.cluster_no, set: p.set, loader_reason: p.reason || p.basis, status: v.status,
    keeper_id: p.keeper_id, copy_id: p.copy_id, spot_check: v.spot_check?.finding ?? null,
    removed_from_collections: v.applied?.removed_from_collections || [],
    comparator: c ? { verdict: c.verdict, score: c.score, orientation: c.orientation, samples_used: c.samples_used } : null,
    keeper: { ...kb, n_pages: K.length, n_with_pagenum: K.filter((x) => x.page_num_int != null).length },
    copy: { ...cb, n_pages: C.length, n_with_pagenum: C.filter((x) => x.page_num_int != null).length },
    title: { keeper: tK, copy: tC },
    aligned: aligned(K, C, c, tK, tC),
    last: { keeper: lastText(K), copy: lastText(C) },
    tail: { keeper: tail(K), copy: tail(C) },
  });
  process.stdout.write('.');
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
console.log(`\n${plan.length} pairs → ${OUT}`);
await client.close();

#!/usr/bin/env node
/**
 * PRIOR ART: ../spot-check/overview-draw.mjs (stratified by shelf, 4 pages per book, no inclusion probabilities) and
 * ../lib/sampling.mjs `sampleOnePagePerBook` ($sample, so not reproducible and with no recorded probability). This
 * draw is for the second-reader calibration (#6338): ONE page per book, a stratum of books carrying a
 * detector-flagged page, every page's selection probability recorded so results weight back to the frame, the
 * script read from the page's own text (books.language is the EDITION's language — language-fields.md), and the
 * page image downloaded and hashed so every reader opens the same bytes. Reuses overview-draw's packet record.
 *
 *   node --env-file=.env.production.local scripts/eval/second-reader/draw.mjs --out R --script latin \
 *     --languages "Latin,German,French,Italian,Dutch,Spanish,Portuguese" --n 100 --seed 20261009 \
 *     [--flagged flagged.json] [--exclude exclude.json] [--enrich 0.33] [--lambda 0.8]
 *
 * --script: a dominantScript() name (latin, greek, hebrew, arabic, han, tibetan, devanagari, syriac, …).
 * --flagged: JSON array of { book_id, page_number } from any detector run (the enriched stratum).
 * --exclude: JSON array of book ids not to draw (books whose earlier review led to fixes — see RUNBOOK.md).
 * Read-only on Mongo. Writes R/private/draw.json and R/images/. A book whose pages are all ineligible, or whose
 * chosen page's image will not download, is rejected and replaced; the acceptance rate per stratum scales the frame
 * size in the inclusion probability (π = k / (N · acceptance)) and is recorded.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { structureCounts, pageImageUrl } from '../spot-check/lib.mjs';
import { pickPage, pageScript } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('out'), SCRIPT = opt('script'), N = Number(opt('n', 100)), SEED = Number(opt('seed'));
const LANGS = String(opt('languages', '')).split(',').map((s) => s.trim()).filter(Boolean);
const ENRICH = Number(opt('enrich', 0.33)), LAMBDA = Number(opt('lambda', 0.8));
if (!OUT || !SCRIPT || !LANGS.length || !Number.isFinite(SEED)) throw new Error('--out, --script, --languages and --seed are required');
if (fs.existsSync(path.join(OUT, 'private', 'draw.json'))) throw new Error(`${OUT}/private/draw.json exists — refusing to draw over a run`);
const flaggedList = opt('flagged') ? JSON.parse(fs.readFileSync(opt('flagged'), 'utf8')) : [];
const exclude = new Set(opt('exclude') ? JSON.parse(fs.readFileSync(opt('exclude'), 'utf8')) : []);

// Eligibility, fixed by rule (the preregistration): a reachable, translated page with enough text, in the target
// script, and not front/back matter or a plate.
const EXCLUDED_TYPES = new Set(['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate']);
const MIN_OCR = 200, MIN_TR = 100;
const eligible = (p) => p.page_number > 0 && (p.ocr?.data ?? '').length >= MIN_OCR && (p.translation?.data ?? '').trim().length >= MIN_TR
  && !EXCLUDED_TYPES.has(p.page_type) && pageScript(p.ocr.data) === SCRIPT;

const rng = makeRng(SEED);
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const langRe = LANGS.map((l) => new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
const frameIds = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gte: 1 }, language: { $in: langRe } }, { projection: { _id: 0, id: 1 } }).toArray())
  .map((b) => b.id).filter((id) => id && !exclude.has(id)).sort();
const flaggedBy = new Map();
for (const f of flaggedList) if (frameIds.includes(f.book_id)) { if (!flaggedBy.has(f.book_id)) flaggedBy.set(f.book_id, []); flaggedBy.get(f.book_id).push(f.page_number); }
const strata = { flagged: frameIds.filter((id) => flaggedBy.has(id)), unflagged: frameIds.filter((id) => !flaggedBy.has(id)) };
let kF = Math.min(strata.flagged.length, Math.round(N * ENRICH)); const kU = Math.min(strata.unflagged.length, N - kF);
if (kF + kU < N) kF = Math.min(strata.flagged.length, N - kU);
console.log(`frame: ${frameIds.length} books (${strata.flagged.length} flagged) in ${LANGS.join('/')}; drawing ${kF} flagged + ${kU} unflagged, script ${SCRIPT}`);

const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const imgDir = path.join(OUT, 'images');
fs.mkdirSync(imgDir, { recursive: true });
fs.mkdirSync(path.join(OUT, 'private'), { recursive: true });

async function download(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return null;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const ext = /png/.test(r.headers.get('content-type') || '') ? 'png' : 'jpg';
    const file = `images/${sha.slice(0, 16)}.${ext}`;
    fs.writeFileSync(path.join(OUT, file), buf);
    return { file, sha256: sha, bytes: buf.length };
  } catch { return null; }
}

const picks = [], acceptance = {};
for (const [stratum, ids, k] of [['flagged', strata.flagged, kF], ['unflagged', strata.unflagged, kU]]) {
  let visited = 0, accepted = 0;
  const reasons = {};
  for (const id of shuffle(ids)) {
    if (accepted >= k) break;
    visited++;
    const all = await db.collection('pages').find({ book_id: id }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1,
      photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 } }).sort({ page_number: 1, _id: 1 }).toArray();
    const el = all.filter(eligible);
    if (!el.length) { reasons.no_eligible_page = (reasons.no_eligible_page || 0) + 1; continue; }
    const nums = [...new Set(el.map((p) => p.page_number))].sort((a, b) => a - b);
    const { page, q } = pickPage({ book_id: id, pages: nums, flagged: flaggedBy.get(id) || [] }, stratum, LAMBDA, rng);
    const p = el.find((x) => x.page_number === page);
    const url = pageImageUrl(p);
    const img = url ? await download(url) : null;
    if (!img) { reasons.image_unavailable = (reasons.image_unavailable || 0) + 1; continue; }
    const b = await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, visible: 1, 'catalog_metadata.collections': 1, 'image_source.provider': 1 } });
    const record = { slot: 0, stratum: SCRIPT, book_id: id, book_url: `https://sourcelibrary.org/book/${id}`, tradition: SCRIPT, book: b,
      structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_translated_field: b.pages_translated }, run: [page],
      pages: [{ page_number: page, page_id: String(p._id), image_url: url, image_file: img.file, image_sha256: img.sha256,
        crop: !p.split_from_spread && !p.cropped_photo && p.crop?.xStart !== undefined ? p.crop : undefined,
        ocr: p.ocr.data, ocr_engine: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null,
        translation: p.translation.data, translation_model: p.translation?.model ?? null, translation_source: p.translation?.source ?? null }] };
    picks.push({ book_id: id, page_number: page, stratum, q_page: q, m_pages: nums.length, script: SCRIPT, page_type: p.page_type ?? null, record });
    accepted++;
    console.log(`${stratum.padEnd(9)} ${id} p${page} ${String(b.language).padEnd(10)} ${String(b.display_title || b.title).slice(0, 50)}`);
  }
  acceptance[stratum] = { frame: ids.length, visited, accepted, target: k, rate: visited ? accepted / visited : null, rejected: reasons };
}
await client.close();

// π_b = k / (N_h · acceptance_h): the book's chance of being drawn among the books that could have been accepted.
for (const p of picks) {
  const a = acceptance[p.stratum];
  p.pi_book = a.accepted / (a.frame * a.rate);
  p.weight = 1 / (p.m_pages * p.pi_book * p.q_page);
}
const ordered = shuffle(picks).map((p, i) => ({ ...p, order: i + 1 }));
let sha = null; try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
fs.writeFileSync(path.join(OUT, 'private', 'draw.json'), JSON.stringify({
  meta: { issue: 6338, at: new Date().toISOString(), seed: SEED, script: SCRIPT, languages: LANGS, n: N, enrich: ENRICH, lambda: LAMBDA,
    eligibility: { min_ocr: MIN_OCR, min_tr: MIN_TR, excluded_types: [...EXCLUDED_TYPES], page_number_gt: 0 },
    frame_books: frameIds.length, excluded_books: exclude.size, flagged_source: opt('flagged') ?? null, acceptance, code_sha: sha, rng: 'mulberry32 (paired-stats makeRng)' },
  picks: ordered,
}, null, 1));
console.log(`wrote ${OUT}/private/draw.json: ${ordered.length} pages; acceptance ${JSON.stringify(Object.fromEntries(Object.entries(acceptance).map(([k, v]) => [k, `${v.accepted}/${v.visited}`])))}`);

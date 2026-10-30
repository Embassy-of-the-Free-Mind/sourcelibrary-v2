#!/usr/bin/env node
// PRIOR ART: scripts/eval/build-quality-dataset.mjs (a datasheet-backed export, but of eval rows, not the corpus;
// its WITHHELD_BOOKS list of modern editions is reused below); scripts/eval/export-refusal-census.mjs and
// scripts/eval/dataset/refusal-census-v1/DATASHEET.md (the datasheet layout this follows); scripts/audit/
// provenance-ledger.mjs (measures provenance on a page sample, writes no per-book manifest). None builds a
// per-book, rights-tiered manifest of the whole live corpus with page-level exclusions and a sample (#7823).
/**
 * Sellable dataset v0 (#7823): manifest, exclusions, Claude re-translate candidates, datasheet and a
 * 5,000-page Tier A sample, built read-only from Mongo. Re-run for each quarterly refresh.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/dataset/build-sellable-manifest.mjs \
 *     --out=$JOB_SCRATCH/sellable-v0 [--upload] [--r2-token=<hex>] [--limit-books=N] [--concurrency=4]
 *   …then, after checking the build, `--out=<same> --upload-only` puts it in R2.
 *
 * NEVER WRITES TO MONGO. Outputs go to --out and, with --upload, to R2 under
 * `datasets/sellable/v0/<token>/`. The bucket is served publicly by images.sourcelibrary.org, so the only
 * protection is the unguessable token: never print it anywhere public (#7822). Without --r2-token a new
 * one is minted and written to <out>/R2_PREFIX.txt; pass the old one to overwrite a release in place.
 *
 * Eligibility (#7823):
 *   book: visible: true && pages_count > 0; not held (pipeline_auto.hold); not named by an open `contained`
 *         issue; not a known in-copyright edition; stored year < 1930 (or, with no year, no 1930+ year in
 *         `published`); has transcribed text. Tier from what the HOLDING LIBRARY stated about its images
 *         (image_source.rights_normalized, #7771): A = no restriction stated, B = NC / ND / terms / in
 *         copyright (text only, images excluded, needs a legal read), U = the library has not stated.
 *   page: visible (page_number > 0, not a repeat capture); not withheld (translation_withheld); no Claude
 *         output in ocr or translation (Anthropic terms; listed in claude-pages.jsonl); not ETCSL text.
 * The text counted is the text the site SERVES: stripEditorialWrappers() of ocr.data / translation.data,
 * and on an English edition's English leaf the transcription, never the stored rewording (#7100).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { withMongo } from '../lib/mongo.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import { isEnglishOriginalBook, servesTranscriptionInsteadOfTranslation } from '../lib/english-original-text.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d); };
const OUT = path.resolve(arg('out', path.join(process.env.JOB_SCRATCH || '.', 'sellable-v0')));
const LIMIT = Number(arg('limit-books', 0)) || 0;
const CONC = Number(arg('concurrency', 4));
const CHUNK = Number(arg('chunk', 60));
const SAMPLE_N = Number(arg('sample', 5000));
const PER_BOOK = 20;
const SEED = Number(arg('seed', 20261030));
const UPLOAD = !!arg('upload', false);
const SITE = 'https://sourcelibrary.org';
const VERSION = 'v0';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- rules

const LIVE = { visible: true, pages_count: { $gt: 0 } };
const CLAUDE = /claude|anthropic|\bopus\b|sonnet|haiku/i;
/** Text another body owns and we republish (373 ETCSL records carry Oxford's text, #4809). */
const THIRD_PARTY_EXCLUDED = /^etcsl/i;
/** Imported text we did not read with a model: kept, flagged per book, counted in the datasheet. */
const IMPORTED_TEXT = /^(ia-ocr|esukhia|etcsl|cdli|oraec|sat|cbeta|source:)/i;
/** Modern editions withheld from the quality-v1 deposit (#7462, scripts/eval/build-quality-dataset.mjs). */
const IN_COPYRIGHT_BOOKS = new Set([
  '69d006e57d7491182a232833', '69d7e24ce08c70307b76611e', '69e7483885f786e884a4bd19', '69dfee83ce6bb8619e07f177',
  '69e7482885f786e884a4b959', '6a357e822aadc65cf0906d5f', '6953a88377f38f6761bd16b9', '6a3533dac8ce407afbe04ffe',
  '6a1956263e125aa8d6dfe80d', '699249f4a2d53df4853c1997', '6990666f2ec9f7db5717a544', '69906d8364d44bd0a0ef5a44',
]);
const MODERN_YEAR = 1930;
const TIER_A_CLASSES = new Set(['public-domain', 'cc0', 'cc-by', 'cc-by-sa']);
const TIER_B_CLASSES = new Set(['noc-nc', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd', 'cc-by-nd', 'terms-of-use', 'in-copyright']);
const STATED = new Set(['stated', 'stated-from-import']);
const NOT_A_TRANSLATION = new Set(['system', 'skip', 'same-language']);
const CLASS_RIGHTS_URIS = { 'noc-nc': 'http://rightsstatements.org/vocab/NoC-NC/1.0/', 'in-copyright': 'http://rightsstatements.org/vocab/InC/1.0/', 'public-domain': 'http://creativecommons.org/publicdomain/mark/1.0/' };
const STANDARD_RIGHTS_URI = /^https?:\/\/(creativecommons\.org|rightsstatements\.org)\//i;

/** Twin of libraryRightsUri() in src/lib/types/image-source.ts. */
function rightsUri(rn) {
  if (!rn || !STATED.has(rn.status) || !rn.class || rn.class === 'unknown') return null;
  if (rn.statement_uri && STANDARD_RIGHTS_URI.test(rn.statement_uri)) return rn.statement_uri;
  return CLASS_RIGHTS_URIS[rn.class] ?? null;
}

function tierOf(book) {
  const src = book.image_source || {};
  const rn = src.rights_normalized;
  if (src.provider === 'bph') return { tier: 'A', why: 'bph-own-scans' };
  if (rn && STATED.has(rn.status) && TIER_B_CLASSES.has(rn.class)) return { tier: 'B', why: `library-stated:${rn.class}` };
  if (rn && STATED.has(rn.status) && TIER_A_CLASSES.has(rn.class)) return { tier: 'A', why: `library-stated:${rn.class}` };
  // The library has not spoken (an importer default, a silent manifest, a failed fetch). Text is ours;
  // whether the scans may be sold is open until the rights backfill reads the holder (#7771).
  return { tier: 'U', why: `not-stated:${rn?.class ?? 'none'}/${rn?.status ?? 'none'}` };
}

const yearFrom = (s) => { const m = String(s ?? '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/); return m ? Number(m[1]) : null; };

function bookExclusion(book, contained) {
  const id = book.id;
  if (book.pipeline_auto?.hold) return `held:${book.pipeline_auto.hold.reason || 'unnamed'}`;
  if (contained.has(id) || contained.has(String(book._id))) return 'contained-issue';
  if (IN_COPYRIGHT_BOOKS.has(id)) return 'in-copyright-edition-known';
  if (book.image_source?.provider === 'etcsl') return 'third-party-text-etcsl';
  if (typeof book.year === 'number' && book.year >= MODERN_YEAR) return 'post-1929-edition-year';
  if (typeof book.year !== 'number') { const y = yearFrom(book.published); if (y && y >= MODERN_YEAR) return 'post-1929-edition-published'; }
  if (!(book.pages_ocr > 0)) return 'no-text';
  return null;
}

const languageOf = (b) => String(b.language || (Array.isArray(b.languages) && b.languages[0]) || 'Unknown').trim() || 'Unknown';
const centuryOf = (y) => (typeof y === 'number' ? (y < 0 ? `${Math.ceil(-y / 100)}c BCE` : `${Math.floor(y / 100) + 1}c`) : 'unknown');
const words = (s) => (s ? s.split(/\s+/).filter(Boolean).length : 0);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const engineOf = (block) => (block?.model ? String(block.model) : block?.source ? `source:${block.source}` : 'not-recorded');

/** Twin of getPageSource() in src/lib/page-image-url.ts: the full-resolution image the page shows. */
function pageImage(p) {
  const ok = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  let url = null;
  if (ok(p.cropped_photo)) url = p.cropped_photo;
  else if (p.split_from_spread && ok(p.photo)) url = p.photo;
  else if (typeof p.archived_photo === 'string' && /^failed/i.test(p.archived_photo)) url = null;
  else url = [p.enhanced_photo, p.archived_photo, p.photo_original, p.photo].find(ok) ?? null;
  const crop = !p.split_from_spread && !ok(p.cropped_photo) && p.crop?.xStart !== undefined && p.crop?.xEnd !== undefined
    ? { xStart: p.crop.xStart, xEnd: p.crop.xEnd } : null;
  return { url, crop };
}

// Seeded PRNG so the sample draw is reproducible.
let rs = SEED >>> 0;
const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- contained issues

function containedIds() {
  const file = arg('contained-ids');
  if (file) return new Set(fs.readFileSync(file, 'utf8').match(/[0-9a-f]{24}/g) || []);
  try {
    const out = execFileSync('gh', ['issue', 'list', '--label', 'contained', '--state', 'open', '--limit', '500', '--json', 'number,body'], { encoding: 'utf8' });
    const ids = new Set();
    for (const i of JSON.parse(out)) for (const m of (i.body || '').match(/[0-9a-f]{24}/g) || []) ids.add(m);
    return ids;
  } catch (e) {
    throw new Error(`cannot read open 'contained' issues (gh): ${e.message}. Pass --contained-ids=<file> instead.`);
  }
}

// ---------------------------------------------------------------- outputs

const W = (name) => fs.createWriteStream(path.join(OUT, name));
const outManifest = W('manifest.jsonl');
const outExcluded = W('excluded.jsonl');
const outClaude = W('claude-pages.jsonl');
const line = (s, o) => s.write(`${JSON.stringify(o)}\n`);

const agg = {
  tiers: {}, langs: {}, centuries: {}, ocrEngines: {}, trEngines: {},
  exclBooks: {}, exclBookPages: {}, exclPages: {}, claude: { pages: 0, books: new Set(), ocr: 0, translation: 0, models: {} },
  overlap: { ia: { books: 0, pages: 0 }, harvardOrGoogle: { books: 0, pages: 0 }, bhlOrLoc: { books: 0, pages: 0 } },
  importedTextPages: {}, unsplit: 0, yearUnknown: { books: 0, pages: 0 },
};
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const SUMS = ['pages_text', 'pages_english', 'pages_english_original', 'words_original', 'words_english', 'chars_original', 'chars_english'];
const addT = (o, k, r) => { const t = (o[k] ||= { books: 0, ...Object.fromEntries(SUMS.map((f) => [f, 0])) }); t.books++; for (const f of SUMS) t[f] += r[f]; };

const sampleCands = []; // { book_id, page_number, lang, r }

// ---------------------------------------------------------------- page scan

const PAGE_PROJ = {
  id: 1, book_id: 1, page_number: 1, repeat_of: 1, page_type: 1,
  'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.unreadable': 1,
  'translation.data': 1, 'translation.model': 1, 'translation.source': 1, translation_withheld: 1,
};

async function scanBooks(P, books) {
  const byId = new Map(books.map((b) => [b.id, { book: b, r: newRow(b), reservoir: [] }]));
  const cur = P.find({ book_id: { $in: [...byId.keys()] }, page_number: { $gt: 0 } }, { projection: PAGE_PROJ }).batchSize(500);
  for await (const p of cur) {
    const st = byId.get(p.book_id); if (!st) continue;
    if (p.repeat_of != null) continue; // a hidden repeat capture, not a page of the book (#5056)
    const { book, r } = st;
    r.pages_total++;
    const ocrRaw = typeof p.ocr?.data === 'string' ? p.ocr.data : '';
    const trRaw = typeof p.translation?.data === 'string' ? p.translation.data : '';
    const pageRef = { book_id: book.id, page_id: p.id ?? String(p._id), page_number: p.page_number };
    if (p.translation_withheld) { r.pages_excluded++; inc(agg.exclPages, 'translation-withheld'); line(outExcluded, { kind: 'page', ...pageRef, reason: 'translation-withheld', withheld_reason: p.translation_withheld.reason ?? null }); continue; }
    const cOcr = CLAUDE.test(p.ocr?.model || '') && ocrRaw.trim();
    const cTr = CLAUDE.test(p.translation?.model || '') && trRaw.trim();
    if (cOcr || cTr) {
      const field = cOcr && cTr ? 'both' : cOcr ? 'ocr' : 'translation';
      r.pages_excluded++; r.claude_pages++;
      agg.claude.pages++; agg.claude.books.add(book.id); if (cOcr) agg.claude.ocr++; if (cTr) agg.claude.translation++;
      inc(agg.claude.models, cTr ? p.translation.model : p.ocr.model);
      inc(agg.exclPages, 'claude-output');
      const row = { ...pageRef, field, ocr_model: p.ocr?.model ?? null, translation_model: p.translation?.model ?? null, language: languageOf(book), tier: r.tier };
      line(outClaude, row); line(outExcluded, { kind: 'page', ...pageRef, reason: 'claude-output', field });
      continue;
    }
    const ocrEngine = engineOf(p.ocr);
    if (THIRD_PARTY_EXCLUDED.test(ocrEngine)) { r.pages_excluded++; inc(agg.exclPages, 'third-party-text-etcsl'); line(outExcluded, { kind: 'page', ...pageRef, reason: 'third-party-text-etcsl' }); continue; }
    if (!ocrRaw.trim() || p.ocr?.unreadable) continue; // image only
    if (p.page_type === 'blank') { r.pages_blank++; continue; }
    const original = (stripEditorialWrappers(ocrRaw) || '').trim();
    if (!original) continue;
    r.pages_text++; r.words_original += words(original); r.chars_original += original.length;
    inc(r.ocr_engines, ocrEngine);
    if (IMPORTED_TEXT.test(ocrEngine)) r.imported_text_pages++;
    let english = '';
    if (servesTranscriptionInsteadOfTranslation(p, book)) { r.pages_english_original++; }
    else if (r.english_original && !trRaw.trim()) { r.pages_english_original++; }
    else if (trRaw.trim() && !NOT_A_TRANSLATION.has(p.translation?.source)) {
      english = (stripEditorialWrappers(trRaw) || '').trim();
      if (english) { r.pages_english++; r.words_english += words(english); r.chars_english += english.length; inc(r.translation_engines, engineOf(p.translation)); }
    }
    // Sample candidates: Tier A triples (image + original + English) from a split, non-English book.
    if (english && r.tier === 'A' && !r.english_original && !r.unsplit_spread) {
      const res = st.reservoir; const k = rand();
      if (res.length < PER_BOOK) res.push({ k, page_number: p.page_number });
      else { let mi = 0; for (let i = 1; i < res.length; i++) if (res[i].k > res[mi].k) mi = i; if (k < res[mi].k) res[mi] = { k, page_number: p.page_number }; }
    }
  }
  for (const { book, r, reservoir } of byId.values()) finishBook(book, r, reservoir);
}

function newRow(b) {
  const src = b.image_source || {};
  const rn = src.rights_normalized || null;
  const { tier, why } = tierOf(b);
  return {
    book_id: b.id, title: String(b.display_title || b.title || '').replace(/\s+/g, ' ').trim() || null, author: b.author || null,
    year: typeof b.year === 'number' ? b.year : null, published: b.published ?? null,
    language: languageOf(b), languages: Array.isArray(b.languages) ? b.languages : null,
    original_language: b.original_language ?? null,
    tier, tier_basis: why,
    images_licensable: tier === 'A',
    rights_class: rn?.class ?? null, rights_status: rn?.status ?? null, rights_statement_uri: rightsUri(rn),
    rights_statement_raw: rn?.statement_uri ?? null, rights_terms_text: rn?.terms_text ?? null, attribution_required: rn?.attribution_required ?? null,
    stored_license: src.license ?? null,
    image_provider: src.provider ?? null, image_provider_name: src.provider_name ?? null, image_source_url: src.source_url ?? null,
    iiif_manifest: src.iiif_manifest ?? null, ia_identifier: b.ia_identifier ?? (/(internet_archive|^ia$)/.test(src.provider || '') ? src.identifier ?? null : null),
    url: `${SITE}/book/${b.id}`,
    english_original: isEnglishOriginalBook(b),
    translation_rung: b.translation_state?.rung ?? null,
    quality_score: typeof b.quality_score === 'number' ? b.quality_score : null,
    unsplit_spread: b.needs_splitting === true && b.split_completed !== true,
    pages_total: 0, pages_text: 0, pages_english: 0, pages_english_original: 0, pages_blank: 0, pages_excluded: 0, claude_pages: 0, imported_text_pages: 0,
    words_original: 0, words_english: 0, chars_original: 0, chars_english: 0,
    ocr_engines: {}, translation_engines: {},
  };
}

function finishBook(book, r, reservoir) {
  if (r.pages_text === 0) {
    inc(agg.exclBooks, 'no-text-after-page-filters'); inc(agg.exclBookPages, 'no-text-after-page-filters', r.pages_total);
    line(outExcluded, { kind: 'book', book_id: r.book_id, title: r.title, reason: 'no-text-after-page-filters', pages: r.pages_total });
    return;
  }
  line(outManifest, r);
  addT(agg.tiers, r.tier, r);
  addT(agg.langs, r.language, r);
  addT(agg.centuries, centuryOf(r.year), r);
  for (const [k, v] of Object.entries(r.ocr_engines)) inc(agg.ocrEngines, k, v);
  for (const [k, v] of Object.entries(r.translation_engines)) inc(agg.trEngines, k, v);
  if (r.imported_text_pages) for (const [k, v] of Object.entries(r.ocr_engines)) if (IMPORTED_TEXT.test(k)) inc(agg.importedTextPages, k, v);
  if (r.unsplit_spread) agg.unsplit++;
  if (r.year == null) { agg.yearUnknown.books++; agg.yearUnknown.pages += r.pages_text; }
  const prov = r.image_provider || '';
  if (r.ia_identifier || /^(internet_archive|ia)$/.test(prov)) { agg.overlap.ia.books++; agg.overlap.ia.pages += r.pages_text; }
  if (/^(google_books|harvard)$/.test(prov)) { agg.overlap.harvardOrGoogle.books++; agg.overlap.harvardOrGoogle.pages += r.pages_text; }
  if (/^(biodiversity_heritage_library|loc)$/.test(prov)) { agg.overlap.bhlOrLoc.books++; agg.overlap.bhlOrLoc.pages += r.pages_text; }
  for (const c of reservoir) sampleCands.push({ book_id: r.book_id, page_number: c.page_number, lang: r.language, k: c.k });
}

// ---------------------------------------------------------------- sample

function allocate(cands, n) {
  const byLang = new Map();
  for (const c of cands) (byLang.get(c.lang) || byLang.set(c.lang, []).get(c.lang)).push(c);
  // Water-fill: every language gets an equal share, capped by what it has; the remainder goes round again.
  const quota = new Map([...byLang.keys()].map((l) => [l, 0]));
  let left = Math.min(n, cands.length);
  while (left > 0) {
    const open = [...byLang.keys()].filter((l) => quota.get(l) < byLang.get(l).length);
    if (!open.length) break;
    const share = Math.max(1, Math.floor(left / open.length));
    for (const l of open) { const add = Math.min(share, byLang.get(l).length - quota.get(l), left); quota.set(l, quota.get(l) + add); left -= add; if (!left) break; }
  }
  const out = [];
  for (const [l, list] of byLang) { list.sort((a, b) => a.k - b.k); out.push(...list.slice(0, quota.get(l))); }
  return out;
}

async function buildSample(P, manifestById) {
  const picked = allocate(sampleCands, SAMPLE_N);
  const byBook = new Map();
  for (const c of picked) (byBook.get(c.book_id) || byBook.set(c.book_id, []).get(c.book_id)).push(c.page_number);
  const rows = [];
  const proj = { ...PAGE_PROJ, 'translation.content_hash': 1, 'ocr.prompt_version': 1, 'translation.prompt_version': 1, scan_quality: 1,
    photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1, crop: 1 };
  for (const [bookId, nums] of byBook) {
    const b = manifestById.get(bookId);
    const book = { language: b.language, translation_state: { english_original: b.english_original } };
    for (const p of await P.find({ book_id: bookId, page_number: { $in: nums } }, { projection: proj }).toArray()) {
      if (p.repeat_of != null) continue;
      const original = (stripEditorialWrappers(p.ocr?.data || '') || '').trim();
      const english = servesTranscriptionInsteadOfTranslation(p, book) ? '' : (stripEditorialWrappers(p.translation?.data || '') || '').trim();
      if (!original || !english) continue;
      const img = pageImage(p);
      const flags = [];
      if (p.page_type && p.page_type !== 'text') flags.push(`page_type:${p.page_type}`);
      if (p.scan_quality?.label || typeof p.scan_quality === 'string') flags.push(`scan_quality:${p.scan_quality?.label ?? p.scan_quality}`);
      if (img.crop) flags.push('image_needs_crop');
      if (!img.url) flags.push('no_image_url');
      if (/<marginalia|\[marginal/i.test(p.ocr?.data || '')) flags.push('marginalia');
      if (b.quality_score != null && b.quality_score < 0.5) flags.push('book_quality_score_below_0.5');
      if (b.translation_rung && !['readable', 'complete'].includes(b.translation_rung)) flags.push(`book_rung:${b.translation_rung}`);
      rows.push({
        sample_id: sha(`${bookId}:${p.page_number}`).slice(0, 12),
        book_id: bookId, page_id: p.id ?? String(p._id), page_number: p.page_number,
        url: `${SITE}/book/${bookId}?page=${p.page_number}`,
        image_url: img.url, image_crop: img.crop,
        title: b.title, author: b.author, year: b.year, language: b.language,
        tier: b.tier, rights_class: b.rights_class, rights_status: b.rights_status, rights_statement_uri: b.rights_statement_uri,
        image_provider: b.image_provider_name || b.image_provider, image_source_url: b.image_source_url,
        ocr_engine: engineOf(p.ocr), ocr_prompt_version: p.ocr?.prompt_version ?? null,
        translation_engine: engineOf(p.translation), translation_prompt_version: p.translation?.prompt_version ?? null,
        original, english,
        content_hash: sha(`${original}\n\u0000\n${english}`), original_sha256: sha(original), english_sha256: sha(english),
        stored_translation_hash: p.translation?.content_hash ?? null,
        quality_flags: flags,
      });
    }
  }
  rows.sort((a, b) => a.sample_id.localeCompare(b.sample_id));
  return rows;
}

// ---------------------------------------------------------------- datasheet

const fmt = (n) => Number(n).toLocaleString('en-US');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i ? '---:' : '---')).join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

function datasheet(meta, sample) {
  const T = agg.tiers;
  const tierRow = (k, label) => { const t = T[k] || { books: 0, pages_text: 0, pages_english: 0, words_original: 0, words_english: 0 }; return [label, fmt(t.books), fmt(t.pages_text), fmt(t.pages_english), fmt(t.words_original), fmt(t.words_english)]; };
  const sum = (f) => Object.values(T).reduce((s, t) => s + t[f], 0);
  const langRows = Object.entries(agg.langs).sort((a, b) => b[1].pages_text - a[1].pages_text);
  const cent = Object.entries(agg.centuries).sort((a, b) => (a[0] === 'unknown') - (b[0] === 'unknown') || (parseInt(a[0], 10) * (a[0].includes('BCE') ? -1 : 1)) - (parseInt(b[0], 10) * (b[0].includes('BCE') ? -1 : 1)));
  const eng = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const exB = Object.entries(agg.exclBooks).sort((a, b) => b[1] - a[1]);
  const heldBooks = exB.filter(([k]) => k.startsWith('held:'));
  const heldTotal = heldBooks.reduce((s, [, n]) => s + n, 0);
  const sampleLangs = {}; for (const r of sample) inc(sampleLangs, r.language);
  return `# Source Library sellable dataset ${VERSION} (snapshot ${meta.date})

## What this is

[Source Library](https://sourcelibrary.org) holds scans of historical books and manuscripts from about 70 holding
libraries, with an AI transcription of each page in its own language and an AI English translation. This dataset is
the part of the public corpus that can be offered for licence: one row per book, with the rights basis of its page
images, the engines that wrote its text, and how much text it holds. It is built read-only from the production
database by \`scripts/dataset/build-sellable-manifest.mjs\` at commit \`${meta.commit}\`.

## Files

| file | rows | what |
|---|---:|---|
| \`manifest.jsonl.gz\` | ${fmt(meta.counts.manifest)} | one row per eligible book |
| \`excluded.jsonl.gz\` | ${fmt(meta.counts.excluded)} | every excluded book, and every excluded page of an eligible book, with the reason |
| \`claude-pages.jsonl.gz\` | ${fmt(meta.counts.claude)} | pages excluded because Claude wrote their transcription or translation: the re-translate candidate set |
| \`sample-5000.jsonl.gz\` | ${fmt(sample.length)} | Tier A sample pages: image URL, original, English, rights, engines, hashes, quality flags |
| \`DATASHEET.md\` | | this file |
| \`release.json\` | | snapshot date, commit, counts, sha256 of every file |

Manifest fields: \`book_id\`, \`url\`, \`title\`, \`author\`, \`year\` (stored catalogue year, \`null\` when unknown), \`published\`
(the catalogue's free-text imprint date), \`language\` (the edition's language), \`languages\`, \`original_language\`,
\`tier\`, \`tier_basis\`, \`images_licensable\`, \`rights_class\` / \`rights_status\` / \`rights_statement_uri\` (what the holding
library stated about its images, read from its manifest or record; \`rights_statement_raw\`, \`rights_terms_text\`,
\`attribution_required\` keep its own words), \`stored_license\` (our importer's value, often a default), \`image_provider\`,
\`image_source_url\`, \`iiif_manifest\`, \`ia_identifier\`, \`english_original\`, \`translation_rung\`, \`quality_score\`,
\`unsplit_spread\`, page counts (\`pages_total\` visible pages, \`pages_text\` with a transcription, \`pages_english\` with an
English translation, \`pages_english_original\` English leaves whose text is the transcription itself, \`pages_blank\`,
\`pages_excluded\`, \`claude_pages\`, \`imported_text_pages\`), \`words_original\`, \`words_english\`, \`chars_original\`,
\`chars_english\`, and \`ocr_engines\` / \`translation_engines\` (pages per engine).

## Tiers

The tier is set by what the **holding library** stated about its page images (\`image_source.rights_normalized\`, #7771),
not by our importer's stored licence, which for about a third of books is a default.

- **A: text and images.** The library stated public domain (or CC0, CC BY, CC BY-SA; attribution is carried in
  \`attribution_required\`), or the scans are the Bibliotheca Philosophica Hermetica's own.
- **B: text only; images excluded.** The library stated No Copyright – Non-Commercial, a CC NC or ND licence, its own
  terms of use, or In Copyright. **Whether the transcription of such a scan is clean for commercial use needs a legal
  read; Tier B is counted separately for that reason.**
- **U: text; image rights not yet stated.** The library has not spoken: the importer assumed public domain, the
  manifest is silent, or the read failed. Treat the images as B until the rights backfill reaches them.

${table(['tier', 'books', 'pages with text', 'pages with English', 'words, original', 'words, English'], [tierRow('A', 'A'), tierRow('B', 'B'), tierRow('U', 'U'), ['**all**', fmt(sum('books')), fmt(sum('pages_text')), fmt(sum('pages_english')), fmt(sum('words_original')), fmt(sum('words_english'))]])}

Words are whitespace-separated tokens of the served text. For scripts written without spaces (Chinese, Japanese,
Tibetan, Thai) that count is meaningless, so the manifest also carries characters: ${fmt(sum('chars_original'))}
original and ${fmt(sum('chars_english'))} English across all tiers. English editions are not translated: their
English leaves (${fmt(sum('pages_english_original'))} pages) count under \`pages_english_original\`, and their words as original.

## By language (top 40 by pages with text)

${table(['language', 'books', 'pages with text', 'pages with English', 'words, original', 'words, English'], langRows.slice(0, 40).map(([l, t]) => [l, fmt(t.books), fmt(t.pages_text), fmt(t.pages_english), fmt(t.words_original), fmt(t.words_english)]))}

${langRows.length} languages in all (catalogue labels, the edition's language).

## By century (catalogue year)

${table(['century', 'books', 'pages with text', 'pages with English'], cent.map(([c, t]) => [c, fmt(t.books), fmt(t.pages_text), fmt(t.pages_english)]))}

The catalogue year is often the composition era, a series year or a reprint year rather than the imprint, and
${fmt(agg.yearUnknown.books)} eligible books (${fmt(agg.yearUnknown.pages)} pages with text) carry none.

## Engine mix (pages)

Transcription:

${table(['engine', 'pages'], eng(agg.ocrEngines).slice(0, 25).map(([k, v]) => [`\`${k}\``, fmt(v)]))}

Translation:

${table(['engine', 'pages'], eng(agg.trEngines).slice(0, 25).map(([k, v]) => [`\`${k}\``, fmt(v)]))}

\`source:*\` and \`ia-ocr/*\` rows are text we imported rather than read with a model (the Internet Archive's own OCR, the
Esukhia Derge Tengyur and Kangyur, and similar); \`not-recorded\` is a page whose engine was not stamped. Pages whose
transcription is imported: ${eng(agg.importedTextPages).map(([k, v]) => `\`${k}\` ${fmt(v)}`).join(', ') || 'none'}.
Gemini output is included: the Gemini API terms (effective 2026-03-23) bar Source Library from developing competing
models and claim no ownership of output; they do not bar licensing it.

## What is excluded, and why

Books (live = \`visible: true && pages_count > 0\`, ${fmt(meta.counts.live)} books):

${table(['reason', 'books', 'visible pages'], exB.filter(([k]) => !k.startsWith('held:')).map(([k, n]) => [k, fmt(n), fmt(agg.exclBookPages[k] || 0)]).concat([[`held (all reasons, below)`, fmt(heldTotal), fmt(heldBooks.reduce((s, [k]) => s + (agg.exclBookPages[k] || 0), 0))]]))}

- **held**: the book carries a pipeline hold (\`pipeline_auto.hold\`). Most holds are lane routing, not a quality
  finding (scans published before text, OCR-only lanes, a GPU backlog); some are containment of invented or
  wrong-leaf text. All are excluded in v0. The ten largest: ${heldBooks.slice(0, 10).map(([k, n]) => `${k.slice(5)} ${fmt(n)}`).join(', ')}.
- **contained-issue**: the book id appears in an open GitHub issue labelled \`contained\`.
- **in-copyright-edition-known**: the twelve modern or not-EU-public-domain editions withheld from the quality-v1
  deposit (#7462).
- **post-1929-edition-year / -published**: stored year 1930 or later, or no year and a 1930+ year in the imprint field.
  A conservative screen: the catalogue year is unreliable, and a 1930+ reprint of an old work is still a modern edition.
- **third-party-text-etcsl**: ETCSL records republish Oxford's transliteration and translation (#4809).
- **no-text**: no transcribed page.

Pages of eligible books:

${table(['reason', 'pages'], Object.entries(agg.exclPages).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, fmt(n)]))}

- **translation-withheld**: the English was withdrawn from readers (\`translation_withheld\`, containment); the page's
  transcription is excluded with it.
- **claude-output**: Claude wrote the transcription (${fmt(agg.claude.ocr)}) or the translation (${fmt(agg.claude.translation)}) of
  ${fmt(agg.claude.pages)} pages in ${fmt(agg.claude.books.size)} books. Anthropic's terms forbid using outputs to train competing
  models or helping a third party do so. Listed in \`claude-pages.jsonl\` as re-translate candidates; models:
  ${eng(agg.claude.models).map(([k, v]) => `\`${k}\` ${fmt(v)}`).join(', ') || 'none'}.

${fmt(agg.unsplit)} eligible books are unsplit two-page spreads (\`unsplit_spread\`): one image carries two leaves, so they are
kept for text but kept out of the sample.

## Measured quality (cited, not re-measured)

- **Transcription, Latin print, against published reference text** (quality-v1 deposit, \`ocr-accuracy-cells.json\`,
  source table at commit a65044017, deposit dated 2026-10-26): median character error rate **0.7%** for Gemini 3 Flash
  (n = 68 aligned pages, 95% CI 0.4–1.2%; 1 of 68 catastrophic) and **1.7%** for Gemini 3.1 Flash-Lite, the production
  engine (n = 62, 95% CI 0.7–3.7%; 3 of 62 catastrophic). Accuracy, but Latin print only; most languages have fewer than
  30 referenced books and no decision-grade cell.
- **Translation, 15 languages** (translation audit #5274, 311 pages drawn 2026-09-30, one per book): **89.1%** of pages
  rated 4 or 5 for fidelity, weighted by translated pages per language. This is a model judge's rating against the
  transcription, blind to the scan: a screen, not accuracy. A follow-up leaf check (#5311) found 6 of the 311 pages
  translating the wrong leaf.
- No other quality number is claimed here. A buyer-grade accuracy measurement per language is not yet made.

## Overlap with other corpora

- **Internet Archive (id match, exact):** ${fmt(agg.overlap.ia.books)} eligible books (${fmt(agg.overlap.ia.pages)} pages with text) carry an
  Archive identifier or came from the Archive, so the same scans are public there, usually with the Archive's own OCR.
  The English translations and the model transcriptions are not.
- **Institutional Books 1.0 (Harvard, Google-digitised): estimate, no id match.** ${fmt(agg.overlap.harvardOrGoogle.books)} eligible books
  (${fmt(agg.overlap.harvardOrGoogle.pages)} pages) came from Google Books or Harvard; that is the upper bound of what could overlap. Not
  checked against the release's item list.
- **Common Pile v0.1: estimate, no id match.** ${fmt(agg.overlap.bhlOrLoc.books)} eligible books (${fmt(agg.overlap.bhlOrLoc.pages)} pages) came from
  the Biodiversity Heritage Library or the Library of Congress, both Common Pile sources; its public-domain book
  subsets also draw on Archive scans, so part of the Archive overlap above may apply. Not checked item by item.
- What exists nowhere else: the English translations (${fmt(sum('pages_english'))} pages) and, for manuscripts and non-Latin scripts,
  the transcriptions themselves.

## The sample

\`sample-5000.jsonl\`: ${fmt(sample.length)} Tier A pages from ${fmt(new Set(sample.map((r) => r.book_id)).size)} books, at most ${PER_BOOK} per book, drawn with seed
${SEED} and balanced across languages (each language an equal share, capped by what it has):
${Object.entries(sampleLangs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}.
Only non-English editions with both a transcription and an English translation are drawn. \`original\` and \`english\`
are the served text (editorial wrappers stripped, as \`/api/books/<id>/quote\` serves it, without its watermark).
\`content_hash\` is the sha256 of \`original + "\\n\\0\\n" + english\`. \`quality_flags\`: \`page_type:*\` (not a plain
text page), \`scan_quality:*\`, \`image_needs_crop\` (apply \`image_crop\`, x fractions of the full image),
\`marginalia\`, \`book_quality_score_below_0.5\`, \`book_rung:*\` (the book is not yet readable in English).

## Known limits

- **Rights are the holding library's statement, not a legal opinion.** Tier U books have none yet. The legal read on
  Tier B text is out of scope.
- **Inline markup is kept.** The served text keeps the transcription's inline tags (\`<insert>\`, \`<note>\`, \`<page-num>\`,
  \`<marginalia>\` and similar) exactly as the site serves them; editorial wrapper blocks (\`<meta>\`, summaries) are removed.
- **Catalogue metadata is uneven:** language is the edition's, year is often not the imprint.
- **Engine stamps are incomplete on old pages** (\`not-recorded\`); about 3.5% of transcribed pages are imported text
  (provenance ledger, #4809, 2026-10-30).
- **The snapshot is live data.** Counts move daily as the pipeline reads and translates.

## Provenance

Built ${meta.date} by \`node scripts/dataset/build-sellable-manifest.mjs\` (read-only Mongo queries on the \`bookstore\`
database) at commit \`${meta.commit}\` of
[sourcelibrary-v2](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2). Issue #7823.
`;
}

// ---------------------------------------------------------------- upload

async function upload(files) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const token = arg('r2-token') || crypto.randomBytes(16).toString('hex');
  const prefix = `datasets/sellable/${VERSION}/${token}/`;
  for (const f of files) {
    const body = fs.readFileSync(path.join(OUT, f));
    const type = f.endsWith('.gz') ? 'application/gzip' : f.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/json';
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: prefix + f, Body: body, ContentType: type,
      Metadata: { sha256: sha(body), issue: '7823' } }));
    console.log(`uploaded ${f} (${fmt(body.length)} bytes)`);
  }
  fs.writeFileSync(path.join(OUT, 'R2_PREFIX.txt'), `${prefix}\n`);
  console.log(`R2 prefix written to ${path.join(OUT, 'R2_PREFIX.txt')} (keep it out of public places)`);
}

// ---------------------------------------------------------------- main

if (arg('upload-only', false)) { // upload a finished build in --out, after checking it
  await upload(['manifest.jsonl.gz', 'excluded.jsonl.gz', 'claude-pages.jsonl.gz', 'sample-5000.jsonl.gz', 'DATASHEET.md', 'release.json']);
  process.exit(0);
}
const t0 = Date.now();
const contained = containedIds();
console.log(`contained-issue ids: ${contained.size}`);
let commit = 'unknown'; try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const meta = { version: VERSION, date: new Date().toISOString().slice(0, 10), built_at: new Date().toISOString(), commit, issue: 7823, seed: SEED, counts: {} };

await withMongo(async (db) => {
  const B = db.collection('books'), P = db.collection('pages');
  const BOOK_PROJ = { _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, languages: 1, original_language: 1,
    image_source: 1, ia_identifier: 1, pages_count: 1, pages_ocr: 1, pipeline_auto: 1, translation_state: 1, quality_score: 1, needs_splitting: 1, split_completed: 1 };
  const eligible = []; let live = 0;
  for await (const b of B.find(LIVE, { projection: BOOK_PROJ }).batchSize(2000)) {
    b.id = b.id ?? String(b._id); // look a book up by id OR _id (book-deletion-and-identity.md)
    live++;
    const why = bookExclusion(b, contained);
    if (why) { inc(agg.exclBooks, why); inc(agg.exclBookPages, why, b.pages_count || 0); line(outExcluded, { kind: 'book', book_id: b.id, title: b.display_title || b.title || null, reason: why, pages: b.pages_count || 0 }); continue; }
    eligible.push(b);
    if (LIMIT && eligible.length >= LIMIT) break;
  }
  meta.counts.live = live;
  console.log(`live ${live}, eligible before page scan ${eligible.length}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  // Big books first so the concurrent lanes finish together.
  eligible.sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0));
  const chunks = []; for (let i = 0; i < eligible.length; i += CHUNK) chunks.push(eligible.slice(i, i + CHUNK));
  let done = 0;
  const lane = async () => { for (let c; (c = chunks.shift());) { await scanBooks(P, c); done += c.length; if (done % 600 < CHUNK) console.log(`  scanned ${done}/${eligible.length} books, ${((Date.now() - t0) / 60000).toFixed(1)} min`); } };
  await Promise.all(Array.from({ length: CONC }, lane));
  await Promise.all([outManifest, outExcluded, outClaude].map((s) => new Promise((r) => s.end(r))));

  const manifestById = new Map(fs.readFileSync(path.join(OUT, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.book_id, r]; }));
  console.log(`sample candidates ${sampleCands.length}`);
  const sample = await buildSample(P, manifestById);
  const langs = new Set(sample.map((r) => r.language));
  if (!LIMIT && (sample.length < SAMPLE_N * 0.98 || langs.size < 5)) throw new Error(`sample too small: ${sample.length} rows, ${langs.size} languages`);
  fs.writeFileSync(path.join(OUT, 'sample-5000.jsonl'), sample.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const count = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).length;
  meta.counts.manifest = manifestById.size; meta.counts.excluded = count('excluded.jsonl'); meta.counts.claude = count('claude-pages.jsonl'); meta.counts.sample = sample.length;
  meta.tiers = agg.tiers; meta.excluded_books = agg.exclBooks; meta.excluded_pages = agg.exclPages;
  meta.claude = { pages: agg.claude.pages, books: agg.claude.books.size, ocr: agg.claude.ocr, translation: agg.claude.translation, models: agg.claude.models };
  meta.languages_top = Object.entries(agg.langs).sort((a, b) => b[1].pages_text - a[1].pages_text).slice(0, 25).map(([l, t]) => ({ language: l, ...t }));
  meta.overlap = agg.overlap;
  fs.writeFileSync(path.join(OUT, 'DATASHEET.md'), datasheet(meta, sample));
}, { timeoutMs: 4 * 3600_000, socketTimeoutMs: 600_000, maxPoolSize: CONC + 2 });

const files = [];
for (const f of ['manifest.jsonl', 'excluded.jsonl', 'claude-pages.jsonl', 'sample-5000.jsonl']) {
  fs.writeFileSync(path.join(OUT, `${f}.gz`), zlib.gzipSync(fs.readFileSync(path.join(OUT, f)), { level: 9 }));
  files.push(`${f}.gz`);
}
files.push('DATASHEET.md');
meta.files = Object.fromEntries(files.map((f) => [f, { bytes: fs.statSync(path.join(OUT, f)).size, sha256: sha(fs.readFileSync(path.join(OUT, f))) }]));
fs.writeFileSync(path.join(OUT, 'release.json'), JSON.stringify(meta, null, 1));
files.push('release.json');
console.log(JSON.stringify({ counts: meta.counts, tiers: meta.tiers, minutes: ((Date.now() - t0) / 60000).toFixed(1) }, null, 1));
if (UPLOAD) await upload(files);

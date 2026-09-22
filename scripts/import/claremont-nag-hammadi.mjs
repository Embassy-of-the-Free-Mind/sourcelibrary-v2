#!/usr/bin/env node
/**
 * claremont-nag-hammadi.mjs — finish the nine Nag Hammadi codex books imported
 * from Claremont's Nag Hammadi Archive (CONTENTdm collection `nha`) in March
 * 2026, and add the four codices that import never reached (I, V, X, XIII).
 *
 * PRIOR ART: none — the 2026-03-16 import left no script in the repo (the nine
 * books carry `source: 'claremont'` and nothing under scripts/ or src/ mentions
 * Claremont). Closest shapes, both read before writing this: scripts/import/
 * harvard-wuzhen-direct.mjs (direct insert through insertBookIfNew) and
 * scripts/catalog-coverage/archive-acquired.ts (per-page IIIF → R2 with the
 * stored/native dimension record). Neither enumerates a CONTENTdm collection or
 * chooses between overlapping photographic series, which is the work here.
 *
 * WHAT THE SOURCE LOOKS LIKE. Every plate is its own CONTENTdm item (no compound
 * objects), titled "Codex V, papyrus page 12". Each codex was photographed more
 * than once — the Institute for Antiquity and Christianity's 5×7" "A-Series"
 * negatives, its 3.875×5.25" negatives, and (Codex I only) the Honnold/Mudd
 * "Jung Codex" negatives — so one papyrus page can have two or three records.
 * The page sequence is taken from the series with the longest numeric run and
 * gap-filled from the others; the pointers not chosen are recorded on the page
 * doc (`catalog_metadata.alternates`) rather than dropped. That is exactly how
 * the March import built the nine (measured 2026-09-11: their page order is the
 * papyrus run, ascending, mixed from the same series).
 *
 * WHAT IT WRITES (all idempotent — re-running --apply changes nothing twice):
 *   1. Four new hidden books (I, V, X, XIII) in the same shape as the nine.
 *   2. On all thirteen: contributing_library, image_source, field_provenance
 *      stamps (title / language / contributing_library, only where absent),
 *      book-level catalog_metadata, and hidden:true / visible:false /
 *      hidden_reason 'awaiting_permission_claremont_nha_2026-09'. One
 *      sweep_log row per book per change.
 *   3. On every page of the thirteen: catalog_metadata.record = the raw
 *      dmGetItemInfo record, plus the alternate-series pointers.
 *   4. Every page archived to R2 — master at pages/<book>/NNNN-full.jpg
 *      (archived_photo), 1200px display at NNNN.jpg (display_photo), 150px
 *      thumb at NNNN-thumb.jpg (thumbnail_blob) — the canonical pagePaths()
 *      layout from src/lib/storage.ts. Native dims from info.json are recorded
 *      beside the stored dims (invariants/archive-coverage.md: an archiver that
 *      cannot say what it stored and what was on offer has not finished).
 *   5. The two Brill facsimile scans (z-lib, hidden) get the Claremont book's
 *      work_id and a "superseded by" note appended to hidden_reason. Never deleted.
 *
 * WHAT IT NEVER DOES: OCR, translation, unhide, delete, or reorder the nine's
 * existing pages. The 262 pages already OCR'd are a free probe corpus for a
 * separate evaluation.
 *
 * Run with tsx (it imports src/lib/storage.ts), from Hetzner for the archive
 * pass (invariants/import-cost-and-egress.md — ~1,400 masters at ~6 MB each):
 *   npx tsx scripts/import/claremont-nag-hammadi.mjs --plan              # no writes
 *   npx tsx scripts/import/claremont-nag-hammadi.mjs --apply [--codex I,V] [--skip-archive]
 *   npx tsx scripts/import/claremont-nag-hammadi.mjs --verify            # PR table (HEADs R2)
 * Claremont is asked at ≤2 req/s (DOMAIN_LIMITS in scripts/lib/iiif-utils.mjs)
 * with the contact User-Agent.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { claimSlot, getDomainLimit, noteRateLimited, fetchIiifInfo, fetchIiifNativeRes, dimensionFields } from '../lib/iiif-utils.mjs';
import { fetchWithStallTimeout } from '../lib/fetch-stall-timeout.mjs';
// A static extensionless import of a .ts module from .mjs fails to link under tsx
// ("does not provide an export named pagePaths"); the repo's .mjs convention is a
// dynamic import with the explicit extension (cf. scripts/auto-crop-black-borders.mjs).
const { storagePut, pagePaths } = await import('../../src/lib/storage.ts');

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const VERIFY = argv.includes('--verify');
const PLAN = !APPLY && !VERIFY;
const SKIP_ARCHIVE = argv.includes('--skip-archive');
const ARCHIVE_ONLY = argv.includes('--archive-only');
const strArg = (name) => { const i = argv.indexOf(`--${name}`); return i > -1 ? argv[i + 1] : null; };
const CODEX_FILTER = strArg('codex') ? new Set(strArg('codex').split(',').map((s) => s.trim().toUpperCase())) : null;
const PAGE_LIMIT = Number(strArg('limit-pages')) || 0; // testing aid: archive at most N pages per book

// ── Constants ────────────────────────────────────────────────────────────────
const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org; derek@sourcelibrary.org)';
const CDM = 'https://ccdl.claremont.edu/digital/bl/dmwebservices/index.php?q=';
const COLLECTION_URL = 'https://ccdl.claremont.edu/digital/collection/nha';
const IIIF_HOST = 'ccdl.claremont.edu';
// CONTENTdm exposes two IIIF Image paths. `/iiif/2/nha:<ptr>/` — the form the
// March 2026 import stored on 853 pages — answers 403 for every image (probed
// from Hetzner and the laptop, 2026-09-17). `/digital/iiif/nha/<ptr>/` serves
// the 4.4 MB master. Build every URL in the working form.
const iiifPhoto = (pointer) => `https://${IIIF_HOST}/digital/iiif/nha/${pointer}/full/full/0/default.jpg`;
const iiifThumb = (pointer) => `https://${IIIF_HOST}/digital/iiif/nha/${pointer}/full/200,/0/default.jpg`;
const DEAD_IIIF_FORM = /^https:\/\/ccdl\.claremont\.edu\/iiif\/2\/nha:(\d+)\//;
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').trim();
const isR2 = (u) => typeof u === 'string' && u.startsWith(`${R2_PUBLIC}/`);

const SWEEP = 'claremont-nag-hammadi-2026-09';
const IMPORTER = 'script:claremont-nag-hammadi';
const HIDDEN_REASON = 'awaiting_permission_claremont_nha_2026-09';
const CONTRIBUTING_LIBRARY = 'Claremont Colleges Library, Special Collections — Nag Hammadi Archive';
const PROVIDER = 'claremont';
const PROVIDER_NAME = 'Claremont Colleges Library';
const LICENSE = 'Physical rights are retained by the institution. Copyright is retained in accordance with U.S. Copyright laws.';
const AUTHOR = 'Anonymous (Gnostic)';
const CATEGORIES = ['Gnostic', 'Nag Hammadi', 'Coptic'];
const COLLECTIONS = ['letters-from-the-desert', 'apocrypha'];
const DESCRIPTION_TAIL = 'Manuscript photographed from the Coptic Museum, Cairo. Images from the Claremont Colleges Digital Library Nag Hammadi Archive.';

const CODICES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

/** The nine books the March 2026 import created — looked up by `id`, never re-created. */
const EXISTING = {
  II: 'd882e2d7-5639-4cca-a7a0-2cf5daf1cace',
  III: '5062f0f4-1d7d-49a7-83b3-62d87149e510',
  IV: '954c835a-6839-47ff-bad8-1d04f44260bb',
  VI: 'e4670147-75c9-4dec-849d-d3bf57ad5383',
  VII: '319856cf-464f-4ae3-b880-61a6f6b06b7c',
  VIII: '258cf1ed-9670-4f55-9082-b3b8d2ee15c7',
  IX: '399ee141-a1f6-4231-9707-35d8f58a8cf4',
  XI: '1c13e860-1807-4830-b8a4-93a865b81504',
  XII: '6cb76ff7-ccfa-4876-a395-187238791a84',
};

/** Contents lines for the four new books, in the nine's "Contains: …" register. */
const CONTENTS = {
  I: 'Prayer of the Apostle Paul, Apocryphon of James, Gospel of Truth, Treatise on the Resurrection, Tripartite Tractate (the Jung Codex).',
  V: 'Eugnostos the Blessed, Apocalypse of Paul, First Apocalypse of James, Second Apocalypse of James, Apocalypse of Adam.',
  X: 'Marsanes.',
  XIII: 'Trimorphic Protennoia, On the Origin of the World (fragment).',
};

/** Brill facsimile scans (Internet Archive, z-lib uploads) that depict the same codex. */
const BRILL = {
  I: '69cf7d6f6d17d9f121ccf46b',
  II: '69cf7d866d17d9f121ccf51d',
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Claremont fetch (rate-limited, contact UA) ───────────────────────────────
async function cdmJson(query) {
  const url = `${CDM}${query}/json`;
  await claimSlot(IIIF_HOST, getDomainLimit(url));
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      // CONTENTdm also drops the socket mid-response on a heavy page
      // ("fetch failed: other side closed", 2026-09-16). Same treatment as a 5xx.
      log(`  retry ${attempt + 1}: ${String(e?.cause?.message || e?.message).slice(0, 80)} — ${url.slice(-70)}`);
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) { noteRateLimited(url, Number(res.headers.get('retry-after'))); await sleep(2000 * (attempt + 1)); continue; }
    // CONTENTdm answers a heavy dmQuery page with a bare 502 now and then
    // (seen 2026-09-16 on the second 500-row page). A 5xx is the server's
    // problem, not the query's — back off and ask again, don't die.
    if (res.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`gave up after 6 attempts (429/5xx/socket) ${url}`);
}

/** Every record in the nha collection, deduplicated by pointer (the pager repeats ~15). */
async function enumerateCollection() {
  const byPointer = new Map();
  let start = 1;
  let total = null;
  while (total === null || start <= total) {
    const j = await cdmJson(`dmQuery/nha/0/title!source!date!descri!langua!type!format/title/500/${start}/0/0/0/0`);
    total = Number(j.pager?.total) || 0;
    for (const r of j.records || []) byPointer.set(String(r.pointer), r);
    start += 500;
  }
  return [...byPointer.values()];
}

// ── Plate-title parsing and series choice ────────────────────────────────────
const ROMAN = '(XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)';
// "Codex V, papyrus page 12" / "Codex I , papyurs page 9" / "Codex X. papyrus page 3*" / "Codex XIII papyrus page 40".
// Spreads ("pages 2 and 85"), fragments, covers, flyleaves and conservation photos do not match.
const PAGE_RX = new RegExp(`^Codex\\s+${ROMAN}\\s*[,.]?\\s*papy(?:rus|urs|ri)\\s+page\\s+(\\d+\\*?|[A-Z]\\d*)\\s*$`, 'i');

function parsePlate(rec) {
  const m = PAGE_RX.exec(String(rec.title || '').trim());
  if (!m) return null;
  return { codex: m[1].toUpperCase(), label: m[2].toUpperCase(), pointer: String(rec.pointer), series: seriesOf(rec.source), title: rec.title };
}
/** "Black and white negative, 5 x 7 inches: Institute for Antiquity and Christianity" — the part before the sub-series tail. */
function seriesOf(source) {
  return String(typeof source === 'string' ? source : '').split(';')[0].trim() || '(unlabelled)';
}
const isNumeric = (label) => /^\d+\*?$/.test(label);
const labelNum = (label) => parseInt(label, 10);
function labelOrder(a, b) {
  const an = isNumeric(a), bn = isNumeric(b);
  if (an && bn) {
    const d = labelNum(a) - labelNum(b);
    return d !== 0 ? d : (a.endsWith('*') ? 1 : 0) - (b.endsWith('*') ? 1 : 0); // "3" before "3*"
  }
  if (an !== bn) return an ? -1 : 1; // numeric run first, letter pages after
  return a.localeCompare(b);
}

/**
 * Choose one record per papyrus page for a codex. The series with the most
 * distinct numeric pages is primary; the others fill its gaps. Ties go to the
 * 5×7 A-Series (the largest negatives).
 */
function planCodex(plates, codex) {
  const own = plates.filter((p) => p.codex === codex);
  const bySeries = new Map();
  for (const p of own) {
    if (!bySeries.has(p.series)) bySeries.set(p.series, new Map());
    const m = bySeries.get(p.series);
    if (!m.has(p.label)) m.set(p.label, []);
    m.get(p.label).push(p);
  }
  const rank = [...bySeries.entries()]
    .map(([series, m]) => ({ series, numeric: [...m.keys()].filter(isNumeric).length, total: m.size }))
    .sort((a, b) => b.numeric - a.numeric || (b.series.includes('5 x 7') ? 1 : 0) - (a.series.includes('5 x 7') ? 1 : 0));
  const primary = rank[0]?.series || null;
  const labels = [...new Set(own.map((p) => p.label))].sort(labelOrder);
  const pages = labels.map((label) => {
    const order = rank.map((r) => r.series);
    let chosen = null;
    const alternates = [];
    for (const s of order) {
      const recs = (bySeries.get(s)?.get(label) || []).slice().sort((a, b) => Number(a.pointer) - Number(b.pointer));
      for (const r of recs) {
        if (!chosen) chosen = r; else alternates.push({ pointer: r.pointer, series: r.series, title: r.title });
      }
    }
    return { label, pointer: chosen.pointer, series: chosen.series, title: chosen.title, alternates };
  });
  const nums = labels.filter(isNumeric).map(labelNum);
  const max = nums.length ? Math.max(...nums) : 0;
  const have = new Set(nums);
  const missing = [];
  for (let n = 1; n <= max; n++) if (!have.has(n)) missing.push(n);
  return { codex, plateRecords: own.length, series: rank, primary, pages, missing };
}

/** Which page numbers an EXISTING book lacks, judged by its pages' Claremont titles. */
function missingForExisting(pageDocs, plateByPointer) {
  const nums = [];
  for (const p of pageDocs) {
    const ptr = pointerOfPage(p);
    const plate = ptr ? plateByPointer.get(ptr) : null;
    if (plate && isNumeric(plate.label)) nums.push(labelNum(plate.label));
  }
  const max = nums.length ? Math.max(...nums) : 0;
  const have = new Set(nums);
  const missing = [];
  for (let n = 1; n <= max; n++) if (!have.has(n)) missing.push(n);
  return { missing, mapped: nums.length };
}
function pointerOfPage(p) {
  const fromRef = /^nha:(\d+)$/.exec(p.source_ref || '') || /^nha:(\d+)$/.exec(p.iiif_image_id || '');
  if (fromRef) return fromRef[1];
  const fromUrl = /nha[:/](\d+)\//.exec(p.photo || p.photo_original || '');
  return fromUrl ? fromUrl[1] : null;
}

// ── Book-level records ───────────────────────────────────────────────────────
const romanTokens = (codex) => ['nag', 'hammadi', codex.toLowerCase()].sort();
/** Same key mint-local-work-ids.mjs produces for these titles: local:n::<sorted distinctive tokens>. */
const workId = (codex) => `local:n::${romanTokens(codex).join('-')}`;
const title = (codex) => `Nag Hammadi Codex ${codex}`;
const slug = (codex) => `nag-hammadi-codex-${codex.toLowerCase()}`;

function imageSource(codex, now) {
  return {
    provider: PROVIDER,
    provider_name: PROVIDER_NAME,
    source_url: `${COLLECTION_URL}/search/searchterm/Codex%20${codex}`,
    identifier: `nha:codex-${codex}`,
    license: LICENSE,
    license_url: 'https://ccdl.claremont.edu/digital/collection/nha',
    attribution: 'Nag Hammadi Archive, Claremont Colleges Library, Special Collections. Photographs by the Institute for Antiquity and Christianity / UNESCO project (James M. Robinson).',
    contributing_library: CONTRIBUTING_LIBRARY,
    digitized_by: 'Claremont Colleges Library',
    digital_host: 'ccdl.claremont.edu',
    access_date: now,
    notes: 'The codices themselves are held by the Coptic Museum, Cairo; Claremont holds the photographic negatives from the Robinson/UNESCO facsimile project.',
  };
}
function provenanceStamp(value, now) {
  return {
    source: 'import',
    provider: PROVIDER,
    provider_name: PROVIDER_NAME,
    date: now,
    value,
    claims: [{ source: 'import:claremont_nha', value }],
    script: 'claremont-nag-hammadi.mjs',
  };
}
function bookCatalogMetadata(plan, now) {
  return {
    source: 'claremont_nha',
    collection: 'nha',
    collection_url: COLLECTION_URL,
    query: `dmQuery/nha/title^Codex ${plan.codex}, papyrus page^all^and`,
    fetched_at: now,
    plate_records: plan.plateRecords,
    series: plan.series.map((s) => ({ series: s.series, numeric_pages: s.numeric, records: s.total })),
    primary_series: plan.primary,
    missing_page_numbers: plan.missing,
  };
}

// ── Page-level catalog record ────────────────────────────────────────────────
async function stampPageRecords(db, book, plateByPointer, plan) {
  const pages = db.collection('pages');
  const docs = await pages.find({ book_id: book.id, 'catalog_metadata.record': { $exists: false } }, { projection: { _id: 1, page_number: 1, source_ref: 1, iiif_image_id: 1, photo: 1, photo_original: 1 } }).toArray();
  let done = 0;
  for (const p of docs) {
    const ptr = pointerOfPage(p);
    if (!ptr) { log(`  page ${p.page_number}: no Claremont pointer on the doc — skipped`); continue; }
    const plate = plateByPointer.get(ptr);
    const alternates = plate ? (plan.pages.find((x) => x.label === plate.label)?.alternates || []).filter((a) => a.pointer !== ptr) : [];
    const record = await cdmJson(`dmGetItemInfo/nha/${ptr}`);
    await pages.updateOne({ _id: p._id }, { $set: { catalog_metadata: {
      source: 'claremont_nha', pointer: ptr, title: plate?.title ?? record?.title ?? null, series: plate?.series ?? seriesOf(record?.source),
      papyrus_page: plate?.label ?? null, alternates, record, fetched_at: new Date(),
    } } });
    done++;
  }
  return { stamped: done, total: docs.length };
}

// ── Archive ──────────────────────────────────────────────────────────────────
async function fetchBytes(url) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    await claimSlot(IIIF_HOST, getDomainLimit(url));
    try {
      const { res, buffer } = await fetchWithStallTimeout(url, { headers: { 'User-Agent': UA }, stallMs: 60_000 });
      // Claremont sometimes answers 200 with an HTML error body (Codex VII,
      // 7 pages, 2026-09-18) — sharp then dies with "unsupported image format".
      // A JPEG starts FF D8; anything else is a retry, not a crash.
      if (res.ok && !(buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8)) { lastErr = new Error(`non-JPEG body (${res.headers.get('content-type') || 'no content-type'}, ${buffer.length} B)`); }
      else if (res.ok) return buffer;
      if (res.status === 429) { noteRateLimited(url, Number(res.headers.get('retry-after'))); lastErr = new Error('HTTP 429'); }
      else if (res.status >= 400 && res.status < 500) throw new Error(`HTTP ${res.status} ${url}`);
      else lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (/HTTP 4\d\d/.test(String(e.message)) && !/429/.test(String(e.message))) throw e;
      lastErr = e;
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw lastErr;
}

async function archivePage(book, p) {
  const src = iiifPhoto(pointerOfPage(p));
  const info = await fetchIiifInfo(src, { userAgent: UA }).catch(() => null);
  let buf = await fetchBytes(src);
  let stitchedTiles = 0;
  let meta = await sharp(buf).metadata();
  // `/full/full/` is a request, not a guarantee (archive-coverage.md). Measured
  // 2026-09-11 Claremont honours it (6000×8400 back for a 6000-wide info.json),
  // but the check costs nothing and the stitch path exists for the day it stops.
  if (info?.width && meta.width && meta.width < info.width * 0.98 && info.tiles) {
    const stitch = await fetchIiifNativeRes(src, { info });
    buf = stitch.buffer; stitchedTiles = stitch.tiles || 0;
    meta = await sharp(buf).metadata();
  }
  const paths = pagePaths(book.id, p.page_number);
  for (const k of Object.values(paths)) assertBookScopedKey(k, book.id, 'claremont-nag-hammadi');
  const master = await sharp(buf).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const stored = await sharp(master).metadata();
  const display = await sharp(buf).rotate().resize(1200, null, { withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  const thumb = await sharp(buf).rotate().resize(150, null, { withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
  const [full, disp, th] = await Promise.all([
    storagePut(paths.full, master, { contentType: 'image/jpeg', access: 'public' }),
    storagePut(paths.display, display, { contentType: 'image/jpeg', access: 'public' }),
    storagePut(paths.thumb, thumb, { contentType: 'image/jpeg', access: 'public' }),
  ]);
  // The March pages store the dead `/iiif/2/nha:` form as their source URL;
  // record the form that actually resolves, so `photo` stays a usable
  // pointer at the host (lesson_page_image_fields_r2_vs_source).
  const fixSource = DEAD_IIIF_FORM.test(p.photo || '') || DEAD_IIIF_FORM.test(p.photo_original || '')
    ? { photo: src, photo_original: src }
    : {};
  return {
    $set: {
      archived_photo: full.url,
      display_photo: disp.url,
      thumbnail_blob: th.url,
      ...fixSource,
      ...dimensionFields(stored, { nativeWidth: info?.width ?? null, nativeHeight: info?.height ?? null, stitchedTiles }),
      updated_at: new Date(),
    },
  };
}

async function archiveBook(db, book) {
  const pages = db.collection('pages');
  const todo = await pages.find({ book_id: book.id, $or: [{ archived_photo: { $exists: false } }, { archived_photo: { $not: new RegExp(`^${R2_PUBLIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`) } }] },
    { projection: { _id: 1, page_number: 1, source_ref: 1, iiif_image_id: 1, photo: 1, photo_original: 1, archived_photo: 1 } }).sort({ page_number: 1 }).toArray();
  const work = PAGE_LIMIT ? todo.slice(0, PAGE_LIMIT) : todo;
  let ok = 0, failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < work.length) {
      const p = work[next++];
      try {
        const upd = await archivePage(book, p);
        await pages.updateOne({ _id: p._id }, upd);
        ok++;
        if (ok % 20 === 0) log(`  ${book.title}: ${ok}/${work.length} archived`);
      } catch (e) {
        failed++;
        // Never write the failure into archived_photo (archive-fetch-failures.md):
        // an unattributed error there hides the page from every later run.
        log(`  ${book.title} p${p.page_number}: FAILED ${String(e.message).slice(0, 140)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, work.length) }, worker));
  const onR2 = await pages.countDocuments({ book_id: book.id, archived_photo: { $regex: `^${R2_PUBLIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/` } });
  const total = await pages.countDocuments({ book_id: book.id });
  const complete = onR2 === total;
  // Status value hoisted out of the $set literal: the field-write lint reads a
  // quoted value on the same line as a field name (#4896 CI run).
  const archiveStatus = complete ? 'archive_complete' : 'archive_partial';
  await db.collection('books').updateOne({ id: book.id }, { $set: {
    pages_archived: onR2,
    archive_status: archiveStatus,
    ...(complete ? { archive_completed_at: new Date() } : {}),
    updated_at: new Date(),
  } });
  return { ok, failed, onR2, total, pending: todo.length };
}

// ── Verify (HEAD every archived object) ──────────────────────────────────────
async function headCount(urls) {
  let ok = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const u = urls[next++];
      try { const r = await fetch(u, { method: 'HEAD' }); if (r.ok) ok++; } catch { /* counted as missing */ }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`mode: ${PLAN ? 'PLAN (no writes)' : VERIFY ? 'VERIFY' : 'APPLY'}${CODEX_FILTER ? ` codices ${[...CODEX_FILTER].join(',')}` : ''}`);
  const records = await enumerateCollection();
  const plates = records.map(parsePlate).filter(Boolean);
  const plateByPointer = new Map(plates.map((p) => [p.pointer, p]));
  log(`Claremont nha: ${records.length} records, ${plates.length} single-page plates`);

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');
  const now = new Date();
  const rows = [];

  try {
    for (const codex of CODICES) {
      if (CODEX_FILTER && !CODEX_FILTER.has(codex)) continue;
      const plan = planCodex(plates, codex);
      let resumeEmpty = false;
      let book = EXISTING[codex] ? await books.findOne({ id: EXISTING[codex] }) : null;
      if (EXISTING[codex] && !book) throw new Error(`Codex ${codex}: expected book ${EXISTING[codex]} is missing — refusing to create a second one`);
      if (!book) {
        // Belt and braces: never create a second Codex N even if EXISTING drifts.
        const clash = await books.findOne({ source: PROVIDER, title: title(codex) }, { projection: { id: 1 } })
          || await books.findOne({ 'image_source.provider': PROVIDER, title: title(codex) }, { projection: { id: 1 } });
        if (clash) {
          // A book row with no page rows is the shell an aborted run leaves
          // behind (the first --apply died in makePageDoc after insertBookIfNew,
          // 2026-09-17). Adopt it and finish it rather than refusing.
          // A Claremont book this script created on an earlier run (the four
          // new codices are not in EXISTING by design — that map is the March
          // nine). Adopt it: with page rows it takes the existing-book path
          // (stamp + archive); with none it takes the create-pages path.
          const pageRows = await pages.countDocuments({ book_id: clash.id });
          book = await books.findOne({ id: clash.id });
          resumeEmpty = pageRows === 0;
          log(`Codex ${codex}: adopting ${clash.id} from an earlier run (${pageRows} page rows)`);
        }
      }
      const isNew = !book || resumeEmpty;
      const row = { codex, status: isNew ? 'NEW' : 'existing', plateRecords: plan.plateRecords, primary: plan.primary, series: plan.series.map((s) => `${s.series.replace('Black and white negative, ', '').replace(': Institute for Antiquity and Christianity', ' IAC').replace(': Honnold/Mudd Library, Special Collections', ' Honnold')}=${s.numeric}`).join('; ') };

      if (isNew) {
        row.pages = plan.pages.length;
        row.missing = plan.missing;
        if (PLAN) {
          log(`Codex ${codex}: NEW — ${plan.pages.length} pages from ${plan.plateRecords} plate records; primary "${plan.primary}"; gaps ${plan.missing.join(',') || 'none'}; letter pages ${plan.pages.filter((p) => !isNumeric(p.label)).map((p) => p.label).join(',') || 'none'}`);
          // A plan that never builds a page doc or touches an image URL proves
          // nothing about either — that is how #4903 and #4906 got past a green
          // plan run. Build-and-discard through the guarded constructor, and
          // HEAD one master, so both fail here instead of on --apply.
          plan.pages.slice(0, 3).forEach((p, i) => makePageDoc({
            _id: new ObjectId(), id: randomUUID(), book_id: 'plan-probe', page_number: i + 1,
            page_label: `papyrus page ${p.label}`, source_ref: `nha:${p.pointer}`,
            photo: iiifPhoto(p.pointer), photo_original: iiifPhoto(p.pointer), thumbnail: iiifThumb(p.pointer),
            catalog_metadata: { source: 'claremont_nha', pointer: p.pointer, title: p.title, series: p.series, papyrus_page: p.label, alternates: p.alternates },
            created_at: now, updated_at: now,
          }));
          const probe = plan.pages[0] ? await fetch(iiifPhoto(plan.pages[0].pointer), { method: 'HEAD', headers: { 'User-Agent': UA } }).catch((e) => ({ status: `ERR ${e.message}` })) : null;
          if (probe && probe.status !== 200) throw new Error(`Codex ${codex}: master URL probe returned ${probe.status} — fix the URL form before --apply`);
          row.probe = probe ? probe.status : 'n/a';
          rows.push(row);
          continue;
        }
        if (VERIFY) { row.pages = 0; row.onR2 = 0; rows.push(row); continue; }
        if (ARCHIVE_ONLY) { rows.push(row); continue; }
        const bookId = resumeEmpty ? book.id : randomUUID();
        const firstPtr = plan.pages[0]?.pointer;
        const acquired = resumeEmpty ? { inserted: true } : await insertBookIfNew(db, {
          _id: new ObjectId(), id: bookId, slug: slug(codex),
          title: title(codex), display_title: title(codex), author: AUTHOR,
          language: 'Coptic', original_language: 'Coptic', languages: ['Coptic'], language_multi: false,
          year: 350,
          categories: CATEGORIES, collections: COLLECTIONS,
          description: `Contains: ${CONTENTS[codex]} ${DESCRIPTION_TAIL}`,
          content_type: 'book',
          thumbnail: firstPtr ? iiifThumb(firstPtr).replace('/full/200,/', '/full/400,/') : '',
          pages_count: plan.pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
          status: 'draft', hidden: true, visible: false,
          work_id: workId(codex),
          image_source: imageSource(codex, now),
          contributing_library: CONTRIBUTING_LIBRARY,
          dublin_core: { dc_identifier: plan.pages.slice(0, 1).map((p) => `CONTENTdm:nha:${p.pointer}`), dc_source: COLLECTION_URL },
          catalog_metadata: bookCatalogMetadata(plan, now),
          field_provenance: {
            title: provenanceStamp(title(codex), now),
            language: provenanceStamp('Coptic', now),
            contributing_library: provenanceStamp(CONTRIBUTING_LIBRARY, now),
          },
          notes: `Imported direct from the Claremont Colleges Digital Library Nag Hammadi Archive (CONTENTdm collection nha) by scripts/import/claremont-nag-hammadi.mjs. Page sequence follows the "${plan.primary}" series, gap-filled from the other negative series; alternate pointers are recorded per page in catalog_metadata.alternates.`,
          created_at: now, updated_at: now,
        }, { importer: IMPORTER, sourceIdentifier: `nha:codex-${codex}`, sourceUrl: `${COLLECTION_URL}/search/searchterm/Codex%20${codex}` });
        if (!acquired.inserted) throw new Error(`Codex ${codex}: acquisition gate declined — ${acquired.message}`);
        const pageDocs = plan.pages.map((p, i) => makePageDoc({
          _id: new ObjectId(), id: randomUUID(), book_id: bookId, page_number: i + 1,
          page_label: `papyrus page ${p.label}`, source_ref: `nha:${p.pointer}`,
          photo: iiifPhoto(p.pointer), photo_original: iiifPhoto(p.pointer), thumbnail: iiifThumb(p.pointer),
          catalog_metadata: { source: 'claremont_nha', pointer: p.pointer, title: p.title, series: p.series, papyrus_page: p.label, alternates: p.alternates },
          created_at: now, updated_at: now,
        }));
        await pages.insertMany(pageDocs, { ordered: false });
        await books.updateOne({ id: bookId }, { $set: {
          hidden_reason: HIDDEN_REASON,
          work_title: title(codex), work_id_source: 'local-mint', work_id_confidence: 'deterministic', work_slug: `anonymous-${slug(codex)}`,
        } });
        await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'created-hidden', detail: { codex, pages: pageDocs.length, primary_series: plan.primary, missing_page_numbers: plan.missing } });
        book = await books.findOne({ id: bookId });
        log(`Codex ${codex}: created ${bookId} with ${pageDocs.length} pages (hidden)`);
      }

      // ── Existing (or just-created) book: measure, stamp, archive ──
      const pageDocs = await pages.find({ book_id: book.id }, { projection: { page_number: 1, source_ref: 1, iiif_image_id: 1, photo: 1, photo_original: 1, archived_photo: 1, display_photo: 1 } }).sort({ page_number: 1 }).toArray();
      const ex = missingForExisting(pageDocs, plateByPointer);
      row.pages = pageDocs.length;
      row.missing = ex.missing;
      row.onR2Record = pageDocs.filter((p) => isR2(p.archived_photo)).length;
      row.book_id = book.id;

      if (VERIFY) {
        row.onR2 = await headCount(pageDocs.map((p) => p.archived_photo).filter(isR2));
        row.displayR2 = pageDocs.filter((p) => isR2(p.display_photo)).length;
        row.stamped = await pages.countDocuments({ book_id: book.id, 'catalog_metadata.record': { $exists: true } });
        row.fp = book.field_provenance?.contributing_library?.claims?.[0]?.source === 'import:claremont_nha';
        row.hidden = `${book.hidden}/${book.visible}/${book.hidden_reason}`;
        rows.push(row);
        continue;
      }

      if (PLAN) {
        const needStamp = await pages.countDocuments({ book_id: book.id, 'catalog_metadata.record': { $exists: false } });
        log(`Codex ${codex}: existing ${book.id} — ${pageDocs.length} pages, ${row.onR2Record} masters on R2 (record), ${needStamp} pages need catalog records; gaps ${ex.missing.join(',') || 'none'}; hidden_reason=${book.hidden_reason} visible=${book.visible} provenance=${book.field_provenance ? Object.keys(book.field_provenance).join(',') : 'none'} contributing_library=${book.contributing_library || 'none'}`);
        rows.push(row);
        continue;
      }

      if (!ARCHIVE_ONLY) {
        // Book-level stamps (idempotent: provenance only where absent, the rest set to the same value).
        const set = {
          contributing_library: CONTRIBUTING_LIBRARY,
          image_source: { ...(book.image_source || {}), ...imageSource(codex, now) },
          catalog_metadata: { ...(book.catalog_metadata || {}), ...bookCatalogMetadata(plan, now) },
          hidden: true, visible: false, hidden_reason: HIDDEN_REASON,
          updated_at: now,
        };
        for (const [field, value] of [['title', book.title], ['language', book.language], ['contributing_library', CONTRIBUTING_LIBRARY]]) {
          if (!book.field_provenance?.[field]) set[`field_provenance.${field}`] = provenanceStamp(value, now);
        }
        const before = { hidden: book.hidden, visible: book.visible, hidden_reason: book.hidden_reason, contributing_library: book.contributing_library };
        await books.updateOne({ id: book.id }, { $set: set });
        if (before.hidden_reason !== HIDDEN_REASON || before.visible !== false || before.contributing_library !== CONTRIBUTING_LIBRARY) {
          await recordSweepAction(db, { sweep: SWEEP, book_id: book.id, action: 'stamped-awaiting-permission', detail: { codex, before, after: { hidden: true, visible: false, hidden_reason: HIDDEN_REASON, contributing_library: CONTRIBUTING_LIBRARY } } });
        }
        const st = await stampPageRecords(db, book, plateByPointer, plan);
        log(`Codex ${codex}: book stamped; page catalog records ${st.stamped}/${st.total} fetched`);

        // Brill facsimile → same work, superseded.
        if (BRILL[codex]) {
          const brill = await books.findOne({ id: BRILL[codex] }, { projection: { id: 1, work_id: 1, hidden_reason: 1, title: 1 } });
          if (!brill) log(`Codex ${codex}: Brill facsimile ${BRILL[codex]} not found — skipped`);
          else if (brill.work_id === workId(codex) && String(brill.hidden_reason || '').includes(book.id)) log(`Codex ${codex}: Brill facsimile already linked`);
          else {
            const note = `superseded by Claremont NHA ${book.id}`;
            const hidden_reason = brill.hidden_reason ? (String(brill.hidden_reason).includes(note) ? brill.hidden_reason : `${brill.hidden_reason}; ${note}`) : note;
            await books.updateOne({ id: brill.id }, { $set: { work_id: workId(codex), work_id_source: 'manual', work_id_confidence: 'high', hidden: true, visible: false, hidden_reason, updated_at: now } });
            await recordSweepAction(db, { sweep: SWEEP, book_id: brill.id, action: 'linked-to-claremont-work', detail: { codex, claremont_book: book.id, before: { work_id: brill.work_id, hidden_reason: brill.hidden_reason }, after: { work_id: workId(codex), hidden_reason } } });
            log(`Codex ${codex}: Brill facsimile ${brill.id} → ${workId(codex)}`);
          }
        }
      }

      if (!SKIP_ARCHIVE) {
        const a = await archiveBook(db, book);
        row.archived = a;
        log(`Codex ${codex}: archive ${a.ok} ok / ${a.failed} failed; ${a.onR2}/${a.total} masters on R2`);
      }
      rows.push(row);
    }
  } finally {
    await client.close();
  }

  // ── Report ──
  console.log('');
  if (VERIFY) {
    console.log('| codex | book | plate records | pages | masters on R2 (HEAD) | display on R2 | page records | missing page numbers | series (numeric pages) | provenance | hidden/visible/reason |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.codex} | ${r.status} ${r.book_id || ''} | ${r.plateRecords} | ${r.pages} | ${r.onR2 ?? 0} | ${r.displayR2 ?? 0} | ${r.stamped ?? 0} | ${r.missing?.length ? r.missing.join(', ') : 'none'} | ${r.series} | ${r.fp ? 'claremont_nha' : 'none'} | ${r.hidden || ''} |`);
  } else {
    console.log('| codex | status | plate records | pages | masters on R2 (record) | missing page numbers | primary series | all series (numeric pages) |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.codex} | ${r.status} | ${r.plateRecords} | ${r.pages} | ${r.archived ? r.archived.onR2 : (r.onR2Record ?? 0)} | ${r.missing?.length ? r.missing.join(', ') : 'none'} | ${(r.primary || '').replace('Black and white negative, ', '')} | ${r.series} |`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

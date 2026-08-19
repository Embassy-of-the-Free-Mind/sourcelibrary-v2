#!/usr/bin/env node
/**
 * Import foundational Jewish-philosophy / Kabbalah works from Sefaria as
 * TEXT-ONLY books (no scans): original-language text in ocr.data, English in
 * translation.data, section-aligned page-by-page.
 *
 * Why Sefaria: its English community translations are CC0 and its source texts
 * are PD or CC-BY-SA, all exposed via a clean public API. These ~25 works are a
 * real gap in our Kabbalah/philosophy coverage (audit 2026-06-01). The move is
 * alignment, not duplication — we hold the Zohar/Pardes facsimiles already; this
 * fills the philosophy canon (Maimonides, Halevi, Saadia, Crescas), the Lurianic
 * cluster, Abulafia, and Gikatilla's Gates of Light in English.
 *
 * Pages: born-digital texts have no real pages. We paginate by joining
 * consecutive same-section segments into chunks of ~CHUNK_SEGMENTS, preserving
 * section boundaries, and record the Sefaria ref range on each page for citation.
 *
 * Books are inserted HIDDEN (visible:false). Verify rendering, then flip with the
 * visibility pair. Idempotent: skips works already imported (dublin_core match).
 * Complex (multi-node) Sefaria texts are detected and SKIPPED here for a second
 * pass — this script handles flat depth-1/2 texts.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/import-sefaria.mjs --probe        # check which refs exist / are complex
 *   node scripts/import/import-sefaria.mjs --dry-run      # build, no DB write
 *   node scripts/import/import-sefaria.mjs --commit       # write to Mongo
 *   node scripts/import/import-sefaria.mjs --commit --only Kuzari
 */

import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const ARGS = process.argv.slice(2);
const PROBE = ARGS.includes('--probe');
const DRY_RUN = ARGS.includes('--dry-run');
const COMMIT = ARGS.includes('--commit');
const ONLY = (() => { const i = ARGS.indexOf('--only'); return i >= 0 ? ARGS[i + 1] : null; })();
const CHUNK_SEGMENTS = 12;
const SEFARIA = 'https://www.sefaria.org';

// Candidate works. `ref` is the Sefaria index title; the script validates each.
// language = the original-language text we surface in ocr.data (what Sefaria's
// `he` array holds). translation = English (text array).
const WORKS = [
  // --- Medieval Jewish philosophy / Neoplatonism (biggest gap) ---
  { ref: 'Kuzari', title: 'Kuzari (Kitāb al-Khazarī)', display_title: 'The Kuzari', author: 'Judah Halevi', language: 'Hebrew', published: 'c. 1140', collections: ['classical-philosophy', 'judaism', 'philosophical-theology'] },
  { ref: 'Guide for the Perplexed', title: 'Moreh Nevukhim (Guide for the Perplexed)', display_title: 'Guide for the Perplexed', author: 'Moses Maimonides', language: 'Hebrew', published: 'c. 1190', collections: ['classical-philosophy', 'judaism', 'philosophical-theology', 'neoplatonism'] },
  { ref: 'Duties of the Heart', title: 'Ḥovot ha-Levavot (Duties of the Heart)', display_title: 'Duties of the Heart', author: 'Bahya ibn Pakuda', language: 'Hebrew', published: 'c. 1080', collections: ['mysticism', 'judaism', 'philosophical-theology'] },
  { ref: 'The Book of Beliefs and Opinions', title: 'Emunot ve-Deot (Beliefs and Opinions)', display_title: 'Beliefs and Opinions', author: 'Saadia Gaon', language: 'Hebrew', published: '933', collections: ['classical-philosophy', 'judaism', 'philosophical-theology'] },
  { ref: 'Sefer HaIkkarim', title: 'Sefer ha-Ikkarim (Book of Principles)', display_title: 'Sefer ha-Ikkarim', author: 'Joseph Albo', language: 'Hebrew', published: 'c. 1425', collections: ['classical-philosophy', 'judaism', 'philosophical-theology'] },
  // --- Cordoveran / classic Kabbalah ---
  { ref: 'Tikkunei Zohar', title: 'Tikkunei ha-Zohar', display_title: 'Tikkunei Zohar', author: 'Anonymous (Zoharic)', language: 'Aramaic', published: 'c. 1300', collections: ['kabbalah', 'mysticism', 'jewish-kabbalistic-mysticism', 'sacred-texts'] },
  { ref: 'Reshit Chokhmah', title: 'Reshit Chokhmah (The Beginning of Wisdom)', display_title: 'Reshit Chokhmah', author: 'Elijah de Vidas', language: 'Hebrew', published: '1579', collections: ['kabbalah', 'mysticism', 'jewish-kabbalistic-mysticism'] },
  { ref: 'Chesed LeAvraham', title: 'Chesed le-Avraham', display_title: 'Chesed le-Avraham', author: 'Abraham Azulai', language: 'Hebrew', published: 'c. 1650', collections: ['kabbalah', 'mysticism', 'jewish-kabbalistic-mysticism'] },
  // --- Gikatilla ---
  { ref: 'Shaarei Orah', title: "Sha'arei Orah (Gates of Light)", display_title: 'Gates of Light', author: 'Joseph Gikatilla', language: 'Hebrew', published: 'c. 1290', collections: ['kabbalah', 'mysticism', 'jewish-kabbalistic-mysticism'] },
  // --- Ramchal (Luzzatto) ---
  { ref: 'Derekh Hashem', title: 'Derech Hashem (The Way of God)', display_title: 'The Way of God', author: 'Moshe Chaim Luzzatto', language: 'Hebrew', published: 'c. 1730', collections: ['kabbalah', 'mysticism', 'philosophical-theology'] },
  { ref: 'Kalach Pitchei Chokhmah', title: 'Kalach Pitchei Chokhmah (138 Openings of Wisdom)', display_title: '138 Openings of Wisdom', author: 'Moshe Chaim Luzzatto', language: 'Hebrew', published: 'c. 1730', collections: ['kabbalah', 'mysticism', 'jewish-kabbalistic-mysticism'] },
  { ref: "Da'at Tevunot", title: "Da'at Tevunot (The Knowing Heart)", display_title: 'The Knowing Heart', author: 'Moshe Chaim Luzzatto', language: 'Hebrew', published: 'c. 1730', collections: ['kabbalah', 'mysticism', 'philosophical-theology'] },
];

function slugify(text, maxLen = 70) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .substring(0, maxLen).replace(/-$/, '');
}

async function generateUniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

// Sefaria segments may contain HTML (footnotes, emphasis). These are real
// apparatus on real text — NOT our AI editorial wrappers — so a plain tag-strip
// is correct here. Decode the few entities Sefaria emits.
function clean(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchText(ref) {
  const url = `${SEFARIA}/api/texts/${encodeURIComponent(ref)}?context=0&pad=0&commentary=0`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return { ok: true, data: j };
}

// Flatten a depth-1 or depth-2 parallel (he,en) structure into aligned segments.
function flattenSegments(j) {
  const he = j.he, en = j.text;
  const segs = [];
  const depth = j.textDepth ?? (Array.isArray(en?.[0]) ? 2 : 1);
  if (depth >= 2) {
    const nSections = Math.max(en?.length ?? 0, he?.length ?? 0);
    for (let s = 0; s < nSections; s++) {
      const enS = en?.[s] ?? [], heS = he?.[s] ?? [];
      const n = Math.max(enS.length, heS.length);
      for (let k = 0; k < n; k++) {
        segs.push({ section: s + 1, seg: k + 1, en: clean(enS[k]), he: clean(heS[k]) });
      }
    }
  } else {
    const n = Math.max(en?.length ?? 0, he?.length ?? 0);
    for (let k = 0; k < n; k++) {
      segs.push({ section: 1, seg: k + 1, en: clean(en?.[k]), he: clean(he?.[k]) });
    }
  }
  return segs.filter(x => x.en || x.he);
}

// Group consecutive same-section segments into pages of ~CHUNK_SEGMENTS.
function buildPages(segs, refTitle, sectionName) {
  const pages = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur[0], last = cur[cur.length - 1];
    const heData = cur.map(x => x.he).filter(Boolean).join('\n');
    const enData = cur.map(x => x.en).filter(Boolean).join('\n');
    const sn = sectionName || 'Section';
    const range = first.section === last.section
      ? `${sn} ${first.section}:${first.seg}-${last.seg}`
      : `${sn} ${first.section}:${first.seg}–${last.section}:${last.seg}`;
    pages.push({ heData, enData, source_ref: `${refTitle}, ${range}` });
    cur = [];
  };
  for (const seg of segs) {
    if (cur.length && (cur[0].section !== seg.section || cur.length >= CHUNK_SEGMENTS)) flush();
    cur.push(seg);
  }
  flush();
  return pages;
}

async function probe() {
  console.log(`Probing ${WORKS.length} Sefaria refs...\n`);
  for (const w of WORKS) {
    const res = await fetchText(w.ref);
    if (!res.ok) { console.log(`  ✗ ${w.ref.padEnd(28)} HTTP ${res.status}`); continue; }
    const j = res.data;
    const complex = !!j.isComplex;
    const segs = complex ? [] : flattenSegments(j);
    const heHas = segs.some(s => s.he), enHas = segs.some(s => s.en);
    console.log(`  ${complex ? '⚠ COMPLEX' : '✓ flat'.padEnd(9)} ${w.ref.padEnd(28)} depth=${j.textDepth} sections=${j.text?.length ?? '?'} segs=${segs.length} he=${heHas ? 'Y' : 'n'} en=${enHas ? 'Y' : 'n'} enLic=${j.license} heLic=${j.heLicense}`);
    await new Promise(r => setTimeout(r, 400));
  }
}

async function importWork(db, w) {
  const res = await fetchText(w.ref);
  if (!res.ok) return { ref: w.ref, skipped: `HTTP ${res.status}` };
  const j = res.data;
  if (j.isComplex) return { ref: w.ref, skipped: 'complex (needs node-traversal pass)' };

  const segs = flattenSegments(j);
  if (!segs.length) return { ref: w.ref, skipped: 'no segments' };
  const sectionName = j.sectionNames?.[0] || 'Section';
  const pages = buildPages(segs, w.display_title || w.title, sectionName);
  const hasHe = pages.some(p => p.heData);
  const hasEn = pages.some(p => p.enData);

  const dcId = `SEFARIA:${w.ref}`;
  const existing = await db.collection('books').findOne(
    { 'dublin_core.dc_identifier': dcId }, { projection: { _id: 1, slug: 1 } });
  if (existing) return { ref: w.ref, skipped: `exists (${existing.slug})` };

  const enLicense = j.license || 'Unknown';
  const heLicense = j.heLicense || 'Unknown';

  // Safety: never ingest text whose license we can't verify. Sefaria's default
  // version sometimes lacks license metadata — skip rather than import blind.
  const OK_LICENSE = /public domain|cc0|cc-by/i;
  if (hasEn && !OK_LICENSE.test(enLicense)) return { ref: w.ref, skipped: `unverified EN license (${enLicense})` };

  if (!COMMIT) {
    return { ref: w.ref, dryrun: true, pages: pages.length, hasHe, hasEn, enLicense, heLicense,
      sample: { ref: pages[0]?.source_ref, en: pages[0]?.enData?.slice(0, 90), he: pages[0]?.heData?.slice(0, 60) } };
  }

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const slug = await generateUniqueSlug(db, slugify(`${w.display_title}-${w.author}`));
  const now = new Date();

  const bookDoc = makeBookDoc({
    _id: bookId, id: bookIdStr, slug,
    title: w.title, display_title: w.display_title, author: w.author,
    language: w.language, original_language: w.language,
    published: w.published, categories: [], collections: w.collections || [],
    ia_identifier: null, thumbnail: null,
    pages_count: pages.length,
    pages_ocr: hasHe ? pages.filter(p => p.heData).length : 0,
    pages_translated: hasEn ? pages.filter(p => p.enData).length : 0,
    pages_archived: 0,
    content_type: 'book',
    dublin_core: { dc_identifier: [dcId], dc_source: `${SEFARIA}/${encodeURIComponent(w.ref)}` },
    image_source: {
      provider: 'sefaria', provider_name: 'Sefaria',
      source_url: `${SEFARIA}/${encodeURIComponent(w.ref)}`,
      identifier: w.ref, license: enLicense,
      contributing_library: 'Sefaria (www.sefaria.org)', access_date: now,
    },
    // Full per-version provenance — CC-BY-SA sources require attribution + share-alike.
    text_source: {
      provider: 'sefaria',
      en: { version_title: j.versionTitle || null, license: enLicense, source: j.versionSource || null },
      he: { version_title: j.heVersionTitle || null, license: heLicense, source: j.heVersionSource || null },
      attribution: 'Text courtesy of Sefaria (www.sefaria.org).',
    },
    field_provenance: { language: { source: 'import', model: null, confidence: 'high', provider: 'sefaria' } },
    notes: `Imported from Sefaria (${w.ref}). Born-digital transcription + translation, paginated by section at ~${CHUNK_SEGMENTS} segments/page. EN: ${j.versionTitle || 'n/a'} (${enLicense}). HE: ${j.heVersionTitle || 'n/a'} (${heLicense}).`,
    status: 'draft', hidden: true, visible: false,
    source_fingerprint: `sefaria:${w.ref}`,
    normalized_title: slugify(w.title).replace(/-/g, ' '),
    normalized_author: slugify(w.author).replace(/-/g, ' '),
    created_at: now, updated_at: now,
  });

  await db.collection('books').insertOne(bookDoc);

  const pageDocs = pages.map((p, idx) => {
    const pid = new ObjectId();
    const doc = makePageDoc({
      _id: pid, id: pid.toHexString(),
      book_id: bookIdStr, page_number: idx + 1,
      source_ref: p.source_ref,
      created_at: now, updated_at: now,
    });
    // Omit empty ocr/translation entirely (empty strings trigger false completion).
    if (p.heData) doc.ocr = { data: p.heData, language: w.language, model: null, source: 'manual', updated_at: now };
    if (p.enData) doc.translation = { data: p.enData, language: 'English', model: null, source: 'manual', updated_at: now };
    return doc;
  });
  for (let s = 0; s < pageDocs.length; s += 500) {
    await db.collection('pages').insertMany(pageDocs.slice(s, s + 500), { ordered: false });
  }

  return { ref: w.ref, imported: bookIdStr, slug, pages: pages.length, hasHe, hasEn };
}

async function main() {
  if (PROBE) { await probe(); return; }
  if (!COMMIT && !DRY_RUN) { console.error('Pass --probe, --dry-run, or --commit'); process.exit(1); }

  const targets = ONLY ? WORKS.filter(w => w.ref === ONLY) : WORKS;
  if (!targets.length) { console.error(`No work matches --only ${ONLY}`); process.exit(1); }

  let client, db;
  if (COMMIT || true) {
    client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
    await client.connect();
    db = client.db('bookstore');
  }

  const results = [];
  for (const w of targets) {
    try {
      results.push(await importWork(db, w));
    } catch (e) {
      results.push({ ref: w.ref, error: e.message });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== ${COMMIT ? 'IMPORT' : 'DRY-RUN'} RESULTS ===`);
  for (const r of results) {
    if (r.imported) console.log(`  ✓ ${r.ref.padEnd(28)} → ${r.slug} (${r.pages}p, he=${r.hasHe}, en=${r.hasEn})`);
    else if (r.dryrun) console.log(`  · ${r.ref.padEnd(28)} ${r.pages}p he=${r.hasHe} en=${r.hasEn} enLic=${r.enLicense} | ${r.sample?.ref}`);
    else if (r.skipped) console.log(`  – ${r.ref.padEnd(28)} skipped: ${r.skipped}`);
    else if (r.error) console.log(`  ✗ ${r.ref.padEnd(28)} ERROR: ${r.error}`);
  }
  if (client) await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });

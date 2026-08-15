#!/usr/bin/env node
/**
 * Import the University of Minnesota (Wangensteen Historical Library) "East Asian
 * History of Health Texts" collection (ContentDM cdm16022, p16022coll362) as
 * Source Library BOOKS — multi-page facsimiles via IIIF.
 *
 * Scope: only the `cpd` (compound = multi-page) objects — the genuine books.
 * The 12 single-image (jp2/jpg) items in the collection are artifact-ish pictures
 * and are deliberately skipped (per Derek: "no artifacts, just posters and books").
 *
 * Mostly Edo/Meiji-era Japanese medical works (anatomy, anma massage, cholera/
 * measles epidemic records, longevity/hygiene, balneology, materia medica), plus
 * some Chinese and bilingual vocabularies, 1569–1904. Public domain by age.
 *
 * Pages reference ContentDM IIIF image URLs (width-capped) as `photo`; the
 * archiving/OCR pipeline fetches them server-side. Books land HIDDEN and (with
 * pipeline_auto unset) auto-enroll in the OCR→translation pipeline.
 * NOTE: Edo woodblock/kuzushiji Japanese is among the hardest OCR cases — benchmark
 * a sample before trusting/scaling translation (see the Javanese recitation-loop lesson).
 *
 * Modeled on scripts/import/harvard-wuzhen-direct.mjs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/import-umn-health-texts.mjs --dry            # parse only
 *   node scripts/import/import-umn-health-texts.mjs [--limit N]      # import hidden
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const HOST = 'https://cdm16022.contentdm.oclc.org';
const ALIAS = 'p16022coll362';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const COLLECTION_SLUG = 'east-asian-history-of-health';
const DRY = process.argv.includes('--dry');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? parseInt(process.argv[i + 1], 10) : Infinity; })();
const IMG_WIDTH = 2000;

const mongo = new MongoClient(process.env.MONGODB_URI);

async function getJson(url) {
  let lastErr;
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}
function md(meta, label) { const f = (meta || []).find(x => x.label === label); return f ? String(f.value) : null; }
function slugify(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70); }
function normTitle(t) { return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }
function normAuthor(a) { return (a || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' '); }

async function listCpd() {
  const url = `${HOST}/digital/bl/dmwebservices/index.php?q=dmQuery/${ALIAS}/0/title!date/title/2000/0/0/0/0/0/json`;
  const d = await getJson(url);
  return (d.records || []).filter(r => r.filetype === 'cpd').map(r => ({ pointer: r.pointer, title: r.title, date: r.date }));
}

async function ensureCollection(db) {
  const col = db.collection('collections');
  if (await col.findOne({ slug: COLLECTION_SLUG })) { console.log(`collection "${COLLECTION_SLUG}" exists`); return; }
  if (DRY) { console.log(`[DRY] would create collection "${COLLECTION_SLUG}"`); return; }
  await col.insertOne({
    slug: COLLECTION_SLUG,
    name: 'East Asian History of Health',
    subtitle: 'Edo- and Meiji-era medical and health texts',
    description: 'Japanese (with some Chinese and Korean) works on medicine and health from the Owen H. Wangensteen Historical Library of Biology and Medicine at the University of Minnesota — anatomy, massage (anma), epidemic records of measles and cholera, longevity and hygiene regimens, hot-spring balneology, childcare, and materia medica, spanning the 16th to early 20th centuries.',
    color: '#3a5a6a',
    order: 999,
    visible: false,
    languages: ['Japanese', 'Chinese'],
    created_at: new Date(), updated_at: new Date(),
  });
  console.log(`✓ created collection "${COLLECTION_SLUG}" (hidden)`);
}

async function main() {
  await mongo.connect();
  const db = mongo.db('bookstore');
  const books = db.collection('books');
  const pagesCol = db.collection('pages');
  console.log(`UMN Health Texts import${DRY ? ' (DRY)' : ''} | width=${IMG_WIDTH} | limit=${LIMIT}`);
  await ensureCollection(db);

  const items = await listCpd();
  console.log(`${items.length} cpd (book) items in ${ALIAS}`);
  let imported = 0, skipped = 0, failed = 0, totalPages = 0;

  for (const it of items) {
    if (imported >= LIMIT) break;
    const manifestUrl = `${HOST}/iiif/2/${ALIAS}:${it.pointer}/manifest.json`;
    const fp = `iiif:${manifestUrl}`;
    try {
      if (await books.findOne({ source_fingerprint: fp })) { skipped++; continue; }
      const m = await getJson(manifestUrl);
      const meta = m.metadata || [];
      const title = (Array.isArray(m.label) ? m.label[0] : m.label) || it.title || `Health text ${it.pointer}`;
      const date = md(meta, 'Date of Creation') || it.date || '';
      const yr = (String(date).match(/\d{4}/) || [])[0];
      const language = md(meta, 'Language') || 'Japanese';
      const description = md(meta, 'Description');
      const sourceUrl = `${HOST}/digital/collection/${ALIAS}/id/${it.pointer}`;
      const canvases = m.sequences?.[0]?.canvases || [];
      const pages = canvases.map((c, i) => {
        const childId = (c['@id'] || '').match(/(p16022coll362:\d+)/)?.[1]
          || (c.images?.[0]?.resource?.service?.['@id'] || '').match(/(p16022coll362:\d+)/)?.[1];
        const svc = childId ? `${HOST}/iiif/2/${childId}` : (c.images?.[0]?.resource?.service?.['@id'] || '');
        return {
          page_number: i + 1,
          photo: `${svc}/full/${IMG_WIDTH},/0/default.jpg`,
          thumbnail: `${svc}/full/300,/0/default.jpg`,
          photo_original: `${svc}/full/full/0/default.jpg`,
        };
      }).filter(p => p.photo.startsWith('http'));
      if (!pages.length) { console.log(`  ✗ ${it.pointer}: no pages`); failed++; continue; }

      if (DRY) { console.log(`  [DRY] ${it.pointer} "${String(title).slice(0,45)}" (${date}) ${pages.length}pp ${language}`); imported++; totalPages += pages.length; continue; }

      const bookId = new ObjectId(); const idStr = bookId.toHexString();
      let b = slugify(title) || `umn-health-${it.pointer}`; let slug = b; let n = 1;
      while (await books.findOne({ slug })) { slug = `${b}-${++n}`; }

      await books.insertOne(makeBookDoc({
        _id: bookId, id: idStr, slug,
        title, display_title: title, author: md(meta, 'Creator') || 'Unknown',
        language, original_language: language,
        published: date || null, year: yr ? parseInt(yr, 10) : null,
        thumbnail: pages[0].thumbnail || '',
        pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
        content_type: 'book',
        description: description || null,
        categories: ['History of Medicine'],
        collections: [COLLECTION_SLUG],
        provider: 'University of Minnesota Libraries (Wangensteen Historical Library)',
        contributing_library: 'Owen H. Wangensteen Historical Library of Biology and Medicine, University of Minnesota',
        held_by: ['umedia'],
        normalized_title: normTitle(title), normalized_author: normAuthor(md(meta, 'Creator') || 'Unknown'),
        dublin_core: { dc_identifier: [`IIIF:${manifestUrl}`] },
        image_source: {
          provider: 'umedia', provider_name: 'University of Minnesota (UMedia / Wangensteen Historical Library)',
          source_url: sourceUrl, iiif_manifest: manifestUrl, identifier: `${ALIAS}:${it.pointer}`,
          license: 'Public Domain', attribution: 'University of Minnesota Libraries, Owen H. Wangensteen Historical Library of Biology and Medicine',
          access_date: new Date(),
        },
        status: 'draft', hidden: true, visible: false,
        // PARKED: blocks the pipeline cron from auto-enrolling these in OCR/translation
        // (cron enrolls only pipeline_auto:{$exists:false}; 'parked' is also $nin the processing set).
        // Edo/kuzushiji Japanese OCR must be benchmarked before spending Gemini budget on 344 books.
        pipeline_auto: { status: 'parked', reason: 'awaiting kuzushiji OCR benchmark', last_updated: new Date() },
        source_fingerprint: fp,
        created_at: new Date(), updated_at: new Date(),
      }));

      const CHUNK = 200;
      for (let s = 0; s < pages.length; s += CHUNK) {
        // pages collection has a UNIQUE index on `id` — must set a distinct id per doc.
        const docs = pages.slice(s, s + CHUNK).map(p => makePageDoc({ _id: new ObjectId(), id: new ObjectId().toHexString(), book_id: idStr, ...p }));
        await pagesCol.insertMany(docs, { ordered: false });
      }
      imported++; totalPages += pages.length;
      console.log(`  ✓ ${slug} — "${String(title).slice(0,45)}" (${date}) ${pages.length}pp`);
    } catch (e) { failed++; console.log(`  ✗ ${it.pointer}: ${e.message}`); }
  }
  await mongo.close();
  console.log(`\n=== Summary === imported=${imported} skipped=${skipped} failed=${failed} totalPages=${totalPages}`);
}
main().catch(async e => { console.error('FATAL', e.stack || e.message); try { await mongo.close(); } catch {} process.exit(1); });

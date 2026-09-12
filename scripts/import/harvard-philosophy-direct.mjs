#!/usr/bin/env node
/**
 * Residential direct-insert of the 147 Harvard-Yenching philosophy scans
 * (經/子/佛 works from the works-catalog, #2453) that 429 from the datacenter
 * import route. Generalizes harvard-iiif-direct-batch.mjs to read the catalog
 * rows from scripts/output/harvard-phil-rows.json (written by _tmp_harvard_rows.mjs).
 *
 * Each row: { work_id, source_id (HOLLIS mms), url (…/URN-3:FHCL:<id>), cjk, en, author }.
 * Manifest: https://nrs.harvard.edu/urn-3:FHCL:<id>:MANIFEST (fetched residential).
 * Dedup on the IIIF manifest fingerprint. Lands HIDDEN with work_id attached.
 *
 * NOTE: Harvard image URLs (mps.lib.harvard.edu) render client-side (residential
 * browser → no 429), so the facsimile works immediately. Server-side R2 archiving
 * may 429 from the datacenter — a softer, retryable, later concern; the book is
 * acquired regardless.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/harvard-philosophy-direct.mjs --dry-run
 *   node scripts/import/harvard-philosophy-direct.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';

const COMMIT = process.argv.includes('--commit');
const ROWS = JSON.parse(readFileSync('scripts/output/harvard-phil-rows.json', 'utf8'));

function slugify(s, n = 70) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').substring(0, n).replace(/-$/, '');
}
async function uniqueSlug(db, base) {
  let s = base || 'harvard-chinese', i = 2;
  while (await db.collection('books').findOne({ slug: s }, { projection: { _id: 1 } })) s = `${base}-${i++}`;
  return s;
}
async function fetchManifest(fhcl) {
  const url = `https://nrs.harvard.edu/urn-3:FHCL:${fhcl}:MANIFEST`;
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      if (r.ok) return { url, manifest: await r.json() };
      if (r.status === 429) { await new Promise(x => setTimeout(x, 8000 * a)); continue; }
      return { url, err: r.status };
    } catch (e) { if (a === 4) return { url, err: e.message }; await new Promise(x => setTimeout(x, 5000 * a)); }
  }
  return { url, err: '429/exhausted' };
}
function pagesFrom(manifest) {
  const canvases = manifest.sequences?.[0]?.canvases || [];
  return canvases.map(c => {
    const res = c.images?.[0]?.resource; const svc = res?.service?.['@id'];
    const photo = res?.['@id'] || (svc ? `${svc}/full/full/0/default.jpg` : null);
    return photo ? { photo, thumbnail: svc ? `${svc}/full/200,/0/default.jpg` : photo } : null;
  }).filter(Boolean);
}

// build items: extract fhcl from url, group by work for vol suffixing
const items = ROWS.map(r => {
  const m = /FHCL:(\d+)/.exec(r.url || '');
  return m ? { fhcl: m[1], mms: r.source_id, work_id: r.work_id, cjk: r.cjk, en: r.en, author: r.author } : null;
}).filter(Boolean);
const byWork = {};
for (const it of items) (byWork[it.work_id] = byWork[it.work_id] || []).push(it);
for (const arr of Object.values(byWork)) { const multi = arr.length > 1; arr.forEach((it, i) => { it.vol = multi ? i + 1 : null; }); }

async function main() {
  console.log(`${COMMIT ? 'IMPORT' : 'DRY-RUN'} — ${items.length} Harvard-Yenching philosophy manifests (${Object.keys(byWork).length} works)\n`);
  const client = COMMIT ? new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 }) : null;
  if (client) await client.connect();
  const db = client?.db('bookstore');
  const results = [];
  for (const it of items) {
    const manifestUrl = `https://nrs.harvard.edu/urn-3:FHCL:${it.fhcl}:MANIFEST`;
    const fp = `iiif:${manifestUrl}`;
    if (db) {
      const ex = await db.collection('books').findOne({ $or: [{ source_fingerprint: fp }, { 'image_source.iiif_manifest': manifestUrl }] }, { projection: { slug: 1 } });
      if (ex) { console.log(`– ${it.fhcl} skip (held: ${ex.slug})`); results.push({ fhcl: it.fhcl, skip: true }); continue; }
    }
    const { manifest, err } = await fetchManifest(it.fhcl);
    if (err) { console.log(`✗ ${it.fhcl} ${it.cjk} manifest ${err}`); results.push({ fhcl: it.fhcl, err }); continue; }
    const pages = pagesFrom(manifest);
    if (!pages.length) { console.log(`✗ ${it.fhcl} ${it.cjk} no pages`); results.push({ fhcl: it.fhcl, err: 'no-pages' }); continue; }
    const label = typeof manifest.label === 'string' ? manifest.label : '';
    let title = it.cjk || label || it.fhcl;
    if (it.en && !title.includes(it.en)) title = `${title} — ${it.en}`;
    if (it.vol) title = `${title} (vol ${it.vol})`;
    const author = it.author || '未詳 (Unknown)';
    if (!COMMIT) { console.log(`· ${it.fhcl} ${String(pages.length).padStart(4)}p | ${title.slice(0, 50)}${it.vol ? ` [vol ${it.vol}]` : ''}`); results.push({ fhcl: it.fhcl, pages: pages.length }); await new Promise(x => setTimeout(x, 800)); continue; }
    const bookId = new ObjectId(), id = bookId.toHexString(), now = new Date();
    const slug = await uniqueSlug(db, slugify(it.en) || ('harvard-' + it.fhcl));
    const acquired = await insertBookIfNew(db, {
      _id: bookId, id, slug, title, display_title: it.cjk || label,
      author, language: 'Chinese', original_language: 'Chinese', published: '',
      categories: [], collections: ['east-asia', 'chinese-classics'], thumbnail: pages[0]?.thumbnail || '',
      pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0, content_type: 'book',
      work_id: it.work_id,
      dublin_core: { dc_identifier: [`IIIF:${manifest['@id'] || manifestUrl}`, `HOLLIS:${it.mms}`], dc_source: manifestUrl },
      image_source: {
        provider: 'harvard', provider_name: 'Harvard-Yenching Library',
        source_url: `https://curiosity.lib.harvard.edu/chinese-rare-books/catalog/49-${it.mms}`, iiif_manifest: manifestUrl,
        license: 'Harvard viewer terms (https://nrs.lib.harvard.edu/urn-3:hul.ois:hlviewerterms)',
        contributing_library: 'Harvard-Yenching Library (CURIOSity Chinese Rare Books)', attribution: 'Provided by Harvard University.', access_date: now,
      },
      notes: 'Chinese philosophy original from Harvard-Yenching, imported direct from IIIF manifest (residential fetch) to bypass datacenter 429. works-catalog #2453.',
      status: 'draft', hidden: true, visible: false, source_fingerprint: fp,
      normalized_title: slugify(it.cjk).replace(/-/g, ' '), normalized_author: slugify(author).replace(/-/g, ' '),
      created_at: now, updated_at: now,
    }, { importer: 'script:harvard-philosophy-direct', sourceIdentifier: it.fhcl, sourceUrl: manifestUrl });
    // The gate declined this candidate; the reason is a row in `dedup_skips`.
    if (!acquired.inserted) { console.log(`– ${it.fhcl} skip — ${acquired.message}`); results.push({ fhcl: it.fhcl, skip: true }); continue; }
    for (let s = 0; s < pages.length; s += 500) {
      const docs = pages.slice(s, s + 500).map((p, k) => { const pid = new ObjectId(); return makePageDoc({ _id: pid, id: pid.toHexString(), book_id: id, page_number: s + k + 1, photo: p.photo, thumbnail: p.thumbnail, photo_original: p.photo, created_at: now, updated_at: now }); });
      await db.collection('pages').insertMany(docs, { ordered: false });
    }
    console.log(`✓ ${it.fhcl} → ${slug} (${pages.length}p)`); results.push({ fhcl: it.fhcl, ok: true, pages: pages.length, slug });
    await new Promise(x => setTimeout(x, 1500));
  }
  if (client) await client.close();
  const ok = results.filter(r => r.ok), skip = results.filter(r => r.skip), errs = results.filter(r => r.err);
  console.log(`\n${COMMIT ? 'IMPORTED' : 'DRY'}: ok=${ok.length} skip=${skip.length} err=${errs.length} pages=${ok.reduce((s, r) => s + (r.pages || 0), 0)}`);
  if (errs.length) { writeFileSync('scripts/output/harvard-phil-fails.json', JSON.stringify(errs, null, 2)); console.log(`errors → scripts/output/harvard-phil-fails.json`); }
}
main().catch(e => { console.error(e); process.exit(1); });

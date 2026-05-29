#!/usr/bin/env node
/**
 * Enumerate Wikimedia Commons categories of Javanese manuscripts and emit an
 * image_only import manifest (PDF-mode, native pdfimages extraction).
 *
 * Polite by design: one PDF download per manuscript (via Special:FilePath) +
 * local native extraction, instead of tens of thousands of thumb.php renders.
 * Skips manuscripts already imported (matches on metadata.original_filename).
 *
 * Usage:
 *   set -a; source /Users/dereklomas/sourcelibrary/.env.production.local; set +a
 *   node scripts/import/build-commons-manifest.mjs \
 *     --categories "British_Library_manuscripts_from_Yogyakarta_Digitisation_Project,Manuscripts_in_Javanese_script" \
 *     --out scripts/import/commons-manuscripts.json
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { parseArgs } from 'util';

const { values: args } = parseArgs({ options: {
  categories: { type: 'string', default: 'British_Library_manuscripts_from_Yogyakarta_Digitisation_Project' },
  out: { type: 'string', default: 'scripts/import/commons-manuscripts.json' },
} });
const CATS = args.categories.split(',').map(s => s.trim()).filter(Boolean);
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'SourceLibrary-importer/1.0 (https://sourcelibrary.org; library ingest)';
const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

async function api(params) {
  const u = new URL(API);
  Object.entries({ format: 'json', formatversion: '2', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let a = 1; a <= 4; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (r.ok) return await r.json(); } catch {}
    if (a < 4) await new Promise(r => setTimeout(r, 1500 * a));
  }
  throw new Error('api failed: ' + u);
}

// Recurse one level into subcategories; collect File: members.
async function collectFiles(cat, depth = 1, seen = new Set()) {
  const files = [];
  let cont;
  do {
    const r = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:' + cat, cmlimit: '500', cmtype: 'file|subcat', ...(cont ? { cmcontinue: cont } : {}) });
    for (const m of r.query?.categorymembers || []) {
      if (m.ns === 6 && /\.pdf$/i.test(m.title)) { if (!seen.has(m.title)) { seen.add(m.title); files.push(m.title); } }
      else if (m.ns === 14 && depth > 0) { files.push(...await collectFiles(m.title.replace('Category:', ''), depth - 1, seen)); }
    }
    cont = r.continue?.cmcontinue;
  } while (cont);
  return files;
}

function parseShelfmark(fname) {
  const m = fname.match(/\b(Add(?:itional)?[._ ]*(?:MS[._ ]*)?\d+|MSS[._ ]*Jav[._ ]*\d+|Or[._ ]*\d+)\b/i);
  return m ? m[0].replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() : null;
}
function mapLicense(short, usage) {
  const s = (short || usage || '').toLowerCase();
  if (s.includes('cc0') || s.includes('zero')) return 'cc0';
  if (s.includes('public domain') || s === 'pd' || s.includes('publicdomain')) return 'public-domain';
  if (s.includes('cc-by-sa') || s.includes('cc by-sa')) return 'cc-by-sa-4.0';
  if (s.includes('cc-by') || s.includes('cc by')) return 'cc-by-4.0';
  return short || usage || 'unknown';
}

async function main() {
  const norm = s => (s || '').replace(/_/g, ' ').trim(); // Commons normalizes _<->space in titles
  let existing = new Set();
  try {
    const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }); await mongo.connect();
    existing = new Set((await mongo.db('bookstore').collection('books')
      .find({ 'metadata.original_filename': { $exists: true } }).project({ 'metadata.original_filename': 1 }).toArray())
      .map(b => norm(b.metadata.original_filename)));
    await mongo.close();
    console.log(`already-imported originals: ${existing.size}`);
  } catch (e) {
    console.log(`WARN: Mongo unavailable (${e.message.split('\n')[0]}); skip-set empty — importer dedupes by filename at import time`);
  }

  const titles = [];
  for (const cat of CATS) { const f = await collectFiles(cat); console.log(`  ${cat}: ${f.length} PDFs`); titles.push(...f); }
  const uniqueTitles = [...new Set(titles)];
  console.log(`total unique PDFs across categories: ${uniqueTitles.length}`);

  // WiLMa categories mix in administrative paperwork (owner-declaration letters,
  // guidelines, reports) — exclude those and trivially short non-manuscripts.
  const JUNK_RE = /declaration|owner declaration|letter of manuscript|guideline|manual|\breport\b|template|formulir|surat pernyataan|berita acara|laporan|cover sheet|metadata|katalog|catalogue|daftar/i;
  const manifest = []; const licenseCounts = {}; let totalPages = 0, skipped = 0, junk = 0;
  for (let i = 0; i < uniqueTitles.length; i += 40) {
    const batch = uniqueTitles.slice(i, i + 40);
    const r = await api({ action: 'query', titles: batch.join('|'), prop: 'imageinfo', iiprop: 'extmetadata|size|url' });
    for (const p of r.query?.pages || []) {
      const fname = p.title.replace(/^File:/, '');
      if (existing.has(norm(fname))) { skipped++; continue; }
      const ii = p.imageinfo?.[0]; if (!ii) continue;
      const pages = ii.pagecount || 0; if (!pages) continue;
      if (pages < 3 || JUNK_RE.test(fname)) { junk++; continue; }   // skip admin paperwork / non-manuscripts
      const em = ii.extmetadata || {};
      const license = mapLicense(em.LicenseShortName?.value, em.UsageTerms?.value);
      licenseCounts[license] = (licenseCounts[license] || 0) + 1;
      totalPages += pages;
      const shelf = parseShelfmark(fname);
      const cleanTitle = fname.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
      const isBL = /british[_ ]library|Add[._ ]|MSS[._ ]Jav/i.test(fname);
      manifest.push({
        fingerprint: 'commons:' + slugify(fname),
        slug: slugify(shelf ? `${cleanTitle}` : cleanTitle) || ('commons-' + p.pageid),
        title: cleanTitle.slice(0, 120),
        display_title: cleanTitle,
        author: 'Anonymous',
        language: 'Javanese',
        genre: 'Javanese manuscript',
        script: 'Javanese (aksara Jawa / Carakan), handwritten',
        provider: isBL ? 'british-library' : 'wikimedia_commons',
        provider_name: isBL ? 'British Library (via Wikimedia Commons)' : 'Wikimedia Commons',
        contributing_library: isBL ? 'British Library — Javanese Manuscripts from Yogyakarta Digitisation Project' : 'Wikimedia Commons (Wikisource Loves Manuscripts / community digitisation)',
        source_id: shelf || fname,
        shelfmark: shelf,
        source_url: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')),
        source_pdf: 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(fname),
        original_filename: fname,
        license,
        license_url: license === 'cc0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : license === 'public-domain' ? 'https://creativecommons.org/publicdomain/mark/1.0/' : `https://creativecommons.org/licenses/${license.replace('cc-','').replace('-4.0','')}/4.0/`,
        attribution: (em.Attribution?.value || em.Credit?.value || (isBL ? 'British Library' : 'Wikimedia Commons')).replace(/<[^>]+>/g, '').slice(0, 200),
        collections: ['javanese-kraton'], categories: ['manuscripts'],
        dc_type: 'Manuscript', dc_language: 'jav',
        extract: 'pdfimages', archive_master: false, image_only: true,
        ocr_deferred_reason: 'aksara Jawa OCR unsolved on Gemini (recitation loops) — image-only until trustworthy OCR. See issue #2144.',
        source_pdf_pages: pages,
      });
    }
  }
  // sort smallest-first so the bulk job lands many complete manuscripts early
  manifest.sort((a, b) => a.source_pdf_pages - b.source_pdf_pages);
  writeFileSync(args.out, JSON.stringify(manifest, null, 2));
  console.log(`\n=== manifest: ${manifest.length} manuscripts, ${totalPages.toLocaleString()} total pages (skipped ${skipped} already-imported, ${junk} non-manuscript/admin)`);
  console.log('licenses:', JSON.stringify(licenseCounts));
  console.log('page-count distribution:', manifest.map(m => m.source_pdf_pages).filter((_,i)=>i%Math.ceil(manifest.length/10||1)===0));
  console.log('wrote', args.out);
}
main().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });

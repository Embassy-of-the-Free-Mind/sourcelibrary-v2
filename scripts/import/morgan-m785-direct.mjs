#!/usr/bin/env node
/**
 * One-off import for Morgan Library MS M.785: Astrological treatises
 * of Abū Maʻshar (Albumazar) in the Latin abridgement of Georgius
 * Zothorus Zaparus Fendulus. Bruges, in or before 1403. 52 folios,
 * vellum, 254 × 175 mm, textura script. 76 pages of zodiacal and
 * astrological miniatures.
 *
 * The underlying manuscript and its illuminations are public domain
 * (created 1403). The Morgan's photographic reproductions are also
 * public domain in the US under Bridgeman v. Corel (S.D.N.Y. 1999)
 * and in the EU under Article 14 of the 2019 Copyright Directive,
 * as faithful 2D reproductions of public-domain works.
 *
 * The Morgan exposes 120 master JPEGs (covers + endleaves + 52 folios
 * recto and verso + back endleaves + back covers) at 1736 × 2500 px,
 * roughly 250 dpi at the folio's physical size. Captured with a Phase
 * One iXG 100MP rig per the EXIF.
 *
 * No IIIF manifest is available (probed www.themorgan.org/sites/default/files/iiif/144038/manifest.json,
 * ica.themorgan.org/manuscript/manifest/144038, Biblissima — all 404).
 *
 * Image URL pattern:
 *   full:  https://www.themorgan.org/sites/default/files/facsimile/144038/144038v_NNNN.jpg
 *   thumb: https://www.themorgan.org/sites/default/files/styles/largest_800_x_800_/public/facsimile/144038/144038v_NNNN.jpg
 *   where NNNN = viewer-page-number + 25, range 0026–0145 for pages 1–120.
 *
 * Import imports as visible: false / hidden: true / status: 'draft' so
 * the book is in Mongo and reachable on a preview build, but is not on
 * the public site or in /libraries/morgan until promoted. The follow-up
 * is to send Morgan a heads-up notification (see morgan-m785-request.md
 * at repo root for the draft) and flip to visible: true on response or
 * after a reasonable wait.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/morgan-m785-direct.mjs --dry-run   # print URLs, no DB writes
 *   node scripts/import/morgan-m785-direct.mjs             # real import
 */

import { MongoClient, ObjectId } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

const MORGAN_ID = '144038';                      // Morgan's collection record id
const ACCESSION = 'MS M.785';
const PAGE_COUNT = 120;                          // total leaves shown in the viewer
const IMAGE_OFFSET = 25;                         // image-filename index = viewer-page + 25

function imageFileName(viewerPage) {
  const idx = viewerPage + IMAGE_OFFSET;
  return `144038v_${String(idx).padStart(4, '0')}.jpg`;
}

function fullImageUrl(viewerPage) {
  return `https://www.themorgan.org/sites/default/files/facsimile/${MORGAN_ID}/${imageFileName(viewerPage)}`;
}

function thumbImageUrl(viewerPage) {
  return `https://www.themorgan.org/sites/default/files/styles/largest_800_x_800_/public/facsimile/${MORGAN_ID}/${imageFileName(viewerPage)}`;
}

function slugify(text, maxLen = 60) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-|-$/g, '')
    .substring(0, maxLen);
}

async function generateUniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function headCheck(url) {
  const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return {
    contentType: r.headers.get('content-type'),
    contentLength: r.headers.get('content-length'),
  };
}

async function main() {
  // Verify three sample pages before any DB writes. Catches a broken URL
  // pattern (e.g. Morgan changes their offset) before we touch Mongo.
  console.log('Verifying Morgan image URLs (HEAD x3)...');
  for (const vp of [1, 11, 120]) {
    const url = fullImageUrl(vp);
    const meta = await headCheck(url);
    console.log(`  viewer page ${vp.toString().padStart(3)} → ${imageFileName(vp)}  (${meta.contentType}, ${meta.contentLength} bytes)`);
  }

  if (DRY_RUN) {
    console.log('\nDRY-RUN sample URLs:');
    console.log('  page   1 (front cover):    ' + fullImageUrl(1));
    console.log('  page  11 (fol. 1r):        ' + fullImageUrl(11));
    console.log('  page  60 (fol. 25r):       ' + fullImageUrl(60));
    console.log('  page 120 (back cover):     ' + fullImageUrl(120));
    console.log(`\nWould insert 1 book + ${PAGE_COUNT} pages.`);
    return;
  }

  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI. Did you `set -a; source .env.production.local; set +a`?');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  // Duplicate guard — synthetic source_fingerprint, plus a morgan_accession
  // identifier so future Morgan imports can also dedupe on shelfmark.
  const fingerprint = `morgan:m785`;
  const existing = await db.collection('books').findOne(
    {
      $or: [
        { source_fingerprint: fingerprint },
        { morgan_accession: ACCESSION },
        { 'image_source.identifier': ACCESSION, 'image_source.provider': 'morgan' },
      ],
    },
    { projection: { _id: 1, slug: 1 } }
  );
  if (existing) {
    console.log(`Skipping — book already exists: ${existing._id} (slug=${existing.slug})`);
    await client.close();
    return;
  }

  const slug = await generateUniqueSlug(db, slugify('morgan-ms-m785-astrological-treatises-abu-mashar'));
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();

  const accessDate = new Date();

  const bookDoc = {
    _id: bookId,
    id: bookIdStr,
    slug,
    tenant_id: 'default',
    title: 'Astrological treatises (MS M.785)',
    display_title: 'Astrological Treatises of Abū Maʻshar',
    author: "Abū Maʻshar al-Balkhī (Albumazar); Latin abridgement by Georgius Zothorus Zaparus Fendulus",
    language: 'Latin',
    original_language: 'Latin',
    published: '1403',
    published_place: 'Bruges, Belgium',
    categories: ['astrology', 'hermetica', 'medieval-manuscripts', 'illuminated-manuscripts'],
    ia_identifier: null,
    morgan_accession: ACCESSION,
    work_id: 'abu-mashar-introductorium-maius-fendulus',
    thumbnail: thumbImageUrl(11),  // fol. 1r — better hero than the binding
    pages_count: PAGE_COUNT,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: 0,
    dublin_core: {
      dc_identifier: [`MORGAN:${ACCESSION}`],
      dc_source: `https://www.themorgan.org/manuscript/${MORGAN_ID}`,
    },
    image_source: {
      provider: 'morgan',
      provider_name: 'The Morgan Library & Museum',
      source_url: `https://www.themorgan.org/manuscript/${MORGAN_ID}`,
      identifier: ACCESSION,
      // The underlying manuscript is public domain (created 1403); the
      // Morgan's faithful photographic reproductions are also PD under
      // Bridgeman v. Corel (US) / Article 14 of the 2019 EU Copyright
      // Directive. The Morgan's stated I&R policy claims a restriction
      // that does not match the legal picture, but we credit them
      // prominently and link back to their record as a matter of practice.
      license: 'publicdomain',
      attribution: `New York, The Morgan Library & Museum, ${ACCESSION}. Purchased in 1935.`,
      contributing_library: 'The Morgan Library & Museum',
      shelfmark: ACCESSION,
      iiif_manifest: null,
      access_date: accessDate,
      notes: 'Master JPEGs at 1736 × 2500 px sourced directly from themorgan.org (no IIIF available). Higher-resolution masters may be obtained via Morgan Imaging & Rights — see .claude/handoffs/2026-05-26-morgan-m785-import-pause.md for the contact draft.',
    },
    notes: [
      'One of five extant manuscripts of the Fendulus Latin abridgement of Abū Maʻshar\'s Kitāb al-mudkhal al-kabīr (Greater Introduction to Astrology).',
      'Direct prototype: British Museum Sloan MS 3983 (Franco-Flemish, ca. 1350). Earliest copy: Paris BnF MS Lat. 7330 (ca. 1240).',
      'Standard layout: per zodiac sign, one text page + one sign illustration + three folios of three registers each illustrating the decans. Followed by seven planets shown in their houses, counter-houses, exaltation, and dejection.',
      '76 pages of miniatures total. Script: textura. Binding: 20th-century blue half-leather by Marguerite Duprez Lahey.',
      'Provenance: Presented to Jean de France, duc de Berry, on 7 June 1403 by Lubertus Hautschild, Abbot of S. Barthélemi (Eeckhout, Bruges). Inscription fol. 51v: "ce livre est au duc duc de Berry JEHAN". Later: baron de Joursanvault (1748–1792, then son 1787–1841); his sale Paris 1838 (Techener); Henri Bandot of Dijon; M. Court of Dijon (1907); purchased from Jacques Rosenthal, l\'Art Ancien (Zurich), January 1935.',
    ].join('\n\n'),
    status: 'draft',
    hidden: true,
    visible: false,
    source_fingerprint: fingerprint,
    normalized_title: 'astrological treatises ms m 785',
    normalized_author: 'abu mashar al balkhi georgius zothorus zaparus fendulus',
    created_at: new Date(),
    updated_at: new Date(),
  };

  await db.collection('books').insertOne(bookDoc);
  console.log(`Inserted book ${bookIdStr} slug=${slug}`);

  // Page labels (the Morgan exposes per-leaf labels in their viewer listing).
  // Pages 1-10: front cover, inside front cover, three pairs of endleaves, title page, title verso.
  // Pages 11-112: fol. 1r through fol. 51v (52 folios r/v interleaved).
  // Pages 113-118: three rear endleaves r/v.
  // Pages 119-120: inside back cover, back cover.
  function pageLabel(viewerPage) {
    if (viewerPage === 1) return 'front cover';
    if (viewerPage === 2) return 'inside front cover';
    if (viewerPage >= 3 && viewerPage <= 8) {
      const endleafNum = Math.ceil((viewerPage - 2) / 2);
      const recto = (viewerPage - 2) % 2 === 1;
      return `front endleaf ${['i','ii','iii'][endleafNum - 1]} ${recto ? 'recto' : 'verso'}`;
    }
    if (viewerPage === 9) return 'title page (iv recto)';
    if (viewerPage === 10) return 'title page verso (iv verso)';
    if (viewerPage >= 11 && viewerPage <= 112) {
      const folio = Math.ceil((viewerPage - 10) / 2);
      const recto = (viewerPage - 10) % 2 === 1;
      return `fol. ${folio}${recto ? 'r' : 'v'}`;
    }
    if (viewerPage >= 113 && viewerPage <= 118) {
      const endleafNum = Math.ceil((viewerPage - 112) / 2);
      const recto = (viewerPage - 112) % 2 === 1;
      const foliated = endleafNum === 1 ? ' (foliated 52)' : endleafNum === 2 ? ' (foliated 53)' : ' (foliated 54)';
      return `rear endleaf ${endleafNum} ${recto ? 'recto' + foliated : 'verso'}`;
    }
    if (viewerPage === 119) return 'inside back cover';
    if (viewerPage === 120) return 'back cover';
    return `page ${viewerPage}`;
  }

  const CHUNK = 500;
  for (let start = 0; start < PAGE_COUNT; start += CHUNK) {
    const pageDocs = [];
    for (let p = start; p < Math.min(start + CHUNK, PAGE_COUNT); p++) {
      const viewerPage = p + 1;
      const pageId = new ObjectId();
      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        tenant_id: 'default',
        book_id: bookIdStr,
        page_number: viewerPage,
        label: pageLabel(viewerPage),
        photo: fullImageUrl(viewerPage),
        thumbnail: thumbImageUrl(viewerPage),
        photo_original: fullImageUrl(viewerPage),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
    await db.collection('pages').insertMany(pageDocs, { ordered: false });
    console.log(`Inserted pages ${start + 1}-${start + pageDocs.length}`);
  }

  await client.close();
  console.log(`\nDone. Book id=${bookIdStr}, slug=${slug}, ${PAGE_COUNT} pages.`);
  console.log(`Preview (hidden): /book/${slug}`);
  console.log(`Audit query: curl -s "https://sourcelibrary.org/api/books?include_hidden=1&include_unindexed=1" | jq '.[] | select(.morgan_accession=="${ACCESSION}")'`);
}

main().catch(e => { console.error(e); process.exit(1); });

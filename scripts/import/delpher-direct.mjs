#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/ia-manifest-direct.mjs (manifest → makeBookDoc → insertBookIfNew → hold →
 * pages; reused for the shape) and scripts/import/import-pdf-books.mjs (rasterises a PDF and uploads
 * page variants to R2 itself; its pdftoppm step is reused for the Google collection below, but it
 * inserts with a bare insertOne and unguarded keys). Neither reads a KB/Delpher object: Delpher has
 * no IIIF manifest, its page JP2s do not render in browsers, and its hosts are on neither image
 * allowlist (invariants/image-host-allowlists.md), so the pages cannot be stored as external URLs
 * for the archiver the way IA pages are. No script on main mentions delpher or resolver.kb.nl
 * (git grep, 2026-10-06). First written in job drebbel-creative-5811 (#5811), which imported Jaeger
 * 1922 with it; this is that script plus per-item rights and the Google collection (#5906).
 *
 * delpher-direct — import Delpher (KB, Koninklijke Bibliotheek) books, pages copied to R2.
 *
 * Delpher serves books two ways, and a manifest entry names one of them:
 *
 *   "urn"  — KB-hosted scans (collection `boeken`, e.g. MMKB02:100007776):
 *     Object list:  https://resolver.kb.nl/resolve?urn=<URN>:mpeg21   (DIDL: one Item per page)
 *     Page image:   https://imageviewer.kb.nl/ImagingService/imagingService?id=<URN>:<NNNNN>:image
 *                   (JPEG at the JP2's native size — the largest the KB serves publicly)
 *     Both hosts answer a datacenter IP (Hetzner, 2026-10-05/06).
 *
 *   "gbid" — the Google collection (collection `boeken1`, a Google Books volume id). Delpher only
 *     embeds Google's viewer; the one file it offers is the signed "Download pdf" link on its own
 *     object page, which this script reads and follows, then rasterises with pdftoppm (poppler).
 *     Google answers a datacenter IP with "Sorry... automated queries" (403; measured from Hetzner
 *     2026-10-06), so RUN THESE FROM A RESIDENTIAL CONNECTION, or download the PDF in a browser and
 *     name it in the entry as "pdf": "<local path>". Do not retry around the refusal.
 *     NOT RUN END TO END: the box this was written on has no poppler and is refused by Google, so
 *     the pdftoppm → R2 leg is untested. Do the first laptop run on one book and look at its pages.
 *
 * Rights are per item and required: an entry without "license" and "rights" is refused. Delpher's
 * own statement for the object is read from its page and stored verbatim beside ours
 * (image_source.delpher_terms); an object Delpher marks "Auteursrechtelijk beschermd" is refused.
 * "rights" is OUR determination — screen the imprint and the apparatus, not the author's dates
 * (import-workflow.md §3b). Delpher's wording, for reference:
 *   KB scans:          per object — out of copyright ("Geen auteursrecht"), unknown ("Auteursrecht
 *                      onbekend", KB has not determined: check it yourself), or protected.
 *   Google collection: "Geen auteursrecht, alleen niet-commercieel gebruik" — copyright-free, but
 *                      commercial reuse is barred by KB's agreement with Google
 *                      (license: https://rightsstatements.org/vocab/NoC-NC/1.0/).
 *
 * Each page is written to the archiver's own R2 layout, so the book arrives already archived:
 *   archived/<bookId>/<n>.jpg (master as served / as rasterised), pages/<bookId>/<NNNN>.jpg
 *   (display ≤1200px), pages/<bookId>/<NNNN>-thumb.jpg; the Google PDF itself goes to
 *   masters/<bookId>/source.pdf. Every key passes assertBookScopedKey (#3362).
 *
 * Manifest JSON: { "campaign", "collections": [], "BOOKS": [ { "urn" | "gbid", "title", "author",
 *   "year", "lang", "license", "rights", "place"?, "publisher"?, "shelfmark"?, "note"?, "pdf"?,
 *   "dpi"?, "library"?, "identity_from"? } ] }  — identity from the title page; if it was taken from
 *   the catalogue instead, say so with "identity_from": "catalog" and check it at the first run.
 * Lands HIDDEN; --hold <reason> parks it (release with hold-pipeline-books.mjs --to archive_complete).
 * Without --commit nothing is written and Google is not contacted.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/import/delpher-direct.mjs --manifest <x>.json [--commit] [--hold <reason>]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { recountBook } from '../lib/page-counts.mjs';

const COMMIT = process.argv.includes('--commit');
const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const MANIFEST = argAfter('--manifest');
const HOLD_REASON = argAfter('--hold');
if (!MANIFEST) { console.error('Required: --manifest <json>'); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const IMPORTER = manifest.campaign || path.basename(MANIFEST, '.json');
const COLLECTIONS = manifest.collections || [];
const UA = 'SourceLibrary acquisition (contact: derek@sourcelibrary.org)';
const KB = 'Koninklijke Bibliotheek';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const r2 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { tries = 4, headers = {} } = {}) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(90000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (t >= tries) throw new Error(`HTTP ${r.status} ${url}`);
    } catch (e) { if (t >= tries) throw e; }
    await sleep(2000 * t);
  }
}
async function put(key, bookId, body, contentType = 'image/jpeg') {
  assertBookScopedKey(key, bookId, 'delpher-direct');
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
  return `${R2_PUBLIC}/${key}`;
}
const slugify = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/, '');

/** Delpher's own "Gebruiksvoorwaarden" line for an object, verbatim. The page also carries the
 *  word in its site menu, so take the occurrence that runs straight into "Lees verder". */
function delpherTerms(html) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&shy;|­/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  return text.match(/Gebruiksvoorwaarden ((?:(?!Gebruiksvoorwaarden).)+?) Lees verder/)?.[1].trim() || null;
}

/** KB-hosted object: pages listed by the DIDL, each fetched from the imaging service. */
async function kbSource(b) {
  const didlUrl = `https://resolver.kb.nl/resolve?urn=${b.urn}:mpeg21`;
  const didl = (await get(didlUrl)).toString('utf8');
  const seqs = [...new Set([...didl.matchAll(new RegExp(`${b.urn.replace(':', '\\:')}:(\\d{5}):image"`, 'g'))].map((m) => m[1]))].sort();
  const pdfMd5 = didl.match(/:pdf"[\s\S]*?dc:type="md5">([0-9A-F]+)</)?.[1] || null;
  const imgUrl = (k) => `https://imageviewer.kb.nl/ImagingService/imagingService?id=${b.urn}:${seqs[k]}:image`;
  const details = JSON.parse((await get(`https://www.delpher.nl/nl/pres/view/multi?coll=boeken&identifier=${encodeURIComponent(b.urn)}&actions%5B%5D=details`,
    { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).toString('utf8')).detailsAction || '';
  return { identifier: b.urn, pageCount: seqs.length, terms: delpherTerms(details),
    delpherUrl: `https://www.delpher.nl/nl/boeken/view?coll=boeken&identifier=${b.urn}`,
    imageSource: { didl_url: didlUrl, ...(pdfMd5 ? { pdf_md5: pdfMd5 } : {}) }, archiveSource: 'delpher_imaging_service',
    prepare: async () => {}, master: (k) => get(imgUrl(k)), original: (k) => imgUrl(k), pause: 250, cleanup: () => {} };
}

/** Google-collection object: the PDF behind Delpher's own download link, one image per PDF page. */
async function googleSource(b) {
  const delpherUrl = `https://www.delpher.nl/nl/boeken1/gview?coll=boeken1&identifier=${b.gbid}`;
  const page = (await get(delpherUrl)).toString('utf8');
  const pdfUrl = page.match(/https?:\/\/books\.google\.[a-z.]+\/books\/download\/[^"'\s<]+output=pdf[^"'\s<]*/)?.[0].replace(/&amp;/g, '&').replace(/^http:/, 'https:') || null;
  let tmp = null, files = [], pdf = null;
  return { identifier: b.gbid, pageCount: null, terms: delpherTerms(page), delpherUrl, pdfUrl,
    imageSource: { digitized_by: 'Google', google_books_url: `https://books.google.com/books?id=${b.gbid}` }, archiveSource: 'delpher_google_pdf',
    // Runs BEFORE the book is inserted: a refused download must not leave a book with no pages.
    prepare: async () => {
      try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); } catch { throw new Error('pdftoppm (poppler) is not installed — the Google collection needs it'); }
      if (b.pdf) pdf = fs.readFileSync(b.pdf);
      else {
        if (!pdfUrl) throw new Error(`no "Download pdf" link on ${delpherUrl}`);
        // One attempt, no retry: a refusal here is Google rationing the IP, and retrying makes it worse.
        const r = await fetch(pdfUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) });
        pdf = Buffer.from(await r.arrayBuffer());
        if (!r.ok || pdf.subarray(0, 4).toString() !== '%PDF') throw new Error(`Google refused the PDF (HTTP ${r.status}) — run from a residential connection, or download it in a browser and set "pdf" in the manifest`);
      }
      if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error(`${b.pdf} is not a PDF`);
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delpher-'));
      fs.writeFileSync(path.join(tmp, 'source.pdf'), pdf);
      execFileSync('pdftoppm', ['-r', String(b.dpi || 300), '-jpeg', '-jpegopt', 'quality=90', path.join(tmp, 'source.pdf'), path.join(tmp, 'page')], { maxBuffer: 1024 * 1024 * 64 });
      files = fs.readdirSync(tmp).filter((f) => /^page.*\.jpg$/.test(f)).sort();
      if (!files.length) throw new Error('pdftoppm produced no pages');
      return files.length;
    },
    sourcePdf: () => pdf, master: async (k) => fs.readFileSync(path.join(tmp, files[k])), original: () => null, pause: 0,
    cleanup: () => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); } };
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
try {
  for (const b of manifest.BOOKS) {
    const label = b.urn || b.gbid;
    if (!b.urn === !b.gbid) { console.log(`${label}: FAIL give exactly one of "urn" / "gbid"`); continue; }
    if (!b.license || !b.rights) { console.log(`${label}: FAIL no "license" + "rights" in the manifest — rights are recorded per item`); continue; }
    const src = b.urn ? await kbSource(b) : await googleSource(b);
    try {
      console.log(`${label}: ${src.pageCount ?? '?'} pages · "${b.title.slice(0, 60)}"`);
      console.log(`  Delpher terms: ${src.terms || '(not found on the object page)'}`);
      if (/auteursrechtelijk beschermd/i.test(src.terms || '')) { console.log('  FAIL Delpher marks this object as in copyright — not imported'); continue; }
      if (b.urn && !src.pageCount) { console.log('  FAIL no pages'); continue; }
      const bookId = new ObjectId(), now = new Date();
      let slug = slugify(`${b.title} ${b.author}`), i = 2;
      while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${slugify(`${b.title} ${b.author}`)}-${i++}`;
      const fields = (pages) => ({
        _id: bookId, id: bookId.toHexString(), slug, title: b.title, author: b.author,
        language: b.lang, languages: [b.lang], field_provenance: { language: 'caller', languages: 'caller', title: b.identity_from || 'title_page', author: b.identity_from || 'title_page', published: b.identity_from || 'title_page' },
        published: String(b.year), year: b.year,
        ...(b.place ? { place_published: b.place } : {}), ...(b.publisher ? { publisher: b.publisher } : {}),
        pages_count: pages, pages_ocr: 0, pages_translated: 0, content_type: 'book',
        ...(b.note ? { curator_notes: b.note } : {}), acquisition_campaign: IMPORTER,
        ...(COLLECTIONS.length ? { collections: COLLECTIONS } : {}),
        contributing_library: b.library || KB,
        // The Google URL is here so the gate also knows the scan as `gbooks:<id>` (source-fingerprints.mjs).
        dublin_core: { dc_identifier: [`KB:${src.identifier}`, ...(b.gbid ? [src.imageSource.google_books_url] : [])], dc_source: src.delpherUrl },
        image_source: { provider: 'delpher', provider_name: `Delpher (${KB})`, source_url: src.delpherUrl,
          identifier: src.identifier, license: b.license, rights: b.rights, delpher_terms: src.terms,
          contributing_library: b.library || KB, ...(b.shelfmark ? { shelfmark: b.shelfmark } : {}),
          ...src.imageSource, access_date: now },
        status: 'draft', hidden: true, visible: false, created_at: now, updated_at: now,
      });
      if (!COMMIT) {
        makeBookDoc(fields(src.pageCount || 0));
        console.log(`  DRY ok → slug ${slug}${b.gbid ? ` · pdf ${b.pdf || src.pdfUrl || 'NO DOWNLOAD LINK'}` : ''}`);
        continue;
      }
      const pages = (await src.prepare()) ?? src.pageCount;
      const res = await insertBookIfNew(db, fields(pages), { importer: IMPORTER, sourceIdentifier: src.identifier, sourceUrl: src.delpherUrl });
      if (!res.inserted) { console.log(`  GATE ${res.reason}: ${res.message}`); continue; }
      const id = res.bookId;
      if (HOLD_REASON) console.log('  hold:', (await holdBook(db, id, { reason: HOLD_REASON, source: IMPORTER,
        release: `Held at import by delpher-direct.mjs; pages are already on R2 — release with --to archive_complete.` })).outcome);
      if (src.sourcePdf) await put(`masters/${id}/source.pdf`, id, src.sourcePdf(), 'application/pdf');
      const docs = [];
      for (let k = 0; k < pages; k++) {
        const n = k + 1, nn = String(n).padStart(4, '0');
        const master = await src.master(k);
        const meta = await sharp(master).metadata();
        const display = meta.width > 1200 ? await sharp(master).resize(1200).jpeg({ quality: 80 }).toBuffer() : master;
        const thumb = await sharp(master).resize(150).jpeg({ quality: 60 }).toBuffer();
        const [a, d, t] = await Promise.all([put(`archived/${id}/${n}.jpg`, id, master), put(`pages/${id}/${nn}.jpg`, id, display), put(`pages/${id}/${nn}-thumb.jpg`, id, thumb)]);
        const pid = new ObjectId();
        docs.push(makePageDoc({ _id: pid, id: pid.toHexString(), book_id: id, page_number: n,
          photo: d, photo_original: src.original(k) || a, thumbnail: t, archived_photo: a, display_photo: d, thumbnail_blob: t,
          image_width: meta.width, image_height: meta.height,
          archive_metadata: { archived_at: new Date(), bytes: master.length, source: src.archiveSource },
          created_at: now, updated_at: now }));
        if (n % 25 === 0) console.log(`  ${n}/${pages}`);
        if (src.pause) await sleep(src.pause);
      }
      await db.collection('pages').insertMany(docs, { ordered: false });
      await db.collection('books').updateOne({ id }, { $set: { thumbnail: docs[0].thumbnail, updated_at: new Date() } });
      await recountBook(db, id, { reason: 'delpher-direct' });
      console.log(`  OK → ${id} (${docs.length} pages on R2) /book/${slug}`);
    } catch (e) {
      console.log(`  FAIL ${e.message}`);
    } finally { src.cleanup(); }
  }
} finally { await client.close(); }

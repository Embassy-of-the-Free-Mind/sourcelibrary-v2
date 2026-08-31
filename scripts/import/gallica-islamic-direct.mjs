#!/usr/bin/env node
/**
 * Gallica Graeco-Arabic wave — DIRECT INSERT, no Vercel function involved.
 *
 * WHY THIS REPLACES gallica-islamic-wave.mjs. That script POSTs to
 * /api/import/gallica, so every book costs a Vercel function invocation that
 * holds a 300-page manifest for 30-90 seconds. Vercel is ~$3,069/mo and
 * invocations are a measured line item there (the crawler-traffic entry in
 * costs/infrastructure-costs.md is ~$1,000/mo of exactly this). A 356-book wave
 * is several hundred long-running invocations bought for nothing: the work is
 * fetch-a-manifest and write-Mongo, and neither needs to happen inside a
 * serverless function.
 *
 * This is the documented `*-direct.mjs` pattern (see harvard-wuzhen-direct.mjs
 * and import-workflow.md step 4). It was written for the datacenter-429 problem;
 * it solves the cost problem identically, and both reasons apply to Gallica.
 *
 * Run it on Hetzner: its own IP (not Derek's home connection, which was
 * carrying these sweeps), always-on for a slow overnight pass, and zero Vercel
 * cost.
 *
 * ACQUISITION GATE. Uses insertBookIfNew() — the direct-insert importers'
 * equivalent of the route's dedupe gate. Skip-and-record is the default, so a
 * declined book leaves a row in `dedup_skips` rather than vanishing.
 *
 * THROTTLE. Gallica 429s hard: an import at 6s spacing lost ~2/3 of its calls.
 * Default here is 20s. Slower is the point — a run that finishes is worth more
 * than one that finishes fast and imports nothing.
 *
 * Usage (on Hetzner):
 *   node --env-file=.env.production.local scripts/import/gallica-islamic-direct.mjs --limit 5
 *   node --env-file=.env.production.local scripts/import/gallica-islamic-direct.mjs --limit 400 --commit
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';

const COMMIT = process.argv.includes('--commit');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '5'), 10);
const LIST = arg('--list', './gallica-islamic-candidates.json');
const DELAY_MS = parseInt(arg('--delay', '20000'), 10);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

// A Greek author in the catalogue title means the WORK is Greek even though the
// manuscript is Arabic. That distinction is the whole point of the wave, and
// language-fields.md requires keeping it.
const GREEK_WORK = /Ptolém|Almageste|Euclide|Hippocrate|Galien|Dioscoride|Platon|Aristote|Porphyre|Proclus|Plotin|Archimède|Ménélaüs|Apollonius|Theologia|Théologia|Isagoge|Organon/i;

const slugify = (t, max = 70) => String(t).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '');

async function uniqueSlug(db, base) {
  let slug = base || 'arabic-manuscript', i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`;
  return slug;
}

/** Gallica IIIF v2. Returns page image URLs, or null if the manifest is unusable. */
async function fetchManifest(ark) {
  const url = `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/manifest.json`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const m = await r.json();
  const canvases = m.sequences?.[0]?.canvases || m.items || [];
  const pages = canvases.map((c) => {
    // v2 shape first (Gallica is v2), then v3.
    const res = c.images?.[0]?.resource || c.items?.[0]?.items?.[0]?.body;
    const svc = res?.service?.['@id'] || res?.service?.[0]?.id || res?.service?.id;
    const photo = res?.['@id'] || res?.id || (svc ? `${svc}/full/full/0/default.jpg` : null);
    const thumbnail = svc ? `${svc}/full/200,/0/default.jpg` : photo;
    return photo ? { photo, thumbnail } : null;
  }).filter(Boolean);
  return { manifest: m, pages, url };
}

async function main() {
  const raw = JSON.parse(readFileSync(LIST, 'utf8'));
  const all = (raw.keep || raw.candidates || raw)
    .slice()
    .sort((a, b) => (GREEK_WORK.test(b.title || '') ? 1 : 0) - (GREEK_WORK.test(a.title || '') ? 1 : 0));
  const batch = all.slice(0, LIMIT);
  console.log(`list ${all.length}; processing ${batch.length}${COMMIT ? '' : ' (DRY RUN)'} at ${DELAY_MS / 1000}s spacing`);
  console.log(`Greek-work titles in list: ${all.filter(r => GREEK_WORK.test(r.title || '')).length}`);

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  let ok = 0, skipped = 0, failed = 0, totalPages = 0;
  for (const [i, r] of batch.entries()) {
    const isGreek = GREEK_WORK.test(r.title || '');
    const title = String(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 300) || `Arabic manuscript ${r.ark}`;

    let res;
    try { res = await fetchManifest(r.ark); }
    catch (e) { failed++; console.error(`  FAIL ${r.ark}: ${e.name}`); await new Promise(s => setTimeout(s, DELAY_MS)); continue; }
    if (res.error || !res.pages?.length) {
      failed++; console.error(`  FAIL ${r.ark}: ${res.error || 'no pages in manifest'}`);
      await new Promise(s => setTimeout(s, DELAY_MS)); continue;
    }

    if (!COMMIT) {
      console.log(`  [dry] ${r.ark} ${String(res.pages.length).padStart(4)}pp ${isGreek ? '[GREEK]' : '       '} ${title.slice(0, 62)}`);
      totalPages += res.pages.length;
      await new Promise(s => setTimeout(s, DELAY_MS)); continue;
    }

    const now = new Date();
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await uniqueSlug(db, slugify(title));
    const manifestUrl = res.url;

    const acquired = await insertBookIfNew(db, {
      _id: bookId, id: bookIdStr, slug,
      title, author: 'Unknown',
      language: 'Arabic',
      // The MANUSCRIPT is Arabic; the WORK may be Greek. Conflating them would
      // file the Almagest as an Arabic composition and sever the work-graph
      // link to our Greek and Latin copies.
      ...(isGreek ? { original_language: 'Greek' } : {}),
      published: r.date || 'Unknown',
      categories: ['islamic-science', ...(isGreek ? ['graeco-arabic-transmission'] : [])],
      collections: [],
      thumbnail: res.pages[0].thumbnail || '',
      pages_count: res.pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
      content_type: 'book',
      dublin_core: { dc_identifier: [`IIIF:${manifestUrl}`, `ark:/12148/${r.ark}`], dc_source: manifestUrl },
      image_source: {
        provider: 'gallica', provider_name: 'Bibliothèque nationale de France (Gallica)',
        source_url: `https://gallica.bnf.fr/ark:/12148/${r.ark}`,
        iiif_manifest: manifestUrl,
        license: 'Public domain / BnF conditions of use',
        contributing_library: 'Bibliothèque nationale de France, Département des Manuscrits',
        access_date: now,
      },
      status: 'draft', hidden: true, visible: false,
      source_fingerprint: `gallica:${r.ark}`,
      normalized_title: slugify(title).replace(/-/g, ' '),
      normalized_author: 'unknown',
      created_at: now, updated_at: now,
    }, { importer: 'script:gallica-islamic-direct', sourceIdentifier: r.ark, sourceUrl: manifestUrl });

    if (!acquired.inserted) {
      skipped++; console.log(`  SKIP ${r.ark}: ${acquired.message}`);
      await new Promise(s => setTimeout(s, DELAY_MS)); continue;
    }

    const CHUNK = 500;
    for (let s = 0; s < res.pages.length; s += CHUNK) {
      const docs = res.pages.slice(s, s + CHUNK).map((p, k) => {
        const pid = new ObjectId();
        return makePageDoc({
          _id: pid, id: pid.toHexString(), book_id: bookIdStr,
          page_number: s + k + 1, photo: p.photo, thumbnail: p.thumbnail, photo_original: p.photo,
          created_at: now, updated_at: now,
        });
      });
      await db.collection('pages').insertMany(docs, { ordered: false });
    }

    ok++; totalPages += res.pages.length;
    console.log(`  OK ${String(i + 1).padStart(3)}/${batch.length} ${r.ark} ${String(res.pages.length).padStart(4)}pp ${isGreek ? '[GREEK]' : '       '} ${title.slice(0, 54)}`);
    await new Promise(s => setTimeout(s, DELAY_MS));
  }

  console.log(`\nimported ${ok}, skipped ${skipped}, failed ${failed}, ${totalPages} pages`);
  console.log('Vercel function invocations used: 0');
  await client.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}

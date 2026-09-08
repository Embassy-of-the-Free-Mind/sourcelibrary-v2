#!/usr/bin/env node
/**
 * New World wave — early accounts of the American civilisations, from the
 * Internet Archive, direct-inserted from Hetzner.
 *
 * PRIOR ART:
 *   scripts/import/ia-bundle-import.mjs — same IA + list-file + insertBookIfNew()
 *     shape, but targets FILES inside a multi-file bundle item. This wave is one
 *     IA item per book, so its URL construction does not apply.
 *   scripts/import/early-america-direct.mjs — one-item-per-book IA direct insert
 *     and the source of this file's metadata mapping, but it hardcodes its list
 *     and predates the acquisition gate (bare check-then-insert, which
 *     edition-identity.md says is not a gate under concurrency). Fixed here.
 *   scripts/import/egangotri-tantra-wave.mjs — the wave-from-a-list shape, but
 *     it posts to /api/import/ia, which import-cost-and-egress.md names as the
 *     measured mistake (~1,500 books bought several hundred Vercel invocations).
 *     Deliberately not copied.
 *
 * Scope: Peru/Andes, Maya and Aztec/Mexico first, then the wider gap list from
 * the corpus survey — Gómara, Torquemada, the missionary grammars, the
 * Brazilian and French-American shelves.
 *
 * Books land HIDDEN (visible:false + hidden:true, always as a pair) per
 * import-workflow.md step 4. Flipping them visible is a separate, post-QA act.
 *
 * Language fields follow language-fields.md: `language` is the EDITION's
 * language, `original_language` the source work's, and `text_role` says which
 * of the two this scan is. A 19th-century French Popol Vuh is a translation
 * edition of a K'iche' work, and the list must say so.
 *
 * Usage (on Hetzner — its own IP, always-on, separate quota):
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/new-world-wave.mjs --list scripts/import/new-world-candidates.json
 *   node scripts/import/new-world-wave.mjs --list ... --commit --limit 20
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';

const COMMIT = process.argv.includes('--commit');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIST = arg('--list', 'scripts/import/new-world-candidates.json');
const LIMIT = parseInt(arg('--limit', '999'), 10);
const DELAY_MS = parseInt(arg('--delay', '900'), 10);
const ONLY = arg('--region', null);
const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org; derek@sourcelibrary.org)';

// IA refuses anonymous bulk fetch above ~5 req/s and answers with a TCP refusal,
// not an HTTP status — a 100% failure rate here means the transport is blocked,
// not that the items are gone. Two requests per book at ~1/s stays well inside
// that, and this counter aborts rather than hammering on for an hour.
const MAX_CONSECUTIVE_FAIL = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripText = (s) => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const firstOf = (v) => {
  const raw = Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : null) : (typeof v === 'string' ? v : null);
  return raw ? stripText(raw) || null : null;
};
const arrOf = (v) => {
  const raw = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : (typeof v === 'string' ? [v] : []);
  return raw.map(stripText).filter(Boolean);
};

function slugify(t, m = 70) {
  return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, m).replace(/-$/, '');
}

async function uniqueSlug(db, base) {
  let s = base || 'new-world-source';
  let i = 2;
  while (await db.collection('books').findOne({ slug: s }, { projection: { _id: 1 } })) s = `${base}-${i++}`;
  return s;
}

/**
 * Page count, best source first. The IIIF manifest is authoritative because it
 * is what the reader pages through; `imagecount` can disagree with it on items
 * whose derivation was re-run.
 */
async function pageCountFor(ia, metadata) {
  try {
    const r = await fetch(`https://iiif.archive.org/iiif/${ia}/manifest.json`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000),
    });
    if (r.ok) {
      const m = await r.json();
      if (Array.isArray(m.items) && m.items.length) return { n: m.items.length, src: 'iiif_v3' };
      if (m.sequences?.[0]?.canvases?.length) return { n: m.sequences[0].canvases.length, src: 'iiif_v2' };
    }
  } catch { /* fall through to the metadata signals */ }
  const meta = metadata.metadata || {};
  if (meta.imagecount) return { n: parseInt(meta.imagecount, 10), src: 'imagecount' };
  const jp2 = (metadata.files || []).filter((f) => f.name.endsWith('.jp2') && !f.name.includes('thumb'));
  if (jp2.length > 1) return { n: jp2.length, src: 'jp2_files' };
  return { n: 0, src: 'none' };
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI missing'); process.exit(1); }
  const raw = JSON.parse(readFileSync(LIST, 'utf8'));
  let all = raw.books || raw;
  if (ONLY) all = all.filter((b) => b.region === ONLY);
  const batch = all.slice(0, LIMIT);
  console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'} — ${batch.length} of ${all.length} candidates${ONLY ? ` (region ${ONLY})` : ''}\n`);

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let pagesTotal = 0;
  let consecutiveFail = 0;
  const fails = [];

  for (const b of batch) {
    const fp = `ia:${b.ia}`;

    let metadata;
    try {
      const mr = await fetch(`https://archive.org/metadata/${b.ia}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000),
      });
      if (!mr.ok) throw new Error(`metadata HTTP ${mr.status}`);
      metadata = await mr.json();
    } catch (e) {
      failed++; consecutiveFail++; fails.push(b.ia);
      console.log(`FAIL  ${b.ia} — ${e.message}`);
      if (consecutiveFail >= MAX_CONSECUTIVE_FAIL) {
        console.error(`\nABORT: ${consecutiveFail} consecutive fetch failures from archive.org.`);
        console.error('That is a transport-level block, not a run of missing items. Let it cool');
        console.error(`and re-run — the acquisition gate makes a re-run free, and ${imported} books are in.`);
        break;
      }
      await sleep(DELAY_MS);
      continue;
    }
    consecutiveFail = 0;

    const meta = metadata.metadata || {};
    if (!meta.identifier) {
      failed++; fails.push(b.ia);
      console.log(`FAIL  ${b.ia} — item has no metadata (dark or deleted)`);
      await sleep(DELAY_MS);
      continue;
    }

    const restricted = meta['access-restricted-item'] === 'true' || meta['access-restricted-item'] === true;
    if (restricted) {
      skipped++;
      console.log(`SKIP  ${b.ia} — access-restricted at IA (lending only)`);
      await sleep(DELAY_MS);
      continue;
    }

    const { n: pageCount, src: pageCountSource } = await pageCountFor(b.ia, metadata);
    if (!pageCount) {
      failed++; fails.push(b.ia);
      console.log(`FAIL  ${b.ia} — no page count`);
      await sleep(DELAY_MS);
      continue;
    }

    const iaCatalog = {
      source: 'internet_archive',
      identifier: b.ia,
      ark: meta['identifier-ark'] || null,
      mediatype: meta.mediatype || null,
      collections: arrOf(meta.collection),
      access_restricted: restricted,
      publisher: firstOf(meta.publisher),
      place: firstOf(meta.publishplace) || firstOf(meta.place),
      creator: firstOf(meta.creator),
      description: firstOf(meta.description),
      subjects: arrOf(meta.subject),
      oclc_id: firstOf(meta['oclc-id']),
      lccn: firstOf(meta.lccn),
      date_iso: firstOf(meta.date),
      scan_date: firstOf(meta.scandate),
      scanning_center: firstOf(meta.scanningcenter),
      scraped_at: new Date().toISOString(),
    };
    for (const k of Object.keys(iaCatalog)) {
      const v = iaCatalog[k];
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete iaCatalog[k];
    }

    const licenseUrl = meta.licenseurl || meta.license || null;
    const rights = meta.rights || meta.possible_copyright_status || null;
    const contributor = typeof meta.contributor === 'string' ? stripText(meta.contributor) : null;
    const sponsor = typeof meta.sponsor === 'string' ? stripText(meta.sponsor) : null;

    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await uniqueSlug(db, slugify(`${b.title} ${b.author}`));
    const now = new Date();
    const photo = (i) => `https://archive.org/download/${b.ia}/page/n${i}/full/full/0/default.jpg`;
    const thumb = (i) => `https://archive.org/download/${b.ia}/page/n${i}/full/pct:15/0/default.jpg`;

    const fields = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title: b.title,
      display_title: null,
      author: b.author,
      language: b.language,
      published: String(b.published),
      ...(b.original_language ? { original_language: b.original_language } : {}),
      // A facing-page edition (Chimalpahin's Nahuatl with Siméon's French) is
      // "substantially multilingual" in language-fields.md's terms: `language`
      // still names the principal text, and languages[] carries the rest.
      ...(Array.isArray(b.languages) && b.languages.length > 1
        ? { languages: b.languages, language_multi: true }
        : {}),
      text_role: b.text_role || 'original',
      field_provenance: { language: 'caller' },
      ia_identifier: b.ia,
      thumbnail: thumb(0),
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      content_type: 'book',
      dublin_core: {
        dc_identifier: [
          `IA:${b.ia}`,
          ...(iaCatalog.ark ? [String(iaCatalog.ark)] : []),
          ...(iaCatalog.oclc_id ? [`OCLC:${iaCatalog.oclc_id}`] : []),
          ...(iaCatalog.lccn ? [`LCCN:${iaCatalog.lccn}`] : []),
        ],
        dc_source: `https://archive.org/details/${b.ia}`,
        ...(iaCatalog.publisher ? { dc_publisher: iaCatalog.publisher } : {}),
        ...(iaCatalog.description ? { dc_description: iaCatalog.description } : {}),
        ...(iaCatalog.subjects?.length ? { dc_subject: iaCatalog.subjects } : {}),
      },
      catalog_metadata: iaCatalog,
      ...(iaCatalog.place ? { place_published: String(iaCatalog.place) } : {}),
      ...(iaCatalog.publisher ? { publisher: String(iaCatalog.publisher) } : {}),
      image_source: {
        provider: 'internet_archive',
        provider_name: 'Internet Archive',
        source_url: `https://archive.org/details/${b.ia}`,
        identifier: b.ia,
        license: licenseUrl || 'publicdomain',
        license_url: licenseUrl,
        rights,
        ...(contributor ? { contributing_library: contributor } : {}),
        ...(sponsor ? { sponsor } : {}),
        access_date: now,
      },
      page_count_source: pageCountSource,
      status: 'draft',
      hidden: true,
      visible: false,
      source_fingerprint: fp,
      created_at: now,
      updated_at: now,
    };

    if (!COMMIT) {
      const held = await db.collection('books').findOne(
        { $or: [{ ia_identifier: b.ia }, { source_fingerprint: fp }] },
        { projection: { slug: 1 } },
      );
      console.log(`${held ? 'HELD ' : 'DRY  '} ${b.ia.padEnd(38)} ${String(pageCount).padStart(4)}pp ${String(b.region).padEnd(6)} ${b.title.slice(0, 52)}`);
      if (held) skipped++; else { imported++; pagesTotal += pageCount; }
      await sleep(DELAY_MS);
      continue;
    }

    // The gate, not a check-then-insert: two sessions racing the same wave must
    // not both win. A declined book leaves a row in dedup_skips saying why.
    let acquired;
    try {
      acquired = await insertBookIfNew(db, fields, { importer: 'new-world-wave' });
    } catch (e) {
      failed++; fails.push(b.ia);
      console.log(`FAIL  ${b.ia} — insert ${e.message}`);
      await sleep(DELAY_MS);
      continue;
    }
    if (!acquired.inserted) {
      skipped++;
      console.log(`SKIP  ${b.ia} — ${acquired.reason}: ${acquired.message || ''}`);
      await sleep(DELAY_MS);
      continue;
    }

    const CHUNK = 500;
    for (let s = 0; s < pageCount; s += CHUNK) {
      const docs = [];
      for (let k = 0; k < CHUNK && s + k < pageCount; k++) {
        const i = s + k;
        const pid = new ObjectId();
        docs.push(makePageDoc({
          _id: pid,
          id: pid.toHexString(),
          book_id: bookIdStr,
          page_number: i + 1,
          photo: photo(i),
          thumbnail: thumb(i),
          photo_original: photo(i),
          created_at: now,
          updated_at: now,
        }));
      }
      await db.collection('pages').insertMany(docs, { ordered: false });
    }
    imported++;
    pagesTotal += pageCount;
    console.log(`OK    ${b.ia.padEnd(38)} ${String(pageCount).padStart(4)}pp -> ${bookIdStr} ${b.title.slice(0, 44)}`);
    await sleep(DELAY_MS);
  }

  await client.close();
  console.log(`\n=== ${COMMIT ? 'COMMITTED' : 'DRY-RUN'} — imported:${imported} skipped:${skipped} failed:${failed} pages:${pagesTotal} ===`);
  if (fails.length) console.log(`failed ids: ${fails.join(', ')}`);
  if (COMMIT && imported) {
    console.log('\nBooks are HIDDEN. Next: archive masters to R2, then QA before any visible flip:');
    console.log('  npx tsx scripts/catalog-coverage/archive-acquired.ts --provider internet_archive --batch 40');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

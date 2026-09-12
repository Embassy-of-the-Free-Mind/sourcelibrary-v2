#!/usr/bin/env node
/**
 * Direct import of earliest-edition founding documents (American + French
 * Revolution) straight into Atlas, bypassing /api/import/ia.
 *
 * WHY direct: on 2026-07-05 the server-side IA import route reliably 500'd with
 * `MongoNetworkTimeoutError` (Vercel serverless → Atlas connection timeout),
 * while a residential (local) connection to the same Atlas cluster is healthy.
 * Same residential-direct-insert pattern as harvard-wuzhen-direct.mjs — mirrors
 * the route's book/page doc shape (source_fingerprint `ia:<id>`, normalized
 * title/author, catalog_metadata, image_source, text_role) so a later
 * /api/import/ia run correctly 409s these instead of duplicating them.
 *
 * All items are original-language first works → text_role: 'original'.
 * Lands HIDDEN (visible:false, hidden:true) per the import invariant.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/founding-docs-direct.mjs --dry-run
 *   node scripts/import/founding-docs-direct.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
import { normalizeTitle, normalizeAuthor } from '../lib/dedup-normalize.mjs';

const COMMIT = process.argv.includes('--commit');

const BOOKS = [
  // --- American Revolution ---
  { ia: 'commonsenseaddre00pain_7', title: 'Common Sense: Addressed to the Inhabitants of America', author: 'Thomas Paine', language: 'English', published: '1776' },
  { ia: 'rightsofmanbeing1791pain', title: "Rights of Man: Being an Answer to Mr. Burke's Attack on the French Revolution", author: 'Thomas Paine', language: 'English', published: '1791' },
  { ia: 'bim_eighteenth-century_the-american-crisis_paine-thomas-political_1777', title: 'The American Crisis', author: 'Thomas Paine', language: 'English', published: '1777' },
  { ia: 'summaryviewofrig00jeff_0', title: 'A Summary View of the Rights of British America', author: 'Thomas Jefferson', language: 'English', published: '1774' },
  { ia: 'bim_eighteenth-century_the-constitutions-of-the_1781', title: 'The Constitutions of the Several Independent States of America; the Declaration of Independence; the Articles of Confederation', author: 'United States', language: 'English', published: '1781' },
  { ia: 'bim_eighteenth-century_the-fderal-constitution_united-states_1795', title: 'The Fœderal Constitution of the United States of America', author: 'United States', language: 'English', published: '1795' },
  { ia: 'ageofreasonbeing0000pain_h5s9', title: 'The Age of Reason', author: 'Thomas Paine', language: 'English', published: '1794' },
  { ia: 'service-rbc-rbc0001-2004-2004pe76546-2004pe76546_202505', title: 'The Declaration of Independence', author: 'Continental Congress', language: 'English', published: '1776' },
  // --- French Revolution ---
  { ia: 'questcequeletier00siey_0', title: "Qu'est-ce que le Tiers-État?", author: 'Emmanuel Joseph Sieyès', language: 'French', published: '1789' },
  { ia: 'bub_gb_smqivFwgTLcC', title: "Préliminaire de la Constitution: Reconnaissance et exposition raisonnée des droits de l'homme et du citoyen", author: 'Emmanuel Joseph Sieyès', language: 'French', published: '1789' },
  { ia: 'bub_gb_r-v5wN6ChUAC', title: 'Reflections on the Revolution in France', author: 'Edmund Burke', language: 'English', published: '1790' },
  { ia: 'vindicationofrig00woll_4', title: 'A Vindication of the Rights of Men', author: 'Mary Wollstonecraft', language: 'English', published: '1790' },
  { ia: 'vindicationofrig00wol', title: 'A Vindication of the Rights of Woman', author: 'Mary Wollstonecraft', language: 'English', published: '1792' },
  { ia: 'lesdroitsdelafem00goug', title: 'Les Droits de la femme (Déclaration des droits de la femme et de la citoyenne)', author: 'Olympe de Gouges', language: 'French', published: '1791' },
  { ia: 'discoursdemaximi00robe', title: "Discours de Maximilien Robespierre à l'Assemblée nationale", author: 'Maximilien Robespierre', language: 'French', published: '1790' },
];

const COLLECTIONS_TAG = []; // collection pages not built yet; leave untagged for now

function slugify(text, maxLen = 70) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').substring(0, maxLen).replace(/-$/, '');
}
async function uniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`;
  return slug;
}

async function pageCountFor(ia, metadata) {
  // 1. IIIF manifest (most reliable)
  try {
    const r = await fetch(`https://iiif.archive.org/iiif/${ia}/manifest.json`, { signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const m = await r.json();
      if (Array.isArray(m.items)) return { n: m.items.length, src: 'iiif_v3' };
      if (m.sequences?.[0]?.canvases) return { n: m.sequences[0].canvases.length, src: 'iiif_v2' };
    }
  } catch { /* fall through */ }
  const meta = metadata.metadata || {};
  if (meta.imagecount) return { n: parseInt(meta.imagecount, 10), src: 'imagecount' };
  const jp2 = (metadata.files || []).filter(f => f.name.endsWith('.jp2') && !f.name.includes('thumb'));
  if (jp2.length > 1) return { n: jp2.length, src: 'jp2_files' };
  return { n: 0, src: 'none' };
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI missing (source .env.production.local)'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  let imported = 0, skipped = 0, failed = 0;
  for (const b of BOOKS) {
    const fp = `ia:${b.ia}`;
    const existing = await db.collection('books').findOne(
      { $or: [{ ia_identifier: b.ia }, { source_fingerprint: fp }] }, { projection: { _id: 1, slug: 1 } });
    if (existing) { console.log(`SKIP  ${b.ia} — already present (${existing.slug})`); skipped++; continue; }

    let metadata;
    try {
      const mr = await fetch(`https://archive.org/metadata/${b.ia}`, { signal: AbortSignal.timeout(20000) });
      if (!mr.ok) { console.log(`FAIL  ${b.ia} — metadata ${mr.status}`); failed++; continue; }
      metadata = await mr.json();
    } catch (e) { console.log(`FAIL  ${b.ia} — metadata fetch ${e}`); failed++; continue; }

    const meta = metadata.metadata || {};
    const restricted = meta['access-restricted-item'] === 'true' || meta['access-restricted-item'] === true;
    const { n: pageCount, src: pageCountSource } = await pageCountFor(b.ia, metadata);
    if (!pageCount) { console.log(`FAIL  ${b.ia} — could not determine page count`); failed++; continue; }
    if (restricted) console.log(`WARN  ${b.ia} — access-restricted-item flagged (importing anyway, facsimile may gate)`);

    const stripText = s => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const firstOf = v => { const raw = Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : null) : (typeof v === 'string' ? v : null); return raw ? stripText(raw) || null : null; };
    const arrOf = v => { const raw = Array.isArray(v) ? v.filter(x => typeof x === 'string') : (typeof v === 'string' ? [v] : []); return raw.map(stripText).filter(Boolean); };

    const iaCatalog = {
      source: 'internet_archive', identifier: b.ia,
      ark: meta['identifier-ark'] || null, mediatype: meta.mediatype || null,
      collections: arrOf(meta.collection), access_restricted: restricted,
      publisher: firstOf(meta.publisher), place: firstOf(meta.publishplace) || firstOf(meta.place),
      creator: firstOf(meta.creator), description: firstOf(meta.description),
      subjects: arrOf(meta.subject), oclc_id: firstOf(meta['oclc-id']), lccn: firstOf(meta.lccn),
      date_iso: firstOf(meta.date), scan_date: firstOf(meta.scandate),
      scanning_center: firstOf(meta.scanningcenter), scraped_at: new Date().toISOString(),
    };
    for (const k of Object.keys(iaCatalog)) { const v = iaCatalog[k]; if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete iaCatalog[k]; }

    const licenseUrl = meta.licenseurl || meta.license || null;
    const rights = meta.rights || meta.possible_copyright_status || null;
    const contributor = typeof meta.contributor === 'string' ? stripText(meta.contributor) : null;
    const sponsor = typeof meta.sponsor === 'string' ? stripText(meta.sponsor) : null;

    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await uniqueSlug(db, slugify(`${b.title} ${b.author}`));
    const now = new Date();
    const photo = i => `https://archive.org/download/${b.ia}/page/n${i}/full/full/0/default.jpg`;
    const thumb = i => `https://archive.org/download/${b.ia}/page/n${i}/full/pct:15/0/default.jpg`;

    const bookDoc = makeBookDoc({
      _id: bookId, id: bookIdStr, slug,
      title: b.title, display_title: null, author: b.author,
      language: b.language, published: b.published,
      field_provenance: { language: 'caller' },
      categories: ['History', 'Political Philosophy'],
      ...(COLLECTIONS_TAG.length ? { collections: COLLECTIONS_TAG } : {}),
      ia_identifier: b.ia,
      thumbnail: thumb(0),
      pages_count: pageCount, pages_ocr: 0, pages_translated: 0,
      content_type: 'book',
      text_role: 'original',
      dublin_core: {
        dc_identifier: [`IA:${b.ia}`, ...(iaCatalog.ark ? [String(iaCatalog.ark)] : []),
          ...(iaCatalog.oclc_id ? [`OCLC:${iaCatalog.oclc_id}`] : []), ...(iaCatalog.lccn ? [`LCCN:${iaCatalog.lccn}`] : [])],
        dc_source: `https://archive.org/details/${b.ia}`,
        ...(iaCatalog.publisher ? { dc_publisher: iaCatalog.publisher } : {}),
        ...(iaCatalog.description ? { dc_description: iaCatalog.description } : {}),
        ...(iaCatalog.subjects?.length ? { dc_subject: iaCatalog.subjects } : {}),
      },
      catalog_metadata: iaCatalog,
      ...(iaCatalog.place ? { place_published: String(iaCatalog.place) } : {}),
      ...(iaCatalog.publisher ? { publisher: String(iaCatalog.publisher) } : {}),
      image_source: {
        provider: 'internet_archive', provider_name: 'Internet Archive',
        source_url: `https://archive.org/details/${b.ia}`, identifier: b.ia,
        license: licenseUrl || 'publicdomain', license_url: licenseUrl, rights,
        ...(contributor ? { contributing_library: contributor } : {}),
        ...(sponsor ? { sponsor } : {}), access_date: now,
      },
      page_count_source: pageCountSource,
      status: 'draft', hidden: true, visible: false,
      source_fingerprint: fp,
      normalized_title: normalizeTitle(b.title), normalized_author: normalizeAuthor(b.author),
      created_at: now, updated_at: now,
    });

    if (!COMMIT) { console.log(`DRY   ${b.ia} — would insert "${b.title}" (${pageCount}pp, ${pageCountSource}) slug=${slug}`); imported++; continue; }

    await db.collection('books').insertOne(bookDoc);
    const CHUNK = 500;
    for (let s = 0; s < pageCount; s += CHUNK) {
      const docs = [];
      for (let k = 0; k < CHUNK && s + k < pageCount; k++) {
        const i = s + k; const pid = new ObjectId();
        docs.push(makePageDoc({ _id: pid, id: pid.toHexString(), book_id: bookIdStr, page_number: i + 1,
          photo: photo(i), thumbnail: thumb(i), photo_original: photo(i), created_at: now, updated_at: now }));
      }
      await db.collection('pages').insertMany(docs, { ordered: false });
    }
    console.log(`OK    ${b.ia} → ${bookIdStr} "${b.title}" (${pageCount}pp) slug=${slug}`);
    imported++;
  }

  await client.close();
  console.log(`\n=== ${COMMIT ? 'COMMITTED' : 'DRY-RUN'} — imported:${imported} skipped:${skipped} failed:${failed} ===`);
}
main().catch(e => { console.error(e); process.exit(1); });

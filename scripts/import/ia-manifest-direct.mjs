#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/syriac-canon-direct.mjs — this is that script made reusable. It hard-codes
 * its manifest path and ALWAYS holds each book off the pipeline (a Syriac-OCR decision), so it cannot
 * import an English shelf that should go straight to the OCR lane. Same IA metadata → makeBookDoc →
 * insertBookIfNew → pages shape, unchanged. scripts/import/ia-bundle-import.mjs is the bundled-item
 * pattern (one IA item holding many books) — not this shape. src/app/api/import/ia/route.ts is the
 * one-book UI route; a shelf never goes through a Vercel function (invariants/import-cost-and-egress.md).
 *
 * ia-manifest-direct — import a curated list of Internet Archive items straight into Mongo.
 *
 * Manifest JSON (see scripts/import/manifests/*.json):
 *   { "campaign": "<acquisition_campaign tag>", "collections": ["slug", ...],
 *     "BOOKS": [ { "id": "<ia identifier>", "title", "author", "year", "lang", "languages"?, "note"? } ] }
 * `lang` is the EDITION language (invariants/language-fields.md); `languages` lists the substantial
 * languages of a facing-text edition. text_role is deliberately NOT set — classify-text-role owns it.
 *
 * Lands HIDDEN (visible:false, hidden:true); Phase 0 auto-enrols the book on the OCR lane on its next
 * tick unless --hold <reason> is given, which parks it via scripts/lib/pipeline-hold.mjs (release with
 * `hold-pipeline-books.mjs --release-held --reason <reason> --to queued --apply` — --to queued is
 * REQUIRED for books that never had a status, or OCR is skipped). Making a book public is a QA step.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/ia-manifest-direct.mjs --manifest scripts/import/manifests/<x>.json --dry-run
 *   node scripts/import/ia-manifest-direct.mjs --manifest <x>.json --commit [--limit N] [--only <ia-id>] [--hold <reason>]
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';

const COMMIT = process.argv.includes('--commit');
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const LIMIT = argAfter('--limit') ? +argAfter('--limit') : Infinity;
const ONLY = argAfter('--only');
const HOLD_REASON = argAfter('--hold');
const MANIFEST = argAfter('--manifest');
if (!MANIFEST) { console.error('Required: --manifest <path to manifest json>'); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const { BOOKS } = manifest;
const IMPORTER = manifest.campaign || path.basename(MANIFEST, '.json');
const COLLECTIONS = Array.isArray(manifest.collections) ? manifest.collections : [];
if (!Array.isArray(BOOKS) || !BOOKS.length) { console.error('Manifest needs a non-empty BOOKS[]'); process.exit(1); }
const OUT = path.join(HERE, '..', '..', 'scratchpad', 'acq', `${IMPORTER}-results.jsonl`);
const HOLD = HOLD_REASON ? {
  reason: HOLD_REASON,
  release: `Held at import by ia-manifest-direct.mjs (--hold ${HOLD_REASON}); release with --to queued so OCR runs from scratch.`,
  source: IMPORTER,
} : null;
const UA = 'SourceLibrary acquisition (contact: derek@sourcelibrary.org)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const slugify = (t, m = 70) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, m).replace(/-$/, '');
const uniqueSlug = async (db, base) => { let s = base || 'book', i = 2;
  while (await db.collection('books').findOne({ slug: s }, { projection: { _id: 1 } })) s = `${base}-${i++}`; return s; };

// IIIF manifest first: it is the leaf set the page URLs below address, and scandata-excluded
// leaves are skipped by IIIF (memory: IA leaf offset is always 0 — count the manifest, not imagecount).
async function pageCountFor(ia, metadata) {
  try {
    const r = await fetch(`https://iiif.archive.org/iiif/${ia}/manifest.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (r.ok) { const m = await r.json();
      if (Array.isArray(m.items)) return { n: m.items.length, src: 'iiif_v3' };
      if (m.sequences?.[0]?.canvases) return { n: m.sequences[0].canvases.length, src: 'iiif_v2' }; }
  } catch {}
  const meta = metadata.metadata || {};
  if (meta.imagecount) return { n: parseInt(meta.imagecount, 10), src: 'imagecount' };
  return { n: 0, src: 'none' };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const rec = o => { fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI missing — source .env.production.local'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  const ias = BOOKS.map(b => b.id);
  const held = new Set();
  for (const d of await db.collection('books').find(
    { $or: [{ ia_identifier: { $in: ias } }, { source_fingerprint: { $in: ias.map(i => `ia:${i}`) } }] },
    { projection: { ia_identifier: 1, source_fingerprint: 1, id: 1 } }).toArray()) {
    if (d.ia_identifier) held.add(d.ia_identifier);
    if (d.source_fingerprint) held.add(d.source_fingerprint);
  }
  console.log(`${IMPORTER}: ${BOOKS.length} books · already held by ia id: ${held.size} · hold: ${HOLD_REASON || 'none'} · mode ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

  let n = 0, imported = 0, declined = 0, skipped = 0, failed = 0, pagesTotal = 0, heldOk = 0;
  for (const b of BOOKS) {
    if (ONLY && b.id !== ONLY) continue;
    if (n >= LIMIT) break;
    n++;
    if (held.has(b.id) || held.has(`ia:${b.id}`)) { console.log(`SKIP  ${b.id} — already held`); skipped++; rec({ id: b.id, outcome: 'already-held' }); continue; }
    let metadata;
    try {
      const mr = await fetch(`https://archive.org/metadata/${b.id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!mr.ok) { console.log(`FAIL  ${b.id} — metadata ${mr.status}`); failed++; rec({ id: b.id, outcome: 'metadata-http', status: mr.status }); if (mr.status === 403 || mr.status === 429) await sleep(30000); continue; }
      metadata = await mr.json();
    } catch (e) { console.log(`FAIL  ${b.id} — ${e.message}`); failed++; rec({ id: b.id, outcome: 'metadata-error', reason: e.message }); continue; }
    await sleep(500);
    const meta = metadata.metadata || {};
    if (meta.mediatype !== 'texts') { console.log(`FAIL  ${b.id} — mediatype ${meta.mediatype}`); failed++; rec({ id: b.id, outcome: 'not-text' }); continue; }
    if (meta['access-restricted-item'] === 'true' || meta['access-restricted-item'] === true) { console.log(`FAIL  ${b.id} — access-restricted`); failed++; rec({ id: b.id, outcome: 'access-restricted' }); continue; }
    const { n: pageCount, src: pageCountSource } = await pageCountFor(b.id, metadata);
    if (!pageCount) { console.log(`FAIL  ${b.id} — no page count`); failed++; rec({ id: b.id, outcome: 'no-page-count' }); continue; }
    await sleep(500);

    const stripText = s => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const firstOf = v => { const raw = Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : null) : (typeof v === 'string' ? v : null); return raw ? stripText(raw) || null : null; };
    const arrOf = v => { const raw = Array.isArray(v) ? v.filter(x => typeof x === 'string') : (typeof v === 'string' ? [v] : []); return raw.map(stripText).filter(Boolean); };
    const iaCatalog = { source: 'internet_archive', identifier: b.id, ark: meta['identifier-ark'] || null,
      mediatype: meta.mediatype || null, collections: arrOf(meta.collection),
      access_restricted: false,
      publisher: firstOf(meta.publisher), place: firstOf(meta.publishplace) || firstOf(meta.place),
      creator: firstOf(meta.creator), description: firstOf(meta.description), subjects: arrOf(meta.subject),
      oclc_id: firstOf(meta['oclc-id']), lccn: firstOf(meta.lccn), date_iso: firstOf(meta.date),
      scan_date: firstOf(meta.scandate), scraped_at: new Date().toISOString() };
    for (const k of Object.keys(iaCatalog)) { const v = iaCatalog[k];
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete iaCatalog[k]; }

    const licenseUrl = meta.licenseurl || meta.license || null;
    // IA spells the key with hyphens (`possible-copyright-status: NOT_IN_COPYRIGHT`); the underscore
    // form never matched, so a 1929–30 imprint with no licenseurl was refused despite the statement.
    const rights = meta.rights || meta['possible-copyright-status'] || meta.possible_copyright_status || null;
    // contributing_library is a NAME (memory: credit-holding-institutions). IA's `contributor` is
    // the holding library for library scans; a bare "Internet Archive" or an e-mail is a scanner or
    // an uploader, not a holder, and is left unset rather than credited wrongly.
    const contributorRaw = typeof meta.contributor === 'string' ? stripText(meta.contributor) : null;
    const contributor = contributorRaw && !/@|^internet archive$|^unknown library$/i.test(contributorRaw) ? contributorRaw : null;
    const sponsor = typeof meta.sponsor === 'string' ? stripText(meta.sponsor) : null;
    // rights: the manifest year is the imprint read from the scan; the IA date is the uploader's claim.
    const imprintYear = b.year;
    const iaYear = parseInt(String(meta.date || meta.year || '').match(/\d{4}/)?.[0] || '0', 10);
    const pd = /publicdomain|public domain|cc0|creativecommons|not_in_copyright/i.test(String(licenseUrl || rights || ''));
    // US public-domain line: everything published before 1931 is PD as of 2026-01-01 (the line
    // advances one year every January — bump this constant then). Later imprints need a stated licence.
    const PD_LINE = 1931;
    if ((imprintYear >= PD_LINE || iaYear >= PD_LINE) && !pd) { console.log(`FAIL  ${b.id} — rights: imprint ${imprintYear}, IA date ${iaYear}`); failed++; rec({ id: b.id, outcome: 'rights-refused', imprintYear, iaYear }); continue; }

    const bookId = new ObjectId(), bookIdStr = bookId.toHexString();
    const slug = await uniqueSlug(db, slugify(`${b.title} ${b.author}`));
    const now = new Date();
    const photo = i => `https://archive.org/download/${b.id}/page/n${i}/full/full/0/default.jpg`;
    const thumb = i => `https://archive.org/download/${b.id}/page/n${i}/full/pct:15/0/default.jpg`;
    const multi = Array.isArray(b.languages) && b.languages.length > 1;

    const fields = { _id: bookId, id: bookIdStr, slug, title: b.title, author: b.author,
      language: b.lang,
      languages: multi ? b.languages : [b.lang],
      ...(multi ? { language_multi: true } : {}),
      field_provenance: { language: 'caller', languages: 'caller' },
      published: String(b.year), year: b.year,
      ia_identifier: b.id, thumbnail: thumb(0),
      pages_count: pageCount, pages_ocr: 0, pages_translated: 0, content_type: 'book',
      ...(b.note ? { curator_notes: b.note } : {}),
      acquisition_campaign: IMPORTER,
      ...(COLLECTIONS.length ? { collections: COLLECTIONS } : {}),
      dublin_core: { dc_identifier: [`IA:${b.id}`, ...(iaCatalog.ark ? [String(iaCatalog.ark)] : []),
        ...(iaCatalog.oclc_id ? [`OCLC:${iaCatalog.oclc_id}`] : []), ...(iaCatalog.lccn ? [`LCCN:${iaCatalog.lccn}`] : [])],
        dc_source: `https://archive.org/details/${b.id}`,
        ...(iaCatalog.publisher ? { dc_publisher: iaCatalog.publisher } : {}),
        ...(iaCatalog.description ? { dc_description: iaCatalog.description } : {}),
        ...(iaCatalog.subjects?.length ? { dc_subject: iaCatalog.subjects } : {}) },
      catalog_metadata: iaCatalog,
      ...(iaCatalog.place ? { place_published: String(iaCatalog.place) } : {}),
      ...(iaCatalog.publisher ? { publisher: String(iaCatalog.publisher) } : {}),
      ...(contributor ? { contributing_library: contributor } : {}),
      image_source: { provider: 'internet_archive', provider_name: 'Internet Archive',
        source_url: `https://archive.org/details/${b.id}`, identifier: b.id,
        license: licenseUrl || 'publicdomain', license_url: licenseUrl, rights,
        ...(contributor ? { contributing_library: contributor } : {}), ...(sponsor ? { sponsor } : {}),
        access_date: now },
      page_count_source: pageCountSource,
      status: 'draft', hidden: true, visible: false, created_at: now, updated_at: now };

    if (!COMMIT) {
      makeBookDoc(fields);   // validate the shape without writing
      console.log(`DRY   ${b.id.padEnd(64)} ${String(pageCount).padStart(4)}pp  ${b.lang.padEnd(8)} ${(contributor || '-').slice(0, 34).padEnd(34)} "${b.title.slice(0, 48)}"`);
      imported++; pagesTotal += pageCount; continue;
    }

    let res;
    try { res = await insertBookIfNew(db, fields, { importer: IMPORTER, sourceIdentifier: b.id, sourceUrl: `https://archive.org/details/${b.id}` }); }
    catch (e) { console.log(`FAIL  ${b.id} — insert ${e.message}`); failed++; rec({ id: b.id, outcome: 'insert-error', reason: e.message }); continue; }
    if (!res.inserted) {
      console.log(`GATE  ${b.id} — ${res.reason}: ${(res.message || '').slice(0, 90)}`);
      declined++; rec({ id: b.id, outcome: 'gate-declined', reason: res.reason, message: res.message, matches: res.matches?.slice(0, 3) }); continue;
    }
    const realId = res.bookId;
    // Hold BEFORE the pages exist, so no Phase 0 tick between insert and hold can enrol the book.
    const h = HOLD ? await holdBook(db, realId, HOLD) : { outcome: 'not-held' };
    if (HOLD) { if (h.outcome === 'held') heldOk++; else console.log(`WARN  ${b.id} — hold outcome ${h.outcome}`); }
    const CHUNK = 500;
    for (let s = 0; s < pageCount; s += CHUNK) {
      const docs = [];
      for (let k = 0; k < CHUNK && s + k < pageCount; k++) {
        const i = s + k, pid = new ObjectId();
        docs.push(makePageDoc({ _id: pid, id: pid.toHexString(), book_id: realId, page_number: i + 1,
          photo: photo(i), thumbnail: thumb(i), photo_original: photo(i), created_at: now, updated_at: now }));
      }
      await db.collection('pages').insertMany(docs, { ordered: false });
    }
    const written = await db.collection('pages').countDocuments({ book_id: realId });
    console.log(`OK    ${b.id.padEnd(64)} ${String(pageCount).padStart(4)}pp (${written} written)  hold=${h.outcome}  → ${realId}`);
    imported++; pagesTotal += pageCount;
    rec({ id: b.id, outcome: 'imported', book_id: realId, pages: pageCount, pages_written: written, hold: h.outcome, language: b.lang, contributing_library: contributor });
  }
  await client.close();
  console.log(`\n=== ${COMMIT ? 'COMMITTED' : 'DRY-RUN'} — imported:${imported} held:${heldOk} gate-declined:${declined} already-held:${skipped} failed:${failed} · ${pagesTotal.toLocaleString()} pages ===`);
}
main().catch(e => { console.error(e); process.exit(1); });

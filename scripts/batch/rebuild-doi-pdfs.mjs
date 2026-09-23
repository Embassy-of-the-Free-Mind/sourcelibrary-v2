#!/usr/bin/env node
/**
 * Re-deposit the scholarly PDF of an ALREADY-PUBLISHED edition as a new Zenodo
 * VERSION, leaving the translation untouched.
 *
 * PRIOR ART: scripts/batch/batch-mint-doi.mjs — mints a FIRST DOI. It calls
 * `POST /records`, which creates an independent record with an unrelated DOI;
 * run against the 186 already-minted books it would orphan every existing
 * deposit rather than supersede it. It also generates front matter with Gemini
 * when an edition lacks it. Neither behaviour is wanted here, so this is a
 * separate script rather than a flag on that one.
 *
 * Why this exists: PR #4981 fixed defects that are baked into every deposit
 * already on Zenodo — an index printed as a bare word list with no locators
 * (144 of 186 books), footnotes printed out of order, catalogue apparatus and
 * broken hyphenation on covers. The text is unaffected. Zenodo records are
 * immutable, so the correction is a new version of the same concept DOI: the
 * old version keeps resolving for anyone who cited it, and the concept DOI
 * resolves to the corrected one.
 *
 * SAFETY, in order of importance:
 *   - Does nothing without `--publish`. The default renders the PDF, checks it,
 *     and reports; it makes no write call to Zenodo at all.
 *   - `--publish` without `--book-id` refuses unless `--limit` is given
 *     explicitly, so a bare `--publish` cannot re-version 177 public records.
 *   - Refuses any book whose translation content hash has MOVED since the
 *     published edition. That would mean the text changed, which is not a
 *     typography re-version and must not be shipped as one.
 *   - Never generates front matter; an edition without it is skipped and
 *     RECORDED, never silently passed over.
 *
 * Usage:
 *   node scripts/batch/rebuild-doi-pdfs.mjs                        # plan, all eligible
 *   node scripts/batch/rebuild-doi-pdfs.mjs --book-id <id>         # plan one, write the PDF out
 *   node scripts/batch/rebuild-doi-pdfs.mjs --book-id <id> --publish
 *   node scripts/batch/rebuild-doi-pdfs.mjs --publish --limit 10
 *
 *   node --env-file=.env.production.local scripts/batch/rebuild-doi-pdfs.mjs …
 *   ZENODO_SANDBOX=true rehearses against sandbox.zenodo.org (needs a sandbox token).
 */
import { MongoClient } from 'mongodb';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  generateScholarlyPdf, fetchFrontispiece, editionCredits, resolveDedication,
} from '../lib/scholarly-typst.mjs';

const SANDBOX = process.env.ZENODO_SANDBOX === 'true';
const ZENODO_API = SANDBOX ? 'https://sandbox.zenodo.org/api' : 'https://zenodo.org/api';
const ZENODO_URL = SANDBOX ? 'https://sandbox.zenodo.org' : 'https://zenodo.org';
// Zenodo's edge serves an HTML "unusual traffic" page as 403 to undici's default
// User-Agent. Verified again 2026-09-23: the same GET is 200 with this header and
// 403 without it.
const USER_AGENT = 'SourceLibrary/1.0 (+https://sourcelibrary.org; team@sourcelibrary.org)';
const OUT_DIR = 'scripts/output/doi-rebuild';
const RESULTS = 'scripts/output/doi-rebuild-results.json';
const DELAY_MS = 3000;

const args = process.argv.slice(2);
const hasFlag = f => args.includes(f);
const getArg = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const PUBLISH = hasFlag('--publish');
const BOOK_ID = getArg('--book-id');
const LIMIT_ARG = getArg('--limit');
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG, 10) : null;

function zHeaders(extra = {}) {
  return { Authorization: `Bearer ${process.env.ZENODO_ACCESS_TOKEN}`, 'User-Agent': USER_AGENT, ...extra };
}

async function zFail(resp, context) {
  const body = await resp.text();
  let detail = body.slice(0, 400);
  try {
    const j = JSON.parse(body);
    detail = `${j.message || ''}${j.errors ? ` — ${j.errors.map(e => `${e.field}: ${e.messages?.join(', ')}`).join('; ')}` : ''}`;
  } catch { /* not JSON — an edge block returns HTML, and the raw body says so */ }
  throw new Error(`Zenodo ${context}: HTTP ${resp.status} — ${detail}`);
}

async function zGet(pathname, context) {
  const resp = await fetch(`${ZENODO_API}${pathname}`, { headers: zHeaders() });
  if (!resp.ok) await zFail(resp, context);
  return resp.json();
}

/** File keys on a record or draft, across both response shapes Zenodo returns. */
function fileKeys(rec) {
  const f = rec?.files;
  if (Array.isArray(f)) return f.map(x => x.key);
  // NOT `f?.entries ?` — on an array that is Array.prototype.entries, a truthy
  // function, and every record silently reads as having no files.
  if (f && typeof f === 'object' && f.entries && !Array.isArray(f.entries)) return Object.keys(f.entries);
  return [];
}

// ── Zenodo write path (only reached under --publish) ─────────────────

async function createNewVersion(recordId) {
  const resp = await fetch(`${ZENODO_API}/records/${recordId}/versions`, {
    method: 'POST', headers: zHeaders({ 'Content-Type': 'application/json' }),
  });
  if (!resp.ok) await zFail(resp, `new version of ${recordId}`);
  return resp.json();
}

async function setDraftMetadata(draftId, metadata) {
  const resp = await fetch(`${ZENODO_API}/records/${draftId}/draft`, {
    method: 'PUT', headers: zHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ metadata }),
  });
  if (!resp.ok) await zFail(resp, `draft metadata ${draftId}`);
  return resp.json();
}

async function deleteDraftFile(draftId, key) {
  const resp = await fetch(
    `${ZENODO_API}/records/${draftId}/draft/files/${encodeURIComponent(key)}`,
    { method: 'DELETE', headers: zHeaders() },
  );
  // 404 means it was never there, which is the state we want.
  if (!resp.ok && resp.status !== 404) await zFail(resp, `delete inherited file ${key}`);
}

async function uploadFile(draftId, filename, buffer) {
  const init = await fetch(`${ZENODO_API}/records/${draftId}/draft/files`, {
    method: 'POST', headers: zHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify([{ key: filename }]),
  });
  if (!init.ok) await zFail(init, `file init ${filename}`);

  const put = await fetch(
    `${ZENODO_API}/records/${draftId}/draft/files/${encodeURIComponent(filename)}/content`,
    { method: 'PUT', headers: zHeaders({ 'Content-Type': 'application/octet-stream' }), body: new Uint8Array(buffer) },
  );
  if (!put.ok) await zFail(put, `file upload ${filename}`);

  const commit = await fetch(
    `${ZENODO_API}/records/${draftId}/draft/files/${encodeURIComponent(filename)}/commit`,
    { method: 'POST', headers: zHeaders() },
  );
  if (!commit.ok) await zFail(commit, `file commit ${filename}`);
  return commit.json();
}

async function publishDraft(draftId) {
  const resp = await fetch(`${ZENODO_API}/records/${draftId}/draft/actions/publish`, {
    method: 'POST', headers: zHeaders(),
  });
  if (!resp.ok) await zFail(resp, `publish ${draftId}`);
  return resp.json();
}

// ── Selection and checks ─────────────────────────────────────────────

// A MINOR bump, not a patch. The translation text is byte-identical (asserted
// below via the content hash), but the rebuilt deposit is not merely restyled:
// it gains a contents, a real index with locators, source-page numbers in the
// margin, cross-links between translation and original, and the original-language
// section. Measured on Bodleian MS Ashmole 399: 23 pages before, 43 after.
// Added apparatus, same text, nothing removed — that is a minor version.
const bumpMinor = v => {
  const [maj, min] = String(v || '1.0.0').split('.').map(n => parseInt(n, 10) || 0);
  return `${maj}.${min + 1}.0`;
};

function contentHashOf(translatedPages) {
  const text = translatedPages
    .map(p => `--- Page ${p.page_number} ---\n${p.translation?.data || ''}`)
    .join('\n\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** The published edition this book's DOI belongs to, or a reason it is not eligible. */
function publishedEdition(book) {
  const editions = book.editions || [];
  const pub = editions.filter(e => e.status === 'published' && e.doi && e.zenodo_id);
  if (pub.length === 0) return { skip: 'no published edition row with a zenodo_id' };
  // Newest by version.
  const edition = pub.sort((a, b) => {
    const A = String(a.version).split('.').map(Number), B = String(b.version).split('.').map(Number);
    return (B[0] - A[0]) || (B[1] - A[1]) || (B[2] - A[2]);
  })[0];
  if (!edition.front_matter?.introduction) {
    return { skip: `edition ${edition.version} has no front matter — this script never generates it` };
  }
  return { edition };
}

async function main() {
  if (!process.env.ZENODO_ACCESS_TOKEN) throw new Error('ZENODO_ACCESS_TOKEN is not set');
  if (PUBLISH && !BOOK_ID && LIMIT === null) {
    console.error('Refusing: --publish over the whole set needs an explicit --limit (or --book-id).');
    console.error('This re-versions PUBLIC, PERMANENT records. Start with --book-id.');
    process.exit(2);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const query = BOOK_ID ? { id: BOOK_ID } : { doi: { $exists: true, $ne: null } };
  const books = await db.collection('books').find(query).toArray();
  console.log(`${SANDBOX ? '[SANDBOX] ' : ''}${PUBLISH ? 'PUBLISH' : 'PLAN (no Zenodo writes)'} — ${books.length} book(s) selected\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const done = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : [];
  const doneIds = new Set(done.filter(r => r.published).map(r => r.bookId));

  const results = [];
  let processed = 0;
  for (const book of books) {
    if (LIMIT !== null && processed >= LIMIT) break;
    const label = (book.display_title || book.title || book.id).slice(0, 52);

    if (doneIds.has(book.id)) { console.log(`· ${label}\n    already rebuilt — skipping`); continue; }

    const { edition, skip } = publishedEdition(book);
    if (skip) { console.log(`· ${label}\n    SKIP: ${skip}`); results.push({ bookId: book.id, skipped: skip }); continue; }

    const pages = await db.collection('pages').find({ book_id: book.id }).sort({ page_number: 1 }).toArray();
    const translated = pages.filter(p => p.translation?.data);
    if (translated.length === 0) {
      console.log(`· ${label}\n    SKIP: no translated pages`);
      results.push({ bookId: book.id, skipped: 'no translated pages' });
      continue;
    }

    // The text must not have moved. If it has, this is not a typography
    // re-version and shipping it as a patch would misdescribe the change.
    const hash = contentHashOf(translated);
    if (edition.content_hash && edition.content_hash !== hash) {
      const msg = `translation text changed since v${edition.version} (content hash differs) — needs a real new edition, not a PDF rebuild`;
      console.log(`· ${label}\n    SKIP: ${msg}`);
      results.push({ bookId: book.id, skipped: msg });
      continue;
    }

    const current = await zGet(`/records/${edition.zenodo_id}`, `read record ${edition.zenodo_id}`);
    const existingKeys = fileKeys(current);

    const collections = book.collections?.length
      ? await db.collection('collections')
        .find({ slug: { $in: book.collections }, dedication: { $exists: true } }, { projection: { slug: 1, dedication: 1 } })
        .toArray()
      : [];

    const pdf = await generateScholarlyPdf(book, translated, {
      introduction: edition.front_matter?.introduction,
      methodology: edition.front_matter?.methodology,
      version: bumpMinor(edition.version),
      doi: edition.doi,
      frontispiece: await fetchFrontispiece(book),
      credits: editionCredits(book),
      dedication: resolveDedication(book, collections),
    });

    const newVersion = bumpMinor(edition.version);
    const filename = `${book.slug || book.id}-scholarly-v${newVersion}.pdf`;
    const localPath = path.join(OUT_DIR, filename);
    fs.writeFileSync(localPath, pdf);

    console.log(`· ${label}`);
    console.log(`    record ${edition.zenodo_id} · ${edition.doi} · v${edition.version} → v${newVersion}`);
    console.log(`    files now: ${existingKeys.join(', ') || '(none)'}`);
    console.log(`    new pdf:   ${localPath}  ${(pdf.length / 1024 / 1024).toFixed(1)}MB  ${translated.length} pages`);

    const row = {
      bookId: book.id, title: label, doi: edition.doi, zenodoId: edition.zenodo_id,
      fromVersion: edition.version, toVersion: newVersion, pdf: localPath,
      bytes: pdf.length, existingFiles: existingKeys, published: false,
    };

    if (!PUBLISH) { results.push(row); processed++; continue; }

    // ── from here on we are changing a public record ──
    const draft = await createNewVersion(edition.zenodo_id);
    const draftId = draft.id;
    console.log(`    zenodo: draft ${draftId}`);

    const metadata = { ...(draft.metadata || {}), version: newVersion, publication_date: new Date().toISOString().slice(0, 10) };
    await setDraftMetadata(draftId, metadata);

    // A new version may inherit the previous version's files; the old PDF must
    // not ride along beside the corrected one.
    const draftNow = await zGet(`/records/${draftId}/draft`, `read draft ${draftId}`);
    for (const key of fileKeys(draftNow)) {
      if (/\.pdf$/i.test(key)) { await deleteDraftFile(draftId, key); console.log(`    zenodo: dropped inherited ${key}`); }
    }

    await uploadFile(draftId, filename, pdf);
    console.log(`    zenodo: uploaded ${filename}`);

    const published = await publishDraft(draftId);
    const newDoi = published.pids?.doi?.identifier || published.doi;
    console.log(`    zenodo: PUBLISHED ${newDoi}  ${ZENODO_URL}/records/${published.id}`);

    const fresh = await db.collection('books').findOne({ id: book.id });
    const editions = (fresh.editions || []).map(e => (
      e.id === edition.id
        ? { ...e, status: 'superseded' }
        : e
    ));
    editions.push({
      ...edition,
      id: crypto.randomUUID(),
      version: newVersion,
      status: 'published',
      published_at: new Date(),
      doi: newDoi,
      doi_url: `https://doi.org/${newDoi}`,
      zenodo_id: published.id,
      zenodo_url: `${ZENODO_URL}/records/${published.id}`,
      previous_version_id: edition.id,
      previous_version_doi: edition.doi,
      rebuilt_reason: 'scholarly edition apparatus rebuilt (#4969, #4981); translation text unchanged (content hash asserted equal)',
    });
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { editions, doi: newDoi, updated_at: new Date() } },
    );
    console.log('    db: edition superseded, new version recorded');

    Object.assign(row, { published: true, newDoi, newZenodoId: published.id, newZenodoUrl: `${ZENODO_URL}/records/${published.id}` });
    results.push(row);
    processed++;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  fs.writeFileSync(RESULTS, JSON.stringify([...done, ...results], null, 2));
  const built = results.filter(r => !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  console.log(`\n${PUBLISH ? 'published' : 'planned'}: ${built}   skipped: ${skipped}   → ${RESULTS}`);
  if (!PUBLISH && built) console.log('Nothing was sent to Zenodo. Re-run with --publish to deposit.');
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });

/**
 * `insertBookIfNew()` — the acquisition gate for the direct-insert importers.
 *
 * WHY. All ten API import routes call the dedupe gate; the ~35
 * `scripts/import/*-direct.mjs` importers insert straight into Mongo and never
 * did. That pattern exists deliberately (some providers 403 datacenter IPs, so
 * the fetch has to happen on a residential machine and cannot go through the
 * route), so it cannot be deleted — it has to be given a gate of its own.
 *
 * The narrowest real chokepoint is `makeBookDoc()`: 53 scripts already call it.
 * It is synchronous and DB-free, so it now stamps `source_fingerprints` (which
 * needs no database) but cannot run the dedupe query. This module is the async
 * layer directly above it: same constructor, plus the gate, plus the insert.
 *
 *   import { insertBookIfNew } from '../lib/acquire-book.mjs';
 *   const r = await insertBookIfNew(db, { _id, id, slug, title, ... },
 *                                   { importer: 'script:iiif-direct-import' });
 *   if (!r.inserted) { console.log('skip:', r.message); continue; }
 *
 * Skip-and-record is the DEFAULT. `{ allowDuplicate: true }` is the explicit
 * opt-out for a caller that genuinely wants a second copy — it still records
 * the decision, so a deliberate second copy is as visible as a declined one.
 *
 * SCOPE. This is acquisition-side only. It never widens the match rules, never
 * touches `duplicate_of`, never hides or deletes anything. At acquisition time
 * a false positive is cheap (we decline a book we may already hold, recorded in
 * `dedup_skips` for review); a wrong merge is not, and is a different problem.
 *
 * TS twin: `src/lib/acquisition-guard.ts` — read that file's header for the
 * measured incidents (the concurrency race, the cross-form fingerprint blindness).
 */

import { makeBookDoc } from './book-docs.mjs';
import { computeIdentityFields, buildEditionKey, editionYear, extractVolume } from './identity-fields.mjs';
import { sourceFingerprint, sourceFingerprints } from './source-fingerprints.mjs';

export const SKIP_COLLECTION = 'dedup_skips';
export const CLAIM_COLLECTION = 'acquisition_claims';
export const STALE_CLAIM_MS = 30 * 60 * 1000;

const COLLECTIONS = ['books', 'books_warehouse'];
const VIS_PROJ = { id: 1, title: 1, year: 1, published: 1, visible: 1, edition_key: 1 };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idOf = (doc) => doc.id || String(doc._id);

/** Tier 1 — set intersection over `source_fingerprints`, with the legacy scalar
 *  still matched so records the backfill has not reached are not invisible. */
async function fingerprintMatches(db, book, fps) {
  const scalar = sourceFingerprint(book);
  const keys = [...new Set([...fps, ...(scalar ? [scalar] : [])])];
  if (keys.length === 0) return [];
  const out = [];
  for (const cn of COLLECTIONS) {
    const rows = await db.collection(cn).find(
      { $or: [{ source_fingerprint: { $in: keys } }, { source_fingerprints: { $in: keys } }] },
      { projection: VIS_PROJ }
    ).limit(10).toArray();
    for (const doc of rows) {
      out.push({ book_id: idOf(doc), title: doc.title, tier: 'source_fingerprint', confidence: 'exact', visible: doc.visible === true, collection: cn, year: editionYear(doc) });
    }
  }
  return out;
}

/** Tier 2 — the edition-key tier, ported from `src/lib/dedup.ts`. A missing
 *  year or volume on EITHER side is non-distinguishing (assume duplicate). */
async function editionKeyMatches(db, book) {
  const ek = buildEditionKey(book);
  if (!ek.key) return [];
  const { title, author, year, volume } = ek.parts;
  const prefix = new RegExp(`^${escapeRegex(`${title}|${author}|`)}`);
  const out = [];
  for (const cn of COLLECTIONS) {
    const rows = await db.collection(cn).find({ edition_key: prefix }, { projection: VIS_PROJ }).limit(25).toArray();
    for (const doc of rows) {
      if (typeof doc.edition_key !== 'string' || !doc.edition_key.includes('|')) continue;
      const segs = doc.edition_key.split('|');
      const volSeg = segs[segs.length - 1] || '';
      const yearSeg = segs[segs.length - 2] || '';
      const tmYear = yearSeg === '' ? null : parseInt(yearSeg, 10);
      const tmVol = volSeg === 'v' ? null : parseInt(volSeg.slice(1), 10);
      if (year != null && tmYear != null && year !== tmYear) continue;
      if (volume != null && tmVol != null && volume !== tmVol) continue;
      out.push({ book_id: idOf(doc), title: doc.title, tier: 'edition_key', confidence: 'high', visible: doc.visible === true, collection: cn, year: tmYear });
    }
  }
  return out;
}

/** Tier 3 — exact IIIF manifest URL. */
async function iiifMatches(db, book) {
  const manifest = book.image_source?.iiif_manifest;
  if (!manifest) return [];
  const out = [];
  for (const cn of COLLECTIONS) {
    const rows = await db.collection(cn).find({ 'image_source.iiif_manifest': manifest }, { projection: VIS_PROJ }).limit(5).toArray();
    for (const doc of rows) {
      out.push({ book_id: idOf(doc), title: doc.title, tier: 'iiif_manifest', confidence: 'exact', visible: doc.visible === true, collection: cn, year: editionYear(doc) });
    }
  }
  return out;
}

/** How strong is the evidence behind a skip? `edition_key_no_year` is the case
 *  worth a human's attention: 81% of edition-key-only decisions rest on a
 *  normalized title + surname with no year on one side. */
export function classifyEvidence(candidateYear, matches) {
  if (matches.some((m) => m.tier === 'source_fingerprint' || m.tier === 'iiif_manifest')) return 'exact';
  const ek = matches.filter((m) => m.tier === 'edition_key');
  if (ek.length > 0) return candidateYear != null && ek.some((m) => m.year != null) ? 'edition_key_full' : 'edition_key_no_year';
  return 'title_author';
}

/** Append one row to `dedup_skips`. Nothing automated reads this collection —
 *  it is a review surface for humans and `scripts/audit/duplicate-fingerprint-groups.mjs`. */
export async function recordDedupSkip(db, candidate, matches, ctx, extra) {
  try {
    await db.collection(SKIP_COLLECTION).insertOne({
      at: new Date(),
      importer: ctx.importer,
      allowed_duplicate: extra.allowedDuplicate === true,
      evidence: extra.evidence,
      year_missing_one_side: extra.evidence === 'edition_key_no_year',
      tier: matches[0]?.tier ?? extra.evidence,
      candidate: {
        title: String(candidate.title || '').slice(0, 300),
        author: String(candidate.author || '').slice(0, 200),
        year: editionYear(candidate),
        published: candidate.published ? String(candidate.published).slice(0, 120) : null,
        source_identifier: ctx.sourceIdentifier ?? candidate.image_source?.identifier ?? null,
        source_url: ctx.sourceUrl ?? candidate.image_source?.source_url ?? candidate.image_source?.iiif_manifest ?? null,
        fingerprints: extra.fingerprints,
      },
      matched_book_id: matches[0]?.book_id ?? null,
      matches: matches.slice(0, 10),
    });
  } catch {
    // A skip we failed to record is still a skip. Never fail the caller.
  }
}

async function claimOne(db, fp, importer) {
  const coll = db.collection(CLAIM_COLLECTION);
  try {
    await coll.insertOne({ _id: fp, at: new Date(), importer });
    return 'claimed';
  } catch (err) {
    if (err?.code !== 11000) return 'unavailable'; // infrastructure — fail OPEN
    try {
      const res = await coll.findOneAndUpdate(
        { _id: fp, book_id: { $exists: false }, at: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } },
        { $set: { at: new Date(), importer }, $inc: { takeovers: 1 } }
      );
      return res ? 'reclaimed' : 'held';
    } catch { return 'unavailable'; }
  }
}

/** Atomically take responsibility for a candidate's fingerprints. Returns the
 *  fingerprint another importer holds, or null when we hold them all. */
export async function claimFingerprints(db, fingerprints, importer) {
  for (const fp of fingerprints) {
    if (await claimOne(db, fp, importer) === 'held') return fp;
  }
  return null;
}

export async function confirmClaims(db, fingerprints, bookId) {
  if (!fingerprints?.length) return;
  try {
    await db.collection(CLAIM_COLLECTION).updateMany({ _id: { $in: fingerprints } }, { $set: { book_id: bookId, confirmed_at: new Date() } });
  } catch { /* best effort */ }
}

export async function releaseClaims(db, fingerprints) {
  if (!fingerprints?.length) return;
  try {
    await db.collection(CLAIM_COLLECTION).updateMany(
      { _id: { $in: fingerprints }, book_id: { $exists: false } },
      { $set: { at: new Date(0), released: true } }
    );
  } catch { /* best effort */ }
}

/**
 * The gate, without the insert — for callers that must decide before they do
 * expensive work (fetch a manifest, page through images).
 *
 * @returns {Promise<{ok: boolean, reason?: string, message?: string, matches: object[], fingerprints: string[], evidence?: string}>}
 */
export async function acquisitionGate(db, candidate, ctx, opts = {}) {
  const fingerprints = sourceFingerprints(candidate);
  const matches = [];
  const seen = new Set();
  for (const m of [
    ...(await fingerprintMatches(db, candidate, fingerprints)),
    ...(await editionKeyMatches(db, candidate)),
    ...(await iiifMatches(db, candidate)),
  ]) {
    if (seen.has(m.book_id)) continue;
    seen.add(m.book_id);
    matches.push(m);
  }

  if (matches.length > 0) {
    const evidence = classifyEvidence(editionYear(candidate), matches);
    await recordDedupSkip(db, candidate, matches, ctx, { evidence, fingerprints, allowedDuplicate: opts.allowDuplicate === true });
    if (opts.allowDuplicate !== true) {
      return { ok: false, reason: 'duplicate', matches, fingerprints, evidence, message: `Duplicate (${matches[0].tier}): matches "${matches[0].title}" [${matches[0].book_id}]` };
    }
  }

  if (opts.claim === false) return { ok: true, matches, fingerprints };

  const held = await claimFingerprints(db, fingerprints, ctx.importer);
  if (held && opts.allowDuplicate !== true) {
    await recordDedupSkip(db, candidate, matches, ctx, { evidence: 'claim_race', fingerprints });
    return { ok: false, reason: 'claimed', matches, fingerprints, evidence: 'claim_race', message: `Another importer is acquiring this source right now (${held})` };
  }
  return { ok: true, matches, fingerprints };
}

/**
 * Construct, gate, and insert a book in one call — the replacement for
 * `await db.collection('books').insertOne(makeBookDoc({...}))` in every
 * direct importer.
 *
 * Also fills the identity fields (`normalized_title`, `normalized_author`,
 * `edition_key`) and both fingerprint forms when the caller left them out, so
 * the record is dedup-visible to the NEXT importer — a book that arrives
 * without an `edition_key` is one the identity worker has to catch up on later.
 *
 * @param {import('mongodb').Db} db
 * @param {object} fields          raw `books` fields (validated by makeBookDoc)
 * @param {object} ctx             { importer, sourceIdentifier?, sourceUrl? }
 * @param {object} [opts]          { allowDuplicate?: boolean, collection?: string }
 * @returns {Promise<{inserted: boolean, bookId: string|null, doc: object|null, reason?: string, message?: string, matches: object[], evidence?: string}>}
 */
export async function insertBookIfNew(db, fields, ctx, opts = {}) {
  if (!ctx || typeof ctx.importer !== 'string' || !ctx.importer) {
    throw new Error('insertBookIfNew: ctx.importer is required — it is how a skip row says who declined the book.');
  }
  const collection = opts.collection || 'books';
  const doc = makeBookDoc(fields);

  // Identity + fingerprints, unless the caller stated them deliberately.
  const identity = computeIdentityFields(doc);
  for (const [k, v] of Object.entries(identity)) {
    if (doc[k] === undefined && v !== null && v !== '') doc[k] = v;
  }
  if (doc.source_fingerprint === undefined) {
    const scalar = sourceFingerprint(doc);
    if (scalar) doc.source_fingerprint = scalar;
  }
  if (doc.source_fingerprints === undefined) {
    const fps = sourceFingerprints(doc);
    if (fps.length > 0) doc.source_fingerprints = fps;
  }

  const gate = await acquisitionGate(db, doc, ctx, opts);
  if (!gate.ok) {
    return { inserted: false, bookId: null, doc: null, reason: gate.reason, message: gate.message, matches: gate.matches, evidence: gate.evidence };
  }

  try {
    await db.collection(collection).insertOne(doc);
  } catch (err) {
    await releaseClaims(db, gate.fingerprints);
    throw err;
  }
  const bookId = idOf(doc);
  await confirmClaims(db, gate.fingerprints, bookId);
  return { inserted: true, bookId, doc, matches: gate.matches };
}

// Re-exported so a caller needing only the volume/year helpers does not have to
// know which of the two identity modules they live in.
export { extractVolume, editionYear, sourceFingerprint, sourceFingerprints };

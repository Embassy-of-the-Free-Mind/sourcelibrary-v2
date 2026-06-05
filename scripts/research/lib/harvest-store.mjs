/**
 * Shared store for the manifest-harvest layer (issue #2357).
 *
 * One ledger collection — `bookstore.harvest_candidates` — fed by multiple
 * provider harvesters (Biblissima, Europeana, …) and consumed by triage +
 * promote. Harvest is CONTINUOUS and decoupled from import: re-running a
 * harvester must UPDATE existing rows (refresh last_seen, union the subject
 * terms that surfaced them) WITHOUT clobbering curator decisions or triage
 * results. So `decision` and `dedup_status` are written on INSERT only;
 * later stages own them.
 *
 * Candidate shape (uniform across providers):
 *   _id            stable id (provider's id, else ARK, else manifest_url)
 *   provider       short slug derived from the manifest host (gallica, bsb, …)
 *   aggregator     where we discovered it (biblissima | europeana | direct)
 *   source_library human-readable holding institution
 *   manifest_url   IIIF manifest at the ORIGINAL provider (image source at import)
 *   source_uri     the object/record page
 *   label          title or shelfmark (best available pre-manifest-fetch)
 *   thumbnail      thumb URL
 *   ark            ark:/… if present (dedup key)
 *   subjects[]     union of query terms that surfaced this (accumulates)
 *   language       if known
 *   --- owned by triage ---
 *   dedup_status   unchecked | novel | duplicate
 *   matched_book_id
 *   subject_score
 *   --- owned by curator/promote ---
 *   decision       pending | import | skip
 *   reason
 *   imported_book_id
 */

export function arkOf(url = '') {
  const m = String(url).match(/ark:\/[^/]+\/[^/?#]+/);
  return m ? m[0] : null;
}

const HOST_MAP = [
  [/gallica\.bnf\.fr/, 'gallica', 'Bibliothèque nationale de France'],
  [/irht\.cnrs\.fr/, 'irht', 'IRHT (CNRS)'],
  [/bis-sorbonne\.fr/, 'sorbonne', 'Bibliothèque interuniversitaire de la Sorbonne'],
  [/digitale-sammlungen\.de/, 'bsb', 'Bayerische Staatsbibliothek'],
  [/bodleian/, 'bodleian', 'Bodleian Library'],
  [/bmlonline/, 'laurenziana', 'Biblioteca Medicea Laurenziana'],
  [/uni-heidelberg/, 'heidelberg', 'Heidelberg University Library'],
  [/purl\.pt|bn\.pt/, 'bnp', 'Biblioteca Nacional de Portugal'],
  [/vatlib\.it/, 'vatican', 'Biblioteca Apostolica Vaticana'],
  [/e-codices/, 'e-codices', 'e-codices'],
  [/universiteitleiden|leidenuniv/, 'leiden', 'Leiden University Library'],
  [/stanford\.edu/, 'stanford', 'Stanford Libraries'],
  [/lib\.cam\.ac\.uk/, 'cambridge', 'Cambridge University Library'],
  [/lib\.harvard\.edu/, 'harvard', 'Harvard Library'],
  [/europeana\.eu/, 'europeana', 'Europeana'],
  [/archive\.org/, 'internet_archive', 'Internet Archive'],
];

export function providerFromManifest(url) {
  let host = '';
  try { host = new URL(url).host; } catch { return { provider: 'unknown', source_library: 'Unknown' }; }
  for (const [re, provider, lib] of HOST_MAP) if (re.test(host)) return { provider, source_library: lib };
  return { provider: host.replace(/^www\./, ''), source_library: host };
}

/** Build a uniform candidate doc. `subjects` is the term(s) that surfaced it.
 *  `kind` is the material type (manuscript | printed | art | unknown). */
export function makeCandidate({ id, manifest_url, label, thumbnail, source_uri, aggregator, subjects = [], language = null, source_library = null, kind = null }) {
  const { provider, source_library: lib } = providerFromManifest(manifest_url);
  const ark = arkOf(manifest_url);
  return {
    _id: id || ark || manifest_url,
    provider,
    aggregator,
    source_library: source_library || lib,
    manifest_url,
    source_uri: source_uri || manifest_url.replace(/\/manifest(\.json)?$/, ''),
    label: label || null,
    thumbnail: thumbnail || null,
    ark,
    language,
    ...(kind ? { kind } : {}),
    subjects: [...new Set(subjects)],
  };
}

/**
 * Idempotent upsert. Refreshes last_seen + unions subjects; never overwrites
 * decision / dedup_status / triage fields on existing rows.
 */
export async function upsertCandidates(db, candidates, now = new Date(), collectionName = 'harvest_candidates') {
  if (!candidates.length) return { upserted: 0, modified: 0 };
  const col = db.collection(collectionName);
  await col.createIndex({ manifest_url: 1 }, { unique: true }).catch(() => {});
  await col.createIndex({ decision: 1, dedup_status: 1, provider: 1 }).catch(() => {});
  const ops = candidates.map((c) => {
    const { subjects, ...rest } = c;
    return {
      updateOne: {
        filter: { _id: c._id },
        update: {
          $set: { ...rest, last_seen: now },
          $addToSet: { subjects: { $each: subjects || [] } },
          $setOnInsert: {
            first_seen: now,
            dedup_status: 'unchecked',
            matched_book_id: null,
            subject_score: null,
            decision: 'pending',
            reason: null,
            imported_book_id: null,
          },
        },
        upsert: true,
      },
    };
  });
  const res = await col.bulkWrite(ops, { ordered: false });
  return { upserted: res.upsertedCount, modified: res.modifiedCount };
}

/** Record a per-aggregator run summary in harvest_state. */
export async function recordRun(db, aggregator, info, now = new Date()) {
  await db.collection('harvest_state').updateOne(
    { _id: aggregator },
    { $set: { ...info, last_run_at: now } },
    { upsert: true },
  );
}

/** True if this manifest_url already exists in the catalog (books.image_source.iiif_manifest).
 *  Cheap exact-URL dedup the triage ARK-matcher can miss (e.g. Leiden, no ARK). */
export async function loadOwnedManifests(db) {
  const rows = await db.collection('books')
    .find({ 'image_source.iiif_manifest': { $exists: true, $ne: null } }, { projection: { 'image_source.iiif_manifest': 1 } })
    .toArray();
  return new Set(rows.map((b) => b.image_source?.iiif_manifest).filter(Boolean));
}

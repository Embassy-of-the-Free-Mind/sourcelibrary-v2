/**
 * Candidate Store — MongoDB staging collection for IIIF discovery.
 *
 * Books are discovered into `import_candidates` before being imported
 * into the main `books` collection. This separates discovery from import,
 * allowing review, filtering, and resumption.
 *
 * Statuses:
 *   discovered → queued → importing → imported
 *                                   → failed
 *              → skipped (dedup, bad metadata, etc.)
 */

/**
 * Ensure indexes exist on import_candidates collection.
 * Call once at script startup.
 */
export async function ensureIndexes(db) {
  const col = db.collection('import_candidates');
  await col.createIndex({ manifest_url: 1 }, { unique: true });
  await col.createIndex({ source: 1, status: 1 });
  await col.createIndex({ status: 1, date_earliest: 1 });
  await col.createIndex({ source: 1, source_id: 1 });
  await col.createIndex({ normalized_title: 1, normalized_author: 1 });
}

/**
 * Insert a discovered candidate. Skips if manifest_url already exists.
 *
 * @param {import('mongodb').Db} db
 * @param {Object} candidate
 * @returns {{ inserted: boolean, existing?: boolean }}
 */
export async function insertCandidate(db, candidate) {
  const col = db.collection('import_candidates');
  const doc = {
    manifest_url: candidate.manifest_url,
    source: candidate.source,
    origin_library: candidate.origin_library || candidate.source,
    title: candidate.title || 'Unknown',
    author: candidate.author || 'Unknown',
    display_title: candidate.display_title || null,
    language: candidate.language || 'Unknown',
    date_text: candidate.date_text || null,
    date_earliest: candidate.date_earliest || null,
    date_latest: candidate.date_latest || null,
    page_count: candidate.page_count || null,
    categories: candidate.categories || [],
    provider_name: candidate.provider_name || candidate.source,
    source_url: candidate.source_url || null,
    source_id: candidate.source_id || null,
    metadata: candidate.metadata || {},
    status: 'discovered',
    skip_reason: null,
    book_id: null,
    discovered_at: new Date(),
    imported_at: null,
  };

  try {
    await col.insertOne(doc);
    return { inserted: true };
  } catch (err) {
    if (err.code === 11000) {
      return { inserted: false, existing: true };
    }
    throw err;
  }
}

/**
 * Batch insert candidates. Returns counts.
 */
export async function insertCandidates(db, candidates) {
  if (candidates.length === 0) return { inserted: 0, skipped: 0 };

  const col = db.collection('import_candidates');
  const docs = candidates.map(c => ({
    manifest_url: c.manifest_url,
    source: c.source,
    origin_library: c.origin_library || c.source,
    title: c.title || 'Unknown',
    author: c.author || 'Unknown',
    display_title: c.display_title || null,
    language: c.language || 'Unknown',
    date_text: c.date_text || null,
    date_earliest: c.date_earliest || null,
    date_latest: c.date_latest || null,
    page_count: c.page_count || null,
    categories: c.categories || [],
    provider_name: c.provider_name || c.source,
    source_url: c.source_url || null,
    source_id: c.source_id || null,
    metadata: c.metadata || {},
    status: 'discovered',
    skip_reason: null,
    book_id: null,
    discovered_at: new Date(),
    imported_at: null,
  }));

  try {
    const result = await col.insertMany(docs, { ordered: false });
    return { inserted: result.insertedCount, skipped: candidates.length - result.insertedCount };
  } catch (err) {
    if (err.code === 11000) {
      // Some dupes — partial insert
      const inserted = err.result?.insertedCount || err.insertedCount || 0;
      return { inserted, skipped: candidates.length - inserted };
    }
    throw err;
  }
}

/**
 * Get candidates ready for import.
 */
export async function getCandidatesForImport(db, { source, limit = 100, minYear, maxYear, languages } = {}) {
  const filter = { status: 'discovered' };
  if (source) filter.source = source;
  if (minYear) filter.date_earliest = { $gte: minYear };
  if (maxYear) {
    // Include books with date <= maxYear OR unknown date
    filter.$or = [
      { date_earliest: { $lte: maxYear } },
      { date_earliest: null },
    ];
  }
  if (languages?.length) filter.language = { $in: languages };

  return db.collection('import_candidates')
    .find(filter)
    .sort({ date_earliest: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Update candidate status.
 */
export async function updateCandidateStatus(db, manifestUrl, status, extra = {}) {
  return db.collection('import_candidates').updateOne(
    { manifest_url: manifestUrl },
    {
      $set: {
        status,
        ...extra,
        ...(status === 'imported' ? { imported_at: new Date() } : {}),
      }
    }
  );
}

/**
 * Get discovery/import progress summary.
 */
export async function getProgress(db, source) {
  const matchStage = source ? { $match: { source } } : { $match: {} };
  const results = await db.collection('import_candidates').aggregate([
    matchStage,
    {
      $group: {
        _id: { source: '$source', status: '$status' },
        count: { $sum: 1 },
      }
    },
    { $sort: { '_id.source': 1, '_id.status': 1 } },
  ]).toArray();

  const summary = {};
  for (const r of results) {
    const src = r._id.source;
    if (!summary[src]) summary[src] = { total: 0 };
    summary[src][r._id.status] = r.count;
    summary[src].total += r.count;
  }
  return summary;
}

/**
 * Get the last source_id discovered for a given source (for resumption).
 */
export async function getLastDiscoveredId(db, source) {
  const last = await db.collection('import_candidates')
    .find({ source })
    .sort({ discovered_at: -1 })
    .limit(1)
    .project({ source_id: 1 })
    .toArray();
  return last[0]?.source_id || null;
}

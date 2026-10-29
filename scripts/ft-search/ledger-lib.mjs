// PRIOR ART: src/lib/first-translation/card.ts defines the work_translation_history doc shape (read side);
// scripts/eval/card-prior-candidates.mjs writes whole cards for the retired card-review lane. Nothing appends one
// entry from a fresh-search credit, or holds a proposed change as a book_events row (#7598), so this is that.
//
// Shared by ingest.mjs, select-batch.mjs, recheck-credits.mjs, work-conflicts.mjs and held-review.mjs.
// Pure functions, no I/O except where a collection is passed in.

export const LEDGER = 'work_translation_history';
export const HELD_EVENT = 'ft_change_held_for_review';
const GRADE_RANK = { strong: 0, moderate: 1, weak: 2 };

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The ledger entry for a credit the fresh search wrote (shape of the existing entries[]). */
export function entryFromCredit(credit, attemptId) {
  return {
    kind: 'english_translation',
    year: credit.year != null ? String(credit.year) : null,
    translator: (credit.translators || []).join('; ') || null,
    title: credit.work_title || null,
    publisher: credit.publisher || null,
    completeness: credit.scope || 'unknown',
    relationship: 'same_text',
    citation_url: credit.url || null,
    source_attempt_ids: [attemptId],
    evidence_grade: 'moderate',
    verified: false,
    source: 'ft_fresh_search',
  };
}

/** Same translation already on the card? Same citation_url, or same title and year. */
export function sameEntry(a, b) {
  if (a.citation_url && b.citation_url && a.citation_url === b.citation_url) return true;
  return !!(norm(a.title) && norm(a.title) === norm(b.title) && String(a.year ?? '') === String(b.year ?? ''));
}

/**
 * Decide what to do with `entry` on a work's card (`doc` may be null). Never removes or rewrites an entry:
 * returns { action: 'duplicate' | 'append' | 'create', op } where op is a Mongo bulkWrite operation (or null).
 * A new card is created as status 'under_review', which cardLabel() renders as nothing; the status of an
 * existing card is never touched.
 */
export function ledgerOp(workId, doc, entry, now = new Date()) {
  if (doc && (doc.entries || []).some((e) => sameEntry(e, entry))) return { action: 'duplicate', op: null };
  const stamped = { ...entry, added_at: now.toISOString() };
  if (doc) return { action: 'append', op: { updateOne: { filter: { _id: workId }, update: { $push: { entries: stamped } } } } };
  return {
    action: 'create',
    op: { updateOne: { filter: { _id: workId }, update: { $setOnInsert: { work_id: workId, status: 'under_review', seeded_from: 'ft_fresh_search', created_at: now.toISOString() }, $push: { entries: stamped } }, upsert: true } },
  };
}

/** One line per ledger entry, as leads for the search prompt: verified and strong first, labelled by grade. */
export function ledgerLeads(doc, max = 8) {
  const rows = (doc?.entries || []).filter((e) => (e.kind || 'english_translation') === 'english_translation' && (e.title || e.translator));
  if (!rows.length) return null;
  rows.sort((x, y) => (y.verified ? 1 : 0) - (x.verified ? 1 : 0) || (GRADE_RANK[x.evidence_grade] ?? 3) - (GRADE_RANK[y.evidence_grade] ?? 3));
  const label = (e) => `works ledger: ${e.verified ? 'verified' : 'unverified'}, evidence ${e.evidence_grade || 'ungraded'}${e.completeness && e.completeness !== 'unknown' ? `, ${e.completeness}` : ''}${e.source === 'ft_fresh_search' ? ', our earlier search' : ''}`;
  const line = (e) => `- ${e.title || '(untitled)'}${e.translator ? `, tr. ${e.translator}` : ''}${e.year ? ` (${e.year})` : ''}${e.publisher ? `, ${e.publisher}` : ''} [${label(e)}]${e.citation_url ? ` ${e.citation_url}` : ''}`;
  return `${rows.length} earlier English translation(s) of this WORK are recorded in our works ledger${rows.length > max ? `; the ${max} best graded` : ''}. They are LEADS to check, not answers: unverified ones are often a different work, a different edition, or not real. Cite one only after you find it yourself.\n${rows.slice(0, max).map(line).join('\n')}\n`;
}

/**
 * A change the pipeline will not make by itself, kept in the database for a human (or a later approved run).
 * Returns the book_events row. `change` names the proposed action; held-review.mjs knows how to apply each one.
 */
export function heldEvent({ book_id, change, reason, current = null, proposed = null, attempt_id = null, by, now = new Date() }) {
  return { book_id, type: HELD_EVENT, at: now, by, ...(attempt_id ? { attempt_id } : {}), detail: { change, reason, current, proposed } };
}

/** Insert held rows unless an unresolved one for the same book and change is already there. Returns the number inserted. */
export async function insertHeld(events, rows) {
  if (!rows.length) return 0;
  const open = await events.find({ type: HELD_EVENT, resolved_at: { $exists: false }, book_id: { $in: rows.map((r) => r.book_id) } }, { projection: { book_id: 1, 'detail.change': 1 } }).toArray();
  const seen = new Set(open.map((e) => `${e.book_id}|${e.detail?.change}`));
  const fresh = rows.filter((r) => !seen.has(`${r.book_id}|${r.detail.change}`));
  if (fresh.length) await events.insertMany(fresh, { ordered: false });
  return fresh.length;
}

/** The last line of a `claude -p --output-format json` file whose result holds a JSON object with `key`. */
export function parseAnswer(text, key = 'verdict') {
  let found = null;
  for (const line of String(text).split('\n')) {
    try { const m = (JSON.parse(line).result || '').match(/\{[\s\S]*\}/); const j = m && JSON.parse(m[0]); if (j && j[key]) found = j; } catch { /* not this line */ }
  }
  return found;
}

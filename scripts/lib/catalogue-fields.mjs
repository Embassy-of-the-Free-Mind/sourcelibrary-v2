// PRIOR ART: scripts/maintenance/correct-imprint-from-titlepage.mjs — the write shape lifted here (read the current
// values, stamp each field with previous_value, compare-and-set on the values read), but it is a CLI for one book
// from one title page, not a function another writer can call. scripts/lib/field-provenance.mjs builds the stamp
// operators but does not read the record, so a caller can still pass a guessed previous_value or skip it entirely.
/**
 * The one write path for a book's IMPRINT: year, place, printer (#6327).
 *
 * WHY. On 2026-10-08 a featured book was cited as "Venice, Aldus Manutius, 1516"; its title page says Lyon, Jean
 * de Tournes, 1549. `place_published` and `publisher` carried no `field_provenance` stamp at all, so "who wrote
 * this, and from what?" had no answer. Epic #4043 measured the general state: 81 writers, 164 stamp shapes, and
 * only 16.1% of stamps record what they replaced. A citation is only as good as that record.
 *
 * THE RULE. A write to any field in IMPRINT_FIELDS carries, in the same update, a `field_provenance.<field>` stamp
 * with `source`, `script`, `date` and `previous_value`. This helper is how: it refuses a stamp without `source` or
 * `script`, reads the current values itself (a caller cannot supply — or forget — `previous_value`), and writes
 * value + stamp + history entry in one guarded `updateOne`. `scripts/audit/imprint-field-writes.mjs` fails CI on a
 * write of these fields anywhere else, against a baseline of today's writers that can only shrink.
 *
 *   import { setCatalogueFields } from '../lib/catalogue-fields.mjs';
 *   await setCatalogueFields(db, book.id, { place_published: 'Lyon', publisher: 'Jean de Tournes' },
 *     { source: 'titlepage', script: 'scripts/maintenance/x.mjs', evidence: { page_number: 3, as_printed: '…' } });
 */
import { provenanceUpdate, ProvenanceError } from './field-provenance.mjs';

export { ProvenanceError };

/**
 * The imprint family. `published` and `year` are the date; the rest are the place and the printer under the names
 * they accumulated (the 'imprint / publication' family in scripts/audit/field-sprawl.mjs). `format` sits in that
 * family too but is a physical description, not a citation claim, so it is not gated here.
 */
export const IMPRINT_FIELDS = Object.freeze([
  'published', 'year', 'place_published', 'publisher', 'publication_place', 'place_of_publication', 'place', 'printer',
]);

/** Written beside an imprint field, never on its own; it describes `year`, so it gets no stamp of its own. */
const COMPANIONS = new Set(['year_source']);

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Check a stamp before anything is read or written. Exported so a caller can fail fast (e.g. on CLI arguments)
 * before it opens a connection.
 */
export function assertCatalogueStamp(stamp) {
  if (!stamp || typeof stamp !== 'object') throw new ProvenanceError('setCatalogueFields: a provenance stamp is required');
  if (!nonEmpty(stamp.source)) throw new ProvenanceError('setCatalogueFields: the stamp needs a non-empty `source` (where the value came from)');
  if (!nonEmpty(stamp.script)) throw new ProvenanceError('setCatalogueFields: the stamp needs a non-empty `script` (what wrote it)');
  if ('previous_value' in stamp || 'previous_provenance' in stamp) {
    throw new ProvenanceError('setCatalogueFields: do not pass previous_value — the helper reads it from the record');
  }
}

function assertFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new ProvenanceError('setCatalogueFields: fields must be an object');
  const keys = Object.keys(fields);
  if (!keys.some((k) => IMPRINT_FIELDS.includes(k))) throw new ProvenanceError('setCatalogueFields: no imprint field to write');
  for (const k of keys) {
    if (!IMPRINT_FIELDS.includes(k) && !COMPANIONS.has(k)) {
      throw new ProvenanceError(`setCatalogueFields: '${k}' is not an imprint field (${IMPRINT_FIELDS.join(', ')})`);
    }
    if (fields[k] === undefined) throw new ProvenanceError(`setCatalogueFields: '${k}' is undefined — pass null to clear it`);
  }
}

/**
 * Pure: given the record as read, the fields to write and the stamp, the `updateOne` filter and update — or null
 * when nothing differs. Split out so the guarantees are testable without a database.
 */
export function buildCatalogueUpdate(book, fields, stamp, now = new Date()) {
  assertCatalogueStamp(stamp);
  assertFields(fields);
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => !same(book[k], v)));
  if (!Object.keys(changed).some((k) => IMPRINT_FIELDS.includes(k))) return null;
  const $set = { ...changed, updated_at: now };
  const $push = {};
  const before = {};
  for (const f of Object.keys(changed)) {
    before[f] = book[f] ?? null;
    if (COMPANIONS.has(f)) continue;
    const prov = provenanceUpdate(f, {
      ...stamp,
      date: stamp.date ?? now,
      previous_value: book[f] ?? null,
      previous_provenance: book.field_provenance?.[f] ?? null,
    });
    Object.assign($set, prov.$set);
    Object.assign($push, prov.$push);
  }
  // Compare-and-set on the values read: if another writer changed the record in between, write nothing.
  const filter = { _id: book._id };
  for (const f of Object.keys(changed)) filter[f] = book[f] === undefined ? { $exists: false } : book[f];
  return { filter, update: { $set, $push }, before, changed };
}

/**
 * Write imprint fields on one book with a provenance stamp per field. Looks the book up by `id` OR `_id`
 * (book-deletion-and-identity.md: an `_id`-only lookup misses 16K books).
 *
 * @param {import('mongodb').Db} db
 * @param {string} bookId
 * @param {Record<string, unknown>} fields  imprint fields (and `year_source`) to set; null clears a value
 * @param {{source: string, script: string, date?: Date|string, [k: string]: unknown}} stamp
 * @returns {Promise<{modified: 0|1, before: object, changed: object, book_id: string}>}
 * @throws {ProvenanceError} on a stamp without source/script, a non-imprint field, a missing book, or a record that
 *   changed between read and write.
 */
export async function setCatalogueFields(db, bookId, fields, stamp) {
  assertCatalogueStamp(stamp);
  assertFields(fields);
  const books = db.collection('books');
  const projection = { id: 1, field_provenance: 1, ...Object.fromEntries(Object.keys(fields).map((f) => [f, 1])) };
  const book = await books.findOne({ $or: [{ id: bookId }, { _id: bookId }] }, { projection });
  if (!book) throw new ProvenanceError(`setCatalogueFields: book ${bookId} not found (looked up by id and _id)`);
  const built = buildCatalogueUpdate(book, fields, stamp);
  if (!built) return { modified: 0, before: {}, changed: {}, book_id: book.id ?? String(book._id) };
  const r = await books.updateOne(built.filter, built.update);
  if (r.modifiedCount !== 1) throw new ProvenanceError(`setCatalogueFields: book ${bookId} changed since it was read; nothing written`);
  return { modified: 1, before: built.before, changed: built.changed, book_id: book.id ?? String(book._id) };
}

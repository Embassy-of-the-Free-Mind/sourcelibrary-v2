/**
 * `book_relations` — how two book records relate, WITHOUT hiding either one.
 *
 * PRIOR ART: `books.duplicate_of` (written by src/app/api/admin/duplicates,
 * checked by scripts/maintenance/duplicate-integrity-check.mjs) — a one-way
 * pointer stored on the book that also HIDES it. It fits "this record is the
 * same digital object, redundant" and nothing else: the #6019 review found it
 * on a 474-page Sammelband pointing at an 89-page tract, 5 pointers in cycles,
 * and 114 hidden copies holding 1,050 translated pages their "keeper" lacks.
 * A relation is a ROW (.claude/docs/invariants/field-sprawl.md), so this is a
 * collection, not another field on `books`. Also looked at: `books.work_id`
 * and `books.edition_key` (computed identity, not an assertion a person makes
 * about two named records) and `dedup_skips` (a log of gate decisions).
 *
 * WHO USES IT. A curator or a Claude session that has looked at two books and
 * wants to record "these are two copies of one edition" or "this volume is
 * bound with that one". `checkHoldings()` reads the rows back.
 *
 * WHAT IT NEVER DOES. Nothing here writes to `books`. A relation does not
 * hide, show, merge or rank a book, and nothing automated acts on a row.
 * `duplicate_of` stays the tool for same-object records.
 *
 * THE ROW. `{ _id, a, b, type, evidence, created_by, created_at }`. `a` and
 * `b` are canonical book ids: `String(book.id || book._id)`, resolved from
 * whatever the caller passed (`id`, `_id` as string or ObjectId, or a slug) —
 * 16,343 books have a re-minted `_id`, so an unresolved id would split one
 * book's relations in two. For the symmetric types `a < b`, so a pair has one
 * row however it was entered. `contains` is directed: `a` contains `b`.
 * Unique on `(a, b, type)` — declared in scripts/maintenance/ensure-indexes.mjs.
 */

import { ObjectId, type Db, type Document } from 'mongodb';

export const BOOK_RELATIONS = 'book_relations';

export const RELATION_TYPES = ['other_copy_of_edition', 'bound_with', 'contains'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** `contains` is the one directed type: `a` is the volume, `b` the part. */
const SYMMETRIC: ReadonlySet<RelationType> = new Set<RelationType>(['other_copy_of_edition', 'bound_with']);
export const isSymmetric = (type: RelationType) => SYMMETRIC.has(type);
export const isRelationType = (t: unknown): t is RelationType =>
  typeof t === 'string' && (RELATION_TYPES as readonly string[]).includes(t);

export interface BookRelation {
  _id?: ObjectId;
  a: string;
  b: string;
  type: RelationType;
  /** What was looked at: "title pages identical line for line; two BSB copies". */
  evidence: string;
  created_by: string;
  created_at: Date;
}

/** How the OTHER book stands to the one asked about. */
export type RelationRole = 'other_copy_of_edition' | 'bound_with' | 'contains' | 'contained_in';

export interface RelatedBook {
  /** The book the question was about. */
  of: string;
  /** The book on the other end. */
  book_id: string;
  type: RelationType;
  /** `contains`: the other book is a part of `of`. `contained_in`: the reverse. */
  role: RelationRole;
  evidence: string;
  created_by: string;
  created_at: Date | null;
}

export interface AddRelationInput {
  a: string;
  b: string;
  type: RelationType;
  evidence: string;
  created_by: string;
}

export const canonicalBookId = (doc: Document): string => String(doc.id || doc._id);

/** The stored order of a pair: sorted for symmetric types, as given for `contains`. */
export function orderPair(a: string, b: string, type: RelationType): { a: string; b: string } {
  return isSymmetric(type) && a > b ? { a: b, b: a } : { a, b };
}

/** One of our books, by `id`, `_id` (string or ObjectId) or slug → its canonical id. */
export async function resolveBookId(db: Db, ref: string): Promise<string | null> {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  const or: Document[] = [{ id: r }, { _id: r as unknown as ObjectId }, { slug: r }];
  if (/^[0-9a-f]{24}$/i.test(r)) or.push({ _id: new ObjectId(r) });
  const doc = await db.collection('books').findOne({ $or: or }, { projection: { _id: 1, id: 1 } });
  return doc ? canonicalBookId(doc) : null;
}

/**
 * Record a relation. Idempotent: the same pair and type entered again, in
 * either order for a symmetric type, returns the existing row untouched
 * (`created: false`) — the first evidence stands.
 *
 * Throws when a book does not resolve, when both ends are the same book, when
 * evidence or author is empty, or when a `contains` row would contradict one
 * already stored in the other direction.
 */
export async function addRelation(db: Db, input: AddRelationInput): Promise<{ relation: BookRelation; created: boolean }> {
  if (!isRelationType(input.type)) throw new Error(`book_relations: unknown type "${String(input.type)}" (one of ${RELATION_TYPES.join(', ')})`);
  const evidence = String(input.evidence ?? '').trim();
  const created_by = String(input.created_by ?? '').trim();
  if (!evidence) throw new Error('book_relations: evidence is required — say what was compared');
  if (!created_by) throw new Error('book_relations: created_by is required');

  const [ra, rb] = await Promise.all([resolveBookId(db, input.a), resolveBookId(db, input.b)]);
  if (!ra) throw new Error(`book_relations: no book resolves from "${input.a}" (looked up by id, _id and slug)`);
  if (!rb) throw new Error(`book_relations: no book resolves from "${input.b}" (looked up by id, _id and slug)`);
  if (ra === rb) throw new Error(`book_relations: both ends are the same book (${ra})`);

  const { a, b } = orderPair(ra, rb, input.type);
  const coll = db.collection<BookRelation>(BOOK_RELATIONS);
  if (input.type === 'contains' && (await coll.findOne({ a: b, b: a, type: 'contains' }))) {
    throw new Error(`book_relations: ${b} is already recorded as containing ${a}; a book cannot contain its own container`);
  }

  const key = { a, b, type: input.type };
  try {
    const res = await coll.updateOne(key, { $setOnInsert: { ...key, evidence, created_by, created_at: new Date() } }, { upsert: true });
    const relation = (await coll.findOne(key)) as BookRelation;
    return { relation, created: res.upsertedCount === 1 };
  } catch (err) {
    // Two writers entering the same pair at once: the unique index lets one
    // insert win and the other lands here.
    if ((err as { code?: number }).code !== 11000) throw err;
    return { relation: (await coll.findOne(key)) as BookRelation, created: false };
  }
}

/** A row another writer could have left malformed is skipped, never guessed at. */
function wellFormed(row: Document): row is BookRelation {
  return typeof row.a === 'string' && typeof row.b === 'string' && !!row.a && !!row.b && row.a !== row.b && isRelationType(row.type);
}

function roleFor(type: RelationType, askedIsA: boolean): RelationRole {
  if (type !== 'contains') return type;
  return askedIsA ? 'contains' : 'contained_in';
}

/**
 * Relations of books whose CANONICAL ids are already in hand (see
 * `canonicalBookId`). One query for the whole list. A pair stored twice — by
 * a writer that skipped the sort, or before the unique index existed — is
 * returned once.
 */
export async function relationsOfIds(db: Db, ids: string[]): Promise<RelatedBook[]> {
  const wanted = new Set(ids.filter(Boolean));
  if (wanted.size === 0) return [];
  const list = [...wanted];
  const rows = await db.collection(BOOK_RELATIONS)
    .find({ $or: [{ a: { $in: list } }, { b: { $in: list } }] })
    .sort({ created_at: 1 })
    .toArray();
  const out: RelatedBook[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!wellFormed(row)) continue;
    for (const askedIsA of [true, false]) {
      const of = askedIsA ? row.a : row.b;
      if (!wanted.has(of)) continue;
      const other = askedIsA ? row.b : row.a;
      const role = roleFor(row.type, askedIsA);
      const k = `${of}\u0000${other}\u0000${role}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        of,
        book_id: other,
        type: row.type,
        role,
        evidence: String(row.evidence ?? ''),
        created_by: String(row.created_by ?? ''),
        created_at: row.created_at instanceof Date ? row.created_at : null,
      });
    }
  }
  return out;
}

/** Relations of one book, named by `id`, `_id` or slug. Empty when it does not resolve. */
export async function relationsOf(db: Db, ref: string): Promise<RelatedBook[]> {
  const id = await resolveBookId(db, ref);
  return id ? relationsOfIds(db, [id]) : [];
}

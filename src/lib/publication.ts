/**
 * Publication state: one field per book, one writer (#5340, step 1 of #5303).
 *
 * PRIOR ART: scripts/lib/publication.mjs — this is its TS twin for the Next.js
 * routes; tests/unit/publication-parity.test.ts runs both over the same fixtures.
 * Design: .claude/docs/publication-state.md. src/lib/book-access.ts reads the
 * legacy fields at the reader gate and is not a writer.
 *
 * Until the backfill, the writer ALSO writes the legacy `visible` / `hidden` /
 * `hidden_reason`, derived from the state, in the same update, and
 * publicationFilter() expands to the legacy predicates.
 */
import { ObjectId, type Db, type Document, type Filter, type ObjectId as ObjectIdType } from 'mongodb';

export const PUBLICATION_STATES = ['public', 'unpublished', 'hidden', 'takedown'] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const PUBLICATION_REASONS = [
  'duplicate', 'quality', 'unprocessed', 'unarchived', 'curation',
  'wrong_content', 'rights', 'provider_restricted', 'launch_curation',
] as const;
export type PublicationReason = (typeof PUBLICATION_REASONS)[number];

export const PUBLICATION_VIEWS = [
  'public', 'live', 'reachable', 'not_public', 'unpublished', 'withdrawn', 'takedown',
] as const;
export type PublicationView = (typeof PUBLICATION_VIEWS)[number];

export const RIGHTS_CLEARED = 'rights-cleared';

/** False until the backfill has written `publication` on every book. */
export const PUBLICATION_BACKFILLED = false;

export interface Publication {
  state: PublicationState;
  reason: PublicationReason | null;
  note: string | null;
  since: Date;
  by: string;
  issue?: number;
  duplicate_of?: string;
  version: 1;
}

export interface PublicationOpts {
  state: PublicationState;
  reason?: PublicationReason | null;
  note?: string | null;
  /** An email, `script:<name>` or `route:<path>`. */
  by: string;
  /** GitHub issue number; required for takedown and for leaving it. */
  issue?: number;
  override?: typeof RIGHTS_CLEARED;
  /** Keeper id, recorded when reason = duplicate. */
  duplicateOf?: string;
  /** Only write when the current state is one of these; otherwise `skipped`. */
  from?: PublicationState[];
  now?: Date;
}

interface ReasonMapEntry {
  match: string | RegExp;
  state?: 'takedown';
  reason: PublicationReason;
}

/** Reviewed mapping of legacy `hidden_reason` strings. Keep identical to the .mjs twin. */
export const LEGACY_REASON_MAP: readonly ReasonMapEntry[] = [
  { match: 'kloss_manuscripts_removed_2026-07-08', state: 'takedown', reason: 'rights' },
  { match: /^takedown:/, state: 'takedown', reason: 'rights' },
  { match: /copyright|takedown|dmca|rights/i, state: 'takedown', reason: 'rights' },
  { match: /removal requested by owner/i, state: 'takedown', reason: 'rights' },
  { match: /^awaiting_permission_/, reason: 'rights' },
  { match: 'launch_curation', reason: 'launch_curation' },
  { match: 'unprocessed', reason: 'unprocessed' },
  { match: 'artwork_import', reason: 'unprocessed' },
  { match: 'awaiting_qa_eval', reason: 'unprocessed' },
  { match: 'unarchived', reason: 'unarchived' },
  { match: 'duplicate', reason: 'duplicate' },
  { match: /^duplicate[ _]/i, reason: 'duplicate' },
  { match: 'same_edition_duplicate', reason: 'duplicate' },
  { match: /^superseded by /, reason: 'duplicate' },
  { match: 'low_resolution', reason: 'quality' },
  { match: 'too-small-under-200px', reason: 'quality' },
  { match: 'svg-or-pdf-not-displayable', reason: 'quality' },
  { match: 'empty-failed-import', reason: 'quality' },
  { match: 'no_pages', reason: 'quality' },
  { match: /^source scan defective/, reason: 'quality' },
  { match: 'qa_ocr_invented_text', reason: 'quality' },
  { match: /^fabricated_ocr/, reason: 'quality' },
  { match: /^scan_mismatch/, reason: 'wrong_content' },
  { match: 'qa_wrong_subject_title', reason: 'wrong_content' },
  { match: /^attribution-review/, reason: 'wrong_content' },
  { match: /^Leiden IIIF returns 403/, reason: 'provider_restricted' },
  { match: /^IA access-restricted lending item/, reason: 'provider_restricted' },
  { match: /^date \d{3,4} outside collection period$/, reason: 'curation' },
  { match: 'tourist photo / broken metadata', reason: 'curation' },
  { match: 'photographer/uploader, not artist', reason: 'curation' },
  { match: 'exhibition_photo', reason: 'curation' },
  { match: 'not_standalone_artwork', reason: 'curation' },
  { match: /^per-page artwork doc/, reason: 'curation' },
  { match: /^junk artwork record/, reason: 'curation' },
  { match: /^test-record/, reason: 'curation' },
  { match: 'off_mission_not_primary_source', reason: 'curation' },
  { match: /^Modern typeset\/digital edition/, reason: 'curation' },
  { match: /translation-of-translation/, reason: 'curation' },
  { match: /^derek_feedback_remove_/, reason: 'curation' },
  { match: /^curation: /, reason: 'curation' },
];

export interface MappedReason {
  state: 'takedown' | null;
  reason: PublicationReason | null;
  note: string | null;
  mapped: boolean;
}

export function mapLegacyReason(hiddenReason: unknown): MappedReason {
  if (hiddenReason == null || hiddenReason === '') {
    return { state: null, reason: null, note: null, mapped: true };
  }
  const s = String(hiddenReason);
  for (const entry of LEGACY_REASON_MAP) {
    const hit = typeof entry.match === 'string' ? entry.match === s : entry.match.test(s);
    if (hit) {
      return { state: entry.state ?? null, reason: entry.reason, note: s === entry.reason ? null : s, mapped: true };
    }
  }
  return { state: null, reason: 'curation', note: s, mapped: false };
}

export type PublicationConflict =
  | 'public_with_hidden_reason' | 'hidden_without_reason' | 'unpublished_with_rights_reason' | null;

export interface CurrentPublication {
  state: PublicationState;
  reason: PublicationReason | null;
  note: string | null;
  conflict: PublicationConflict;
}

/** The publication a book has today: `publication` if set, else derived from the legacy fields. */
export function legacyPublication(book: Document | null | undefined): CurrentPublication {
  const pub = book?.publication;
  if (pub && (PUBLICATION_STATES as readonly string[]).includes(pub.state)) {
    return { state: pub.state, reason: pub.reason ?? null, note: pub.note ?? null, conflict: null };
  }
  const mapped = mapLegacyReason(book?.hidden_reason);
  if (book?.visible === true) {
    return {
      state: 'public', reason: null, note: null,
      conflict: book.hidden_reason != null ? 'public_with_hidden_reason' : null,
    };
  }
  if (book?.visible === false) {
    return {
      state: mapped.state === 'takedown' ? 'takedown' : 'hidden',
      reason: mapped.reason ?? 'curation',
      note: mapped.note,
      conflict: mapped.reason == null ? 'hidden_without_reason' : null,
    };
  }
  return {
    state: 'unpublished',
    reason: mapped.reason,
    note: mapped.note,
    conflict: mapped.state === 'takedown' ? 'unpublished_with_rights_reason' : null,
  };
}

export interface DerivedLegacy {
  set: Record<string, unknown>;
  unset: string[];
}

/** Legacy fields derived from a state (doc table "Compatibility"). */
export function derivedLegacyFields(state: PublicationState, reason: PublicationReason | null): DerivedLegacy {
  switch (state) {
    case 'public':
      return { set: { visible: true, hidden: false }, unset: ['hidden_reason'] };
    case 'unpublished':
      return { set: {}, unset: ['visible', 'hidden', 'hidden_reason'] };
    case 'hidden':
      return { set: { visible: false, hidden: true, hidden_reason: reason }, unset: [] };
    case 'takedown':
      return { set: { visible: false, hidden: true, hidden_reason: `takedown:${reason}` }, unset: [] };
    default:
      throw new Error(`publication: unknown state ${JSON.stringify(state)}`);
  }
}

function legacyAgrees(book: Document, state: PublicationState, reason: PublicationReason | null): boolean {
  const { set, unset } = derivedLegacyFields(state, reason);
  for (const [k, v] of Object.entries(set)) if (book?.[k] !== v) return false;
  for (const k of unset) if (book?.[k] !== undefined) return false;
  return true;
}

/** Validate a requested transition from `from`; throws on refusal. */
export function checkTransition(from: PublicationState, opts: Partial<PublicationOpts> | undefined): void {
  const { state, reason, by, issue, override } = opts || {};
  if (!state || !(PUBLICATION_STATES as readonly string[]).includes(state)) {
    throw new Error(`publication: state must be one of ${PUBLICATION_STATES.join(', ')} (got ${JSON.stringify(state)})`);
  }
  if (reason != null && !(PUBLICATION_REASONS as readonly string[]).includes(reason)) {
    throw new Error(`publication: reason must be one of ${PUBLICATION_REASONS.join(', ')} (got ${JSON.stringify(reason)}); put free text in note`);
  }
  if (typeof by !== 'string' || !by.trim()) {
    throw new Error('publication: `by` is required (an email, script:<name> or route:<path>)');
  }
  if (state === 'hidden' && !reason) {
    throw new Error('publication: hiding a book requires a reason');
  }
  if (state === 'takedown' && !Number.isInteger(issue)) {
    throw new Error('publication: a takedown requires `issue` (the GitHub issue number)');
  }
  if (from === 'takedown' && state !== 'takedown') {
    if (override !== RIGHTS_CLEARED || !Number.isInteger(issue)) {
      throw new Error(`publication: leaving takedown requires { override: '${RIGHTS_CLEARED}', issue }`);
    }
  }
}

function effectiveReason(state: PublicationState, reason: PublicationReason | null | undefined): PublicationReason | null {
  if (state === 'public') return null;
  if (state === 'takedown') return reason ?? 'rights';
  return reason ?? null;
}

function buildUpdate(state: PublicationState, reason: PublicationReason | null, opts: PublicationOpts, now: Date) {
  const publication: Publication = { state, reason, note: opts.note ?? null, since: now, by: opts.by, version: 1 };
  if (opts.issue != null) publication.issue = opts.issue;
  if (reason === 'duplicate' && opts.duplicateOf) publication.duplicate_of = opts.duplicateOf;

  const { set, unset } = derivedLegacyFields(state, reason);
  const $set: Record<string, unknown> = { publication, ...set, updated_at: now };
  if (state === 'hidden' || state === 'takedown') $set.hidden_at = now;
  if (reason === 'duplicate' && opts.duplicateOf) $set.duplicate_of = opts.duplicateOf;
  const update: { $set: Record<string, unknown>; $unset?: Record<string, ''> } = { $set };
  if (unset.length) update.$unset = Object.fromEntries(unset.map((k) => [k, ''] as const));
  return update;
}

const HEX24 = /^[0-9a-f]{24}$/i;

/** Mongo filter matching a book by `id` OR `_id` (16,343 books have a re-minted `_id`). */
export function bookRefFilter(ref: string): Filter<Document> {
  const s = String(ref);
  const or: Filter<Document>[] = [{ id: s }, { _id: s as never }];
  if (HEX24.test(s)) or.push({ _id: new ObjectId(s) });
  return { $or: or };
}

function bookRefsFilter(refs: string[]): Filter<Document> {
  const oids = refs.filter((s) => HEX24.test(s)).map((s) => new ObjectId(s));
  return { $or: [{ id: { $in: refs } }, { _id: { $in: [...refs, ...oids] as never[] } }] };
}

const PROJECTION = { _id: 1, id: 1, visible: 1, hidden: 1, hidden_reason: 1, publication: 1 };

function eventFor(
  book: Document, from: CurrentPublication, state: PublicationState,
  reason: PublicationReason | null, opts: PublicationOpts, now: Date,
) {
  return {
    book_id: book.id ?? String(book._id),
    from: from.state,
    from_reason: from.reason ?? null,
    to: state,
    reason,
    note: opts.note ?? null,
    by: opts.by,
    issue: opts.issue ?? null,
    override: opts.override ?? null,
    at: now,
    // Fan-out to copies is step 3 (#5342); null = not attempted by the writer.
    fanout: null,
  };
}

function isUnchanged(book: Document, state: PublicationState, reason: PublicationReason | null, note: string | null): boolean {
  return book.publication?.state === state
    && (book.publication?.reason ?? null) === reason
    && (book.publication?.note ?? null) === note
    && legacyAgrees(book, state, reason);
}

export interface SetPublicationResult {
  status: 'written' | 'unchanged' | 'skipped' | 'not_found';
  book_id: string;
  from?: PublicationState;
  to?: PublicationState;
}

/** Set one book's publication state. Throws on a refused transition. */
export async function setPublication(db: Db, bookRef: string, opts: PublicationOpts): Promise<SetPublicationResult> {
  checkTransition('unpublished', opts);
  const now = opts.now ?? new Date();
  const books = db.collection('books');
  const book = await books.findOne(bookRefFilter(bookRef), { projection: PROJECTION });
  if (!book) return { status: 'not_found', book_id: String(bookRef) };

  const from = legacyPublication(book);
  const state = opts.state;
  const reason = effectiveReason(state, opts.reason);
  const base = { book_id: book.id ?? String(book._id), from: from.state, to: state };

  if (opts.from && !opts.from.includes(from.state)) return { status: 'skipped', ...base };
  checkTransition(from.state, opts);
  if (isUnchanged(book, state, reason, opts.note ?? null)) return { status: 'unchanged', ...base };

  await books.updateOne({ _id: book._id as ObjectIdType }, buildUpdate(state, reason, opts, now));
  await db.collection('publication_events').insertOne(eventFor(book, from, state, reason, opts, now));
  return { status: 'written', ...base };
}

export interface SetPublicationManyResult {
  written: string[];
  unchanged: string[];
  skipped: string[];
  refused: string[];
  not_found: string[];
}

/** Bulk form: same state for every book; a takedown book is refused individually. */
export async function setPublicationMany(
  db: Db, bookRefs: string[], opts: PublicationOpts, { batchSize = 500 }: { batchSize?: number } = {},
): Promise<SetPublicationManyResult> {
  checkTransition('unpublished', opts);
  const now = opts.now ?? new Date();
  const books = db.collection('books');
  const state = opts.state;
  const reason = effectiveReason(state, opts.reason);

  const out: SetPublicationManyResult = { written: [], unchanged: [], skipped: [], refused: [], not_found: [] };
  const refs = [...new Set((bookRefs || []).map(String))];
  for (let i = 0; i < refs.length; i += batchSize) {
    const chunk = refs.slice(i, i + batchSize);
    const docs = await books.find(bookRefsFilter(chunk), { projection: PROJECTION }).toArray();
    const seen = new Set<string>();
    for (const d of docs) { seen.add(String(d.id)); seen.add(String(d._id)); }
    for (const r of chunk) if (!seen.has(r)) out.not_found.push(r);

    const toWrite: unknown[] = [];
    const events: Document[] = [];
    for (const book of docs) {
      const id = book.id ?? String(book._id);
      const from = legacyPublication(book);
      if (opts.from && !opts.from.includes(from.state)) { out.skipped.push(id); continue; }
      try {
        checkTransition(from.state, opts);
      } catch {
        out.refused.push(id);
        continue;
      }
      if (isUnchanged(book, state, reason, opts.note ?? null)) { out.unchanged.push(id); continue; }
      toWrite.push(book._id);
      events.push(eventFor(book, from, state, reason, opts, now));
      out.written.push(id);
    }
    if (toWrite.length) {
      await books.updateMany({ _id: { $in: toWrite as never[] } }, buildUpdate(state, reason, opts, now));
      await db.collection('publication_events').insertMany(events);
    }
  }
  return out;
}

/** Fields to spread into a NEW book's insert. Default unpublished (leaves `visible` absent). */
export function initialPublication({
  state = 'unpublished', reason = null, note = null, by, issue, now,
}: Partial<Omit<PublicationOpts, 'by'>> & { by: string }): Record<string, unknown> {
  checkTransition('unpublished', { state, reason, by, issue });
  const r = effectiveReason(state, reason);
  const since = now ?? new Date();
  const publication: Publication = { state, reason: r, note, since, by, version: 1 };
  if (issue != null) publication.issue = issue;
  const { set } = derivedLegacyFields(state, r);
  return { publication, ...set, ...(state === 'hidden' || state === 'takedown' ? { hidden_at: since } : {}) };
}

function takedownLegacyReasons(): (string | RegExp)[] {
  return LEGACY_REASON_MAP.filter((e) => e.state === 'takedown').map((e) => e.match);
}

/** The named views. Every query that asks about publication uses one of these. */
export function publicationFilter(view: PublicationView): Filter<Document> {
  if (PUBLICATION_BACKFILLED) {
    switch (view) {
      case 'public': return { 'publication.state': 'public' };
      case 'live': return { 'publication.state': 'public', pages_count: { $gt: 0 } };
      case 'reachable': return { 'publication.state': { $in: ['public', 'unpublished'] } };
      case 'not_public': return { 'publication.state': { $ne: 'public' } };
      case 'unpublished': return { 'publication.state': 'unpublished' };
      case 'withdrawn': return { 'publication.state': { $in: ['hidden', 'takedown'] } };
      case 'takedown': return { 'publication.state': 'takedown' };
      default: break;
    }
  } else {
    switch (view) {
      case 'public': return { visible: true };
      case 'live': return { visible: true, pages_count: { $gt: 0 } };
      case 'reachable': return { visible: { $ne: false } };
      case 'not_public': return { visible: { $ne: true } };
      case 'unpublished': return { visible: { $nin: [true, false] } };
      case 'withdrawn': return { visible: false };
      case 'takedown': return { visible: false, hidden_reason: { $in: takedownLegacyReasons() } };
      default: break;
    }
  }
  throw new Error(`publicationFilter: unknown view ${JSON.stringify(view)} (one of ${PUBLICATION_VIEWS.join(', ')})`);
}

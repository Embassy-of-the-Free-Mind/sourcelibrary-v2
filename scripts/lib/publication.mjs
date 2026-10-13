/**
 * Publication state: one field per book, one writer (#5340, step 1 of #5303).
 *
 * PRIOR ART: .claude/docs/publication-state.md — the design this implements.
 * scripts/maintenance/fix-conflicting-visibility.mjs and clear-stale-hidden-reason.mjs
 * each repair one symptom of the missing writer; scripts/lib/pipeline-hold.mjs is
 * the nearest shape (one field, one helper) but governs processing, not publication.
 * src/lib/book-access.ts reads the legacy fields at the reader gate and is not a writer.
 *
 * TS twin: src/lib/publication.ts. tests/unit/publication-parity.test.ts runs both
 * over the same fixtures — change them together.
 *
 *   setPublication(db, bookRef, { state, reason, note, by, issue, override })
 *   setPublicationMany(db, bookRefs, { … })
 *   initialPublication({ state, reason, by })   // fields for a NEW book's insert
 *   publicationFilter(view)                      // the ONLY way to ask "is it public?"
 *
 * Until the backfill (decision 1, scripts/maintenance/backfill-publication-state.mjs
 * --apply) the writer ALSO writes the legacy `visible` / `hidden` / `hidden_reason`,
 * derived from the state, in the same updateOne — and publicationFilter() expands to
 * the legacy predicates, so call sites do not change twice.
 *
 * Out of scope here: fan-out to gallery_images / Supabase (#5342). The
 * Supabase catalogue sync keys on `updated_at`, which every write bumps.
 * The CDN/ISR cache IS evicted here, for the transitions that need it (#6227) —
 * see needsEviction().
 */
import { ObjectId } from 'mongodb';
import { revalidateBookPages, bookEvictionFollowUp } from './revalidate.mjs';

export const PUBLICATION_STATES = Object.freeze(['public', 'unpublished', 'hidden', 'takedown']);

export const PUBLICATION_REASONS = Object.freeze([
  'duplicate', 'quality', 'unprocessed', 'unarchived', 'curation',
  'wrong_content', 'rights', 'provider_restricted', 'launch_curation',
]);

export const PUBLICATION_VIEWS = Object.freeze([
  'public', 'live', 'reachable', 'not_public', 'unpublished', 'withdrawn', 'takedown',
]);

/** The only override that lets a book leave `takedown`. */
export const RIGHTS_CLEARED = 'rights-cleared';

/**
 * False until the backfill has written `publication` on every book. While false,
 * publicationFilter() expands to the legacy predicates (the doc's "legacy expansion").
 */
export const PUBLICATION_BACKFILLED = false;

/**
 * Reviewed mapping from today's `hidden_reason` strings to { state?, reason }.
 * Measured 2026-09-30: 1,582 distinct values (1,465 of them `duplicate of <slug>`).
 * Order matters: first match wins. `state: 'takedown'` marks the rights class;
 * entries without `state` leave the state to the `visible` field.
 * A string no entry matches maps to `curation`, keeps its text in `note`, and is
 * listed by the backfill dry-run as unmapped.
 */
export const LEGACY_REASON_MAP = Object.freeze([
  // rights class → takedown. Everything today's RIGHTS_REASON_RE matched, plus the
  // 2026-07-08 collection removal (visibility-and-stats.md), which that regex missed.
  { match: 'kloss_manuscripts_removed_2026-07-08', state: 'takedown', reason: 'rights' },
  { match: /^takedown:/, state: 'takedown', reason: 'rights' }, // this writer's own output
  { match: /copyright|takedown|dmca|rights/i, state: 'takedown', reason: 'rights' },
  { match: /removal requested by owner/i, state: 'takedown', reason: 'rights' },
  // rights pending, not a takedown: waiting for a holder's permission
  { match: /^awaiting_permission_/, reason: 'rights' },
  // pipeline states
  { match: 'launch_curation', reason: 'launch_curation' },
  { match: 'unprocessed', reason: 'unprocessed' },
  { match: 'artwork_import', reason: 'unprocessed' },
  { match: 'awaiting_qa_eval', reason: 'unprocessed' },
  { match: 'unarchived', reason: 'unarchived' },
  // duplicates
  { match: 'duplicate', reason: 'duplicate' },
  { match: /^duplicate[ _]/i, reason: 'duplicate' }, // "duplicate of <slug>", duplicate_lower_res, …
  { match: 'same_edition_duplicate', reason: 'duplicate' },
  { match: /^superseded by /, reason: 'duplicate' },
  // quality of the scan or the text
  { match: 'low_resolution', reason: 'quality' },
  { match: 'too-small-under-200px', reason: 'quality' },
  { match: 'svg-or-pdf-not-displayable', reason: 'quality' },
  { match: 'empty-failed-import', reason: 'quality' },
  { match: 'no_pages', reason: 'quality' },
  { match: /^source scan defective/, reason: 'quality' },
  { match: 'qa_ocr_invented_text', reason: 'quality' },
  { match: /^fabricated_ocr/, reason: 'quality' },
  // the record describes something other than what was scanned
  { match: /^scan_mismatch/, reason: 'wrong_content' },
  { match: 'qa_wrong_subject_title', reason: 'wrong_content' },
  { match: /^attribution-review/, reason: 'wrong_content' },
  // the provider will not serve it
  { match: /^Leiden IIIF returns 403/, reason: 'provider_restricted' },
  { match: /^IA access-restricted lending item/, reason: 'provider_restricted' },
  // curatorial scope calls
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
]);

function matches(entry, s) {
  return typeof entry.match === 'string' ? entry.match === s : entry.match.test(s);
}

/**
 * Map a legacy `hidden_reason` to { state, reason, note, mapped }.
 * `state` is 'takedown' for the rights class and null otherwise (the caller
 * decides from `visible`). The original string is kept as `note` unless it IS the enum value.
 */
export function mapLegacyReason(hiddenReason) {
  if (hiddenReason == null || hiddenReason === '') {
    return { state: null, reason: null, note: null, mapped: true };
  }
  const s = String(hiddenReason);
  for (const entry of LEGACY_REASON_MAP) {
    if (matches(entry, s)) {
      return {
        state: entry.state ?? null,
        reason: entry.reason,
        note: s === entry.reason ? null : s,
        mapped: true,
      };
    }
  }
  return { state: null, reason: 'curation', note: s, mapped: false };
}

/**
 * The publication a book has TODAY, read from `publication` when present and
 * otherwise derived from the legacy fields (the backfill's rule, decision 1):
 *   visible: true   → public (a stale hidden_reason is ignored — audit rule R2)
 *   visible: false  → hidden, or takedown for the rights class
 *   anything else   → unpublished (reachable by URL, unlisted — today's reader gate)
 * A rights-class reason on a book that is NOT `visible: false` stays `unpublished`
 * and is reported by `conflict`, because promoting it to takedown would change
 * what the reader gate serves, and the backfill changes no served state.
 */
export function legacyPublication(book) {
  const pub = book?.publication;
  if (pub && PUBLICATION_STATES.includes(pub.state)) {
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

/**
 * The legacy fields derived from a state (doc table "Compatibility"):
 *   public       visible true,   hidden false,  hidden_reason $unset
 *   unpublished  visible $unset, hidden $unset, hidden_reason $unset  (reader gate unchanged)
 *   hidden       visible false,  hidden true,   hidden_reason = reason
 *   takedown     visible false,  hidden true,   hidden_reason = 'takedown:' + reason
 * `hidden_reason = 'duplicate'` keeps book-access.ts's duplicate redirect working.
 */
export function derivedLegacyFields(state, reason) {
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

/** True when the book's legacy fields already say what `state`/`reason` would write. */
function legacyAgrees(book, state, reason) {
  const { set, unset } = derivedLegacyFields(state, reason);
  for (const [k, v] of Object.entries(set)) if (book?.[k] !== v) return false;
  for (const k of unset) if (book?.[k] !== undefined) return false;
  return true;
}

function isUnchanged(book, state, reason, note) {
  return book.publication?.state === state
    && (book.publication?.reason ?? null) === reason
    && (book.publication?.note ?? null) === note
    && legacyAgrees(book, state, reason);
}

/**
 * Validate a requested transition; throws on refusal. `from` is the current state.
 */
export function checkTransition(from, opts) {
  const { state, reason, by, issue, override } = opts || {};
  if (!PUBLICATION_STATES.includes(state)) {
    throw new Error(`publication: state must be one of ${PUBLICATION_STATES.join(', ')} (got ${JSON.stringify(state)})`);
  }
  if (reason != null && !PUBLICATION_REASONS.includes(reason)) {
    throw new Error(`publication: reason must be one of ${PUBLICATION_REASONS.join(', ')} (got ${JSON.stringify(reason)}); put free text in note`);
  }
  if (typeof by !== 'string' || !by.trim()) {
    throw new Error('publication: `by` is required (an email, script:<name> or route:<path>)');
  }
  if ((state === 'hidden') && !reason) {
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

function effectiveReason(state, reason) {
  if (state === 'public') return null;
  if (state === 'takedown') return reason ?? 'rights';
  return reason ?? null;
}

function buildUpdate(state, reason, opts, now) {
  const publication = {
    state,
    reason,
    note: opts.note ?? null,
    since: now,
    by: opts.by,
    version: 1,
  };
  if (opts.issue != null) publication.issue = opts.issue;
  if (reason === 'duplicate' && opts.duplicateOf) publication.duplicate_of = opts.duplicateOf;

  const { set, unset } = derivedLegacyFields(state, reason);
  const $set = { publication, ...set, updated_at: now };
  if (state === 'hidden' || state === 'takedown') $set.hidden_at = now;
  if (reason === 'duplicate' && opts.duplicateOf) $set.duplicate_of = opts.duplicateOf;
  const update = { $set };
  if (unset.length) update.$unset = Object.fromEntries(unset.map((k) => [k, '']));
  return update;
}

/** Mongo filter matching a book by `id` OR `_id` (16,343 books have a re-minted `_id`). */
export function bookRefFilter(ref) {
  const s = String(ref);
  const or = [{ id: s }, { _id: s }];
  if (ObjectId.isValid(s) && /^[0-9a-f]{24}$/i.test(s)) or.push({ _id: new ObjectId(s) });
  return { $or: or };
}

function bookRefsFilter(refs) {
  const strs = refs.map(String);
  const oids = strs.filter((s) => /^[0-9a-f]{24}$/i.test(s)).map((s) => new ObjectId(s));
  return { $or: [{ id: { $in: strs } }, { _id: { $in: [...strs, ...oids] } }] };
}

const PROJECTION = { _id: 1, id: 1, slug: 1, visible: 1, hidden: 1, hidden_reason: 1, publication: 1 };

const WITHDRAWN = new Set(['hidden', 'takedown']);

/**
 * Transitions whose cached pages are now WRONG in a way a reader hits (#6227):
 *   withdrawn → reachable  every reader URL touched while hidden is a cached
 *                          404 (layout level, 24h) — the published book 404s;
 *   anything → takedown    a rights withdrawal must not keep serving pages.
 * A plain hide (public → hidden) is not evicted here: its stale copy is the
 * book's own legitimate text for ≤24h, and duplicate sweeps hide thousands one
 * call at a time — one broad route-pattern revalidation each would be a
 * function invocation per book. The visibility route still evicts every flip.
 */
export function needsEviction(fromState, toState) {
  if (toState === 'takedown') return fromState !== 'takedown';
  return WITHDRAWN.has(fromState) && !WITHDRAWN.has(toState);
}

/**
 * Run the eviction (opts.evict: a function, false to opt out, default the real
 * one). Never throws: the Mongo write already happened. On failure it prints
 * the exact follow-up commands and returns them, so a publish whose pages
 * still 404 cannot read as finished.
 */
async function evictBooks(books, opts) {
  if (!books.length) return null;
  const refs = books.map((b) => ({ id: b.id ?? String(b._id), slug: b.slug ?? null }));
  if (opts?.evict === false) {
    return { ok: false, skipped: true, followUp: bookEvictionFollowUp(refs) };
  }
  const evict = typeof opts?.evict === 'function' ? opts.evict : revalidateBookPages;
  try {
    await evict(refs, { quiet: true });
    return { ok: true };
  } catch (err) {
    const followUp = bookEvictionFollowUp(refs);
    console.error(
      `publication: ${refs.length} book(s) changed state but their cached pages were NOT evicted ` +
      `(${err?.message || err}). Readers get cached 404s until you run:\n${followUp}`,
    );
    return { ok: false, error: String(err?.message || err), followUp };
  }
}

function eventFor(book, from, state, reason, opts, now) {
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
    // Fan-out to copies (gallery_images, books_catalog, caches) is step 3 (#5342);
    // null means "not attempted by the writer", which the reconciler will pick up.
    fanout: null,
  };
}

/**
 * Set one book's publication state.
 * opts: { state, reason?, note?, by, issue?, override?, duplicateOf?, from?, now?, evict? }
 *   from: optional list of current states the write is allowed from; otherwise skipped
 *         (e.g. the duplicates route hides only books that are public right now).
 *   evict: false to skip the cache eviction (the caller evicts itself — the result
 *          then carries the followUp), or a function(books) replacing it in tests.
 * Returns { status: 'written' | 'unchanged' | 'skipped' | 'not_found', book_id, from, to, eviction? }.
 *   eviction (only when needsEviction()): { ok, error?, followUp? } — ok:false means
 *   the book's pages are still cached in their old state; followUp is what to run.
 * Throws on a refused transition (takedown without issue, leaving takedown without override).
 */
export async function setPublication(db, bookRef, opts) {
  const now = opts?.now ?? new Date();
  // Validate the request itself before any read, so a malformed call always throws.
  checkTransition('unpublished', opts);
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

  await books.updateOne({ _id: book._id }, buildUpdate(state, reason, opts, now));
  await db.collection('publication_events').insertOne(eventFor(book, from, state, reason, opts, now));
  if (!needsEviction(from.state, state)) return { status: 'written', ...base };
  return { status: 'written', ...base, eviction: await evictBooks([book], opts) };
}

/**
 * The bulk form: same state for every book, one updateMany per batch, one event per book.
 * A book in takedown is refused individually (listed in `refused`), never silently moved.
 * Returns { written, unchanged, skipped, refused, not_found } — each a list of book ids —
 * plus `eviction` when any written book needsEviction(): ONE eviction for the whole call.
 */
export async function setPublicationMany(db, bookRefs, opts, { batchSize = 500 } = {}) {
  const now = opts?.now ?? new Date();
  const books = db.collection('books');
  const state = opts?.state;
  const reason = effectiveReason(state, opts?.reason);
  // Validate the request itself once, from a neutral state, so a bad call throws before any write.
  checkTransition('unpublished', opts);

  const out = { written: [], unchanged: [], skipped: [], refused: [], not_found: [] };
  const toEvict = [];
  const refs = [...new Set((bookRefs || []).map(String))];
  for (let i = 0; i < refs.length; i += batchSize) {
    const chunk = refs.slice(i, i + batchSize);
    const docs = await books.find(bookRefsFilter(chunk), { projection: PROJECTION }).toArray();
    const seen = new Set();
    for (const d of docs) { seen.add(String(d.id)); seen.add(String(d._id)); }
    for (const r of chunk) if (!seen.has(r)) out.not_found.push(r);

    const toWrite = [];
    const events = [];
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
      if (needsEviction(from.state, state)) toEvict.push(book);
    }
    if (toWrite.length) {
      await books.updateMany({ _id: { $in: toWrite } }, buildUpdate(state, reason, opts, now));
      await db.collection('publication_events').insertMany(events);
    }
  }
  if (toEvict.length) out.eviction = await evictBooks(toEvict, opts);
  return out;
}

/**
 * Fields to spread into a NEW book's insert document. Default: unpublished,
 * which (like today's importers that set nothing) leaves `visible` absent.
 */
export function initialPublication({ state = 'unpublished', reason = null, note = null, by, issue, now } = {}) {
  checkTransition('unpublished', { state, reason, by, issue });
  const r = effectiveReason(state, reason);
  const since = now ?? new Date();
  const publication = { state, reason: r, note, since, by, version: 1 };
  if (issue != null) publication.issue = issue;
  const { set } = derivedLegacyFields(state, r);
  return { publication, ...set, ...(state === 'hidden' || state === 'takedown' ? { hidden_at: since } : {}) };
}

/** Legacy `hidden_reason` values of the rights class, as a Mongo `$in` list. */
function takedownLegacyReasons() {
  return LEGACY_REASON_MAP.filter((e) => e.state === 'takedown').map((e) => e.match);
}

/**
 * The named views. Every query that asks about publication uses one of these.
 * Until the backfill they expand to today's legacy predicates.
 */
export function publicationFilter(view) {
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

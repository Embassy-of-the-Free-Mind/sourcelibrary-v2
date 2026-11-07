/**
 * writePageText() — the one writer of page TEXT (`pages.ocr`, `pages.translation`) (#7058).
 *
 * PRIOR ART: scripts/lib/page-revisions.mjs (saveRevisionsBeforeOverwrite) and
 * src/lib/page-revisions.ts (createRevision) — both snapshot BEFORE a write the caller then
 * makes itself, skip pages with no prior text (so a first write or a "clear" of an empty page
 * leaves no row), keep only named columns unless the caller opts into keepMeta, carry no
 * run id, and cannot tell whether the write that followed them ever landed. This module keeps
 * their row shape (so getRevisions / restoreRevision keep working) and adds the rest.
 *
 * Wikipedia-style editing: scholars, Claude and the pipeline all edit page text freely, and
 * the past is always kept and revertible. Every call here is an EDIT:
 *
 *   1. It reads the page's current field object.
 *   2. It appends a `page_revisions` row carrying the WHOLE prior field object — `data` plus
 *      every other key under `meta` (provenance block, content_hash, pipeline flags…) — and
 *      `by`, `reason`, `run_id`, `created_at`, and `next_hash` (contentHash of the new text).
 *   3. It sets the field, compare-and-set on the prior text, so a concurrent writer between
 *      steps 1 and 3 is detected (status 'conflict', the row is marked `aborted`) rather than
 *      silently overwritten.
 *
 * `next === null` is "edit to empty": the row is still written, and the field is `$unset` —
 * not set to `{data: null}`, because lane selectors match `'ocr.data': {$exists: false}` and a
 * null-data object would hide the page from re-reading. The revision row IS the record.
 *
 * Human edits are protected exactly as the collectors protect them (findHumanEditedPageIds in
 * scripts/lib/translate-core.mjs): a field with `source: 'manual'` or a non-empty `edited_by`
 * is refused unless the caller passes `overrideHumanEdit: true` (a person editing over a
 * person, or an operator who says so). The guard is in the update filter too, so it holds
 * under a race.
 *
 * Bulk undo: every write by a run stamps the same `run_id`; scripts/maintenance/revert-run.mjs
 * restores each page from that run's row, only where the page still holds `next_hash`.
 *
 * TS twin: src/lib/page-text-writer.ts — tests/unit/page-text-writer-parity.test.ts runs both
 * over the same fixtures. Change both or neither.
 */

import { randomBytes } from 'crypto';
import { contentHash } from './write-provenance.mjs';
import { translationLayers, writePageAnnotations } from './translation-text.mjs';

export const PAGE_TEXT_FIELDS = Object.freeze(['ocr', 'translation']);
/** Stamped on every row this module writes, so a reader can tell full rows from legacy snapshots. */
export const WRITER_ID = 'page-text-writer/1';

/** Same predicate as findHumanEditedPageIds: source 'manual' or a non-empty edited_by. */
export function isHumanEditedField(sub) {
  if (!sub || typeof sub !== 'object') return false;
  return sub.source === 'manual' || (sub.edited_by != null && sub.edited_by !== '');
}

/** The text a field object carries ('' when none). A legacy bare-string field counts as its text. */
export function fieldText(sub) {
  if (typeof sub === 'string') return sub;
  if (sub && typeof sub === 'object' && typeof sub.data === 'string') return sub.data;
  return '';
}

/** contentHash of a field's text, or null when it carries none. */
export function textHash(sub) {
  const t = fieldText(sub);
  return t === '' ? null : contentHash(t);
}

/** Throws on a malformed call — a writer that guesses is how text gets lost. */
export function validateWrite(field, next, opts) {
  if (!PAGE_TEXT_FIELDS.includes(field)) throw new Error(`writePageText: field must be 'ocr' or 'translation', got ${JSON.stringify(field)}`);
  if (next !== null && (typeof next !== 'object' || Array.isArray(next) || (next.data !== undefined && typeof next.data !== 'string'))) {
    throw new Error('writePageText: next must be null (edit to empty) or a field object whose `data`, when present, is a string');
  }
  if (!opts || typeof opts.by !== 'string' || opts.by.trim() === '') throw new Error('writePageText: opts.by is required (person, model or script)');
  if (typeof opts.reason !== 'string' || opts.reason.trim() === '') throw new Error('writePageText: opts.reason is required');
  if (opts.run_id != null && (typeof opts.run_id !== 'string' || opts.run_id === '')) throw new Error('writePageText: opts.run_id must be a non-empty string when given');
}

/**
 * #5942: a translation written through this door carries the book's words beside `data`
 * (`text` + `text_from`, scripts/lib/translation-text.mjs). Any `text` the caller copied from the
 * prior object is replaced by the parse of the new `data`. A verbatim restore writes what it is
 * given; a stale `text` it carries is never served, because the reader checks text_from.data_hash.
 */
function translationTextFields(field, next) {
  if (field !== 'translation' || typeof next?.data !== 'string' || !next.data) return {};
  const l = translationLayers(next.data, { promptVersion: next.prompt_version });
  return { text: l.text, text_from: l.text_from };
}
async function storeTranslationAnnotations(db, pageId, bookId, field, next, verbatim, runId) {
  if (verbatim || field !== 'translation' || typeof next?.data !== 'string' || !next.data) return;
  await writePageAnnotations(db, [{ page_id: pageId, book_id: bookId, run_id: runId, layers: translationLayers(next.data, { promptVersion: next.prompt_version }) }]);
}

/** The field value written: the caller's object, with content_hash and updated_at stamped if absent. */
export function nextFieldValue(next, now, verbatim = false, field = null) {
  if (!next) return null;
  if (verbatim) return { ...next };
  return {
    ...next,
    ...translationTextFields(field, next),
    ...(next.content_hash || !next.data ? {} : { content_hash: contentHash(next.data) }),
    ...(next.updated_at ? {} : { updated_at: now }),
  };
}

/**
 * The revision row. Legacy named columns first (what getRevisions / restoreRevision and the
 * history API read), then the full prior object under `meta`, then the edit's own record.
 */
export function buildTextRevision({ page, field, next, opts, now, id }) {
  const prior = page[field];
  const present = prior !== undefined && prior !== null;
  const obj = typeof prior === 'string' ? { data: prior } : (present ? prior : {});
  const meta = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'data'));
  const language = field === 'ocr' ? obj.language : (obj.source_language || obj.language);
  return {
    id,
    page_id: page.id,
    book_id: page.book_id,
    field,
    data: fieldText(prior),
    // revision_source: a sweep label for bulk maintenance (the prior's own source stays in meta.source)
    source: opts.revision_source || (present ? (obj.source || 'unknown') : 'empty'),
    ...(obj.model ? { model: obj.model } : {}),
    ...(language ? { language } : {}),
    ...(obj.edited_by ? { edited_by: obj.edited_by } : {}),
    ...(obj.prompt_version ? { prompt_version: obj.prompt_version } : {}),
    ...(obj.batch_job_id ? { job_id: obj.batch_job_id } : {}),
    ...((obj.updated_at || obj.edited_at) ? { original_date: obj.updated_at || obj.edited_at } : {}),
    ...(obj.content_hash ? { content_hash: obj.content_hash } : {}),
    ...(obj.engine ? { engine: obj.engine } : {}),
    created_at: now,
    // ---- full record (#7058) ----
    writer: WRITER_ID,
    prior_state: !present ? 'absent' : (typeof prior === 'string' ? 'string' : 'object'),
    meta,
    prior_hash: textHash(prior),
    next_hash: textHash(next),
    next_state: next === null ? 'absent' : 'object',
    by: opts.by,
    reason: opts.reason,
    ...(opts.run_id ? { run_id: opts.run_id } : {}),
  };
}

/** Rebuild the exact prior field value from a writer row (null = the field was absent). */
export function priorFieldFromRevision(rev) {
  if (rev.prior_state === 'absent') return null;
  if (rev.prior_state === 'string') return rev.data;
  return { ...(rev.meta || {}), ...(rev.data !== '' ? { data: rev.data } : {}) };
}

/**
 * Update filter: the page, still holding the prior text (compare-and-set), and — unless
 * overridden — still not human-edited. `{x: {$in: [null, '']}}` also matches a missing x.
 */
export function casFilter(pageId, field, prior, { overrideHumanEdit = false } = {}) {
  const text = fieldText(prior);
  const filter = { id: pageId };
  if (typeof prior === 'string') filter[field] = prior;
  else filter[`${field}.data`] = text === '' ? { $in: [null, ''] } : text;
  if (!overrideHumanEdit) {
    filter[`${field}.source`] = { $ne: 'manual' };
    filter[`${field}.edited_by`] = { $in: [null, ''] };
  }
  return filter;
}

/** The update document: set the whole field, or unset it for an edit to empty. */
export function fieldUpdate(field, value, now) {
  return value === null
    ? { $unset: { [field]: '' }, $set: { updated_at: now } }
    : { $set: { [field]: value, updated_at: now } };
}

/**
 * Write one page field. Returns
 *   { status: 'written', revision_id, book_id, prior_hash, next_hash }
 *   { status: 'unchanged' }            — field absent and next is empty: nothing to record
 *   { status: 'refused_human_edit' }   — prior is a human edit and overrideHumanEdit is off
 *   { status: 'not_found' }
 *   { status: 'conflict', revision_id } — the page changed under us; nothing written, row aborted
 *   { status: 'prior_changed' }        — expect_prior_hash given and the stored text is no longer it; nothing written
 *
 * opts: { by, reason, run_id?, overrideHumanEdit?, verbatim?, revision_source?, expect_prior_hash?, now?, id? }
 *   expect_prior_hash: textHash of the text the caller computed `next` FROM; for a sweep that reads, transforms and
 *     writes later, so a page rewritten in between is refused instead of overwritten with a transform of old text.
 *   verbatim: write `next` exactly as given (no content_hash / updated_at stamping) — for restores.
 *   revision_source: the row's `source` is this sweep label, not the superseded text's source.
 */
export async function writePageText(db, pageId, field, next, opts) {
  validateWrite(field, next, opts);
  const now = opts.now || new Date();
  const pages = db.collection('pages');
  const page = await pages.findOne({ id: pageId }, { projection: { id: 1, book_id: 1, [field]: 1 } });
  if (!page) return { status: 'not_found' };
  const prior = page[field];
  if ((prior === undefined || prior === null) && next === null) return { status: 'unchanged', book_id: page.book_id };
  if (isHumanEditedField(prior) && !opts.overrideHumanEdit) return { status: 'refused_human_edit', book_id: page.book_id };
  if (opts.expect_prior_hash !== undefined && textHash(prior) !== opts.expect_prior_hash) return { status: 'prior_changed', book_id: page.book_id };

  const rev = buildTextRevision({ page, field, next, opts, now, id: opts.id || randomBytes(6).toString('hex') });
  await db.collection('page_revisions').insertOne(rev);

  const res = await pages.updateOne(casFilter(pageId, field, prior, opts), fieldUpdate(field, nextFieldValue(next, now, opts.verbatim, field), now));
  if (res.matchedCount === 0) {
    await db.collection('page_revisions').updateOne({ id: rev.id }, { $set: { aborted: 'conflict', aborted_at: now } });
    return { status: 'conflict', revision_id: rev.id, book_id: page.book_id };
  }
  await storeTranslationAnnotations(db, pageId, page.book_id, field, next, opts.verbatim, opts.run_id);
  return { status: 'written', revision_id: rev.id, book_id: page.book_id, prior_hash: rev.prior_hash, next_hash: rev.next_hash };
}

/**
 * Undo one run (#7058). For every page × field the run wrote (writer rows with that run_id,
 * not aborted), restore the field the run's FIRST row replaced — but only where the page still
 * holds exactly what the run's LAST row wrote (same text hash, and still absent if the run
 * cleared it). A page someone changed since is reported and left alone: nothing newer is
 * clobbered. The restore is itself a writePageText edit (run_id `revert:<runId>`), so a revert
 * is revertible too. Dry run unless `apply`. mjs only: the TS side has no bulk caller.
 *
 * Returns { rows, targets, restorable, changed: [...], missing: [...], tally, book_ids }.
 */
export async function revertRun(db, runId, { apply = false, by = 'scripts/maintenance/revert-run.mjs', now, pageIds = null } = {}) {
  if (typeof runId !== 'string' || runId === '') throw new Error('revertRun: runId is required');
  // pageIds (optional): undo only these pages of the run (#7567: the pilot pages a later guard would have refused)
  const rows = await db.collection('page_revisions')
    .find({ run_id: runId, writer: WRITER_ID, aborted: { $exists: false }, ...(pageIds && { page_id: { $in: [...pageIds] } }) })
    .sort({ created_at: 1 }).toArray();
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.page_id}\u0000${r.field}`;
    const g = groups.get(k);
    if (g) g.last = r; else groups.set(k, { first: r, last: r });
  }
  const out = { rows: rows.length, targets: groups.size, restorable: 0, changed: [], missing: [], tally: {}, book_ids: [] };
  const books = new Set();
  for (const { first, last } of groups.values()) {
    const { page_id: pageId, field } = first;
    const page = await db.collection('pages').findOne({ id: pageId }, { projection: { id: 1, book_id: 1, [field]: 1 } });
    if (!page) { out.missing.push(pageId); continue; }
    const cur = page[field];
    const same = textHash(cur) === last.next_hash && (last.next_state !== 'absent' || cur === undefined || cur === null);
    if (!same) { out.changed.push({ page_id: pageId, field, book_id: page.book_id }); continue; }
    out.restorable++;
    if (!apply) { books.add(page.book_id); continue; }
    const prior = priorFieldFromRevision(first);
    const next = typeof prior === 'string' ? { data: prior } : prior;
    // overrideHumanEdit: the text on the page is the run's own output (checked above), so a
    // human-edit flag on it came from the run, not from a person since.
    const r = await writePageText(db, pageId, field, next, {
      by, reason: `revert of run ${runId}`, run_id: `revert:${runId}`, overrideHumanEdit: true, verbatim: true, ...(now ? { now } : {}),
    });
    out.tally[r.status] = (out.tally[r.status] || 0) + 1;
    if (r.status === 'written' || r.status === 'unchanged') books.add(page.book_id);
  }
  out.book_ids = [...books];
  return out;
}

/** A run id for a bulk script: `<script>-<UTC stamp>-<6 hex>`. */
export function newRunId(script, now = new Date()) {
  return `${script}-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
}

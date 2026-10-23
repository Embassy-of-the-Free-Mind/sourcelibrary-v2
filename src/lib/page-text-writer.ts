/**
 * writePageText() — the one writer of page TEXT (`pages.ocr`, `pages.translation`) (#7058).
 *
 * PRIOR ART: src/lib/page-revisions.ts (createRevision) — snapshots before a write the caller
 * makes itself, skips pages with no prior text, keeps named columns only, carries no run id.
 * This keeps its row shape (getRevisions / restoreRevision keep working) and adds the rest.
 *
 * TS twin of scripts/lib/page-text-writer.mjs — read the full contract there.
 * tests/unit/page-text-writer-parity.test.ts runs both over the same fixtures. Change both or neither.
 */
import { randomBytes } from 'crypto';
import type { Db, Document, Filter, UpdateFilter } from 'mongodb';
import { contentHash } from './write-provenance';

export type PageTextField = 'ocr' | 'translation';
export const PAGE_TEXT_FIELDS: readonly PageTextField[] = Object.freeze(['ocr', 'translation'] as PageTextField[]);
export const WRITER_ID = 'page-text-writer/1';

type FieldObj = Record<string, unknown> & { data?: unknown };
/** The new field object (written as given), or null to clear the field. */
export type NextField = (Record<string, unknown> & { data?: string }) | null;

export interface WritePageTextOpts {
  /** Who: a person, "Claude (Opus 5.5)", a model id, or a script path. */
  by: string;
  /** Why, in words. */
  reason: string;
  /** Shared by every write of one bulk run — revert-run.mjs undoes a run by it. */
  run_id?: string | null;
  /** Write over a human edit (source 'manual' or edited_by). Off by default. */
  overrideHumanEdit?: boolean;
  /** Write `next` exactly as given — no content_hash / updated_at stamping. For restoring a revision. */
  verbatim?: boolean;
  /**
   * The row's `source`: a sweep label (e.g. 'longs-pass-5924') instead of the superseded text's own
   * source, which stays in `meta.source`. For bulk maintenance, so `page_revisions` segments by
   * mechanism (data-provenance.md) and a pass is never read as a second OCR.
   */
  revision_source?: string;
  /**
   * textHash of the text `next` was computed FROM. A sweep that reads, transforms and writes later passes it, so a page
   * rewritten in between is refused ('prior_changed') instead of overwritten with a transform of the old text.
   */
  expect_prior_hash?: string | null;
  now?: Date;
  id?: string;
}

export type WritePageTextResult =
  | { status: 'written'; revision_id: string; book_id: string; prior_hash: string | null; next_hash: string | null }
  | { status: 'unchanged'; book_id: string }
  | { status: 'refused_human_edit'; book_id: string }
  | { status: 'not_found' }
  | { status: 'conflict'; revision_id: string; book_id: string }
  | { status: 'prior_changed'; book_id: string };

export function isHumanEditedField(sub: unknown): boolean {
  if (!sub || typeof sub !== 'object') return false;
  const s = sub as FieldObj;
  return s.source === 'manual' || (s.edited_by != null && s.edited_by !== '');
}

export function fieldText(sub: unknown): string {
  if (typeof sub === 'string') return sub;
  if (sub && typeof sub === 'object' && typeof (sub as FieldObj).data === 'string') return (sub as FieldObj).data as string;
  return '';
}

export function textHash(sub: unknown): string | null {
  const t = fieldText(sub);
  return t === '' ? null : contentHash(t);
}

export function validateWrite(field: unknown, next: unknown, opts: Partial<WritePageTextOpts> | undefined): void {
  if (!PAGE_TEXT_FIELDS.includes(field as PageTextField)) throw new Error(`writePageText: field must be 'ocr' or 'translation', got ${JSON.stringify(field)}`);
  if (next !== null && (typeof next !== 'object' || Array.isArray(next) || ((next as FieldObj).data !== undefined && typeof (next as FieldObj).data !== 'string'))) {
    throw new Error('writePageText: next must be null (edit to empty) or a field object whose `data`, when present, is a string');
  }
  if (!opts || typeof opts.by !== 'string' || opts.by.trim() === '') throw new Error('writePageText: opts.by is required (person, model or script)');
  if (typeof opts.reason !== 'string' || opts.reason.trim() === '') throw new Error('writePageText: opts.reason is required');
  if (opts.run_id != null && (typeof opts.run_id !== 'string' || opts.run_id === '')) throw new Error('writePageText: opts.run_id must be a non-empty string when given');
}

export function nextFieldValue(next: NextField, now: Date, verbatim = false): Record<string, unknown> | null {
  if (!next) return null;
  if (verbatim) return { ...next };
  return {
    ...next,
    ...(next.content_hash || !next.data ? {} : { content_hash: contentHash(next.data) }),
    ...(next.updated_at ? {} : { updated_at: now }),
  };
}

export function buildTextRevision({ page, field, next, opts, now, id }: {
  page: Record<string, unknown>; field: PageTextField; next: NextField; opts: WritePageTextOpts; now: Date; id: string;
}): Record<string, unknown> {
  const prior = page[field];
  const present = prior !== undefined && prior !== null;
  const obj: FieldObj = typeof prior === 'string' ? { data: prior } : (present ? (prior as FieldObj) : {});
  const meta = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'data'));
  const language = field === 'ocr' ? obj.language : (obj.source_language || obj.language);
  return {
    id,
    page_id: page.id,
    book_id: page.book_id,
    field,
    data: fieldText(prior),
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

export function priorFieldFromRevision(rev: Record<string, unknown>): unknown {
  if (rev.prior_state === 'absent') return null;
  if (rev.prior_state === 'string') return rev.data;
  return { ...((rev.meta as Record<string, unknown>) || {}), ...(rev.data !== '' ? { data: rev.data } : {}) };
}

export function casFilter(pageId: string, field: PageTextField, prior: unknown, { overrideHumanEdit = false }: { overrideHumanEdit?: boolean } = {}): Record<string, unknown> {
  const text = fieldText(prior);
  const filter: Record<string, unknown> = { id: pageId };
  if (typeof prior === 'string') filter[field] = prior;
  else filter[`${field}.data`] = text === '' ? { $in: [null, ''] } : text;
  if (!overrideHumanEdit) {
    filter[`${field}.source`] = { $ne: 'manual' };
    filter[`${field}.edited_by`] = { $in: [null, ''] };
  }
  return filter;
}

export function fieldUpdate(field: PageTextField, value: Record<string, unknown> | null, now: Date): Record<string, unknown> {
  return value === null
    ? { $unset: { [field]: '' }, $set: { updated_at: now } }
    : { $set: { [field]: value, updated_at: now } };
}

export async function writePageText(db: Db, pageId: string, field: PageTextField, next: NextField, opts: WritePageTextOpts): Promise<WritePageTextResult> {
  validateWrite(field, next, opts);
  const now = opts.now || new Date();
  const pages = db.collection('pages');
  const page = await pages.findOne({ id: pageId }, { projection: { id: 1, book_id: 1, [field]: 1 } });
  if (!page) return { status: 'not_found' };
  const bookId = page.book_id as string;
  const prior = page[field];
  if ((prior === undefined || prior === null) && next === null) return { status: 'unchanged', book_id: bookId };
  if (isHumanEditedField(prior) && !opts.overrideHumanEdit) return { status: 'refused_human_edit', book_id: bookId };
  if (opts.expect_prior_hash !== undefined && textHash(prior) !== opts.expect_prior_hash) return { status: 'prior_changed', book_id: bookId };

  const rev = buildTextRevision({ page, field, next, opts, now, id: opts.id || randomBytes(6).toString('hex') });
  await db.collection('page_revisions').insertOne(rev as Document);

  const res = await pages.updateOne(
    casFilter(pageId, field, prior, opts) as Filter<Document>,
    fieldUpdate(field, nextFieldValue(next, now, opts.verbatim), now) as UpdateFilter<Document>,
  );
  if (res.matchedCount === 0) {
    await db.collection('page_revisions').updateOne({ id: rev.id }, { $set: { aborted: 'conflict', aborted_at: now } });
    return { status: 'conflict', revision_id: rev.id as string, book_id: bookId };
  }
  return { status: 'written', revision_id: rev.id as string, book_id: bookId, prior_hash: rev.prior_hash as string | null, next_hash: rev.next_hash as string | null };
}

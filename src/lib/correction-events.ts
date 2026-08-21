import { getDb } from './mongodb';
import { nanoid } from 'nanoid';
import type { PageRevision } from './page-revisions';

/**
 * Correction events (#3241) — human corrections captured as labeled model errors.
 *
 * Every manual edit of OCR or translation text is the highest-value quality
 * signal we have: a person looked at the page image and fixed what the model
 * got wrong. `page_revisions` retains the before-text for recovery; this
 * collection additionally stores the immutable before/after PAIR with who
 * corrected it, so eval tooling can mine error taxonomies per script/source
 * without reconstructing pairs from revision history.
 *
 * Write-path hook only — no UI. Failures are swallowed: losing an event must
 * never block the edit itself.
 */

export interface CorrectionEvent {
  id: string;
  page_id: string;
  book_id: string;
  field: 'ocr' | 'translation';
  before: string;
  after: string;
  /** Provenance of the corrected (before) text — which model made the error. */
  before_model?: string;
  before_source?: string;
  before_prompt_version?: string;
  /** Link to the page_revisions doc holding the same before-text. */
  revision_id?: string;
  editor_role: 'editor' | 'reader';
  /** Display name supplied by the editor UI. */
  edited_by?: string;
  /** Authenticated identity from the session. */
  session_email?: string;
  tenant_id?: string;
  created_at: Date;
}

export interface CorrectionEventInput {
  revision: PageRevision | undefined;
  after: string;
  editorRole: 'editor' | 'reader';
  editedBy?: string;
  sessionEmail?: string | null;
  tenantId?: string;
}

/**
 * Build the correction-event document from a manual edit. Returns null when
 * there was no prior content (first write — nothing was corrected) or when
 * the text is unchanged. Pure — no DB access.
 */
export function buildCorrectionEvent(opts: CorrectionEventInput): CorrectionEvent | null {
  const { revision, after, editorRole, editedBy, sessionEmail, tenantId } = opts;
  if (!revision?.data) return null; // first write — not a correction
  if (revision.data === after) return null; // no-change save

  const event: CorrectionEvent = {
    id: nanoid(12),
    page_id: revision.page_id,
    book_id: revision.book_id,
    field: revision.field,
    before: revision.data,
    after,
    before_model: revision.model,
    before_source: revision.source,
    before_prompt_version: revision.prompt_version,
    revision_id: revision.id,
    editor_role: editorRole,
    edited_by: editedBy,
    session_email: sessionEmail || undefined,
    tenant_id: tenantId,
    created_at: new Date(),
  };
  return event;
}

/**
 * Build and persist a correction event. Call with the revision returned by
 * createRevision() — it already carries the before-text and its provenance.
 */
export async function recordCorrectionEvent(opts: CorrectionEventInput): Promise<CorrectionEvent | null> {
  const event = buildCorrectionEvent(opts);
  if (!event) return null;

  try {
    const db = await getDb();
    await db.collection('correction_events').insertOne(event as unknown as Record<string, unknown>);
    return event;
  } catch (error) {
    console.error(`[correction-events] Failed to record event for page ${event.page_id}:`, error);
    return null;
  }
}

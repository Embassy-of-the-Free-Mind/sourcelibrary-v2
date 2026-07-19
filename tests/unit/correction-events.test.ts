/**
 * Guard for src/lib/correction-events.ts (#3241) — human corrections captured
 * as labeled model errors. Pins the pure builder:
 *  1. A real edit → event with before/after pair + provenance of the corrected text.
 *  2. First write (no revision) → null: nothing was corrected.
 *  3. No-change save → null: not a correction.
 */
import { describe, it, expect } from 'vitest';

import { buildCorrectionEvent } from '../../src/lib/correction-events';
import type { PageRevision } from '../../src/lib/page-revisions';

const revision: PageRevision = {
  id: 'rev1',
  page_id: 'p1',
  book_id: 'b1',
  field: 'ocr',
  data: 'the qvick brown fox',
  source: 'batch_api',
  model: 'gemini-3.1-flash-lite',
  language: 'Latin',
  prompt_version: 'v15',
  created_at: new Date('2026-07-01'),
};

describe('buildCorrectionEvent', () => {
  it('captures the before/after pair with provenance', () => {
    const event = buildCorrectionEvent({
      revision,
      after: 'the quick brown fox',
      editorRole: 'editor',
      editedBy: 'Derek',
      sessionEmail: 'derek@example.com',
      tenantId: 'default',
    });
    expect(event).not.toBeNull();
    expect(event!.page_id).toBe('p1');
    expect(event!.book_id).toBe('b1');
    expect(event!.field).toBe('ocr');
    expect(event!.before).toBe('the qvick brown fox');
    expect(event!.after).toBe('the quick brown fox');
    expect(event!.before_model).toBe('gemini-3.1-flash-lite');
    expect(event!.before_source).toBe('batch_api');
    expect(event!.before_prompt_version).toBe('v15');
    expect(event!.revision_id).toBe('rev1');
    expect(event!.editor_role).toBe('editor');
    expect(event!.edited_by).toBe('Derek');
    expect(event!.session_email).toBe('derek@example.com');
    expect(event!.tenant_id).toBe('default');
  });

  it('returns null on first write (no prior content)', () => {
    expect(
      buildCorrectionEvent({ revision: undefined, after: 'new text', editorRole: 'editor' })
    ).toBeNull();
  });

  it('returns null on a no-change save', () => {
    expect(
      buildCorrectionEvent({ revision, after: revision.data, editorRole: 'editor' })
    ).toBeNull();
  });
});

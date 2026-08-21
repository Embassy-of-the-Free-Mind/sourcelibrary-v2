/**
 * Guard for scripts/lib/page-revisions.mjs (#3240) — the scripts-side twin of
 * src/lib/page-revisions.ts createRevision(). Every batch/realtime writer that
 * overwrites pages.ocr.data or pages.translation.data must retain the prior
 * content in page_revisions first. Pins:
 *  1. Existing content → one revision doc with the superseded text + provenance.
 *  2. First writes (no existing data) → no revision.
 *  3. '[RECITATION_BLOCKED]' markers → no revision (placeholder, not content).
 *  4. reason/jobId land on the doc; translation uses source_language.
 *  5. DB failures are swallowed (never block the content write).
 */
import { describe, it, expect } from 'vitest';

import {
  saveRevisionBeforeOverwrite,
  saveRevisionsBeforeOverwrite,
} from '../../scripts/lib/page-revisions.mjs';

type AnyDoc = Record<string, unknown>;

function fakeDb(pages: AnyDoc[]) {
  const inserted: AnyDoc[] = [];
  const db = {
    collection(name: string) {
      if (name === 'pages') {
        return {
          find(filter: { id: { $in: string[] } }) {
            const ids = new Set(filter.id.$in);
            return {
              toArray: async () => pages.filter(p => ids.has(p.id as string)),
            };
          },
        };
      }
      if (name === 'page_revisions') {
        return {
          insertMany: async (docs: AnyDoc[]) => {
            inserted.push(...docs);
            return { insertedCount: docs.length };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
  return { db, inserted };
}

describe('saveRevisionsBeforeOverwrite', () => {
  it('retains existing OCR with provenance, reason, and jobId', async () => {
    const { db, inserted } = fakeDb([
      {
        id: 'p1',
        book_id: 'b1',
        ocr: {
          data: 'old text',
          model: 'gemini-2.0-flash',
          language: 'Latin',
          source: 'batch_api',
          prompt_version: 'v10',
          batch_job_id: 'job-orig',
          updated_at: new Date('2026-01-01'),
        },
      },
    ]);
    const n = await saveRevisionsBeforeOverwrite(db, ['p1'], 'ocr', {
      jobId: 'job-new',
      reason: 'reocr_batch',
    });
    expect(n).toBe(1);
    expect(inserted).toHaveLength(1);
    const doc = inserted[0];
    expect(doc.page_id).toBe('p1');
    expect(doc.book_id).toBe('b1');
    expect(doc.field).toBe('ocr');
    expect(doc.data).toBe('old text');
    expect(doc.model).toBe('gemini-2.0-flash');
    expect(doc.language).toBe('Latin');
    expect(doc.prompt_version).toBe('v10');
    expect(doc.reason).toBe('reocr_batch');
    // batch_job_id on the superseded content wins over the incoming jobId
    expect(doc.job_id).toBe('job-orig');
    expect(doc.original_date).toEqual(new Date('2026-01-01'));
  });

  it('is a no-op for first writes and missing pages', async () => {
    const { db, inserted } = fakeDb([
      { id: 'p1', book_id: 'b1' }, // no ocr at all
      { id: 'p2', book_id: 'b1', ocr: { data: '' } }, // empty
    ]);
    const n = await saveRevisionsBeforeOverwrite(db, ['p1', 'p2', 'p-missing'], 'ocr', {
      reason: 'reocr_batch',
    });
    expect(n).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('skips [RECITATION_BLOCKED] markers', async () => {
    const { db, inserted } = fakeDb([
      { id: 'p1', book_id: 'b1', ocr: { data: '[RECITATION_BLOCKED]' } },
    ]);
    const n = await saveRevisionsBeforeOverwrite(db, ['p1'], 'ocr', { reason: 'recitation_retry' });
    expect(n).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('uses source_language for translation revisions', async () => {
    const { db, inserted } = fakeDb([
      {
        id: 'p1',
        book_id: 'b1',
        translation: { data: 'old translation', source_language: 'German', source: 'ai' },
      },
    ]);
    const n = await saveRevisionsBeforeOverwrite(db, ['p1'], 'translation', {
      reason: 'retranslate_stale',
    });
    expect(n).toBe(1);
    expect(inserted[0].language).toBe('German');
    expect(inserted[0].field).toBe('translation');
  });

  it('swallows DB errors instead of throwing', async () => {
    const db = {
      collection() {
        throw new Error('connection lost');
      },
    };
    const n = await saveRevisionsBeforeOverwrite(db, ['p1'], 'ocr', { reason: 'reocr_batch' });
    expect(n).toBe(0);
  });
});

describe('saveRevisionBeforeOverwrite', () => {
  it('returns true when a revision was written, false otherwise', async () => {
    const { db } = fakeDb([{ id: 'p1', book_id: 'b1', ocr: { data: 'x' } }]);
    expect(await saveRevisionBeforeOverwrite(db, 'p1', 'ocr', { reason: 'manual' })).toBe(true);
    expect(await saveRevisionBeforeOverwrite(db, 'p-missing', 'ocr')).toBe(false);
  });
});

/**
 * Archiving ignores the pipeline hold (#5448 step 3): ARCHIVE_NOT_BLOCKED admits a book whose
 * `archive_metadata.blocked` was set only because it is held, and still refuses every other block.
 *
 * PRIOR ART: tests/unit/pipeline-hold.test.ts pins the hold's status rules (it never reaches an
 * archive selector); tests/unit/lazy-pages-lane-guard.test.ts scans archive selectors for the
 * lazy-pages filter. Neither runs a selector against documents, which is the only way to pin `$nor`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTestDb, cleanDb } from '../setup';
import { ARCHIVE_NOT_BLOCKED, HOLD_ONLY_ARCHIVE_BLOCK } from '../../scripts/lib/pipeline-hold.mjs';

const held = { status: 'held', hold: { reason: 'x', issue: 7343, held_at: new Date() } };

const BOOKS = [
  { id: 'free', pipeline_auto: { status: 'archiving' } },
  { id: 'held-unblocked', pipeline_auto: held },
  // The two reasons the held-wave importers write (measured 2026-10-25: 4,995 + 201 books).
  { id: 'tier-a', pipeline_auto: held, archive_metadata: { blocked: true, blocked_reason: 'images-only acquisition, pipeline hold acquisition-wave-2026-10b (#7343): do not archive until released' } },
  { id: 'wave-import', pipeline_auto: held, archive_metadata: { blocked: true, blocked_reason: 'acquisition-wave-2026-10-lazy: hidden acquisition, images hot-linked' } },
  // Real blocks: these must stay out, held or not.
  { id: 'http-403', pipeline_auto: held, archive_metadata: { blocked: true, blocked_reason: 'HTTP 403' } },
  { id: 'bulk-failed', archive_metadata: { blocked: true, blocked_reason: 'bulk-archive failed 5x: HTTP 500' } },
  { id: 'no-reason', archive_metadata: { blocked: true } },
  { id: 'dead-pages', archive_metadata: { blocked: true, blocked_reason: 'persistent_4xx_5xx' } },
  // An unblocked flag is not a block.
  { id: 'unblocked-flag', archive_metadata: { blocked: false, blocked_reason: 'HTTP 403' } },
];

describe('ARCHIVE_NOT_BLOCKED (#5448 step 3)', () => {
  beforeEach(async () => {
    await cleanDb();
    await getTestDb().collection('books').insertMany(BOOKS.map(b => ({ ...b })));
  });

  it('admits unblocked books and books blocked only by a hold; refuses every other block', async () => {
    const ids = (await getTestDb().collection('books').find({ ...ARCHIVE_NOT_BLOCKED }).toArray()).map(b => b.id).sort();
    expect(ids).toEqual(['free', 'held-unblocked', 'tier-a', 'unblocked-flag', 'wave-import']);
  });

  it('composes with a selector that has its own $or / $expr', async () => {
    const ids = (await getTestDb().collection('books').find({
      $or: [{ id: 'tier-a' }, { id: 'http-403' }, { id: 'free' }],
      ...ARCHIVE_NOT_BLOCKED,
    }).toArray()).map(b => b.id).sort();
    expect(ids).toEqual(['free', 'tier-a']);
  });

  it('the reason pattern does not swallow failure reasons', () => {
    for (const r of ['HTTP 401', 'HTTP 403', 'persistent_4xx_5xx', 'bulk-archive failed 5x: HTTP 502', 'source gone']) {
      expect(HOLD_ONLY_ARCHIVE_BLOCK.test(r)).toBe(false);
    }
  });

  it('every book-level archive selector that used the bare block filter now uses ARCHIVE_NOT_BLOCKED', () => {
    const ROOT = path.resolve(__dirname, '../..');
    for (const f of ['scripts/workers/archive-ocr.mjs', 'scripts/workers/archive-bulk.mjs', 'scripts/workers/archive-harvard.mjs']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f).toContain('...ARCHIVE_NOT_BLOCKED');
      // A book selector opens with `pages_count: { $gt: 0 }`; the bare filter must not follow it.
      expect(/pages_count: \{ \$gt: 0 \},\s*(?:\$expr:[^\n]*\n\s*)?'archive_metadata\.blocked': \{ \$ne: true \}/.test(src), f).toBe(false);
    }
  });
});

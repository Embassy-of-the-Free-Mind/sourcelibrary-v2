/**
 * stripArchiveOnlyFields: field hygiene on the book restore path (#3997).
 *
 * What these pin: restoring an archived book must not carry `deleted_books`
 * bookkeeping back into `books`, and must not resurrect fields retired by the
 * #3969 consolidations — the tenant/hide_reason cleanup touched `books` but
 * not `deleted_books`, so every archived copy still carries them and an
 * unfiltered restore re-pollutes the collection. Real book data must survive
 * untouched, and what is removed must be returned so the caller can log it.
 */
import { describe, it, expect } from 'vitest';

import { stripArchiveOnlyFields, ARCHIVE_ONLY_FIELDS } from '@/lib/restore-hygiene';

describe('stripArchiveOnlyFields', () => {
  it('keeps real book fields untouched', () => {
    const input = {
      id: 'abc123',
      title: 'Novum lumen chymicum',
      author: 'Sendivogius',
      pages_count: 240,
      visible: false,
      image_source: { provider: 'internet_archive' },
    };
    const { clean, stripped } = stripArchiveOnlyFields(input);

    expect(clean).toEqual(input);
    expect(stripped).toEqual({});
  });

  it('removes retired fields so a restore cannot re-pollute the collection', () => {
    const { clean, stripped } = stripArchiveOnlyFields({
      id: 'abc123',
      title: 'Pymander',
      tenant_id: 'default',
      hide_reason: 'Duplicate of 69b51e80 (kept: 0ocr/406pg, this: 0ocr/348pg)',
    });

    expect('tenant_id' in clean).toBe(false);
    expect('hide_reason' in clean).toBe(false);
    expect(stripped.tenant_id).toBe('default');
    expect(stripped.hide_reason).toContain('Duplicate of');
    expect(clean.title).toBe('Pymander');
  });

  it('removes dedup/purge bookkeeping that is meaningless on a live book', () => {
    const { clean, stripped } = stripArchiveOnlyFields({
      id: 'abc123',
      dedup_batch: 'bph-2026-07',
      dedup_sim: 0.98,
      kept_version_id: '69b51e80',
      delete_reason: 'duplicate',
      reason: 'duplicate',
      needs_reimport: true,
      materials: ['paper'],
      _original_id: '69a0278f',
    });

    expect(Object.keys(clean)).toEqual(['id']);
    expect(Object.keys(stripped).sort()).toEqual(
      ['_original_id', 'dedup_batch', 'dedup_sim', 'delete_reason', 'kept_version_id', 'materials', 'needs_reimport', 'reason'].sort()
    );
  });

  it('does not mutate its input', () => {
    const input = { id: 'abc123', tenant_id: 'default' };
    stripArchiveOnlyFields(input);

    expect(input.tenant_id).toBe('default');
  });

  it('strips every declared archive-only field', () => {
    const input = Object.fromEntries(ARCHIVE_ONLY_FIELDS.map((f) => [f, 'x']));
    const { clean, stripped } = stripArchiveOnlyFields(input);

    expect(clean).toEqual({});
    expect(Object.keys(stripped).sort()).toEqual([...ARCHIVE_ONLY_FIELDS].sort());
  });
});

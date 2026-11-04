/**
 * The #7263 script_type backfill rule: fill only an EMPTY field, only from the page's own first
 * `<script>` tag, only with printed | handwritten | mixed. An existing value is never touched (a
 * disagreeing one is a reported conflict), and a junk tag leaves the field unset.
 */
import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';

import { scriptTypeFill, writeFilter, restHash } from '../../scripts/maintenance/backfill-script-type-7263.mjs';

const page = (script_type: unknown, data?: string) => ({
  ...(script_type === undefined ? {} : { script_type }),
  ...(data === undefined ? {} : { ocr: { data } }),
});

describe('scriptTypeFill', () => {
  it('fills a missing, null or empty field from the tag', () => {
    expect(scriptTypeFill(page(undefined, '<script>handwritten</script>\nText'))).toMatchObject({ fill: 'handwritten' });
    expect(scriptTypeFill(page(null, '<script>Printed</script>'))).toMatchObject({ fill: 'printed' });
    expect(scriptTypeFill(page('', '<SCRIPT> mixed </SCRIPT>'))).toMatchObject({ fill: 'mixed' });
  });

  it('uses the first tag only', () => {
    expect(scriptTypeFill(page(undefined, '<script>printed</script> … <script>handwritten</script>'))).toMatchObject({ fill: 'printed' });
    expect(scriptTypeFill(page(undefined, '<script>pri</script> … <script>printed</script>'))).toMatchObject({ skip: 'tag-junk' });
  });

  it('never touches an existing value; a disagreeing one is a conflict', () => {
    const same = scriptTypeFill(page('printed', '<script>printed</script>'));
    expect(same.fill).toBeUndefined();
    expect(same).toMatchObject({ skip: 'has-value' });
    expect(same.conflict).toBeUndefined();
    const clash = scriptTypeFill(page('printed', '<script>handwritten</script>'));
    expect(clash.fill).toBeUndefined();
    expect(clash).toMatchObject({ skip: 'has-value', conflict: true, field: 'printed', tag: 'handwritten' });
    expect(scriptTypeFill(page('handwritten', 'no tag')).fill).toBeUndefined();
  });

  it('leaves junk, truncated or absent tags unset and says why', () => {
    expect(scriptTypeFill(page(undefined, '<script>pri</script>'))).toMatchObject({ skip: 'tag-junk', raw: 'pri' });
    expect(scriptTypeFill(page(undefined, '<script>n</script>'))).toMatchObject({ skip: 'tag-junk', raw: 'n' });
    expect(scriptTypeFill(page(undefined, '<script>none</script>'))).toMatchObject({ skip: 'tag-junk' });
    expect(scriptTypeFill(page(undefined, '<script></script>'))).toMatchObject({ skip: 'tag-junk', raw: '' });
    expect(scriptTypeFill(page(undefined, '<script>printed'))).toMatchObject({ skip: 'tag-no-tag' });
    expect(scriptTypeFill(page(undefined, 'plain text'))).toMatchObject({ skip: 'tag-no-tag' });
    expect(scriptTypeFill(page(undefined))).toMatchObject({ skip: 'tag-no-ocr' });
  });
});

describe('writeFilter', () => {
  it('re-asserts the empty field and the OCR that was read', () => {
    const at = new Date('2026-10-03T00:00:00Z');
    const f = writeFilter({ _id: 'p1', ocr: { updated_at: at } });
    expect(f._id).toBe('p1');
    expect(f.$or).toEqual([{ script_type: { $exists: false } }, { script_type: null }, { script_type: '' }]);
    expect(f['ocr.updated_at']).toBe(at);
    expect(writeFilter({ _id: 'p2', ocr: {} })['ocr.updated_at']).toEqual({ $exists: false });
  });
});

describe('restHash', () => {
  it('ignores script_type and nothing else', () => {
    const id = new ObjectId();
    const a = { _id: id, b: 1, ocr: { data: 'x', updated_at: new Date(0) } };
    expect(restHash({ ...a, script_type: 'printed' })).toBe(restHash(a));
    expect(restHash({ ...a, ocr: { data: 'y', updated_at: new Date(0) } })).not.toBe(restHash(a));
  });
});

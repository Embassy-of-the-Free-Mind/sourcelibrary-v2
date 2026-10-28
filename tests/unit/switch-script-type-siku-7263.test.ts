/**
 * The #7263 Siku switch: printed → handwritten only on Wenyuange Siku Quanshu volumes (CADAL
 * `060xxxxx.cn`), only where the field is exactly `printed` and the page's own first `<script>`
 * tag is exactly `handwritten`. The other CADAL books in the paddle-zh lane (`020…`/`021….cn`)
 * are woodblock prints whose blanket handwritten tag is wrong, so they must never qualify.
 */
import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';

import { isSikuBook, sikuSwitch, writeFilter, revertOp } from '../../scripts/maintenance/switch-script-type-siku-7263.mjs';

const page = (script_type: unknown, data?: string) => ({
  ...(script_type === undefined ? {} : { script_type }),
  ...(data === undefined ? {} : { ocr: { data } }),
});

describe('isSikuBook', () => {
  it('takes only the Wenyuange SKQS CADAL range', () => {
    expect(isSikuBook({ ia_identifier: '06041645.cn' })).toBe(true);
    expect(isSikuBook({ ia_identifier: '06082287.cn' })).toBe(true);
  });

  it('rejects the woodblock CADAL books the paddle-zh lane also read, and anything else', () => {
    expect(isSikuBook({ ia_identifier: '02092259.cn' })).toBe(false); // 武備志
    expect(isSikuBook({ ia_identifier: '02111815.cn' })).toBe(false); // 李卓吾先生批評西遊記
    expect(isSikuBook({ ia_identifier: '060416451.cn' })).toBe(false);
    expect(isSikuBook({ ia_identifier: 'x06041645.cn' })).toBe(false);
    expect(isSikuBook({ ia_identifier: 'datangxiyuji' })).toBe(false);
    expect(isSikuBook({})).toBe(false);
  });
});

describe('sikuSwitch', () => {
  it('switches printed with a handwritten first tag', () => {
    expect(sikuSwitch(page('printed', '<script>handwritten</script>\n文'))).toMatchObject({ switch: 'handwritten' });
    expect(sikuSwitch(page('printed', '<SCRIPT> Handwritten </SCRIPT>'))).toMatchObject({ switch: 'handwritten' });
  });

  it('leaves every other field value alone', () => {
    for (const v of [undefined, null, '', 'handwritten', 'mixed', 'Printed', 'other']) {
      expect(sikuSwitch(page(v, '<script>handwritten</script>')).switch).toBeUndefined();
    }
  });

  it('needs the first tag to say handwritten', () => {
    expect(sikuSwitch(page('printed', '<script>printed</script>'))).toMatchObject({ skip: 'tag-printed' });
    expect(sikuSwitch(page('printed', '<script>mixed</script> <script>handwritten</script>'))).toMatchObject({ skip: 'tag-mixed' });
    expect(sikuSwitch(page('printed', '文 no tag'))).toMatchObject({ skip: 'tag-no-tag' });
    expect(sikuSwitch(page('printed', ''))).toMatchObject({ skip: 'tag-no-ocr' });
    expect(sikuSwitch(page('printed'))).toMatchObject({ skip: 'tag-no-ocr' });
  });
});

describe('writeFilter / revertOp', () => {
  it('writes only over printed and the OCR that was read', () => {
    const at = new Date('2026-10-20T00:00:00Z');
    expect(writeFilter({ _id: 'p1', ocr: { updated_at: at } })).toEqual({ _id: 'p1', script_type: 'printed', 'ocr.updated_at': at });
    expect(writeFilter({ _id: 'p2' })).toEqual({ _id: 'p2', script_type: 'printed', 'ocr.updated_at': { $exists: false } });
  });

  it('reverts to printed only where the value is still handwritten, with the logged id type', () => {
    const oid = new ObjectId();
    const row = { detail: { page_ids: [String(oid), 'abc'], id_types: ['objectId', 'string'], values: ['handwritten', 'handwritten'], prev: ['printed', 'printed'] } };
    const a = revertOp(row, 0).updateOne;
    expect(a.filter._id).toBeInstanceOf(ObjectId);
    expect(String(a.filter._id)).toBe(String(oid));
    expect(a.filter.script_type).toBe('handwritten');
    expect(a.update).toEqual({ $set: { script_type: 'printed' } });
    expect(revertOp(row, 1).updateOne.filter).toEqual({ _id: 'abc', script_type: 'handwritten' });
  });
});

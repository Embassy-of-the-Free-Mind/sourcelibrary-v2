/**
 * The blind reader check (#7573). What these pin:
 *  - the browser never receives an arm name, so the page cannot unblind itself;
 *  - an answer maps back to the arm that was shown under that letter;
 *  - the two token shapes on /check/<token> cannot be confused;
 *  - the mint script and the route derive the same token id.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  isReaderCheckToken,
  readerCheckTokenId,
  toClientItems,
  parseJudgement,
  judgementRow,
  type ReaderCheckTokenDoc,
} from '@/lib/reader-check';

const doc: ReaderCheckTokenDoc = {
  _id: 'tid',
  reader_id: '00000000-0000-4000-8000-000000000000',
  reader: { language: 'greek', level: 'professional', credit: 'anonymous', credit_name: null, consent_publish: false },
  packet: { file: 'judge-human-check-7573/greek.jsonl', language: 'greek', pair: ['corrected', 'reread'], issue: 7573 },
  items: [
    { packet_id: 'greek:p1', page_id: 'p1', book_id: 'b1', title: 'T', page_number: 3, image_url: 'https://x/3.jpg',
      arms: ['reread', 'corrected'], text_a: 'alpha', text_b: 'beta', control: false },
    { packet_id: 'greek:p2', page_id: 'p2', book_id: 'b1', title: 'T', page_number: 4, image_url: 'https://x/4.jpg',
      arms: ['lite', 'corrected'], text_a: 'gamma', text_b: 'delta', control: true },
  ],
  batch: 1, test: false, revoked: false, created_at: new Date(0),
};

describe('reader check', () => {
  it('sends the browser no arm names and no control marker', () => {
    const json = JSON.stringify(toClientItems(doc));
    for (const word of ['reread', 'corrected', 'lite', 'control', 'arms', 'page_id']) {
      expect(json, word).not.toContain(word);
    }
  });

  it('maps a letter back to the arm shown under it', () => {
    const a = parseJudgement(doc, { index: 0, choice: 'A', invented: true, note: '  ὧδε  ' });
    if ('error' in a) throw new Error(a.error);
    const row = judgementRow(doc, a.index, a, new Date(0));
    expect(row.preferred_arm).toBe('reread');
    expect(row.arms_shown).toEqual({ A: 'reread', B: 'corrected' });
    expect(row.note).toBe('ὧδε');
    expect(row.invented).toBe(true);

    const b = parseJudgement(doc, { index: 1, choice: 'B', invented: 'yes', note: '' });
    if ('error' in b) throw new Error(b.error);
    const row2 = judgementRow(doc, b.index, b, new Date(0));
    expect(row2.preferred_arm).toBe('corrected');
    expect(row2.control).toBe(true);
    expect(row2.invented).toBe(false); // only a real boolean true counts
    expect(row2.note).toBeNull();

    const same = parseJudgement(doc, { index: 0, choice: 'same', invented: false, note: null });
    if ('error' in same) throw new Error(same.error);
    expect(judgementRow(doc, 0, same, new Date(0)).preferred_arm).toBeNull();
  });

  it('refuses a page outside the link and an unknown choice', () => {
    expect(parseJudgement(doc, { index: 2, choice: 'A', invented: false, note: '' })).toEqual({ error: 'invalid page' });
    expect(parseJudgement(doc, { index: '0', choice: 'A', invented: false, note: '' })).toEqual({ error: 'invalid page' });
    expect(parseJudgement(doc, { index: 0, choice: 'reread', invented: false, note: '' })).toEqual({ error: 'invalid choice' });
  });

  it('tells minted tokens from one-page invite tokens', () => {
    expect(isReaderCheckToken('a'.repeat(32))).toBe(true);
    expect(isReaderCheckToken('AbC-_' + 'x'.repeat(27))).toBe(true);
    expect(isReaderCheckToken('item.00000000-0000-4000-8000-000000000000.' + 'f'.repeat(32))).toBe(false);
    expect(isReaderCheckToken('a'.repeat(31))).toBe(false);
    expect(isReaderCheckToken(undefined)).toBe(false);
  });

  it('derives the token id the same way as the mint script', () => {
    const script = readFileSync(path.resolve(__dirname, '../../scripts/email/mint-reader-check-links.mjs'), 'utf8');
    expect(script).toContain("createHash('sha256').update(`reader-check:${token}`).digest('hex')");
    expect(script).toContain("randomBytes(24).toString('base64url')");
    expect(readerCheckTokenId('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

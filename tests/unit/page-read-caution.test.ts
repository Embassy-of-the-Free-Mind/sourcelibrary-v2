import { describe, it, expect } from 'vitest';
import { pageReadCaution, transcriptionReliability } from '@/lib/transcription-reliability';
import { parsePageReport, pageReportMessage } from '@/lib/page-report';

/**
 * What this pins (#5274 follow-up):
 *  - the reader's "hard to read" note fires on the OCR's own signals and stays
 *    silent on a clean page — a note on every page is a note nobody reads;
 *  - metadata tags (<meta>, <warning>, …) never count as page body, or a long
 *    model description would dilute or inflate the share;
 *  - a malformed page report degrades to an ordinary note, never to a stored
 *    object with attacker-chosen keys.
 */

const LINE = 'Et dixit Deus fiat lux et facta est lux et vidit Deus lucem quod esset bona. ';

describe('pageReadCaution', () => {
  it('is silent on a clean page', () => {
    expect(pageReadCaution({ ocr: { data: `<language>la</language>\n${LINE.repeat(4)}` } })).toBeNull();
  });

  it('fires when a large share of the body is <unclear>', () => {
    const data = `${LINE.repeat(3)}<unclear>${LINE}</unclear>`;
    const c = pageReadCaution({ ocr: { data } });
    expect(c?.reason).toBe('unclear');
    expect(c && 'share' in c && c.share).toBeGreaterThan(0.2);
  });

  it('does not fire on a single uncertain word in a long page', () => {
    const data = `${LINE.repeat(10)}<unclear>lucem</unclear>`;
    expect(pageReadCaution({ ocr: { data } })).toBeNull();
  });

  it('ignores metadata when measuring the body', () => {
    const data = `<meta>${'A long description of the page. '.repeat(40)}</meta>\n<unclear>${LINE}</unclear>${LINE}`;
    const c = pageReadCaution({ ocr: { data } });
    expect(c?.reason).toBe('unclear');
  });

  it('fires on a legibility <warning>', () => {
    const data = `<warning>The lower half is faded and partly illegible.</warning>\n${LINE.repeat(4)}`;
    expect(pageReadCaution({ ocr: { data } })?.reason).toBe('damage');
  });

  it('ignores a warning that is not about legibility', () => {
    const data = `<warning>Page numbering skips from 12 to 14.</warning>\n${LINE.repeat(4)}`;
    expect(pageReadCaution({ ocr: { data } })).toBeNull();
  });

  it('leaves ocr.unreadable pages to their own, stronger state', () => {
    const data = `<unclear>${LINE.repeat(4)}</unclear>`;
    expect(pageReadCaution({ ocr: { data, unreadable: true } })).toBeNull();
  });
});

describe('parsePageReport', () => {
  it('accepts a well-formed report', () => {
    expect(parsePageReport({ book_id: 'abc123', page_id: 'p9', page_number: 12, kind: 'wrong_image' }))
      .toEqual({ book_id: 'abc123', page_id: 'p9', page_number: 12, kind: 'wrong_image' });
  });

  it('keeps a report with no class as an unspecified flag', () => {
    expect(parsePageReport({ book_id: 'abc123', page_number: 3 })?.kind).toBeNull();
  });

  it('rejects malformed ids and page numbers', () => {
    expect(parsePageReport({ book_id: { $ne: null }, page_number: 1 })).toBeNull();
    expect(parsePageReport({ book_id: 'a b', page_number: 1 })).toBeNull();
    expect(parsePageReport({ book_id: 'abc', page_number: 1.5 })).toBeNull();
    expect(parsePageReport('abc')).toBeNull();
  });

  it('drops an unknown class rather than storing it', () => {
    expect(parsePageReport({ book_id: 'abc', page_number: 1, kind: 'delete_book' })?.kind).toBeNull();
  });

  it('writes a triage message a person can read without the structured field', () => {
    const r = parsePageReport({ book_id: 'abc', page_number: 4, kind: 'missing_text' })!;
    expect(pageReportMessage(r, '')).toBe('[page report] missing_text — book abc p. 4');
    expect(pageReportMessage(r, 'bottom lines gone')).toContain('bottom lines gone');
  });
});

/**
 * #5746: the Tibetan notice is chosen by the engine that read the page. The
 * 09-01 "cannot read cursive Tibetan" warning described Gemini reads; on a
 * page BDRC Yigdzin read it was false, and its own evidence named Yigdzin's
 * family as the good reader.
 */
describe('transcriptionReliability', () => {
  const kangyur = { language: 'Tibetan', title: 'Neyphug Kanjur rGyud Tsha' };
  const nyingma = { language: 'Tibetan', title: 'rNying ma rgyud \'bum' };
  const yig = { ocr: { model: 'bdrc-yigdzin-v1' } };

  it('is silent outside Tibetan', () => {
    expect(transcriptionReliability({ language: 'Latin' }, yig)).toBeNull();
  });

  it('keeps the strong warning for a Gemini-read page and for a book with no page', () => {
    expect(transcriptionReliability(kangyur, { ocr: { model: 'gemini-3.1-flash-lite' } })?.level).toBe('unreliable');
    expect(transcriptionReliability(kangyur)?.level).toBe('unreliable');
  });

  it('gives a Yigdzin page the measured caution on a Kangyur volume', () => {
    const f = transcriptionReliability(kangyur, yig);
    expect(f?.level).toBe('caution');
    expect(f?.message).not.toMatch(/cannot read/);
    expect(f?.evidence).toMatch(/95%/);
  });

  it('says accuracy is unknown where there is no reference text', () => {
    const f = transcriptionReliability(nyingma, yig);
    expect(f?.level).toBe('caution');
    expect(f?.message).toMatch(/unknown/);
  });

  it('matches the Kangyur spellings in our titles', () => {
    for (const title of ['Kangyur vol. 3', 'Neyphug Kanjur', 'bka\' \'gyur', 'Bka\'gyur']) {
      expect(transcriptionReliability({ language: 'Tibetan', title }, yig)?.message).not.toMatch(/unknown/);
    }
  });
});

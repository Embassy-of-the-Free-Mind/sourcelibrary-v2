/**
 * The stale-translation rule, pinned (#4523).
 *
 * On 2026-09-10 a re-OCR lane rewrote the transcription of 65,129 pages across
 * 190 Tibetan books. Their English translations — written in April from the
 * reading that was just replaced — stayed exactly where they were, and every
 * surface kept serving them: a reader saw new, correct Tibetan beside an
 * English translation of text that is no longer on the page.
 *
 * The rule that catches that has to be a PREDICATE the sweep re-derives, never
 * a list: every future apply pass puts more pages into the set, and a frozen id
 * list is how the Kloss takedown leaked for six weeks. These tests exist
 * because the two ways to get the predicate wrong are both silent —
 *
 *   too narrow  a stale page keeps serving invented English, and nothing errors;
 *   too wide    a freshly retranslated page gets taken down, and nothing errors.
 *
 * so the boundary cases (equal timestamps, a missing translation date, a page
 * already withheld, a page whose OCR was never touched by a re-OCR lane) are
 * asserted rather than assumed.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { staleTranslationReason, withholdUpdate, restoreUpdate, WITHHOLD_REASONS } from '../../scripts/lib/stale-translation.mjs';

const OCR_AT = new Date('2026-09-10T07:25:47Z');
const BEFORE = new Date('2026-04-22T02:56:19Z');
const AFTER = new Date('2026-09-11T12:00:00Z');

const page = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  book_id: 'b1',
  ocr: { pipeline: 'reocr_bdrc_4523', updated_at: OCR_AT, data: 'བོད་ཡིག' },
  translation: { data: 'English', model: 'gemini-3.1-flash-lite-preview', updated_at: BEFORE },
  ...over,
});

describe('staleTranslationReason', () => {
  it('flags a translation older than the re-OCR that replaced its source', () => {
    expect(staleTranslationReason(page())).toBe(WITHHOLD_REASONS.STALE_AFTER_REOCR);
  });

  it('clears once the page is retranslated — the predicate is the exit, not a flag', () => {
    expect(staleTranslationReason(page({ translation: { data: 'New', updated_at: AFTER } }))).toBeNull();
  });

  it('treats an EQUAL timestamp as stale', () => {
    // The applier writes ocr.updated_at and the translation worker writes
    // translation.updated_at; a tie means the translation did not come after
    // the new reading. Reading a tie as fresh keeps serving the fabrication,
    // which is the failure this whole mechanism exists to stop.
    expect(staleTranslationReason(page({ translation: { data: 'x', updated_at: OCR_AT } })))
      .toBe(WITHHOLD_REASONS.STALE_AFTER_REOCR);
  });

  it('treats a MISSING translation date as stale, never as fresh', () => {
    // Undated translations predate date-stamping, so they are years older than
    // any re-OCR lane. Guessing "fresh" here is the guess that serves invented
    // English.
    expect(staleTranslationReason(page({ translation: { data: 'x' } })))
      .toBe(WITHHOLD_REASONS.STALE_AFTER_REOCR);
  });

  it('falls back to edited_at when updated_at is absent', () => {
    expect(staleTranslationReason(page({ translation: { data: 'x', edited_at: AFTER } }))).toBeNull();
  });

  it('leaves a page whose OCR no re-OCR lane touched alone', () => {
    expect(staleTranslationReason(page({ ocr: { updated_at: OCR_AT, data: 'x' } }))).toBeNull();
  });

  it('flags a translation of a transcription flagged unreadable', () => {
    // The reader already withholds both panes for these. Nothing else does:
    // search, embeddings, quotes, exports and the MCP tools read
    // translation.data and see no flag. 22,098 pages were in this state.
    expect(staleTranslationReason({
      ocr: { unreadable: true, unreadable_reason: 'reocr_bdrc_4523', data: 'old', updated_at: BEFORE },
      translation: { data: 'English', updated_at: BEFORE },
    })).toBe(WITHHOLD_REASONS.OCR_UNREADABLE);
  });

  it('says nothing about a page with no translation to serve', () => {
    expect(staleTranslationReason(page({ translation: undefined }))).toBeNull();
    expect(staleTranslationReason(page({ translation: { data: '' } }))).toBeNull();
    expect(staleTranslationReason({ ocr: { unreadable: true }, translation: undefined })).toBeNull();
  });

  it('ignores a translation object that carries no text', () => {
    // ~2,000 pages of this cohort hold a `translation` object with dates and a
    // model but no `data`. Nothing is served from them; treating the object's
    // mere presence as text inflated the first measurement by 3% and would have
    // "withheld" empty fields.
    expect(staleTranslationReason(page({ translation: { updated_at: BEFORE, model: 'x' } }))).toBeNull();
  });

  it('reads a legacy bare-string translation and normalises it into holding', () => {
    const p = page({ translation: 'Old English text' });
    expect(staleTranslationReason(p)).toBe(WITHHOLD_REASONS.STALE_AFTER_REOCR);
    const u = withholdUpdate(p, WITHHOLD_REASONS.STALE_AFTER_REOCR);
    expect(u.$set.translation_withheld.data).toBe('Old English text');
  });

  it('is idempotent: an already-withheld page no longer matches', () => {
    const withheld = { ...page(), translation: undefined, translation_withheld: { data: 'English', reason: 'stale_after_reocr' } };
    expect(staleTranslationReason(withheld)).toBeNull();
  });
});

describe('withholdUpdate / restoreUpdate', () => {
  it('moves the whole translation object, keeping text, model and dates', () => {
    const now = new Date('2026-09-12T10:00:00Z');
    const u = withholdUpdate(page(), WITHHOLD_REASONS.STALE_AFTER_REOCR, now);
    expect(u.$unset).toEqual({ translation: '' });
    expect(u.$set.translation_withheld).toMatchObject({
      data: 'English',
      model: 'gemini-3.1-flash-lite-preview',
      updated_at: BEFORE,
      reason: WITHHOLD_REASONS.STALE_AFTER_REOCR,
      withheld_at: now,
    });
  });

  it('round-trips: restore puts back exactly what withhold moved aside', () => {
    const original = page().translation;
    const u = withholdUpdate(page(), WITHHOLD_REASONS.STALE_AFTER_REOCR);
    const r = restoreUpdate({ translation_withheld: u.$set.translation_withheld });
    expect(r.$set.translation).toEqual(original);
    expect(r.$unset).toEqual({ translation_withheld: '' });
  });

  it('is a no-op on a page with nothing to withhold or restore', () => {
    expect(withholdUpdate({ id: 'p' }, 'x')).toBeNull();
    expect(restoreUpdate({ id: 'p' })).toBeNull();
  });
});

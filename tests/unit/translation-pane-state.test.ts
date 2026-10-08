/**
 * An English book is not "untranslated" (#4958-adjacent; Derek, 2026-09-26, on
 * *The Book of Clevelanders* p.250: the pane said READY TO TRANSLATE / "It has
 * not been translated into English yet" over an English page).
 *
 * The pipeline never translates English. Pre-1700 English may be MODERNIZED,
 * on request, into the same field. This pins the pane-state decision so the
 * copy branches honestly, and so the "English" test is one function shared by
 * the reader and the request-CTA helper rather than two string checks.
 */
import { describe, it, expect } from 'vitest';
import {
  isEnglishBook,
  publishedYear,
  translationPaneEmptyState,
  MODERNIZATION_CUTOFF_YEAR,
} from '@/lib/translation-pane-state';
import { shouldShowTranslationRequestCta } from '@/lib/translation-request-cta';

describe('isEnglishBook', () => {
  it('matches the edition language case-insensitively, with variants', () => {
    expect(isEnglishBook('English')).toBe(true);
    expect(isEnglishBook('english')).toBe(true);
    expect(isEnglishBook('English (Early Modern)')).toBe(true);
  });
  it('is false for other languages and for no language at all', () => {
    expect(isEnglishBook('Latin')).toBe(false);
    expect(isEnglishBook('Middle English')).toBe(false);
    expect(isEnglishBook('')).toBe(false);
    expect(isEnglishBook(null)).toBe(false);
    expect(isEnglishBook(undefined)).toBe(false);
  });
});

describe('publishedYear', () => {
  it('reads the first four-digit year out of the free-text field', () => {
    expect(publishedYear('1657')).toBe(1657);
    expect(publishedYear('c. 1657')).toBe(1657);
    expect(publishedYear('1657-1660')).toBe(1657);
    expect(publishedYear(1912)).toBe(1912);
  });
  it('is null when there is no year to read', () => {
    expect(publishedYear('n.d.')).toBeNull();
    expect(publishedYear('')).toBeNull();
    expect(publishedYear(null)).toBeNull();
    expect(publishedYear(undefined)).toBeNull();
  });
});

describe('translationPaneEmptyState', () => {
  it('a non-English book with OCR and no translation is ready to translate', () => {
    expect(translationPaneEmptyState({ language: 'Latin', published: '1657' })).toBe('ready-to-translate');
    expect(translationPaneEmptyState({ language: 'German', published: '1921' })).toBe('ready-to-translate');
  });
  it('a modern English book: the transcription is the reading text', () => {
    expect(translationPaneEmptyState({ language: 'English', published: '1921' })).toBe('english-reading-text');
    expect(translationPaneEmptyState({ language: 'English', published: String(MODERNIZATION_CUTOFF_YEAR) })).toBe('english-reading-text');
  });
  it('an English book with no readable year is treated as modern, never as owing a modernization', () => {
    expect(translationPaneEmptyState({ language: 'English', published: 'n.d.' })).toBe('english-reading-text');
    expect(translationPaneEmptyState({ language: 'English' })).toBe('english-reading-text');
  });
  it('a pre-1700 English book is not yet modernized', () => {
    expect(translationPaneEmptyState({ language: 'English', published: '1657' })).toBe('english-not-modernized');
    expect(translationPaneEmptyState({ language: 'english', published: String(MODERNIZATION_CUTOFF_YEAR - 1) })).toBe('english-not-modernized');
  });
});

describe('the request-translation CTA agrees with the pane state', () => {
  it('never offers to translate an English book, whichever English state the pane is in', () => {
    for (const published of ['1657', '1921', 'n.d.']) {
      expect(shouldShowTranslationRequestCta({
        ocrText: 'Some transcribed English text.',
        bookLanguage: 'English',
        bookPagesTranslated: 0,
        bookPagesCount: 300,
      }), `published=${published}`).toBe(false);
    }
  });
});

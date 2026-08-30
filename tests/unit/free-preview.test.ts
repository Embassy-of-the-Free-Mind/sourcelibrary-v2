import { describe, it, expect } from 'vitest';
import {
  FREE_PAGE_PERCENT,
  freeMaxPage,
  isPageFree,
  stripGatedPage,
  meteredReaderEnabled,
} from '@/lib/free-preview';
import { botMaxPage } from '@/lib/bot-gate';

/**
 * Pins the metered-reader free-preview policy (#4357 Phase 2). Guards:
 *  - the master switch defaults OFF (unset env ⇒ inert everywhere)
 *  - the human sample and the bot sample share one formula (no drift)
 *  - seo_indexable pages are ALWAYS free — this is the invariant that keeps
 *    every Google-indexed reader page fully accessible, which is what lets
 *    reader JSON-LD keep `isAccessibleForFree: true` without cloaking
 *  - stripGatedPage removes every text-bearing field and no image field
 */
describe('free-preview policy', () => {
  it('is OFF by default: METERED_READER unset means no metering anywhere', () => {
    expect(process.env.METERED_READER).toBeUndefined();
    expect(meteredReaderEnabled()).toBe(false);
  });

  it('free sample math matches the bot gate exactly', () => {
    for (const n of [0, 1, 4, 5, 100, 250, 999]) {
      expect(freeMaxPage(n)).toBe(botMaxPage(n));
    }
    expect(freeMaxPage(100)).toBe(20);
    expect(freeMaxPage(4)).toBe(1); // never less than one free page
    expect(freeMaxPage(0)).toBe(0); // unknown length: deny by default
    expect(FREE_PAGE_PERCENT).toBe(20);
  });

  it('pages inside the sample are free, pages beyond it are not', () => {
    expect(isPageFree({ page_number: 20 }, 100)).toBe(true);
    expect(isPageFree({ page_number: 21 }, 100)).toBe(false);
  });

  it('seo_indexable pages are free regardless of position', () => {
    expect(isPageFree({ page_number: 99, seo_indexable: true }, 100)).toBe(true);
  });

  it('unnumbered and negative pages are free (inserts, flyleaves)', () => {
    expect(isPageFree({ page_number: null }, 100)).toBe(true);
    expect(isPageFree({}, 100)).toBe(true);
    expect(isPageFree({ page_number: -1 }, 100)).toBe(true);
  });

  it('stripGatedPage removes text fields, keeps images, marks the page', () => {
    const page = {
      id: 'p1', book_id: 'b1', page_number: 50,
      photo: 'https://images.example/1.jpg',
      archived_photo: 'https://images.example/a.jpg',
      thumbnail: 'https://images.example/t.jpg',
      page_type: 'text', columns: 2,
      ocr: { data: 'secret transcription', language: 'Latin' },
      translation: { data: 'secret translation', language: 'English' },
      translations: { es: { data: 'secreto', language: 'Spanish' } },
      summary: { data: 'secret summary' },
      transliteration: { data: 'secret' },
      translation_summary: 'secret',
      translation_keywords: ['secret'],
      word_alignment: { spans: [] },
    };
    const gated = stripGatedPage(page, 100);
    // every text field gone
    for (const field of ['ocr', 'translation', 'translations', 'summary',
      'transliteration', 'translation_summary', 'translation_keywords', 'word_alignment']) {
      expect(gated).not.toHaveProperty(field);
    }
    // scan stays browsable
    expect(gated.photo).toBe(page.photo);
    expect(gated.archived_photo).toBe(page.archived_photo);
    expect(gated.thumbnail).toBe(page.thumbnail);
    expect(gated.page_type).toBe('text');
    // marked, with the numbers the wall copy needs
    expect(gated.gated).toBe(true);
    expect(gated.gate.free_pages).toBe(20);
    expect(gated.gate.pages_count).toBe(100);
    // input object untouched (routes reuse it)
    expect(page.ocr.data).toBe('secret transcription');
  });
});

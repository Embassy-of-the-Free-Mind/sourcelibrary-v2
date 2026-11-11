import { describe, expect, it } from 'vitest';
import { pageHasNoTextToShow } from '@/lib/reader-panes';
import type { Page } from '@/lib/types';

const page = (fields: Record<string, unknown>) => ({ id: 'p', book_id: 'b', page_number: 1, ...fields }) as unknown as Page;

describe('pageHasNoTextToShow', () => {
  it('is true for a page nobody has transcribed', () => {
    expect(pageHasNoTextToShow(page({}))).toBe(true);
    expect(pageHasNoTextToShow(page({ ocr: { data: '' }, translation: { data: '   \n' } }))).toBe(true);
  });

  it('is false as soon as either pane has text', () => {
    expect(pageHasNoTextToShow(page({ ocr: { data: 'Tabula smaragdina' } }))).toBe(false);
    expect(pageHasNoTextToShow(page({ translation: { data: 'The Emerald Table' } }))).toBe(false);
    expect(pageHasNoTextToShow(page({ modernized_spelling: { data: 'A light spelling edit' } }))).toBe(false);
  });

  it('keeps the panes open where the empty pane explains something', () => {
    // The metered wall: a gated page IS empty, and reading it as untranscribed would be untrue.
    expect(pageHasNoTextToShow(page({ gated: true }))).toBe(false);
    expect(pageHasNoTextToShow(page({ ocr: { unreadable: true } }))).toBe(false);
    expect(pageHasNoTextToShow(page({ translation_withheld: { reason: 'blank_source' } }))).toBe(false);
  });
});

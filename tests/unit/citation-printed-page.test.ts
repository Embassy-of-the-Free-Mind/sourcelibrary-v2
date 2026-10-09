/**
 * The page part of the citation apparatus (#4291).
 *
 * A scan index is not a page a reader can find in the book. On Fludd's Utriusque cosmi
 * (6952dac977f38f6761bc6cb0) scan 219 carries the running head "DE TRIPL. ANIM. IN CORP.
 * VISION. 217", and every format said "p. 219". Where `pages.printed_page` holds a fitted
 * number, the citation cites it and keeps the scan as a locator; where it does not, the
 * citation reads exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { generateCitations, pageLocator } from '@/lib/citation';
import type { Book } from '@/lib/types';

const fludd = {
  id: '6952dac977f38f6761bc6cb0',
  slug: 'utriusque-cosmi-fludd',
  title: 'Utriusque cosmi maioris scilicet et minoris metaphysica, physica atque technica historia',
  author: 'Robert Fludd',
  published: '1619',
  language: 'Latin',
} as unknown as Book;

const cite = (printed?: Parameters<typeof pageLocator>[1]) =>
  generateCitations(fludd, 219, fludd.id, 'pg219', 'https://sourcelibrary.org', undefined, undefined, printed);

describe('pageLocator (#4291)', () => {
  it('cites the printed page with the scan in brackets', () => {
    expect(pageLocator(219, { label: '217', numbering: 'arabic', rate: 1 })).toEqual({ inline: 'p. 217 [scan 219]', note: '217 [scan 219]', printed: '217' });
  });
  it('cites leaves as folios and two-page scans as a range', () => {
    expect(pageLocator(30, { label: '12v', numbering: 'folio', rate: 1 }).inline).toBe('fol. 12v [scan 30]');
    expect(pageLocator(30, { label: '12v', numbering: 'arabic', rate: 0.5 }).inline).toBe('fol. 12v [scan 30]');
    expect(pageLocator(7, { label: '12–13', numbering: 'arabic', rate: 2 }).inline).toBe('pp. 12–13 [scan 7]');
    expect(pageLocator(3, { label: 'xii', numbering: 'roman', rate: 1 }).inline).toBe('p. xii [scan 3]');
  });
  it('falls back to the scan when no printed page was fitted', () => {
    expect(pageLocator(219)).toEqual({ inline: 'p. 219', note: '219' });
    expect(pageLocator(219, null)).toEqual({ inline: 'p. 219', note: '219' });
    expect(pageLocator(219, { label: '  ' })).toEqual({ inline: 'p. 219', note: '219' });
  });
});

describe('generateCitations with a printed page — Fludd scan 219 → printed 217', () => {
  it('inline and footnote cite p. 217 [scan 219]', () => {
    const c = cite({ label: '217', numbering: 'arabic', rate: 1, method: 'read' });
    expect(c.inline).toContain('p. 217 [scan 219]');
    expect(c.inline).not.toContain('p. 219');
    expect(c.footnote).toContain(', 217 [scan 219]');
    expect(c.locator).toBe('p. 217 [scan 219]');
    expect(c.printed_page).toBe('217');
  });
  it('the link and shortlink still point at the scan the reader opens', () => {
    const c = cite({ label: '217' });
    expect(c.short_url).toBe(cite().short_url);
    expect(c.url).toBe(cite().url);
  });
  it('without a printed page the citation is unchanged', () => {
    const c = cite();
    expect(c.inline).toMatch(/, p\. 219, trans\. Source Library \d{4}\)$/);
    expect(c.locator).toBe('p. 219');
    expect(c.printed_page).toBeUndefined();
  });
});

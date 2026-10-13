import { describe, it, expect } from 'vitest';
import { parseNavQuery, rankNavMatches, NAV_MIN_COVERAGE, type NavCandidate } from '@/lib/search/site-nav';

// #5945: a query that NAMES a page leads to the page. The candidates below are
// real rows of site_pages (names as embed-site-pages.mjs writes them).
const page = (url: string, names: string[], page_type: NavCandidate['page_type'] = 'page', weight = 0): NavCandidate =>
  ({ url, page_type, title: names[0], names, weight });

const PAGES: NavCandidate[] = [
  page('/explore/timeline', ['Timeline — Explore', 'timeline']),
  page('/review', ['Help curate', 'review', 'check pages', 'proofread']),
  page('/review/page-check', ['Page check', 'review page check']),
  page('/research/quality', ['How Page Quality Is Measured (draft)', 'quality', 'research quality']),
  page('/research/quality/summary', ['Page Quality — Summary', 'summary', 'research quality summary']),
  page('/blog/how-we-measure-ocr-quality', ['How We Measure OCR Quality', 'how we measure ocr quality'], 'blog'),
  page('/research', ['Research', 'research questions']),
  page('/about/research', ['How Our Translations Work', 'research', 'about research']),
  page('/libraries', ['Libraries']),
  page('/for-libraries', ['For Libraries & Cultural Institutions', 'for libraries']),
  page('/collections/drebbel', ['Cornelis Drebbel', 'drebbel'], 'collection', 57),
  page('/author/cornelius-drebbel', ['Cornelius Drebbel', 'Drebbel, Cornelis'], 'author', 7),
  page('/author/christiaan-huygens', ['Christiaan Huygens', 'Huygens, Christiaan'], 'author', 32),
  page('/author/huygens-constantijn', ['Huygens, Constantijn'], 'author', 1),
  page('/blog/philosophers-stone', ["What Is the Philosopher's Stone? Eight Answers from the Primary Sources", 'philosophers stone'], 'blog'),
];
const urls = (q: string) => rankNavMatches(q, PAGES).map((m) => m.candidate.url);

describe('rankNavMatches', () => {
  it('finds a page by the word in its URL or an alias', () => {
    expect(urls('timeline')).toEqual(['/explore/timeline']);
    expect(urls('check pages')[0]).toBe('/review');
    expect(urls('Libraries')[0]).toBe('/libraries');
  });

  it('puts the page the query names exactly above pages that merely contain the word', () => {
    expect(urls('quality')[0]).toBe('/research/quality');
    // "quality" is one word of five in the essay's title: a word in a name, not the name.
    expect(urls('quality')).not.toContain('/blog/how-we-measure-ocr-quality');
    expect(urls('for libraries')).toEqual(['/for-libraries']);
  });

  it('lets an exact name silence partial matches', () => {
    expect(urls('quality')).toEqual(['/research/quality']);
    // No exact name: the partial matches stand.
    expect(rankNavMatches('gallery quality', [page('/review/gallery-quality', ['Gallery quality']), page('/x', ['Gallery quality tips'])]).map((m) => m.coverage)).toEqual([1]);
    expect(urls('Huygens').length).toBe(2);
  });

  it('orders equal matches by path depth', () => {
    expect(urls('research').slice(0, 2)).toEqual(['/research', '/about/research']);
  });

  it('reads a type word as a filter, not as part of the name', () => {
    expect(urls('Drebbel collection')).toEqual(['/collections/drebbel']);
    expect(urls('drebbel author')).toEqual(['/author/cornelius-drebbel']);
    expect(urls('philosophers stone essay')).toEqual(['/blog/philosophers-stone']);
    // "page" asks for no particular type.
    expect(urls('huygens page')[0]).toBe('/author/christiaan-huygens');
  });

  it('finds an author by surname and orders namesakes by weight', () => {
    expect(urls('Huygens')).toEqual(['/author/christiaan-huygens', '/author/huygens-constantijn']);
  });

  it('shows nothing for a word no name is mostly made of, and nothing for a sentence', () => {
    expect(urls('measure')).toEqual([]);
    expect(urls('what did paracelsus write about the philosophers stone and mercury')).toEqual([]);
    expect(NAV_MIN_COVERAGE).toBe(0.5);
  });

  it('matches non-Latin names instead of folding them to nothing', () => {
    const zh = [page('/author/zhang-jiebin', ['張介賓'], 'author')];
    expect(rankNavMatches('張介賓', zh).map((m) => m.candidate.url)).toEqual(['/author/zhang-jiebin']);
    // A query with no letters or digits cannot be judged: no match, not every match.
    expect(parseNavQuery('—')).toBeNull();
    expect(rankNavMatches('—', zh)).toEqual([]);
  });

  it('keeps a query that is only a type word', () => {
    expect(parseNavQuery('collections')).toEqual({ tokens: ['collection'], bare: [], types: null });
  });
});

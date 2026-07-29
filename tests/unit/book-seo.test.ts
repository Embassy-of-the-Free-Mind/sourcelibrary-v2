import { describe, it, expect } from 'vitest';
import { buildSeoTitle, buildSeoDescription } from '@/lib/book-seo';

describe('buildSeoTitle', () => {
  it('leads with the original title, adds byline and year, no em-dash', () => {
    const t = buildSeoTitle({ originalTitle: 'Utriusque Cosmi Historia', authorLabel: 'Robert Fludd', year: '1617' });
    expect(t).toBe('Utriusque Cosmi Historia | Robert Fludd (1617)');
    expect(t).not.toContain('—');
    expect(t).not.toContain('·');
    expect(t).not.toContain('Source Library');
  });

  it('collapses a long, subtitle-laden title at its natural break', () => {
    const t = buildSeoTitle({
      originalTitle: 'Les champignons de la France : histoire, description, culture, usages des espèces comestibles',
      authorLabel: 'F. S. Cordier', year: '1870',
    });
    expect(t.startsWith('Les champignons de la France')).toBe(true);
    expect(t).not.toContain('histoire');
    expect(t.length).toBeLessThanOrEqual(62);
  });

  it('strips author life-dates from the byline', () => {
    const t = buildSeoTitle({ originalTitle: 'Kinpu', authorLabel: 'Anna Maria Hussey (1805-1853)', year: '1847' });
    expect(t).toBe('Kinpu | Anna Maria Hussey (1847)');
    expect(t).not.toContain('1805');
  });

  it('drops the year (then the author) before it will mid-word truncate', () => {
    const t = buildSeoTitle({ originalTitle: 'Amphitheatrum Sapientiae Aeternae', authorLabel: 'Heinrich Khunrath', year: '1609' });
    expect(t.length).toBeLessThanOrEqual(62);
    expect(t.startsWith('Amphitheatrum Sapientiae Aeternae')).toBe(true);
  });
});

describe('buildSeoDescription', () => {
  const summary = 'A cosmological treatise mapping the macrocosm and microcosm.';

  it('marks a genuine first translation', () => {
    const d = buildSeoDescription({ originalTitle: 'Utriusque Cosmi Historia', language: 'Latin', summary, isFirstTranslation: true, pagesTranslated: 1036 });
    expect(d.startsWith('First English translation.')).toBe(true);
    expect(d).toContain('macrocosm');
  });

  it('marks a later (non-first) translation plainly', () => {
    const d = buildSeoDescription({ originalTitle: 'Sefer ha-Zohar', language: 'Hebrew', summary, isFirstTranslation: false, pagesTranslated: 611 });
    expect(d.startsWith('English translation.')).toBe(true);
    expect(d.startsWith('First')).toBe(false);
  });

  it('never claims translation on an English-language original', () => {
    const d = buildSeoDescription({ originalTitle: 'Illustrations of British Mycology', language: 'English', summary, isFirstTranslation: false, pagesTranslated: 0 });
    expect(d.toLowerCase()).not.toContain('translation');
    expect(d).toContain('macrocosm');
  });

  it('falls back to a factual template (no false translation claim) when there is no summary', () => {
    const d = buildSeoDescription({ originalTitle: 'Edible and Poisonous Mushrooms', authorLabel: 'M. C. Cooke', year: '1894', language: 'English', summary: null, pagesTranslated: 0 });
    expect(d).toContain('Edible and Poisonous Mushrooms by M. C. Cooke (1894)');
    expect(d.toLowerCase()).not.toContain('translation');
  });

  it('does not double up when the summary already mentions translation', () => {
    const d = buildSeoDescription({ originalTitle: 'X', language: 'Latin', summary: 'This translation renders the Latin into English.', isFirstTranslation: true, pagesTranslated: 10 });
    expect(d.match(/translat/gi)?.length).toBe(1);
  });
});

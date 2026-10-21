import { describe, it, expect } from 'vitest';
import { localizeAuthorName, localizePublished } from '@/lib/book-labels';

describe('localizePublished (#7055)', () => {
  it('renders period words in Latin', () => {
    expect(localizePublished('Medieval', 'la')).toBe('Medii aevi');
    expect(localizePublished('15th century', 'la')).toBe('saec. XV');
    expect(localizePublished('13th-14th century', 'la')).toBe('saec. XIII–XIV');
  });
  it('leaves years, ranges and unknown strings alone', () => {
    expect(localizePublished('1478', 'la')).toBe('1478');
    expect(localizePublished('circa 1500', 'la')).toBe('circa 1500');
    expect(localizePublished('Medieval', 'en')).toBe('Medieval');
  });
  it('covers the other locales', () => {
    expect(localizePublished('15th century', 'es')).toBe('siglo XV');
    expect(localizePublished('15th century', 'nl')).toBe('15e eeuw');
    expect(localizePublished('15th century', 'zh')).toBe('15世纪');
  });
});

describe('localizeAuthorName (#7055)', () => {
  it('renders placeholders per locale', () => {
    expect(localizeAuthorName('Anonymous', 'la')).toBe('Auctor ignotus');
    expect(localizeAuthorName('Unknown', 'la')).toBe('Auctor ignotus');
    expect(localizeAuthorName('Anonymus', 'la')).toBe('Auctor ignotus');
    expect(localizeAuthorName('Unknown', 'es')).toBe('Autor desconocido');
  });
  it('keeps real names and English', () => {
    expect(localizeAuthorName('Ramon Llull', 'la')).toBe('Ramon Llull');
    expect(localizeAuthorName('Anonymous', 'en')).toBe('Anonymous');
  });
});

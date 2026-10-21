import { describe, it, expect } from 'vitest';
import { localizeAuthorName, localizeDateDisplay, localizePublished } from '@/lib/book-labels';

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

describe('localizeDateDisplay (#7072)', () => {
  it('renders the dating run phrases', () => {
    expect(localizeDateDisplay("1532–1593, the author's adult life", 'zh')).toBe('1532–1593，作者成年时期');
    expect(localizeDateDisplay("1532–1593, the author's adult life", 'la')).toBe('1532–1593, aetate auctoris adulta');
    expect(localizeDateDisplay('1200–1250, before the author’s death', 'nl')).toBe('1200–1250, vóór de dood van de auteur');
  });
  it('renders circa, eras and centuries', () => {
    expect(localizeDateDisplay('c. 1400–1450', 'nl')).toBe('ca. 1400–1450');
    expect(localizeDateDisplay('c. 500–400 BCE', 'es')).toBe('c. 500–400 a. C.');
    expect(localizeDateDisplay('c. 200 BCE–100', 'zh')).toBe('约公元前200–100');
    expect(localizeDateDisplay('15th century', 'la')).toBe('saec. XV');
    expect(localizeDateDisplay('uncertain', 'es')).toBe('incierta');
  });
  it('leaves English and unknown phrases alone', () => {
    expect(localizeDateDisplay("1532–1593, the author's adult life", 'en')).toBe("1532–1593, the author's adult life");
    expect(localizeDateDisplay('1500, after the Council of Trent', 'la')).toBe('1500, after the Council of Trent');
    expect(localizeDateDisplay('early 15th c.', 'nl')).toBe('early 15th c.');
    expect(localizeDateDisplay('1478', 'zh')).toBe('1478');
  });
});

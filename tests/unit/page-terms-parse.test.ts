/**
 * #4695 — per-page vocabulary parser. One positive control per script, because a
 * text helper tested only on Latin passes while silently emptying Greek, Chinese,
 * Arabic and Tibetan (non-latin-text-operations.md).
 */
import { describe, it, expect } from 'vitest';
import {
  parseOcrVocab,
  parseTranslationTerms,
  splitList,
  splitTermGloss,
  termKey,
  isLatinScript,
} from '../../scripts/lib/page-terms-parse.mjs';

describe('termKey', () => {
  it('folds Latin script only', () => {
    expect(termKey('Samādhi')).toBe('samadhi');
    expect(termKey('Prima Materia')).toBe('prima materia');
    expect(termKey('ἡσυχία')).toBe('ἡσυχία'); // Greek: NFC only, no lowercase, no fold
    expect(termKey('三昧')).toBe('三昧');
    expect(termKey('مراقبة')).toBe('مراقبة');
    expect(termKey('gtum mo')).toBe('gtum mo');
  });
  it('treats mixed-script strings as non-Latin', () => {
    expect(isLatinScript('三昧 Samadhi')).toBe(false);
    expect(termKey('三昧 Samadhi')).toBe('三昧 Samadhi');
  });
});

describe('splitList / splitTermGloss', () => {
  it('splits on ASCII, CJK and enumeration commas but not inside parentheses', () => {
    expect(splitList('三昧 (Samadhi), 法華經 (Lotus Sutra)、旃檀 (Sandalwood); λόγος')).toEqual([
      '三昧 (Samadhi)', '法華經 (Lotus Sutra)', '旃檀 (Sandalwood)', 'λόγος',
    ]);
    expect(splitList('Otrar (a city, now in Kazakhstan), dhikr')).toEqual(['Otrar (a city, now in Kazakhstan)', 'dhikr']);
  });
  it('separates a parenthetical gloss', () => {
    expect(splitTermGloss('三昧 (Samadhi)')).toEqual({ term: '三昧', gloss: 'Samadhi' });
    expect(splitTermGloss('λόγος')).toEqual({ term: 'λόγος', gloss: null });
    expect(splitTermGloss('(orphan)')).toEqual({ term: '(orphan)', gloss: null });
  });
});

describe('parseOcrVocab', () => {
  it('Chinese with glosses', () => {
    const rows = parseOcrVocab('text <vocab>三昧 (Samadhi), 法華經 (Lotus Sutra), 曼陀羅華 (Mandara flower)</vocab> more');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'vocab', term: '三昧', gloss: 'Samadhi', term_key: '三昧' });
  });
  it('Greek without glosses', () => {
    const rows = parseOcrVocab('<vocab>λόγος, σιωπή, πνεῦμα, μυστήριον</vocab>');
    expect(rows.map((r) => r.term)).toEqual(['λόγος', 'σιωπή', 'πνεῦμα', 'μυστήριον']);
    expect(rows.every((r) => r.gloss === null)).toBe(true);
  });
  it('Jawi/Arabic transliterations and names', () => {
    const rows = parseOcrVocab('<vocab>Allah, La ilaha illa Allah, muraqabah, musyahadah, Syekh Syamsuddin al-Sumatrani</vocab>');
    expect(rows.map((r) => r.term_key)).toContain('muraqabah');
    expect(rows).toHaveLength(5);
  });
  it('Tibetan Wylie and script', () => {
    const rows = parseOcrVocab('<vocab>gtum mo (inner heat), བླ་མ (lama)</vocab>');
    expect(rows).toEqual([
      expect.objectContaining({ term: 'gtum mo', gloss: 'inner heat', term_key: 'gtum mo' }),
      expect.objectContaining({ term: 'བླ་མ', gloss: 'lama', term_key: 'བླ་མ' }),
    ]);
  });
  it('returns [] with no vocab tag and dedupes within a page', () => {
    expect(parseOcrVocab('no tags here')).toEqual([]);
    expect(parseOcrVocab('<vocab>Samādhi, samadhi (absorption)</vocab>')).toEqual([
      expect.objectContaining({ term: 'Samādhi', gloss: 'absorption' }),
    ]);
  });
});

describe('parseTranslationTerms', () => {
  it('term + gloss pairs, term alone, keywords', () => {
    const t = 'The <term>prima materia</term> <gloss>first matter</gloss> and <term>calcination</term>. ' +
      '<keywords>Gregory of Nazianzus, silence, hesychia</keywords>';
    const rows = parseTranslationTerms(t);
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'term', term: 'prima materia', gloss: 'first matter' }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'term', term: 'calcination', gloss: null }));
    expect(rows.filter((r) => r.kind === 'keyword').map((r) => r.term)).toEqual(['Gregory of Nazianzus', 'silence', 'hesychia']);
  });
  it('original-notes are verified against the OCR page, Greek positive and negative control', () => {
    const t = 'deliver everyone to stillness <note>original: "ἡσυχίαν" (hesychian). A technical term.</note> and ' +
      'peace <note>original: "εἰρήνην"</note>';
    const ocr = 'καὶ πάντας εἰς ἡσυχίαν παραδοῦναι';
    const rows = parseTranslationTerms(t, ocr).filter((r) => r.kind === 'original');
    expect(rows).toEqual([
      expect.objectContaining({ term: 'ἡσυχίαν', gloss: 'hesychian', verified: true }),
      expect.objectContaining({ term: 'εἰρήνην', gloss: null, verified: false }),
    ]);
  });
  it('original-notes get verified: null when no OCR text is supplied', () => {
    const rows = parseTranslationTerms('x <note>original: "wujud"</note>');
    expect(rows[0]).toMatchObject({ kind: 'original', term: 'wujud', verified: null });
  });
  it('ignores over-long captures and strips nested tags', () => {
    const long = 'a'.repeat(200);
    expect(parseTranslationTerms(`<term>${long}</term>`)).toEqual([]);
    expect(parseTranslationTerms('<term>Sefer <unclear>Yetzirah</unclear></term>')[0].term).toBe('Sefer Yetzirah');
  });
});

import { describe, it, expect } from 'vitest';
import { stripEsukhiaApparatus, displayTranscription, isEsukhiaEdition } from '@/lib/esukhia-apparatus';

const ESUKHIA = { name: 'Esukhia digital Derge Tengyur' };

// Strings copied from stored Derge Tengyur pages (#5497).
describe('stripEsukhiaApparatus', () => {
  it('drops the Tohoku opener and Peydurma note points (vol. 82 p.1)', () => {
    expect(stripEsukhiaApparatus('{D3790}༄༅༅། །རྒྱ་གར་སྐད་དུ། པཉྩ་བིང་ཤ་ཏི་ས་ཧ་སྲི་ཀ་པྲཛྙཱ་པཱ་ར་མི་ཏ#། བོད་སྐད་དུ།'))
      .toBe('༄༅༅། །རྒྱ་གར་སྐད་དུ། པཉྩ་བིང་ཤ་ཏི་ས་ཧ་སྲི་ཀ་པྲཛྙཱ་པཱ་ར་མི་ཏ། བོད་སྐད་དུ།');
  });

  it('drops a lettered Tohoku opener', () => {
    expect(stripEsukhiaApparatus('རྫོགས་སོ།། {D1320a}༄༅༅། །བཅོམ་ལྡན་འདས་མ་')).toBe('རྫོགས་སོ།། ༄༅༅། །བཅོམ་ལྡན་འདས་མ་');
  });

  it('keeps the block reading of a (reading,correction) pair (vol. 82 p.47)', () => {
    expect(stripEsukhiaApparatus('སེམས་དཔའ་ཆེན་པོ་དེ་དག་ནི་(བསྟན་,བསྟེན་)པར་དཀའ་བ་')).toBe('སེམས་དཔའ་ཆེན་པོ་དེ་དག་ནི་བསྟན་པར་དཀའ་བ་');
  });

  it('accepts the U+201A separator some volumes use', () => {
    expect(stripEsukhiaApparatus('།ཁ་(སྤུབས་‚སྦུབས་)རྡོལ་')).toBe('།ཁ་སྤུབས་རྡོལ་');
  });

  it('keeps the first of a {a,b} variant pair', () => {
    expect(stripEsukhiaApparatus('{བླ་དགས་,བླ་དྭགས་}')).toBe('བླ་དགས་');
  });

  it('drops a line-initial escaped \\#', () => {
    expect(stripEsukhiaApparatus('འཆད་པར་\n\\#དང་། འཆད་པར་')).toBe('འཆད་པར་\nདང་། འཆད་པར་');
  });

  it('drops a stray folio line marker but keeps a doubtful [x] reading', () => {
    expect(stripEsukhiaApparatus('མིང་#[193b.5]བརྗོད་དེ།')).toBe('མིང་བརྗོད་དེ།');
    expect(stripEsukhiaApparatus('མཐོང་[(ཆགས་,ཆག་)འགྱུར་')).toBe('མཐོང་[ཆགས་འགྱུར་');
    expect(stripEsukhiaApparatus('[བཀྲ]')).toBe('[བཀྲ]');
  });
});

describe('displayTranscription', () => {
  it('cleans Esukhia pages only', () => {
    expect(displayTranscription({ data: 'བྱའོ་#ཞེས་', text_edition: ESUKHIA })).toBe('བྱའོ་ཞེས་');
  });

  it('leaves a non-Esukhia page with parentheses, braces and # untouched', () => {
    const latin = '# Caput I\nAqua (id est, mercurius) {sic, vel non} vide [2a.1] et #3.';
    expect(displayTranscription({ data: latin })).toBe(latin);
    expect(displayTranscription({ data: latin, text_edition: { name: 'CBETA' } })).toBe(latin);
  });

  it('handles missing text', () => {
    expect(displayTranscription(undefined)).toBe('');
    expect(displayTranscription({ text_edition: ESUKHIA })).toBe('');
    expect(isEsukhiaEdition({ text_edition: { name: 42 } })).toBe(false);
  });
});

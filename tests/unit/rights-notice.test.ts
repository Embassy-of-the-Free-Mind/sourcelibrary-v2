import { describe, it, expect } from 'vitest';
import { findRightsNotices, foldDigits, screenStrength } from '../../scripts/lib/rights-notice.mjs';

/**
 * The rights-notice screen (#4809) reads the book's OWN imprint, because the date fields
 * and the importer's licence default both missed the modern editions. Lines below are
 * shapes taken from the 2026-10 runs over real OCR: what must be caught (the imprints of
 * books hidden as in-copyright) and what must not (Google/EEB boilerplate, OCR noise).
 */
const kinds = (t: string) => findRightsNotices(t, { now: new Date('2026-10-13') }).map((h) => h.kind);

describe('findRightsNotices — catches modern imprints', () => {
  it.each([
    ['© 2004 Motilal Banarsidass', 'copyright-year'],
    ['© Chaukhamba Orientalia', 'copyright-sign'],
    ['->**Copy rights reserved by publishsers**<-', 'rights-reserved'],
    ['ISBN 81-7084-123-4', 'isbn'],
    ['सर्वाधिकार सुरक्षित', 'hi-sarvadhikar'],
    ['->प्रकाशकेन स्वायत्तीकृता: ]<-', 'hi-sarvadhikar'],
    ['->सम्वत् २०६९ मूल्य - 40/-<-', 'vikram-samvat'],
    ['جميع الحقوق محفوظة', 'ar-huquq'],
    ['| سنة الطباعة | 2015 A.D - 1437H. | Year |', 'imprint-year'],
    ['版權所有 翻印必究', 'zh-banquan'],
    ['This is a copyrighted Project Gutenberg eBook', 'copyright-word'],
    ['COPYRIGHT 1963 BY E. J. BRILL', 'copyright-year'],
  ])('%s → %s', (line, kind) => {
    expect(kinds(line)).toEqual([kind]);
  });
});

describe('findRightsNotices — does not fire on', () => {
  it.each([
    ['a historical notice on an old imprint', 'COPYRIGHT 1926 BY THE UNIVERSITY OF CHICAGO'],
    ['an old samvat colophon (1850 VS = 1793 CE)', 'सम्वत् १८५० लिखितम्'],
    ["Google's front matter", 'public domain book whose copyright term has expired'],
    ["EEB's scan notice", 'Early European Books, Copyright © 2011 ProQuest LLC.'],
    ['the digitizer watermark', 'Digitized by eGangotri — all rights reserved'],
    ['an image description of a stamp', '{"description": "A circular stamp reading संवत् २०३०", "type": "stamp"}'],
    ['a stray © from OCR noise', 'predetermined limits. ©'],
    ['© mid-sentence', 'grace only here and there. ©The buttercup'],
    ["the OCR's own vocab tag", '<vocab>copyright, 2004</vocab>'],
    ['Gutenberg licence prose', 'the copyright holder, your use and distribution'],
  ])('%s', (_label, line) => {
    expect(kinds(line)).toEqual([]);
  });
});

describe('foldDigits', () => {
  it('folds Devanagari, Arabic-Indic and Persian digits', () => {
    expect(foldDigits('१९६६ ٢٠١٥ ۱۳۹۹')).toBe('1966 2015 1399');
  });
});

describe('screenStrength', () => {
  it('an undated Victorian notice is weak; a dated or ISBN one is strong', () => {
    const f = (t: string) => screenStrength(findRightsNotices(t));
    expect(f('[*All rights reserved*]')).toBe('weak');
    expect(f('ISBN 3-519-01443-2')).toBe('strong');
    expect(f('All rights reserved. 1987')).toBe('strong');
  });
  it('scan watermarks are not notices', () => {
    expect(findRightsNotices('->© SUB GÖTTINGEN / GDZ | 2012/2013<-')).toEqual([]);
    expect(findRightsNotices('->© Biblioteca Apostolica Vaticana ALL RIGHTS RESERVED<-')).toEqual([]);
  });
});

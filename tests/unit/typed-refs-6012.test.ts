// #6012: the versioned TEI → pages parse and the byte decoder that every typed-reference row is derived
// from. A change in what these return must come with a PARSE_VERSION bump, so the behaviour is pinned.
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs module
import { teiPages, decodeBytes, foldLatin, PARSE_VERSION } from '../../scripts/eval/typed-refs-6012/lib.mjs';

describe('typed-refs-6012 parse (tei-pages-v1)', () => {
  it('is the version the stored rows carry', () => {
    expect(PARSE_VERSION).toBe('tei-pages-v1');
  });

  it('cuts pages at <pb>, drops forme work and corrections, keeps notes apart, counts gaps', () => {
    const xml = `<TEI><teiHeader><title>Not text</title></teiHeader><text><body>
      <pb facs="#f0001" n="1"/><fw type="header">Running head</fw><p>Erſte Seite <choice><sic>mohi</sic><corr>mihi</corr></choice><note place="foot">Eine Note.</note> Ende.</p><fw type="catch">Zwey</fw>
      <pb facs="#f0002" n="2"/><p>Zweyte <gap reason="illegible"/> Seite &amp; mehr.</p></body></text></TEI>`;
    const pages = teiPages(xml);
    expect(pages.map((p: { n: string }) => p.n)).toEqual(['1', '2']);
    expect(pages[0].text).toBe('Erſte Seite mohi Ende.');
    expect(pages[0].notes).toEqual(['Eine Note.']);
    expect(pages[1].text).toBe('Zweyte ◊ Seite & mehr.');
    expect(pages[1].gaps).toBe(1);
  });

  it('reads TCP P4 upper-case tags and keeps text before the first page break as page 0', () => {
    const pages = teiPages('<ETS><EEBO><HEADER><TITLE>x</TITLE></HEADER><TEXT><P>Front.</P><PB N="1" REF="2"/><P>Bo∣dy</P></TEXT></EEBO></ETS>');
    expect(pages.length).toBe(2);
    expect(pages[0].n).toBeNull();
    expect(pages[1].ref).toBe('2');
  });

  it('decodes a file that mixes Latin-1 bytes into UTF-8 without U+FFFD (CAMENA, #5126 deviation 1)', () => {
    const mixed = Buffer.concat([Buffer.from('Cur', 'latin1'), Buffer.from([0xe2]), Buffer.from(' — ä', 'utf8')]);   // a bare Latin-1 â, then real UTF-8
    const out = decodeBytes(mixed);
    expect(out).toBe('Curâ — ä');
    expect(out).not.toContain('�');
  });

  it('folds the early-print conventions that differ between a keyed text and an OCR read', () => {
    expect(foldLatin('Erſte kuͤhne Vniuerſität')).toBe(foldLatin('Erste kühne Universität'));
    expect(foldLatin('Æther & cœlum')).toBe('aetheretcoelum');
  });
});

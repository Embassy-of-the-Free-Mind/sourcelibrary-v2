import { describe, it, expect } from 'vitest';
import {
  extractTei, foldHan, fitAlign, decideVotes, edgeColumn, buildIndex, fitBook, verifyPage, spanText,
} from '../../scripts/lib/cbeta-fit.mjs';

const GAIJI = { CB06251: { 'unicode-char': '㫬', normal: '昫' }, CB99999: { zzs: '[日*旬]' } };
const XML = `<TEI><teiHeader><title level="m" xml:lang="zh-Hant">測試錄</title></teiHeader><text><body>
<milestone n="1" unit="juan"/>
<lb n="0001a01" ed="T"/><cb:docNumber>No. 1</cb:docNumber><cb:div type="xu"><cb:mulu level="1" type="序">測試錄序</cb:mulu><head>測試錄序</head>
<lb n="0001a02" ed="T"/><p>屈<g ref="#CB06251">x</g>相傳。問廁編聯
<lb n="0001a03" ed="T"/><note place="inline">楦釀二字出唐</note>亦用簡別<note n="1" resp="Taisho" type="orig" place="foot text">校勘記</note>。<app><lem>采</lem><rdg wit="#wit1">採</rdg></app>擷。<g ref="#CB99999"/></p></cb:div>
</body></text></TEI>`;

describe('cbeta-fit extractTei', () => {
  const ex = extractTei(XML, GAIJI);
  it('keeps the printed text and the inline note; drops the TOC, the work number, editorial notes and variant readings', () => {
    expect(ex.text.replace(/\n{2,}/g, '\n').trim()).toBe('測試錄序\n屈㫬相傳。問廁編聯（楦釀二字出唐）亦用簡別。采擷。〔[日*旬]〕');
    expect(ex.title).toBe('測試錄');
    expect(ex.unresolvedGaiji).toBe(1);
  });
  it('records the Taishō line in force at each offset, and the juan', () => {
    expect(ex.lbs.map((l) => l.lb)).toEqual(['0001a01', '0001a02', '0001a03']);
    expect(ex.juans).toEqual([{ at: 0, n: 1 }]);
  });
});

describe('cbeta-fit extractTei — X-canon heads and juan closes', () => {
  const X = `<TEI><text><body><lb ed="X" n="0274b23"/><p>到利袖僧。</p><cb:juan fun="close" n="005"><cb:jhead>卷第五（終）</cb:jhead></cb:juan>
<lb ed="X" n="0274c02"/><cb:div type="xu"><cb:mulu type="序" level="1">No. 1382-B 大丞相游公祭文</cb:mulu><head>No. 1382-B
<lb ed="X" n="0274c03"/><lb ed="R121" n="0961a01"/> 大丞相游公祭文</head></cb:div></body></text></TEI>`;
  const ex = extractTei(X, {});
  it('drops CBETA document numbers from heads and keeps the head', () => {
    expect(ex.text).not.toMatch(/No\./);
    expect(ex.text).toContain('大丞相游公祭文');
  });
  it('records the juan-closing line as a range, at the offsets the text really has', () => {
    expect(ex.juanCloses).toHaveLength(1);
    const g = ex.juanCloses[0];
    expect(ex.text.slice(g.from, g.to).trim()).toBe('卷第五（終）');
  });
  it('keeps only the base edition line numbers (ed="R121" is a cross-reference)', () => {
    expect(ex.lbs.map((l) => l.lb)).toEqual(['0274b23', '0274c02', '0274c03']);
  });
});

describe('cbeta-fit foldHan', () => {
  it('folds kyūjitai/shinjitai and Chinese print variants to one form', () => {
    expect(foldHan('傳燈錄').f).toEqual(foldHan('伝灯録').f);
    expect(foldHan('說法眾').f).toEqual(foldHan('説法衆').f);
  });
  it('drops kana (kunten) and punctuation, and maps back into the text', () => {
    const { f, map } = foldHan('受ケ二然燈一ヲ。');
    expect(f.length).toBe(5);   // 受 二 然 燈 一 — kaeriten digits are Han and stay
    expect(map[0]).toBe(0);
  });
  it('returns NOTHING for a non-Han string — unjudgeable, never a mismatch (non-latin-text-operations.md)', () => {
    expect(foldHan('abc ありがとう').f).toEqual([]);
  });
});

describe('cbeta-fit fitAlign', () => {
  const F = [...'僧曰恁麼即我王有感萬國歸朝師曰時人盡唱太平歌'];
  it('places a column whose first character is misread (慶 for 麼) at the true start', () => {
    const r = fitAlign([...'慶即我王有感萬國歸朝'], F, 0, F.length);
    expect(r.fStart).toBe(3);
  });
  it('places a column whose last character is misread (堪 for 恁) at the true end', () => {
    const r = fitAlign([...'僧曰堪'], F, 0, 10);
    expect(r.fEnd).toBe(3);
  });
});

describe('cbeta-fit decideVotes', () => {
  it('needs two agreeing votes and no tie', () => {
    expect(decideVotes([5, 5, null, null])).toBe(5);
    expect(decideVotes([5, 6, null, null])).toBeNull();
    expect(decideVotes([5, 5, 6, 6])).toBeNull();
    expect(decideVotes([5, 6, 6, null])).toBe(6);
    expect(decideVotes([null, null])).toBeNull();
  });
});

describe('cbeta-fit edgeColumn', () => {
  const H = 3000;
  const col = (text: string, x0: number, y0 = 800, y1 = 800 + H) => ({ f: foldHan(text).f, h: y1 - y0, x0, x1: x0 + 180, y0, y1 });
  const lines = [
    col('一二三四五六七八九十甲乙丙丁戊己庚辛壬癸', 6000),
    col('天地玄黃宇宙洪荒日月盈昃辰宿列張寒來暑往', 5800),
    col('秋收冬藏閏餘成歲律呂調陽雲騰致雨露結為霜', 1200, 800, 800 + H * 0.4),     // main characters before a note
    { f: foldHan('金生麗水').f, h: 300, x0: 1290, x1: 1380, y0: 2100, y1: 2400 },     // note, right sub-column
    { f: foldHan('玉出崑岡').f, h: 300, x0: 1200, x1: 1290, y0: 2100, y1: 2400 },     // note, left sub-column
    col('劍號巨闕', 1200, 2500, 2900),                                                // main characters after the note
    { f: foldHan('伝第十二').f, h: 500, x0: 900, x1: 1000, y0: 1600, y1: 2100 },     // margin label
  ];
  it('skips a margin label and takes the whole last column — main text, both note sub-columns, the tail', () => {
    const c = edgeColumn(lines, 'last')!;
    expect(c.f.join('')).toBe(foldHan('秋收冬藏閏餘成歲律呂調陽雲騰致雨露結為霜金生麗水玉出崑岡劍號巨闕').f.join(''));
  });
  it('takes the first column on the first side', () => {
    expect(edgeColumn(lines, 'first')!.idx).toEqual([0]);
  });
});

describe('cbeta-fit fitBook + verifyPage (synthetic book)', () => {
  // A typed text with no repeated characters (a repeat would let a page anchor in two places),
  // cut into 6 "pages" of 3 columns of 20.
  const text = Array.from({ length: 360 }, (_, i) => String.fromCodePoint(0x4e00 + ((i * 37) % 2000) + 200)).join('');
  const { f: F } = foldHan(text);
  const idx = buildIndex(F);
  const pages = Array.from({ length: 6 }, (_, p) => {
    const cols = [0, 1, 2].map((c) => F.slice(p * 60 + c * 20, p * 60 + c * 20 + 20));
    // misread one character at each page edge, as NDL does
    cols[0] = ['慶', ...cols[0].slice(1)];
    cols[2] = [...cols[2].slice(0, 19), '堪'];
    const lines = cols.map((f, c) => ({ f, h: 3000, x0: 6000 - c * 200, x1: 6180 - c * 200, y0: 800, y1: 3800 }));
    return { read: cols.flat(), lines };
  });
  const fit = fitBook(pages, F, idx, [0, F.length]);
  it('cuts every page on its true leaf boundary although both edge characters are misread', () => {
    expect(fit.pages.map((p) => p.span)).toEqual([[0, 60], [60, 120], [120, 180], [180, 240], [240, 300], [300, 360]]);
  });
  it('refuses a boundary seen from one side only (two reads of the same column outvoting the other page)', () => {
    // Page 2's real last column (an indented verse) is missing from its lines, so its "last column"
    // ends 20 characters early, read identically by both engines; page 3's first column disagrees.
    const p2 = pages[2];
    const cut = { read: p2.read, lines: p2.lines.slice(0, 2) };
    const ev = new Map([['2:last', p2.lines[1].f]]);
    const f2 = fitBook([...pages.slice(0, 2), cut, ...pages.slice(3)], F, idx, [0, F.length], ev);
    expect(f2.pages[2].span).toBeNull();
    expect(f2.pages[3].span).toBeNull();
  });

  it('verifies each page against wrong-page controls', () => {
    const spans = fit.pages.map((p) => p.span);
    const v = verifyPage(2, pages.map((p) => p.read), spans, F);
    expect(v.identity).toBeGreaterThan(0.9);
    expect(v.control!).toBeLessThan(0.5);
    expect(v.pass).toBe(true);
  });
  it('spanText returns the typed text of the span', () => {
    expect(spanText(text, foldHan(text).map, 60, 120, F)).toBe(text.slice(60, 120));
  });
});

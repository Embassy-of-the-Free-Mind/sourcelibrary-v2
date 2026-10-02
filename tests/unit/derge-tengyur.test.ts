import { describe, it, expect } from 'vitest';
import { parseVolume, pageText, claimByLabel, syllables, nwIdentity, sampleClass, volumeVerdict } from '../../scripts/lib/derge-tengyur.mjs';

const RAW = [
  '﻿[1a]',
  '[1b]',
  '[1b.1]{D1109}༄༅༅། །རྒྱ་གར་སྐད་དུ། བི་ཤིཥྚ་སྟ་བཿ། བོད་སྐད་དུ།',
  '[1b.2]#ཁྱད་པར་དུ་འཕགས་པའི་བསྟོད་པ།',
  '[2a]',
  '[2a.1]སྐྱོན་མི་མངའ་ལ་ཡོན་ཏན་ལྡན། །གང་ཕྱིར་འཇིག་རྟེན་སྐྱོན་ལ་དགའ།',
].join('\n');

describe('derge-tengyur parseVolume / pageText', () => {
  it('splits sides on folio markers and records Tohoku boundaries', () => {
    const p = parseVolume(RAW);
    expect(p.map((x: { label: string }) => x.label)).toEqual(['1a', '1b', '2a']);
    expect(p[0].lines).toEqual([]);
    expect(p[1].tohoku).toEqual(['D1109']);
  });
  it('keeps the apparatus verbatim but escapes a line-initial # for Markdown', () => {
    const t = pageText(parseVolume(RAW)[1]);
    expect(t.startsWith('{D1109}༄༅༅།')).toBe(true);
    expect(t.split('\n')[1].startsWith('\\#ཁྱད')).toBe(true);
  });
});

describe('derge-tengyur claimByLabel', () => {
  it('walks forward and leaves a label with no side unclaimed (missing image / extra leaf)', () => {
    const p = parseVolume(RAW);
    expect(claimByLabel(['1b', '2a', '2b'], p)).toEqual([1, 2, null]);
    expect(claimByLabel([null, '2a'], p)).toEqual([null, 2]);
  });
});

describe('derge-tengyur scoring', () => {
  it('identity is the share of the read the reference accounts for', () => {
    const a = syllables('སྐྱོན་མི་མངའ་ལ་ཡོན་ཏན་ལྡན།');
    expect(nwIdentity(a, a)).toBe(1);
    expect(nwIdentity(a, syllables('རྒྱ་གར་སྐད་དུ།'))).toBeLessThan(0.3);
  });
  const sc = (o: object) => ({ read_syllables: 400, identity: 0.9, measured_shift: 0, best_identity: 0.9, control: 0.15, global_best: null, ...o });
  it('a read that matches nothing anywhere is uninformative, not misaligned', () => {
    expect(sampleClass(sc({ identity: 0.1, best_identity: 0.1, global_best: { shift: -84, identity: 0.145 } }))).toBe('uninformative');
  });
  it('a read that matches a far side is misaligned', () => {
    expect(sampleClass(sc({ identity: 0.1, best_identity: 0.1, global_best: { shift: 12, identity: 0.9 } }))).toBe('misaligned');
    expect(sampleClass(sc({ measured_shift: 1, best_identity: 0.9, identity: 0.2 }))).toBe('misaligned');
  });
  it('a noisy read at shift 0 that clears the control is aligned (v4 f. 208b)', () => {
    expect(sampleClass(sc({ identity: 0.594, best_identity: 0.594, control: 0.149 }))).toBe('aligned');
  });
  it('a near-verbatim read in repetitive text is aligned if it still beats every wrong side by 0.1 (v84 f. 18b)', () => {
    expect(sampleClass(sc({ identity: 0.998, best_identity: 0.998, control: 0.812 }))).toBe('aligned');
    expect(sampleClass(sc({ identity: 0.85, best_identity: 0.85, control: 0.7 }))).toBe('weak');
    expect(sampleClass(sc({ identity: 0.95, best_identity: 0.95, control: 0.9 }))).toBe('weak');
  });
  it('one misaligned informative sample refuses the volume; too few informative reads refuses it', () => {
    const ok = { canvas: 1, label: '2a', score: sc({}) };
    const bad = { canvas: 2, label: '3a', score: sc({ measured_shift: 2, best_identity: 0.9, identity: 0.2 }) };
    expect(volumeVerdict([ok, ok, ok, ok]).pass).toBe(true);
    expect(volumeVerdict([ok, ok, ok, ok, bad]).pass).toBe(false);
    expect(volumeVerdict([ok, ok, ok]).pass).toBe(false);
  });
  it('a weak read is inconclusive: it neither refuses nor counts (v139 f. 115b)', () => {
    const ok = { canvas: 1, label: '2a', score: sc({}) };
    const weak = { canvas: 3, label: '115b', score: sc({ identity: 0.785, best_identity: 0.785, control: 0.732 }) };
    expect(volumeVerdict([ok, ok, ok, ok, weak]).pass).toBe(true);
    expect(volumeVerdict([ok, ok, ok, weak]).pass).toBe(false);
  });
});

describe('derge-tengyur index mode (no folio labels in the manifest)', () => {
  const loc = (canvas: number, index: number, identity = 0.95, control = 0.2) => ({ canvas, loc: { read_syllables: 400, index, side: null, identity, control } });
  it('agrees on one offset when every confident read gives it', async () => {
    const { agreedOffset } = await import('../../scripts/lib/derge-tengyur.mjs');
    expect(agreedOffset([loc(10, 11), loc(100, 101), loc(200, 201), loc(300, 301)]).offset).toBe(1);
  });
  it('refuses when reads disagree (an image missing part-way) or too few are confident', async () => {
    const { agreedOffset } = await import('../../scripts/lib/derge-tengyur.mjs');
    expect(agreedOffset([loc(10, 11), loc(100, 101), loc(200, 200), loc(300, 300)]).offset).toBeNull();
    expect(agreedOffset([loc(10, 11), loc(100, 101, 0.3), loc(200, 201, 0.3)]).offset).toBeNull();
  });
});

describe('derge-kangyur (#5665)', () => {
  const KRAW = [
    '[1a]',
    '[1a.1]',
    '[1b]',
    '[1b.1]{D1}{D1-1}༄༅༅། །རྒྱ་གར་སྐད་དུ། བི་ན་ཡ་བསྟུ། {མྱི་,མི་}ཤེས་སོ།',
    '[2a]',
    '[2a.1]དཀོན་མཆོག་གསུམ་ལ་ཕྱག་འཚལ་ལོ། །{D1-2}གང་གིས་འཆིང་',
    '[2b]',
    '[2b.1]རྣམས་ཡང་དག་རབ་བཅད་ཅིང་།',
  ].join('\n');
  it('records dashed Tohoku sub-texts', async () => {
    const p = parseVolume(KRAW);
    expect(p[1].tohoku).toEqual(['D1', 'D1-1']);
    expect(p[2].tohoku).toEqual(['D1-2']);
  });
  it('scores the block spelling of {archaic,standard} only when asked (the Tengyur path is unchanged)', () => {
    expect(syllables('{མྱི་,མི་}ཤེས', { blockSpelling: true })).toEqual(['མྱི', 'ཤེས']);
    expect(syllables('{མྱི་,མི་}ཤེས')).toEqual(['{མྱི', ',མི', '}ཤེས']);
  });
  it('carries the running text across sides and volumes, drops a refined parent, skips blank sides', async () => {
    const { textsOnSides } = await import('../../scripts/lib/derge-tengyur.mjs');
    expect(textsOnSides(parseVolume(KRAW))).toEqual([[], ['D1-1'], ['D1-1', 'D1-2'], ['D1-2']]);
    expect(textsOnSides(parseVolume(KRAW), 'D0')[0]).toEqual([]);
  });
  it('a side is published only if every text on it is; unlisted texts count as not begun', async () => {
    const { english84000 } = await import('../../scripts/lib/derge-tengyur.mjs');
    const recs = new Map([['toh1-1', { status: 'Published', pages: 260 }], ['toh1-2', { status: 'In Progress', pages: 3 }]]);
    expect(english84000(['D1-1'], recs).coverage).toBe('published');
    expect(english84000(['D1-1', 'D1-2'], recs).coverage).toBe('in_progress');
    expect(english84000(['D1-2', 'D7a'], recs)).toEqual({ coverage: 'not_begun', texts: { 'D1-2': 'In Progress', D7a: 'not in catalogue' } });
    expect(english84000([], recs).coverage).toBe('no_text');
  });
  it('parses 84000 works arrays out of the Next.js flight data', async () => {
    const { parse84000Works } = await import('../../scripts/lib/derge-tengyur.mjs');
    const flight = JSON.stringify('x:{"works":[{"toh":"toh1-1","title":"a \\"b\\" [c]","num_pages":260,"publication_status":"Published"},{"toh":"toh7a","num_pages":null,"publication_status":"Not Begun"}]}');
    const html = `<script>self.__next_f.push([1,${flight}])</script>`;
    const r = parse84000Works(html);
    expect(r.get('toh1-1')).toEqual({ status: 'Published', pages: 260 });
    expect(r.get('toh7a')).toEqual({ status: 'Not Begun', pages: 0 });
  });
});

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

describe('derge canon: Kangyur additions (#5665)', () => {
  it('parses sub-text Tohoku markers ({D1-1}) and strips them for scoring', async () => {
    const { parseVolume, syllables } = await import('../../scripts/lib/derge-tengyur.mjs');
    const pages = parseVolume('[1a]\n[1a.1]\n[1b]\n[1b.1]{D1}{D1-1}ཀ་ཁ་\n[2a]\n[2a.1]ག་{D1-2}ང་\n');
    expect(pages.map((p) => p.tohoku)).toEqual([[], ['D1', 'D1-1'], ['D1-2']]);
    expect(syllables(pages[1].lines.join(' '))).toEqual(['ཀ', 'ཁ']);
  });
  it('sideTexts carries the running text onto sides with no marker', async () => {
    const { parseVolume, sideTexts } = await import('../../scripts/lib/derge-tengyur.mjs');
    const pages = parseVolume('[1b]\n[1b.1]{D1}{D1-1}ཀ་\n[2a]\n[2a.1]ཁ་\n[2b]\n[2b.1]ག་{D1-2}ང་\n[3a]\n[3a.1]ཅ་\n');
    expect(sideTexts(pages)).toEqual([['D1', 'D1-1'], ['D1-1'], ['D1-1', 'D1-2'], ['D1-2']]);
  });
  it('84000 status: sub-text falls back to its parent; a parent listed only via sub-texts is a container', async () => {
    const { status84000, sideLeftTo84000 } = await import('../../scripts/lib/derge-tengyur.mjs');
    const recs = new Map([['toh1-1', { status: 'Published', pages: 10 }], ['toh2', { status: 'Not Begun', pages: 5 }], ['toh3', { status: 'In Progress', pages: 5 }]]);
    expect(status84000('D1-1', recs)).toBe('Published');
    expect(status84000('D3-4', recs)).toBe('In Progress');
    expect(status84000('D9', recs)).toBeNull();
    expect(sideLeftTo84000(['D1', 'D1-1'], recs)).toBe(true);
    expect(sideLeftTo84000(['D1-1', 'D3'], recs)).toBe(true);
    expect(sideLeftTo84000(['D1-1', 'D2'], recs)).toBe(false);
    expect(sideLeftTo84000(['D9'], recs)).toBe(false);
    expect(sideLeftTo84000([], recs)).toBe(false);
  });
  it('the Kangyur maps e-text vol 100 ↔ scan vol 102 (Esukhia README) and nothing else', async () => {
    const { CANONS } = await import('../../scripts/lib/derge-tengyur.mjs');
    expect([1, 99, 100, 101, 102, 103].map(CANONS.kangyur.scanVolumeFor)).toEqual([1, 99, 102, 101, 100, 103]);
    expect(CANONS.tengyur.imageGroupFor(1)).toBe('I1317');
    expect(CANONS.tengyur.imageGroupFor(203)).toBe('I1521');
  });
});

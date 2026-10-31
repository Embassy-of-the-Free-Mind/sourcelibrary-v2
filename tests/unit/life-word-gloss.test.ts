/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * The life-word rule (#7458): "life force" / "vital energy" inside the translator's own apparatus, and the sources that
 * license it. Spans are copied from stored pages sampled for #7458 (2026-10-26 comment) and the 2026-10-31 draw.
 */
import { describe, it, expect } from 'vitest';
import {
  lifeWordFindings, lifePhraseCount, LIFE_PHRASE, LIFE_PHRASE_PREFILTER,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/life-word-gloss.mjs';
import {
  buildV21, LIFE_WORDS, ANCHOR,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/maintenance/translation-prompt-v21-life-words.mjs';

describe('lifeWordFindings', () => {
  it('flags the bare 氣 gloss, unlicensed', () => {
    const f = lifeWordFindings('The <term>qi</term> <gloss>vital energy</gloss> of the liver rises.', '肝氣上逆');
    expect(f.hits.map((h: any) => h.tag)).toEqual(['gloss']);
    expect(f.unlicensed).toBe(1);
    expect(f.licensed).toBe(false);
  });

  it('finds every spelling in notes and terms', () => {
    const t = '<note>original: *madhyama prāṇa*; the central life-force</note> and <term>jīva|the soul or life force</term> <gloss>vital life force</gloss> <note>Vital energy</note> <gloss>vital force</gloss>';
    expect(lifeWordFindings(t, 'प्राण').hits.length).toBe(5);
  });

  it('ignores the phrase in the running English: that is the source talking, not the apparatus', () => {
    expect(lifeWordFindings('He calls it the life force of nature.', 'die Lebenskraft der Natur').hits).toEqual([]);
  });

  it('a source that names a vital force licenses the phrase', () => {
    for (const ocr of ['die Lebenskraft', 'der Lebens-Kraft', 'Lebenskräfte', 'vis vitalis', 'vim vitalem', 'la force vitale', 'forza vitale'])
      expect(lifeWordFindings('<note>original: "x"; the vital force</note>', ocr).licensed).toBe(true);
  });

  it('breath, spirit and lifespan words do not license it', () => {
    for (const ocr of ['spiritus vitalis', 'anima', 'प्राणः', '氣', 'Geist', 'vita vegetativa'])
      expect(lifeWordFindings('<gloss>life force</gloss>', ocr).unlicensed).toBe(1);
  });

  it('does not flag near words (forceful, life forms, energetic)', () => {
    expect(lifeWordFindings('<note>a forceful life; life forms; energetic vitality</note>', '').hits).toEqual([]);
  });
});

describe('prefilter and counts', () => {
  it('the Mongo prefilter is a superset of the rule', () => {
    for (const s of ['life force', 'life-force', 'lifeforce', 'vital energy', 'vital energies', 'vital force', 'vital life force', 'life energy', 'Life-Force'])
      { expect(new RegExp(LIFE_PHRASE.source, 'i').test(s)).toBe(true); expect(LIFE_PHRASE_PREFILTER.test(s)).toBe(true); }
  });
  it('lifePhraseCount reads body and apparatus but not summary/keywords', () => {
    expect(lifePhraseCount('The life force <note>vital force</note><summary>life force</summary><keywords>vital energy</keywords>')).toBe(2);
  });
});

describe('buildV21', () => {
  const base = 'head\n\n**Instructions:**\n1. If the page continues…\n';
  it('adds the block once, before Instructions, and nothing else', () => {
    const out = buildV21(base);
    expect(out).toBe(base.replace(ANCHOR, LIFE_WORDS + ANCHOR));
    expect(out.split('**Words for breath, life and lifespan').length - 1).toBe(1);
  });
  it('refuses a base without the anchor', () => {
    expect(() => buildV21('no anchor here')).toThrow(/anchor matched 0x/);
  });
});

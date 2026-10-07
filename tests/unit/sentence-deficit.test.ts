/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * T9 (#5151): fewer sentences in the translation than in the source — a screen for a quiet
 * omission too small for truncationRatio(). Positive: a real Kircher page with 40% of its
 * translated sentences removed. Negative controls: the complete page, an unpointed Hebrew prayer
 * page, a plate, a bilingual source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  sentenceCount, sentenceDeficit, SENT_DEFICIT_FLAG,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/sentence-deficit.mjs';
import {
  translationProse,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/block-drift.mjs';

const QW = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/page-integrity/quick-wins.json'), 'utf8')).cases as Record<string, any>;

describe('T9 · fewer sentences in the translation than in the source (#5151)', () => {
  it('counts sentences past abbreviations, initials and numbers', () => {
    expect(sentenceCount('Vidi hominem. Cap. 3. dicit S. Paulus quod vera sit. Nonne? Ita.')).toBe(4);
    expect(sentenceCount('He came. She went! Did they? Yes.')).toBe(4);
    expect(sentenceCount('天地玄黄。宇宙洪荒。日月盈昃！')).toBe(3);
    expect(sentenceCount('Τί ἐστιν; Οὐκ οἶδα. Ἴσως·')).toBe(3);
  });
  it('returns null for a script whose marks it cannot read (Tibetan shad is a clause mark)', () => {
    expect(sentenceCount('བདག་གི་རྒྱུད་ལ། བྱིན་གྱིས།')).toBeNull();
  });
  it('passes a complete Latin page (Kircher p.317: 20 source sentences, 23 translated)', () => {
    const s = sentenceDeficit(QW['kircher-p317-notes']);
    expect(s).toMatchObject({ judged: true, flag: false });
    expect(s.ratio).toBeGreaterThan(1);
  });
  it('flags the same page once 40% of its translated sentences are deleted (derived)', () => {
    const k = QW['kircher-p317-notes'];
    const body = translationProse(k.tr);
    const sentences = body.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((_: string, i: number) => i % 5 >= 3).join(' '); // keep 2 of every 5
    const s = sentenceDeficit({ ...k, tr: kept });
    expect(s.judged).toBe(true);
    expect(s.ratio).toBeLessThanOrEqual(SENT_DEFICIT_FLAG);
    expect(s.flag).toBe(true);
  });
  it('is unjudgeable on an unpointed Hebrew prayer page (no sentence marks), a plate, or a bilingual source', () => {
    expect(sentenceDeficit(QW['prayer-p333-short-meta'])).toEqual({ judged: false, why: 'few-sentences' });
    expect(sentenceDeficit({ ...QW['kircher-p317-notes'], type: 'plate' })).toEqual({ judged: false, why: 'non-prose' });
    const k = QW['kircher-p317-notes'];
    expect(sentenceDeficit({ ...k, ocr: '<language>Greek, Latin</language>\n' + k.ocr })).toEqual({ judged: false, why: 'multilingual-source' });
  });
});

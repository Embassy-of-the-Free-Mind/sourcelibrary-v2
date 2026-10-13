import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs module, no type declarations
import { readFailure, copyFilterWording, declineWording } from '../../scripts/lib/read-failure.mjs';
import fixture from '../fixtures/copy-filter-6523.json';

/**
 * scripts/lib/read-failure.mjs (#6523): a failed read is counted, not scored. Guards:
 *  1. POSITIVE control: every copy-filter cut 6523c catalogued by eye on the stored CLI reads (35 partial reads cut by
 *     the recitation filter, 4 filter blocks, 1 prose refusal naming the filter) fires as copy_filter;
 *  2. NEGATIVE controls: the 3 real misreads in that catalogue stay scored, and no reference transcription in the
 *     repo (Wikisource and pinned e-texts: real printed text, which says "I cannot" too) carries the wording.
 * Measured once on the scoring box (not in CI: the reads live there): 0 hits on 10,460 stored reads of 25 engines,
 * lite, 3 Flash and Sonnet included (scripts/eval/experiments/2026-10-12-failed-reads-unscored-6523.md).
 */
type Case = { class: string; engine: string; page: string; finishReason: string | null; expect: string | null; text: string };
const cases = (fixture as { cases: Case[] }).cases;

describe('read-failure: copy filter', () => {
  it('fires on every catalogued filter cut (positive control)', () => {
    const missed = cases.filter(c => c.expect === 'copy_filter')
      .filter(c => readFailure({ text: c.text, finishReason: c.finishReason, cli: true })?.kind !== 'copy_filter').map(c => `${c.engine} ${c.page}`);
    expect(missed).toEqual([]);
    expect(cases.filter(c => c.expect === 'copy_filter').length).toBe(40);
  });
  it('scores the catalogued real misreads (negative control)', () => {
    for (const c of cases.filter(x => x.expect === null)) expect(readFailure({ text: c.text, finishReason: c.finishReason, cli: true }), c.page).toBeNull();
  });
  it('never fires on a reference transcription (negative control)', () => {
    const hits: string[] = [];
    for (const d of ['scripts/eval/ground-truth-ws', 'scripts/eval/ground-truth']) {
      for (const f of fs.readdirSync(path.join(process.cwd(), d)).filter(f => f.endsWith('.json'))) {
        const t = fs.readFileSync(path.join(process.cwd(), d, f), 'utf8');
        if (copyFilterWording(t) || declineWording(t)) hits.push(`${d}/${f}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('read-failure: kinds', () => {
  it('names each failure, and scores a misread', () => {
    expect(readFailure({ finishReason: 'RECITATION' })?.kind).toBe('copy_filter');
    expect(readFailure({ finishReason: 'SAFETY' })?.kind).toBe('refusal');            // an API safety block
    expect(readFailure({ finishReason: 'SAFETY', cli: true })?.kind).toBe('copy_filter'); // the CLI's "blocked by Gemini's filters"
    expect(readFailure({ refused: true, refusalSource: 'inferred' })?.kind).toBe('empty');
    expect(readFailure({ text: '', error: 'empty: [agy] print timeout after 2m0s with turn in progress' })?.kind).toBe('timeout');
    expect(readFailure({ text: '   ' })?.kind).toBe('empty');
    expect(readFailure({ contentChars: 0 })?.kind).toBe('empty');
    expect(readFailure({ text: 'I have prepared the transcription plan in plan.md.', extracted: '' })?.kind).toBe('other');
    expect(readFailure({ text: 'Arma virumque cano, Troiae qui primus ab oris\n\nI cannot provide a direct transcription of the rest of this page.' })?.kind).toBe('refusal');
    // a partial read the filter cut mid-word is a copy-filter failure, not a scored page
    expect(readFailure({ text: 'Kranzius dict. loco. eundem excusare volens, scrib\n\nI am unable to output the full verbatim transcription of this page because the automated safety filter flags it.' })?.kind).toBe('copy_filter');
    expect(readFailure({ text: 'Arma uirumque cano, Troie qui primus ab horis', contentChars: 40 })).toBeNull();
    // early printed English says "I cannot" too
    expect(readFailure({ text: 'Wherefore I cannot but publish this Treatise, that the Reader may judge of the Filters of the Alchymists.' })).toBeNull();
  });
});

/**
 * English modernization is produced only when a reader asks for it (#4958).
 *
 * HISTORY, because this file replaces a test that pinned the opposite arrangement.
 *
 * Phase 4 used to generate an English "modernization" into `translation.data` for every
 * English book at any date, and the reader used to make that text the DEFAULT view for
 * books published before 1820. A reader opening a 1907 volume met two English texts —
 * and the second one was not the same text: the v1 prompt Americanized spelling and
 * injected editorial glosses. The output was invisible on modern books yet still set
 * `pages_translated` and `is_fully_translated`, which gate badges and feed homepage
 * stats.
 *
 * The interim fix kept an edition-year threshold in both files and a test pinned them to
 * the same number. That threshold is gone from both: a date is a proxy for archaic
 * ORTHOGRAPHY, and the on-demand lane measures the thing itself on the page in front of
 * the reader (`src/lib/archaic-orthography.ts`), refusing to spend where there is
 * nothing to modernize. Measured on live pages, a date cannot stand in for it — our own
 * OCR preserves long ſ on some pages of a book and not others.
 *
 * THE INVARIANTS NOW. The pipeline never dispatches an English book to translation, and
 * the reader never opens on a modernization. Both are one-line edits away from
 * regressing, which is what earns them a guard.
 *
 * (A note on how this file came to be rewritten rather than edited: the old test and the
 * reader change landed in two PRs that were each green against their own base and broke
 * main together. Green checks measure that a PR *can* merge, never that it *should*.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const ORCHESTRATOR = path.join(root, 'scripts/workers/pipeline-orchestrator.mjs');
const READER = path.join(root, 'src/components/pipeline/TranslationEditor.tsx');

describe('English modernization is reader-triggered', () => {
  const orchestrator = readFileSync(ORCHESTRATOR, 'utf8');
  const reader = readFileSync(READER, 'utf8');

  /**
   * The Phase 4 block: from the English-variants constant to the end of the English
   * filter. Bounded by a trailing anchor rather than a character count — the candidate
   * aggregation between them is long and a fixed window silently cut the filter out of
   * range, which reads as "the filter is gone" rather than "the window was short".
   */
  function phaseFour(): string {
    const start = orchestrator.indexOf('const ENGLISH_VARIANTS_P4');
    expect(start, 'Phase 4 anchor not found — did ENGLISH_VARIANTS_P4 get renamed?').toBeGreaterThan(-1);
    const end = orchestrator.indexOf('modernization is reader-triggered, not dispatched', start);
    expect(end, 'Phase 4 English-filter log line not found — the filter may have been removed.').toBeGreaterThan(start);
    return orchestrator.slice(start, end);
  }

  it('Phase 4 filters English books out of translation dispatch', () => {
    const block = phaseFour();
    expect(
      block,
      'Phase 4 no longer filters on ENGLISH_VARIANTS_P4 — English books would be dispatched to ' +
        'translation again, writing a second English text nobody asked for (#4958).'
    ).toMatch(/freshBooks\s*=\s*freshBooks\.filter\(\s*\(?b\)?\s*=>\s*!ENGLISH_VARIANTS_P4\.includes/);
  });

  it('the filter is unconditional — no year, no date proxy', () => {
    const block = phaseFour();
    expect(
      block,
      'an edition-year threshold is back in Phase 4. The on-demand lane measures orthography ' +
        'on the actual page; a date cannot stand in for it.'
    ).not.toMatch(/MODERNIZATION_MAX_YEAR|editionYear\(/);
  });

  it('`language` survives the Phase 4 projection', () => {
    // A projected-away field reads as undefined, and every English book would pass the
    // filter — the #4563/#4565 starvation shape, where a projection silently decides a
    // filter it was never meant to touch.
    const block = phaseFour();
    const projection = block.match(/\{ \$project: \{ id: 1, title: 1, pages_count: 1[^}]*\} \}/);
    expect(projection, 'Phase 4 projection not found').not.toBeNull();
    expect(projection![0], 'Phase 4 projects away `language` — the English filter would never match.').toContain('language: 1');
  });

  it('the reader opens on the transcription for every English book', () => {
    expect(
      reader,
      'englishOcrIsReadingView has regained a condition. For an English book the ' +
        'transcription is the reading view, always — a modernization is offered, never substituted.'
    ).toMatch(/const englishOcrIsReadingView = isEnglishBook;/);
  });

  it('every paid phase still asks the dial', () => {
    // Counterpart property: removing English from a lane must not have loosened a gate.
    for (const phase of [
      'Phase 1.5 (preview OCR)',
      'Phase 2 (OCR submit)',
      'Phase 4 (translation dispatch)',
      'Phase 8 (image extraction)',
    ]) {
      expect(
        orchestrator,
        `${phase} lost its budgetAllowsDispatchForPhase gate — paid work must stay behind the dial.`
      ).toContain(`budgetAllowsDispatchForPhase('${phase}')`);
    }
  });
});

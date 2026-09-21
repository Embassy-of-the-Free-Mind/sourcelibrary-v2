/**
 * English modernization is generated only where the reader will show it.
 *
 * INCIDENT (2026-09-21, #4958). Seven G.R.S. Mead books (1901–1908) were published,
 * and four of them carried a second English text: 370 pages of `english_modernization`
 * output. The reader never displayed it — `englishOcrIsReadingView` hides the
 * Modernized panel at edition year >= 1820, because modern OCR is already readable
 * (#2561, refined by #3010) — but the pages still set `pages_translated` and
 * `is_fully_translated: true`, which gate badges and feed `homepage_stats`
 * (invariants/visibility-and-stats.md). That is what surfaced as "two englishes".
 *
 * Worse, on modern prose the modernization was not the identity function it ought to
 * be: on *The Mysteries of Mithra* (1907) it Americanized spelling (`centre` →
 * `center`) and injected editorial <note> glosses into the text. A book that needed no
 * modernizing got a silently altered one.
 *
 * THE RULE. The reader decides where a modernization is worth having; the generator
 * must ask the same question. Below the threshold an English book reads as
 * modernized-by-default and the pass is the whole point (Boyle 1725, long ſ). At or
 * above it — and when the year is unknown — there is no panel, so there is nothing to
 * generate and nothing that should touch the translated counters.
 *
 * The threshold lives in two files that cannot import each other (a .mjs worker and a
 * .tsx component). This pins them to the same number, which is the only thing keeping
 * them honest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
// @ts-expect-error — .mjs helper without types; editionYear is the canonical reader of
// the (year, published) pair, and `published` is free text that must never be parseInt'd.
import { editionYear } from '../../scripts/lib/identity-fields.mjs';

const root = path.join(__dirname, '..', '..');
const ORCHESTRATOR = path.join(root, 'scripts/workers/pipeline-orchestrator.mjs');
const READER = path.join(root, 'src/components/pipeline/TranslationEditor.tsx');

describe('English modernization year gate', () => {
  const orchestrator = readFileSync(ORCHESTRATOR, 'utf8');
  const reader = readFileSync(READER, 'utf8');

  it('generator and reader agree on the threshold', () => {
    const gen = orchestrator.match(/const MODERNIZATION_MAX_YEAR = (\d{4});/);
    expect(gen, 'MODERNIZATION_MAX_YEAR is gone from the orchestrator — Phase 4 would modernize every English book again (#4958).').not.toBeNull();

    const read = reader.match(/englishOcrIsReadingView\s*=\s*isEnglishBook\s*&&\s*!\(bookYear\s*<\s*(\d{4})\)/);
    expect(read, 'the reader\'s englishOcrIsReadingView threshold could not be found — if it was refactored, re-point this test rather than deleting it.').not.toBeNull();

    expect(
      gen![1],
      `generator modernizes below ${gen![1]} but the reader only shows the panel below ${read![1]}. ` +
        'Books in the gap get a modernization nobody reads, which still sets is_fully_translated.'
    ).toBe(read![1]);
  });

  it('Phase 4 filters English candidates by edition year', () => {
    expect(
      orchestrator,
      'Phase 4 no longer calls editionYear() — the gate is gone, or is parsing `published` directly (it is free text).'
    ).toMatch(/editionYear\(b\)/);
    // The gate reads these two fields; projecting them away makes every book look
    // unknown-year, which the gate treats as modern. That is the #4563/#4565 shape.
    //
    // Anchored to the Phase 4 block: several phases share the `{ id: 1, title: 1,
    // pages_count: 1 ... }` prefix, and an unanchored match lands on the first one in
    // the file — which is a different phase and would make this assertion meaningless.
    const phase4 = orchestrator.slice(orchestrator.indexOf('const MODERNIZATION_MAX_YEAR'));
    expect(phase4.length, 'Phase 4 anchor not found').toBeGreaterThan(0);
    const projection = phase4.match(/\{ \$project: \{ id: 1, title: 1, pages_count: 1[^}]*\} \}/);
    expect(projection, 'Phase 4 projection not found').not.toBeNull();
    expect(projection![0], 'Phase 4 projects away `published` — editionYear() would read undefined for every book.').toContain('published: 1');
    expect(projection![0], 'Phase 4 projects away `year` — editionYear() would fall back to free text or null.').toContain('year: 1');
  });

  describe('the predicate itself', () => {
    const ENGLISH = ['english', 'eng', 'en'];
    const MAX = 1820;
    /** Mirrors the Phase 4 filter. */
    const translates = (b: Record<string, unknown>) => {
      if (!ENGLISH.includes(String(b.language ?? '').toLowerCase())) return true;
      const y = editionYear(b);
      return typeof y === 'number' && y < MAX;
    };

    it.each([
      [{ language: 'English', year: 1907, published: '1907' }, false, 'a 1907 Mead volume — the incident'],
      [{ language: 'English', published: '1725' }, true, 'archaic English still gets its modernization'],
      [{ language: 'English', published: '1819' }, true, 'just below the threshold'],
      [{ language: 'English', published: '1820' }, false, 'exactly at the threshold'],
      [{ language: 'English', published: 'MDCCXXV' }, false, 'unparseable year reads as modern, per the reader'],
      [{ language: 'English' }, false, 'no year at all'],
      [{ language: 'Latin', year: 1650 }, true, 'a real translation is untouched'],
      [{ language: 'Chinese' }, true, 'a non-English book with no year is untouched'],
    ])('%#: %o -> %s (%s)', (book, expected) => {
      expect(translates(book as Record<string, unknown>)).toBe(expected);
    });
  });
});

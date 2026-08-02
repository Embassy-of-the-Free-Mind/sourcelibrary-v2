import { describe, it, expect } from 'vitest';
import {
  classifyPair,
  sourceKind,
  printedLeaf,
  leafVerdict,
  bookShiftVerdict,
  isTextMoveSource,
} from '../../scripts/lib/revision-pairs.mjs';

/**
 * #3473 — `page_revisions` is used as a double-OCR corpus, and two failure modes
 * make a pair look like two reads of one leaf when it is not: a bulk sweep that
 * MOVED text between pages (`shift-repair-erara-2026-07`, 56,413 ocr + 55,272
 * translation rows), and an unlabelled image swap detectable only by the printed
 * page number.
 *
 * These exercise the filter's behaviour on constructed pairs. Every assertion here
 * fails if the corresponding branch in `classifyPair` is deleted — verified by
 * deleting each branch and watching it go red, per CLAUDE.md's rule that a guard
 * whose only failure mode is "someone removed the line" is documentation.
 */

const P = (n: string | null, body: string) =>
  `${n === null ? '' : `<page-num>${n}</page-num>`}<language>Latin</language>${body}`;

describe('printedLeaf', () => {
  it('normalises decoration around the number', () => {
    expect(printedLeaf(P('[9]', 'x'))).toBe('9');
    expect(printedLeaf(P('9.', 'x'))).toBe('9');
    expect(printedLeaf(P('009', 'x'))).toBe('9');
  });

  it('handles roman numerals and folio marks as strings, not just digits', () => {
    // The first ad-hoc audit matched /[0-9]{1,4}/ only, which silently abstained on
    // every front-matter leaf — exactly where early-modern books number in roman.
    expect(printedLeaf(P('iv.', 'x'))).toBe('iv');
    expect(printedLeaf(P('IV', 'x'))).toBe('iv');
    expect(printedLeaf(P('iv.', 'x'))).toBe(printedLeaf(P('IV', 'x')));
  });

  it('returns null when the leaf prints no number — that is not evidence of a shift', () => {
    expect(printedLeaf(P(null, 'a page with no printed folio'))).toBeNull();
    expect(printedLeaf('')).toBeNull();
  });
});

describe('leafVerdict', () => {
  it('separates same / different / unverified', () => {
    expect(leafVerdict(P('12', 'a'), P('12', 'b'))).toBe('same');
    expect(leafVerdict(P('12', 'a'), P('13', 'b'))).toBe('different');
    expect(leafVerdict(P(null, 'a'), P('13', 'b'))).toBe('unverified');
  });
});

describe('sourceKind', () => {
  it('classifies the e-rara repair sweep as a text move, not a read', () => {
    expect(sourceKind('shift-repair-erara-2026-07')).toBe('text-move');
    expect(isTextMoveSource('shift-repair-erara-2026-07')).toBe(true);
  });

  it('catches a FUTURE shift-repair sweep by prefix', () => {
    // The named set cannot know next year's sweep; the prefix rule is what makes
    // the filter survive one being added without this file being edited.
    expect(sourceKind('shift-repair-bsb-2027-03')).toBe('text-move');
  });

  it('treats unlabelled rows as model passes, not unknowns', () => {
    // 1,263 rows predate source labelling. Flagging them would put a permanent
    // four-figure count in the "unrecognised" alarm and train readers to ignore it.
    expect(sourceKind(null)).toBe('model');
    expect(sourceKind(undefined)).toBe('model');
    expect(sourceKind('')).toBe('model');
    expect(sourceKind('unknown')).toBe('model');
  });

  it('reports an unrecognised label as unknown so a new sweep surfaces', () => {
    expect(sourceKind('bulk-realign-2027')).toBe('unknown');
    expect(sourceKind('some-new-maintenance-script')).toBe('unknown');
  });

  it('separates human edits from model passes', () => {
    expect(sourceKind('manual')).toBe('human');
  });
});

describe('classifyPair', () => {
  it('accepts two model reads that printed the same leaf', () => {
    const v = classifyPair({
      priorSource: 'batch_api',
      priorText: P('47', 'De affectibus animi'),
      currentText: P('47', 'De affectibus animi, corrected'),
    });
    expect(v.usable).toBe(true);
    expect(v.reason).toBe('ok');
    expect(v.leaf).toBe('same');
  });

  it('rejects a sweep pair EVEN WHEN the page numbers agree', () => {
    // The load-bearing case. A page-number check alone passes this pair: after the
    // repair both sides can print the same number while being one text filed
    // against two page ids. Only the source label sees it.
    const v = classifyPair({
      priorSource: 'shift-repair-erara-2026-07',
      priorText: P('47', 'identical body text'),
      currentText: P('47', 'identical body text'),
    });
    expect(v.usable).toBe(false);
    expect(v.reason).toBe('text-move-source');
  });

  it('rejects a pair whose two sides printed different leaves', () => {
    // The other half: a genuine image swap carries no source label at all.
    const v = classifyPair({
      priorSource: 'batch_api',
      priorText: P('505', 'De affectibus'),
      currentText: P('469', 'Aegyptia. Latina. Arabica.'),
    });
    expect(v.usable).toBe(false);
    expect(v.reason).toBe('different-leaf');
  });

  it('rejects a human edit — a second look, but not a second OCR pass', () => {
    const v = classifyPair({
      priorSource: 'manual',
      priorText: P('12', 'body'),
      currentText: P('12', 'body edited'),
    });
    expect(v.usable).toBe(false);
    expect(v.reason).toBe('human-edit');
  });

  it('refuses an unrecognised source rather than folding it into the corpus', () => {
    const v = classifyPair({
      priorSource: 'bulk-realign-2027',
      priorText: P('12', 'body'),
      currentText: P('12', 'body'),
    });
    expect(v.usable).toBe(false);
    expect(v.reason).toBe('unknown-source');
  });

  it('accepts an unverified leaf on its own — the book verdict is what catches those', () => {
    const v = classifyPair({
      priorSource: 'ai',
      priorText: P(null, 'unnumbered leaf'),
      currentText: P(null, 'unnumbered leaf, re-read'),
    });
    expect(v.usable).toBe(true);
    expect(v.leaf).toBe('unverified');
  });

  it('rejects an empty side', () => {
    expect(classifyPair({ priorSource: 'ai', priorText: '', currentText: P('1', 'x') }).reason)
      .toBe('empty-side');
  });
});

describe('bookShiftVerdict', () => {
  const shiftedPairs = Array.from({ length: 10 }, (_, i) => ({
    printedPrior: String(100 + i),
    printedCurrent: String(101 + i),   // uniform +1 slide
  }));

  it('calls a book shifted when its verified pairs mostly disagree, and names the offset', () => {
    const v = bookShiftVerdict(shiftedPairs);
    expect(v.verdict).toBe('shifted');
    expect(v.dominant_offset).toBe(1);
  });

  it('does not call a book on one or two comparisons', () => {
    expect(bookShiftVerdict(shiftedPairs.slice(0, 2)).verdict).toBe('insufficient');
  });

  it('reports no dominant offset when the shifts scatter', () => {
    // Per-page reassignment is a different and messier problem than a slide, and a
    // single number would misdescribe it.
    const scattered = [
      { printedPrior: '10', printedCurrent: '11' },
      { printedPrior: '20', printedCurrent: '27' },
      { printedPrior: '30', printedCurrent: '18' },
      { printedPrior: '40', printedCurrent: '55' },
    ];
    const v = bookShiftVerdict(scattered);
    expect(v.verdict).toBe('shifted');
    expect(v.dominant_offset).toBeNull();
  });

  it('ignores unverified pairs instead of counting them as clean', () => {
    const v = bookShiftVerdict([
      ...shiftedPairs.slice(0, 4),
      ...Array.from({ length: 50 }, () => ({ printedPrior: null, printedCurrent: null })),
    ]);
    expect(v.verified).toBe(4);
    expect(v.verdict).toBe('shifted');
  });

  it('accepts raw texts as well as extracted numbers', () => {
    const v = bookShiftVerdict([
      { priorText: P('1', 'a'), currentText: P('2', 'b') },
      { priorText: P('2', 'a'), currentText: P('3', 'b') },
      { priorText: P('3', 'a'), currentText: P('4', 'b') },
    ]);
    expect(v.verdict).toBe('shifted');
    expect(v.dominant_offset).toBe(1);
  });
});

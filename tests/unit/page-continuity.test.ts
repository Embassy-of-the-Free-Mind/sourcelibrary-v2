import { describe, it, expect } from 'vitest';
import { pageContinuity, continuityHint } from '@/lib/page-continuity';
import fixtures from '../fixtures/page-continuity.json';

// Every fixture is REAL, FULL page text captured from production Mongo on
// 2026-08-05 (see tests/fixtures/page-continuity.json, written by a script that
// applied stripEditorialWrappers — the same treatment the quote API gives text
// before serving it). Nothing is hand-written toward a wanted verdict, which is
// the failure recorded in .claude/docs/invariants/tests-that-are-not-guards.md:
// a fixture drafted after the answer is known reaches that answer by whichever
// path is available, and you never learn which.
//
// An earlier draft of this file DID paraphrase these pages down to ~170 chars
// for readability. Three tests failed — the elided text fell under the 200-char
// prose floor — and the temptation was to lower the floor to make them pass.
// That would have been tuning the code to fit invented evidence. Captured the
// real pages instead; the floor is unchanged.

const { p46, p47, p48, self_contained } = fixtures.thibault;
const arabic = fixtures.arabic.p7;

describe('pageContinuity', () => {
  it('catches a word split by a hyphen at the foot of the page', () => {
    // Thibault p46 ends "…the guide of our move-", and "movements" opens p47.
    const c = pageContinuity(p46);
    expect(c.hyphen_split_at_end).toBe(true);
    expect(c.continues_on_next).toBe(true);
    // p46 opens under a <header>TABLE I.</header> on "Circle No. 5" — a caption,
    // not a continuation. The two edges are judged independently, and a run-on
    // ending must never imply a run-on opening.
    expect(c.continues_from_previous).toBe(false);
  });

  it('catches the far half of that split word, and p47 running on in turn', () => {
    const c = pageContinuity(p47);
    expect(c.continues_from_previous).toBe(true);
    expect(c.continues_on_next).toBe(true);
    expect(c.hyphen_split_at_end).toBe(false); // ends on a comma, not a hyphen
  });

  it('catches a page opening mid-clause', () => {
    // p48 opens "that might arise from it…" — the clause began on p47.
    expect(pageContinuity(p48).continues_from_previous).toBe(true);
  });

  // The case that exposed a systematic false negative while this was being
  // written, and the reason page furniture is stripped before the edge test.
  // Thibault p61 opens:
  //     BOOK ONE
  //
  //     and of their interpretations, to demonstrate the true proportions…
  // The prose plainly continues from p60. A naive "starts with a capital" test
  // sees the running head and reports a clean opening. Most pages in most scans
  // carry a running head, so this was not an edge case — it was the common case.
  it('sees through a running head to the prose underneath', () => {
    expect(self_contained.startsWith('BOOK ONE')).toBe(true); // fixture really is head-first
    expect(pageContinuity(self_contained).continues_from_previous).toBe(true);
  });

  // The negative control that matters most. If this goes true, the flag fires on
  // ordinary pages, callers learn to ignore it, and the signal is worse than
  // nothing — one that cries wolf on 7 boundaries in 8 is noise.
  it('stays silent at an ending that closes cleanly', () => {
    // p61 ends "…will find in effect and with admiration." — a full stop.
    const c = pageContinuity(self_contained);
    expect(c.continues_on_next).toBe(false);
    expect(c.hyphen_split_at_end).toBe(false);
  });

  it('makes no case-based claim about a caseless script', () => {
    // The Arabic page ends "…من ان" with no terminal mark, so a naive
    // missing-punctuation rule would call it a run-on. We decline: in a script
    // with no case there is no corroborating signal, and a confident wrong
    // answer is worse than none.
    const c = pageContinuity(arabic);
    expect(/[\p{Ll}\p{Lu}]/u.test(arabic)).toBe(false); // fixture really is caseless
    expect(c.continues_on_next).toBe(false);
    expect(c.continues_from_previous).toBe(false);
  });

  // Production serves this text through markForExport (src/lib/provenance.ts),
  // which threads zero-width characters through it as the provenance mark. Those
  // are invisible, so a page ending "our move-" arrives ending in a zero-width
  // joiner and a naive /-$/ reports a clean break. This is not theoretical: the
  // flags came back all-false on a preview deploy while 10/10 tests were green,
  // because the tests ran on pre-mark text straight out of Mongo.
  it('sees through the zero-width provenance mark', () => {
    const ZWJ = '‍', ZWSP = '​', BOM = '﻿';
    const marked = p46 + ZWJ + ZWSP + BOM;
    expect(/[​-‏⁠-⁤﻿]/.test(marked)).toBe(true); // really is marked
    const c = pageContinuity(marked);
    expect(c.hyphen_split_at_end).toBe(true);
    expect(c.continues_on_next).toBe(true);
  });


  // THE REGRESSION. Reported from a live session against the deployed tool:
  // get_quote on p.269 of the Taylor Ethics said continues_from_previous:false
  // on a page opening "dom from pain" — the tail of "the prudent man pursues a
  // free-" on p.268. The most mechanically detectable case the feature exists
  // for, and it was the one it missed.
  //
  // Cause: stripInlineNoise removes `>` to kill markdown blockquote markers,
  // and `>` also closes every tag. Run first, it turned
  // `<page-num>276</page-num>` into `<page-num276</page-num`, after which the
  // furniture regex could not match and the head was never reached.
  //
  // Every existing fixture used a BARE running head ("BOOK ONE"), which the
  // uppercase-line branch catches with no tag involved — so the tagged path had
  // no coverage at all and 11 green tests said nothing about it.
  it('sees through TAGGED page furniture, not just bare running heads', () => {
    const p269 =
      '<page-num>276</page-num>\n<header>THE NICOMACHEAN BOOK VII.</header>\n\n' +
      'dom from pain, and not what is pleasant; for pleasure is not a generation, ' +
      'nor is it always accompanied by generation, but it is an energy and an end. ' +
      'Nor does it arise when we are being filled, but when we are exercising some ' +
      'power. Its end is not always something other than itself, but only in the ' +
      'case of those who are being led to the perfecting of their nature.';
    const c = pageContinuity(p269);
    expect(c.continues_from_previous, 'page opens mid-word after a tagged header').toBe(true);
  });

  it('sees a hyphen split through a TAGGED trailing block', () => {
    const p268 =
      '<page-num>275</page-num>\n<header>CHAP. XI. ETHICS.</header>\n\n' +
      'The discussion of pleasure follows, since it is proper to one who philosophises ' +
      'about political science to consider it. Some say that no pleasure is a good, ' +
      'either essentially or accidentally, and that the temperate man avoids pleasures. ' +
      'Furthermore, the prudent man pursues a free-';
    const c = pageContinuity(p268);
    expect(c.hyphen_split_at_end, 'trailing hyphen after a tagged header block').toBe(true);
    expect(c.continues_on_next).toBe(true);
  });

  it('declines to judge text too short to be prose', () => {
    // Real shape: a Chinese page whose entire stripped content was "道\n蔵\n1".
    expect(pageContinuity('道\n蔵\n1').continues_on_next).toBe(false);
    expect(pageContinuity('TABLE I.').continues_on_next).toBe(false);
    expect(pageContinuity('').continues_on_next).toBe(false);
    expect(pageContinuity(null).continues_on_next).toBe(false);
    expect(pageContinuity(undefined).continues_on_next).toBe(false);
  });
});

describe('continuityHint', () => {
  it('says nothing when both edges are clean', () => {
    // Constructed from the predicate's own output shape rather than a page, so
    // this states the contract even if no such page existed.
    expect(
      continuityHint(
        { continues_from_previous: false, continues_on_next: false, hyphen_split_at_end: false },
        12
      )
    ).toBeNull();
  });

  it('names both neighbours when the page is open at both ends', () => {
    const hint = continuityHint(pageContinuity(p47), 47);
    expect(hint).toContain('p.46');
    expect(hint).toContain('p.48');
    expect(hint).toContain('context: true');
  });

  it('points only forward when only the ending runs on, and calls out the split word', () => {
    const hint = continuityHint(pageContinuity(p46), 46);
    expect(hint).toContain('p.47');
    expect(hint).toContain('split');
    expect(hint).not.toContain('p.45');
  });
});

describe('the hyphen signal is read from the ORIGINAL, not the translation', () => {
  // Reported twice, on two books and two languages (#3653 follow-ups #3 and #4):
  // hyphen_split_at_end "appears never to fire". The cause is that a TRANSLATOR
  // RESOLVES HYPHENS — the line-break hyphen is a fact about the printed page,
  // and the English rendering of that page simply carries the whole word. The
  // flag was being tested against the one text in which it can never appear.
  //
  // Text below is the real Diogenes Laertius p.33 (book 6993882874305116d72cf9f3),
  // trimmed. The Greek breaks ἐγέ-/-νετο across the leaf; the English does not.
  const body = 'He judged the case of a friend according to the law. '.repeat(6);
  const translation = `${body}He was most reputable among the Greeks.\n\n<margin></margin>\nThe level\n</margin>`;
  const original = `${body}εὐδοξότατος δὲ μάλιστα παρὰ τοῖς ἕλλησιν ἐγέ-\n\n<margin>\nἡ στάθμη\n</margin>`;

  it('does not fire on the translation alone — the hyphen is not there to find', () => {
    expect(pageContinuity(translation).hyphen_split_at_end).toBe(false);
  });

  it('fires when the original is supplied', () => {
    expect(pageContinuity(translation, original).hyphen_split_at_end).toBe(true);
  });

  it('carries the split through to continues_on_next', () => {
    // Without the original this page looks self-contained: the English ends on
    // a full stop. That is the misleading case the flag exists to catch.
    expect(pageContinuity(translation).continues_on_next).toBe(false);
    expect(pageContinuity(translation, original).continues_on_next).toBe(true);
  });

  it('steps past a trailing <margin> gloss to reach the hyphen', () => {
    // The gloss sits AFTER the hyphenated word in the markup, so a naive tail
    // read sees "ἡ στάθμη" and concludes the page ends cleanly.
    expect(pageContinuity(translation, original).hyphen_split_at_end).toBe(true);
  });

  it('falls back to the served text when there is no separate original', () => {
    // Monolingual books pass the same string twice, or only one; behaviour must
    // not change for them.
    const mono = `${body}the prudent man pursues a free-`;
    expect(pageContinuity(mono).hyphen_split_at_end).toBe(true);
    expect(pageContinuity(mono, null).hyphen_split_at_end).toBe(true);
  });
});

/**
 * The translator's ellipsis marker (#3721).
 *
 * Fixtures captured from production, not drafted: Taylor 1818 Nicomachean Ethics
 * pp.45-47. The reporter gave eight datapoints across five books and five
 * layouts, and also retracted their own earlier theory that hyphen resolution
 * was the cause — the mechanism is that the translation layer appends an
 * ellipsis where a sentence runs off the leaf, and TERMINAL contained both the
 * ellipsis and the dot. The marker meaning INCOMPLETE made the detector say
 * COMPLETE.
 */
describe('pageContinuity — an edge ellipsis is a continuation marker', () => {
  const { p45, p46, p47 } = fixtures.ellipsis_marker;

  it('reads a page ending on an appended ellipsis as continuing', () => {
    // p.46 ends `…a conscious awareness of such energy..."` — inside a block
    // quote, so the marker is followed by a closing quotation mark.
    expect(pageContinuity(p46.translation, p46.original).continues_on_next).toBe(true);
    expect(pageContinuity(p47.translation, p47.original).continues_on_next).toBe(true);
  });

  it('reads a page opening on an ellipsis as continued-from', () => {
    expect(pageContinuity(p46.translation, p46.original).continues_from_previous).toBe(true);
  });

  it('leaves a page ending on a bare word alone', () => {
    // p.45 ends "…displeasing to a common nature, but" and always worked. The
    // fix must not be doing the work of the existing rule.
    expect(pageContinuity(p45.translation, p45.original).continues_on_next).toBe(true);
  });

  it('satisfies the reporter\'s invariant across the captured run', () => {
    // For adjacent pages, N.continues_on_next must equal N+1.continues_from_previous.
    // This is the assertion that makes the class visible rather than one page.
    const c45 = pageContinuity(p45.translation, p45.original);
    const c46 = pageContinuity(p46.translation, p46.original);
    const c47 = pageContinuity(p47.translation, p47.original);
    expect(c45.continues_on_next).toBe(c46.continues_from_previous);
    expect(c46.continues_on_next).toBe(c47.continues_from_previous);
  });

  it('still reports a self-contained page as self-contained', () => {
    // Guard against the fix turning into "everything continues". A real page
    // that ends on a full stop with no ellipsis must stay false.
    expect(pageContinuity(self_contained).continues_on_next).toBe(false);
  });
});

/**
 * Does a page's text run on across the leaf break?
 *
 * The corpus is retrieved a page at a time, but it was never *written* a page at
 * a time. Measured over 1,209 adjacent prose page-pairs (2026-08-05): **18.6%
 * have a passage that demonstrably spans the break**, 1.7% with a word split by
 * a hyphen. That is nearly one boundary in five, not an edge case.
 *
 * (A first pass measured 12.6%. It was wrong in the direction that flatters the
 * status quo: it judged the opening of a page without stripping the running head,
 * so every page whose prose resumed under a "BOOK ONE" line scored as a clean
 * start. Correcting that moved a third of the cases from invisible to visible —
 * which is the same mistake this module exists to stop a caller from making.)
 *
 * The damage is not that the neighbouring text is unreachable — `get_quote` has
 * always accepted `include_context=true`, and `get_book_text` reads ranges. It is
 * that **a caller has no way to know it is looking at a fragment.** A page ending
 * "the guide of our move-" reads as complete prose to a model that never saw the
 * next leaf, and the citation apparatus around it is fully valid, so the quote is
 * served with every appearance of integrity. That is the same failure family as
 * the wrapper-block misquote in `.claude/docs/invariants/quote-and-snippet-integrity.md`:
 * confidently citing words that are not the whole of what the author wrote.
 *
 * So these predicates exist to produce a *signal*, cheaply, from text we already
 * hold — no extra query, no extra model call.
 *
 * ## What they deliberately do NOT do
 *
 * They only speak for **cased scripts**. `continuesFromPrevious` keys on a
 * lowercase opening letter, which is meaningless in Arabic, Hebrew, and CJK, and
 * `continuesOntoNext` keys on missing terminal punctuation, which in a caseless
 * script fires on ordinary line-wrapped text far too often to be worth acting on.
 * For those scripts both return `false` — the honest answer is "no claim", not a
 * guess, because a false "this is a fragment" teaches a caller to distrust a
 * signal that is right seven times in eight elsewhere.
 *
 * A hyphen split is the one signal that needs no interpretation, so it is
 * reported separately and is trusted on its own.
 */

/** Sentence-final marks across the scripts where we make a claim, plus closers. */
const TERMINAL = /[.!?:;»”"'’)\]…。！？۔։።៕။]$/;

/** A trailing hyphen directly after a letter: the word itself is cut in half. */
const HYPHEN_SPLIT = /[\p{L}]-$/u;

/** Does the text contain letters from a script that HAS upper/lower case? */
const HAS_CASED_SCRIPT = /[\p{Ll}\p{Lu}]/u;

/**
 * Page furniture that sits OUTSIDE the run of prose: running heads, signature
 * marks, printed page numbers, and catchwords. These are real marks on the leaf —
 * `quote-and-snippet-integrity.md` is explicit that they are kept, not stripped,
 * because they aid reading and recall — but they are not part of the sentence
 * flowing across the break, and leaving them in place defeats both edge tests.
 *
 * This is not hypothetical. Thibault p61 begins:
 *
 *     BOOK ONE
 *
 *     and of their interpretations, to demonstrate the true proportions…
 *
 * The prose plainly continues from p60, but a naive "does it start with a capital"
 * test sees "BOOK ONE" and reports a clean opening. A catchword does the mirror
 * image at the foot of the page — it is literally the first word of the next leaf,
 * printed for the binder, so it both hides the run-on ending and is itself proof
 * of one.
 */
const LEADING_FURNITURE =
  /^(?:\s*<(header|page-num|sig|margin|catchword)>[\s\S]*?<\/\1>\s*|\s*[\p{Lu}\p{N}][\p{Lu}\p{N}\s.,'’:-]{0,38}\n)+/u;

const TRAILING_FURNITURE =
  /(?:\s*<(header|page-num|sig|margin|catchword)>[\s\S]*?<\/\1>\s*|\n\s*[\p{Lu}\p{N}][\p{Lu}\p{N}\s.,'’:-]{0,38}\s*)+$/u;

function stripInlineNoise(text: string): string {
  return text.replace(/[*_#>`~[\]]/g, '').replace(/\|/g, ' ');
}

/** The text as it flows INTO this page — furniture at the top removed. */
function headOf(text: string): string {
  return stripInlineNoise(text).replace(LEADING_FURNITURE, '').trim();
}

/** The text as it flows OUT of this page — furniture at the foot removed. */
function tailOf(text: string): string {
  return stripInlineNoise(text).replace(TRAILING_FURNITURE, '').trim();
}

export interface PageContinuity {
  /** The page opens mid-sentence: read the previous page to see the whole thought. */
  continues_from_previous: boolean;
  /** The page breaks off mid-sentence: the passage carries on onto the next page. */
  continues_on_next: boolean;
  /** A word is split by a hyphen at the page break — the strongest signal, and unambiguous. */
  hyphen_split_at_end: boolean;
}

const NONE: PageContinuity = {
  continues_from_previous: false,
  continues_on_next: false,
  hyphen_split_at_end: false,
};

/**
 * Judge a single page's edges. `text` must already have editorial wrappers
 * stripped — a trailing `<summary>` block ends in a full stop and would mask the
 * very run-on we are looking for. (That is not hypothetical: the same measurement
 * run at 39% before the real stripper was applied and 55.7% after.)
 */
export function pageContinuity(text: string | null | undefined): PageContinuity {
  if (!text) return NONE;

  // Too short to be prose — plate captions, colophons, blank leaves. Judging
  // these produces noise, and noise here is worse than silence.
  if (stripInlineNoise(text).trim().length < 200) return NONE;

  const head = headOf(text);
  const tail = tailOf(text);
  const hyphen_split_at_end = HYPHEN_SPLIT.test(tail);

  // Caseless scripts get the hyphen signal only; see the note above.
  if (!HAS_CASED_SCRIPT.test(tail)) {
    return { ...NONE, hyphen_split_at_end };
  }

  return {
    continues_from_previous: /^\p{Ll}/u.test(head),
    continues_on_next: hyphen_split_at_end || !TERMINAL.test(tail),
    hyphen_split_at_end,
  };
}

/**
 * One line a model can act on, or null when the page stands on its own. Kept
 * next to the predicate so the wording cannot drift away from the logic.
 */
export function continuityHint(c: PageContinuity, page: number): string | null {
  const from = c.continues_from_previous;
  const onto = c.continues_on_next;
  if (!from && !onto) return null;

  const where = c.hyphen_split_at_end
    ? `A word is split across the break at the foot of p.${page}.`
    : '';

  if (from && onto) {
    return `${where} This page opens mid-sentence and breaks off mid-sentence: the passage runs from p.${page - 1} through p.${page + 1}. Call get_quote again with context: true (or get_quotes for the range) before quoting, so you are not citing a fragment as if it were the whole sentence.`.trim();
  }
  if (onto) {
    return `${where} This page breaks off mid-sentence — the passage continues on p.${page + 1}. Call get_quote again with context: true before quoting, so you are not citing half a sentence.`.trim();
  }
  return `This page opens mid-sentence — it began on p.${page - 1}. Call get_quote again with context: true before quoting, so the thought is whole.`;
}

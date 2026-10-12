/**
 * Does this page say, in its own words, that it is quoting somebody else at length?
 *
 * PRIOR ART: src/lib/front-matter.ts — the precedent the reporter named
 * ("you already do exactly the right thing for front matter"), but it judges a
 * whole leaf from its furniture; src/lib/page-continuity.ts — reads page edges
 * for run-on prose, knows nothing of whose prose it is; src/lib/quote-text.ts
 * `containsMarginalia` — same "flag + note" shape, keyed on a tag the OCR
 * writes. No tag marks an extract, so none of them fits.
 *
 * ## Why (#3689)
 *
 * Taylor's 1818 *Nicomachean Ethics*, scan p.45:
 *
 *     The truth of this is most beautifully illustrated by Plotinus in his book
 *     On Felicity, from which the following is an extract.
 *
 * The extract then runs for four more pages. A caller quoting the middle of
 * p.46 holds a valid page citation to a book with Aristotle's name on it — and,
 * since the citation block grew BibTeX, a ready-made entry attributing Plotinus
 * to Aristotle. Nothing in the response was false except the implied
 * attribution, and nothing in it could be checked.
 *
 * ## What it uses — the book's own announcement, and its own quotation marks
 *
 * Not `<meta>`, and not "the page mentions Plotinus": that heuristic was
 * rejected on the issue, because Aristotle discusses other philosophers on
 * every page and a wrong attribution warning is worse than none. The signal
 * here is narrower and is not an inference about content: the printed sentence
 * that says an extract FOLLOWS, and the quotation marks the printer set around
 * it. Measured 2026-10-12 on 106,341 pages of 288 English books (38 by or
 * translated by Thomas Taylor, 250 sampled): 192 such sentences in 71 books —
 * Taylor's 79 of them, but also Wilkins on the Purāṇas, Aston on the *Nihongi*,
 * de Groot, Higgins. It is a habit of the period, not of one translator.
 *
 * ## What it deliberately does NOT do
 *
 * **Name the extract's author.** The announcement is returned VERBATIM. The
 * measured phrasings include "from his Arguments against the Christians",
 * "from my Theoretic Arithmetic" and "from the Register of Mappersall" — a
 * name pulled out of those by pattern would be wrong often, and silently. The
 * sentence already says whose words follow; a caller can read it.
 *
 * **Claim the extract's extent.** Where it ENDS is the hard half. The tracker
 * follows the quotation the announcement opens until a paragraph closes it,
 * and gives up after MAX_LOOKBACK pages. It errs towards flagging, which the
 * issue names as the safe direction: a flag costs a caller one look at the
 * scan, a miss costs a misattribution. Same sample, 84,379 pages of the 206
 * books with any candidate sentence: 194 announcing pages, 50 of them opening a
 * marked quotation; 26 quotations ran onto later pages (99 pages), 20 were seen
 * to close and 6 hit the cap unclosed. Of those 6, two are real long extracts
 * read by eye (a second scan of this Taylor volume; Proclus in Taylor's
 * *Timaeus*); the other four were NOT checked and are probably a closing mark
 * lost in transcription. `quotation_marks_on_this_page` is what lets a caller
 * tell the two apart, and the note says a flagged page may be only partly
 * extract (Taylor's p.49 is mostly Aristotle with the extract's last three
 * lines) and that an unflagged page is NOT thereby vouched for.
 *
 * **Speak for other languages.** The announcement patterns are English. On a
 * translated book they are tried against our English translation as well as
 * the transcription, which reaches some of it; a Latin "sequentia excerpta"
 * on an untranslated page is not seen.
 */

/** How many earlier pages the quote route reads to see whether an extract is still open. */
export const MAX_LOOKBACK = 8;

export const EMBEDDED_EXTRACT_NOTE =
  'The book states in its own words that it is quoting ANOTHER source at length here: read '
  + '`announcement`, which is that sentence verbatim and names the source. Words inside the extract '
  + 'belong to that source, not to the author in the citation block — the citation is correct for '
  + 'where the words are PRINTED, not for who wrote them. Cite them as "<source>, quoted in <this '
  + 'book>", never as the book\'s author. The extent is approximate: it is followed from the printed '
  + 'announcement and its quotation marks only, so part of this page may still be the author\'s own '
  + 'text (compare the scan with include_image), and a page WITHOUT this field is not thereby '
  + 'guaranteed to be free of quoted material, footnotes or translator\'s commentary.';

/** Appended to a continuity hint: the span it recommends may cross from one author to another. */
export const EXTRACT_SPAN_WARNING =
  ' CAUTION: this page is flagged quote.embedded_extract — the neighbouring pages may not be by the '
  + 'same author as this one. Do not join text across them under a single attribution without '
  + 'reading where the extract begins and ends.';

/** The MCP tip: makes sure the flag is read rather than passed over. */
export const EMBEDDED_EXTRACT_TIP =
  'This page is, at least in part, an EXTRACT FROM ANOTHER SOURCE that the book itself announces '
  + '(quote.embedded_extract.announcement). The citation block names the book\'s author, who may '
  + 'not have written these words — follow quote.embedded_extract_note before attributing them.';

export interface EmbeddedExtract {
  /**
   * `announced_here`: the sentence announcing the extract is on this page, and
   * what follows it is the extract. `continues_from_earlier_page`: this page
   * opens inside a quotation that an earlier page announced and nothing since
   * has closed.
   */
  relation: 'announced_here' | 'continues_from_earlier_page';
  /** The announcing sentence, verbatim from the page it is printed on. */
  announcement: string;
  /** Scan page carrying the announcement. */
  announced_on_page: number;
  /**
   * A quotation mark or block quote opens straight after the announcement, so
   * the extract's extent could be followed. `false` on an announcement whose
   * extract is set as ordinary prose: flagged, but its end is unknown.
   */
  quotation_marked: boolean;
  /**
   * Only on `continues_from_earlier_page`: this page itself shows a quoted line
   * or a closing mark. `false` means the flag rests on the earlier page alone —
   * the quotation opened there and nothing has been seen to close it — which is
   * the weaker case: a closing mark lost in transcription looks the same.
   */
  quotation_marks_on_this_page?: boolean;
  /** The quotation is closed on this page: the following page is not flagged. */
  ends_on_this_page?: boolean;
}

/**
 * The announcement itself. Three shapes, each requiring BOTH "extract" and a
 * word that points forward — a page that merely uses the noun ("an extract of
 * gentian", "the above extract") announces nothing:
 *
 *   the following extract(s) / the following is an extract / the following
 *     passages are extracted
 *   from which the following …            (Taylor's p.45)
 *   we extract the following / shall extract …, as follows
 */
/** "…could not extract from him the day before, now on the following day…" (Cicero, in the sample). */
const NOT_A_DATE = String.raw`(?!\s+(?:day|night|morning|evening|week|month|year|season|sabbath)s?\b)`;

const ANNOUNCE = new RegExp(
  [
    String.raw`\bfollowing\b${NOT_A_DATE}[^.!?\n]{0,60}?\bextract(?:s|ed)?\b`,
    String.raw`\bfrom which\b[^.!?\n]{0,40}?\bfollowing\b${NOT_A_DATE}[^.!?\n]{0,40}?\b(?:extract(?:s|ed)?|passages?|quotations?|citations?)\b`,
    String.raw`\bextract(?:ed)?\b[^.!?\n]{0,40}?\bthe following\b${NOT_A_DATE}`,
  ].join('|'),
  'gi',
);

/**
 * "The following extract of gentian" is a preparation, not a quotation. An
 * extract OF something is kept only where the something is a text ("of a
 * letter", "of his journal").
 */
const SUBSTANCE = /\bextracts?\s+of\s+(?!an?\b|the\b|his\b|her\b|my\b|our\b|their\b|that\b|this\b|some\b|two\b|three\b|several\b)/i;

/** A period after one of these is an abbreviation, not the end of the sentence. */
const ABBREVIATION = /(?:\b(?:Mr|Mrs|Messrs|Dr|St|Rev|Hon|Esq|Prof|Sir|Bp|Vol|vol|lib|cap|ch|chap|No|pp?|ed|viz|i\.\s?e|e\.\s?g|[A-Z]))$/;

const OPEN_QUOTE = /^[\s>*_]*[“«„‘"'»]/;
const RUN_MARK = /^[\s>*_]*»/;
const CLOSE_QUOTE = /[”»"’'][\s*_)\]]*(?:<sup>[^<]{0,6}<\/sup>)?[\s*_]*$/;

/**
 * A line that opens with a quotation mark or sits in a block quote. Printers of
 * the period re-open the quotation at every paragraph (often every line) of a
 * long extract, so a page still inside one normally shows this.
 */
const QUOTED_LINE = /^[ \t]*(?:>|[“«„‘"»])/m;

const MAX_SENTENCE = 400;

/** The rule the transcription sets between the body of a page and its footnotes. */
const RULE = /^[-*_\s]+$/;

/**
 * Paragraphs of prose, with tag-only lines dropped: they open and close
 * nothing. A footnote rule is KEPT, as itself, because what follows it is a
 * different text from what precedes it.
 */
function paragraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter((p) => p && !/^(?:<[^>]+>[^<]*<\/[^>]+>\s*)+$/.test(p));
}

/** Widen a match to the sentence it sits in, without stopping at "Dr." or "Vol.". */
function sentenceAround(para: string, start: number, end: number): { sentence: string; end: number } {
  let s = start;
  while (s > 0) {
    const ch = para[s - 1];
    if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(para[s] ?? '') && !ABBREVIATION.test(para.slice(0, s - 1))) break;
    s--;
    if (start - s > MAX_SENTENCE) break;
  }
  let e = end;
  while (e < para.length) {
    const ch = para[e];
    if (ch === ':' || ch === '!' || ch === '?') { e++; break; }
    if (ch === '.' && !ABBREVIATION.test(para.slice(0, e)) && !/^\.\s?[a-z0-9,]/.test(para.slice(e, e + 3))) { e++; break; }
    e++;
    if (e - end > MAX_SENTENCE) break;
  }
  return { sentence: para.slice(s, e).replace(/\s+/g, ' ').replace(/^[>\s*_-]+/, '').trim(), end: e };
}

interface Announcement { sentence: string; /** Offset in the paragraph where the sentence ends. */ end: number }

function announcementsIn(para: string): Announcement[] {
  const out: Announcement[] = [];
  let lastEnd = -1;
  for (const m of para.matchAll(ANNOUNCE)) {
    if (m.index < lastEnd) continue; // same sentence matched twice
    const { sentence, end } = sentenceAround(para, m.index, m.index + m[0].length);
    if (SUBSTANCE.test(sentence)) continue;
    out.push({ sentence, end });
    lastEnd = end;
  }
  return out;
}

interface OpenExtract {
  announcement: string;
  announced_on_page: number;
  /**
   * `mark`: a quotation mark opened it, and a paragraph ending on a closing
   * mark closes it. `blockquote` and `run`: it has no closing mark — a block
   * quote, or the continental habit of a `»` before every quoted line (de
   * Groot) — and ends at the first paragraph set without one.
   */
  by: 'mark' | 'blockquote' | 'run';
  /**
   * Still on the announcing page, with no footnote rule crossed. There, a new
   * paragraph set WITHOUT a quotation mark is the author resuming — which is
   * how a short quotation whose closing mark the OCR dropped is stopped from
   * flagging the eight leaves after it (12 of 36 measured runs, before this).
   * It cannot be asked of later pages: Taylor's p.46 opens with a line of
   * Aristotle and resumes the extract unmarked, the rule between them lost.
   */
  sameBlock: boolean;
}

export interface PageText { page: number; text: string | null | undefined }

/**
 * Read `pages` (ascending, ending with the page being quoted) and say whether
 * the LAST one announces an extract or opens inside one. Returns null when
 * there is no evidence — the default must be silence, for the reason given at
 * the top of this file.
 */
export function embeddedExtract(pages: PageText[]): EmbeddedExtract | null {
  let open: OpenExtract | null = null;
  let verdict: EmbeddedExtract | null = null;

  pages.forEach((pg, i) => {
    const isTarget = i === pages.length - 1;
    // A gap in the run (an untranscribed leaf) breaks the chain: nothing can be
    // said about a quotation whose middle was never read.
    if (i > 0 && pg.page !== pages[i - 1].page + 1) open = null;
    if (!pg.text) { open = null; return; }

    if (isTarget && open) {
      const o: OpenExtract = open;
      verdict = {
        relation: 'continues_from_earlier_page',
        announcement: o.announcement,
        announced_on_page: o.announced_on_page,
        quotation_marked: true,
        quotation_marks_on_this_page: QUOTED_LINE.test(pg.text) || paragraphs(pg.text).some((p) => CLOSE_QUOTE.test(p)),
      };
    }

    if (open) (open as OpenExtract).sameBlock = false;
    const paras = paragraphs(pg.text);
    for (let k = 0; k < paras.length; k++) {
      const para = paras[k];
      if (RULE.test(para)) {
        if (open) (open as OpenExtract).sameBlock = false;
        continue;
      }

      if (open) {
        const o: OpenExtract = open;
        // A block quote with no marks of its own ends where the indentation does.
        if (o.by === 'blockquote' && !para.startsWith('>')) open = null;
        else if (o.by === 'run' && !RUN_MARK.test(para)) open = null;
        else if (o.by === 'mark' && o.sameBlock && !OPEN_QUOTE.test(para)) open = null;
        else if (CLOSE_QUOTE.test(para)) {
          open = null;
          if (isTarget && verdict?.relation === 'continues_from_earlier_page' && verdict.announced_on_page === o.announced_on_page) {
            verdict.ends_on_this_page = true;
          }
        }
      }

      const found = announcementsIn(para);
      if (found.length === 0) continue;
      const a = found[found.length - 1];
      const rest = para.slice(a.end);
      const next = RULE.test(paras[k + 1] ?? '') ? '' : paras[k + 1] ?? '';
      let by: OpenExtract['by'] | null = null;
      let closedAlready = false;
      if (rest.trim()) {
        // The quotation starts on the same line as the announcement.
        if (RUN_MARK.test(rest)) by = 'run';
        else if (OPEN_QUOTE.test(rest)) { by = 'mark'; closedAlready = CLOSE_QUOTE.test(rest); }
      } else if (RUN_MARK.test(next)) by = 'run';
      else if (OPEN_QUOTE.test(next)) by = 'mark';
      else if (next.startsWith('>')) by = 'blockquote';

      open = by && !closedAlready ? { announcement: a.sentence, announced_on_page: pg.page, by, sameBlock: true } : null;
      // An announcement on the page being quoted outranks a continuation from
      // an earlier one: it is the nearer evidence and it is on the leaf.
      if (isTarget) {
        verdict = {
          relation: 'announced_here',
          announcement: a.sentence,
          announced_on_page: pg.page,
          quotation_marked: by !== null,
          ...(by && closedAlready ? { ends_on_this_page: true } : {}),
        };
      }
    }
  });

  return verdict;
}

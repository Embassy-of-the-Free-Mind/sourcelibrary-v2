# Source Library severity rubric — PROPOSAL (not in use)

PRIOR ART: `scripts/lib/review-vocabulary.mjs` (KINDS: what the wrong text is; EXPOSURE), `.claude/docs/page-error-taxonomy.md`
(44 classes: where an error starts), the #6338 reviewer brief used by the weekly audit (`serious / moderate / minor`, defined in
prose per reader), `.claude/docs/quality-statements.md` (how a rate is stated). None of them defines severity by the
consequence for the reader, the same way for every store, with a span that a second reader can check. This proposes that.
Status: draft for Derek, 2026-11-12. Nothing reads it yet. To be tested on the calibration set (`CALIBRATION-SET-DESIGN.md`)
before any brief adopts it.

## Why a rubric

Four review stores grade severity four ways. `book_checks` records only "serious" findings; the weekly audit records three
tiers in each reader's own sense; the route judge records `misleads / wrong_text / cosmetic`. The free tests of
2026-11-12 (`scripts/eval/error-zoo/leakage-report-2026-11-12.md`) show:

- one Opus reader is self-consistent (κ 0.95 on 331 re-reads of identical packets), but we hold **no** independent second
  reading of the same text at scale, so nobody knows how much of "serious" is the page and how much is the reader;
- the reader's 1–5 translation score tracks its serious count (ρ −0.81) and its moderate count (−0.58), and its **minor count
  tracks nothing** (+0.11; and a minor count does not predict a serious finding on the re-read, AUC 0.43);
- serious OCR errors are far more predictable from the text (AUC 0.85 within the uniform frame) than "any serious" (0.76).

So: define severity by consequence, make every finding checkable, drop minors from every rate, and keep OCR and English apart.

## The unit and the order of reading

The unit is one **page as a reader sees it**: the scan, the transcription pane and the English pane as the reader renders them.
Tags the reader moves out of the text (`<summary>`, `<keywords>`, `<sig>`, `<page-num>`, `<header>`, `<vocab>`) and markers it
renders (`<leaf-break/>`, `<column-break/>`) are not errors in the reading text; judge them only if they leak visibly.

Read the scan first, then the transcription against the scan, then the English against the transcription and the scan.

## Step 1: mark spans (ESA-style)

Every finding is a span with these fields. A finding without a quote is not recorded.

| field | what |
|---|---|
| `pane` | `ocr` or `english` (or `page` for whole-page faults: wrong leaf, empty, catalogue) |
| `quote` | the served words, exactly as shown (≤ 200 characters) |
| `scan` | what the scan shows at that place, as you read it, or "nothing here" |
| `class` | taxonomy code (`page-error-taxonomy.md`) |
| `kind` | review-vocabulary KIND |
| `severity` | `critical`, `major` or `minor` (step 2) |
| `sure` | `sure` or `unsure`. An unsure critical goes to a second reader; it is never counted alone |

## Step 2: severity by consequence

Ask one question: **if a reader quoted or cited this page, what would they get wrong?**

### Critical: the reader would publish something the book does not say

- **Text not on this leaf.** Invented, recited from memory, another leaf's text, an illegible patch filled in fluently without
  a mark. (Kinds `confabulation`, `recitation`, `wrong_leaf`, `carry_over`, `show_through`, `illegible_fill`.)
- **Meaning reversed or its actor changed.** A negation lost or added; agent and patient swapped; "slower" became "warmer".
- **A name, number, date, dose, measure or citation changed.** In the transcription this is critical even when the character
  error rate is tiny: one wrong digit in a dose or one wrong letter in a printer's name is what a citer copies.
- **A line or more dropped silently** from either pane, or the English rendering a different text from the transcription.

Specimens from the zoo: "the virgins were fearing God" read as "for Christ's sake they went through death" (O1);
*tardiorem* (slower) read as *cardiozez* and translated "warmer" (O6 → T8); Agricola p.464, the English of another leaf
(T14); 342 printed, 142 transcribed (O7).

### Major: the reader is misled locally but can recover from context, or loses apparatus

- A wrong word sense or term that makes a sentence odd but not false; a qualifier weakened ("perhaps" → "often").
- A footnote, marginal note or gloss dropped or merged; a table's structure lost so cells no longer line up.
- Reading order broken inside a sentence or across columns.
- An added note or gloss that is wrong (T10), when it is clearly marked as a note.

### Minor: cosmetic, the words a reader would quote are right

Spelling normalised, an abbreviation expanded correctly, punctuation, a heading level, italics, a running head left in.
**Minors are recorded for the zoo but never counted in a rate or used as a training target.**

### Not an error

Tags the reader strips; an expansion marked as an expansion; a correct gloss; text genuinely illegible and marked `<unclear>`.

## Step 3: one overall page judgment

After marking spans, give the page one of: **usable** (no critical, at most one major), **use with care** (majors, no critical),
**not usable** (any critical). This is the ESA overall score in three bands; it lets a reader who disagrees with a span still
agree on the page.

## What gets counted

- The **page target** is the number of critical spans: 0, 1, 2+, separately for the transcription and the English.
- **Majors** are reported beside it, never pooled into it.
- For comparisons across routes, criticals per 1,000 words of the pane.
- If someone needs one MQM-style number: critical 25, major 5, minor 0 (not 1: minors carry no signal here), per 1,000 words.
  It is only comparable between runs that used this rubric.

## Trusting a label

A critical counts toward a published rate only when it is `sure` and has a quote, or when a second reader from another
model family (or a person) marked an overlapping span. The calibration set measures how often that happens.

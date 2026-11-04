---
stage: ocr
measure: [judged, judged_vs_reference]
languages: [sa, zh]
scripts: [Deva, Hant]
canons: []
n_books: 60
n_pages: 60
verdict: "Pre-registration only: nothing judged when this was committed. Results go in a separate entry."
status: informational
decision: "none yet — the design for calibrating the judges' severity labels on agy Flash-low Sanskrit print and Chinese true print (#7263)"
feeds: judge
superseded_by: null
issue: [7263, 6740, 7991, 7568, 7243]
router_evidence: "none — a pre-registration; the results entry says which router-table cells it informs"
defect_rates: "none — nothing judged yet"
---
## 2026-11-04 · Pre-registration: how much of "misleading" is a real sense error? (#7263)

PRIOR ART: `scripts/eval/route-judge-6740/judge.mjs` (the route judge: `judgePrompt`, `parseVerdict`, `opusCall`,
the wrong-page control rule, imported unchanged). `scripts/eval/flash-reread-5924/T-TASK.md` (Step T, the
misleading/flawed/sound scale of #7568's re-read rows, used verbatim). `scripts/eval/sa-gr-served-7991/` (draw shape,
sense errors per 1,000 words, the book-cluster bootstrap, `kindOf()` error kinds; its second reader saw the first
severity, which this one does not). `scripts/eval/judge-cal-7866bar-7263/meaning.mjs` (the crop-to-the-span
adjudication, adapted to vertical Chinese columns). `scripts/batch/zh-print-correct-7263/frame.mjs` on #8067's
branch (the Chinese true-print frame, Siku excluded). `scripts/eval/sanskrit-gex45-7243/` (its model references).

**Who reads this.** Derek, and whoever sets the floor for "agy is unacceptable here". **The decision it changes:**
whether the router rows that call agy Flash-low bad at Sanskrit (125/250 misleading, #7568) and Chinese print (37/71
in 3 books) count as agy failures, and which severity label can be trusted. n = 30 books a language is a
calibration of the labels, **not** a route decision.

### Frames (read-only on Mongo; `scripts/eval/severity-cal-7263/draw.mjs`, seed 72630)
- **Sanskrit printed Devanagari.** Live books (`visible`, `pages_count > 0`), `language` /^Sanskrit/, catalogue form
  not handwritten (`book_class.class`). A page is eligible when it is served (`isVisiblePage`), passes #7866's
  `eligiblePage()` (text, not plate/blank/front matter, has an image), has ≥ 40 words of OCR, is not tagged
  handwritten or mixed (`scriptClass`), is not human-edited, and ≥ 80% of its letters are Devanagari.
- **Chinese true print.** The #8067 frame (`frame.mjs` over `frame-all.json`, Siku excluded by `isSiku`), pages in
  state `owed` (a Gemini read, not human-edited, reading text, ≥ 30 Han, not handwritten or mixed). At draw time each
  page is re-read from Mongo; a page whose OCR is no longer a Gemini read (the running `zh-print-bulk-7263` job may
  have written a correction) is not eligible.
- **Draw.** Books uniformly at random without replacement (seeded keys), 30 a language; one page uniformly from the
  book's eligible pages. A book with no eligible page is logged and the next key taken. No hand picking. The frame
  size and every exclusion (by reason, books and pages) are reported.

### Texts on each page
- **S, stored:** `ocr.data` as stored when drawn (frozen in the sample, hash kept).
- **F, fresh:** agy `gemini-3.8-flash-low`, 1 page a call, the live OCR prompt (`scripts/batch/cli-ocr.mjs read`,
  through the keep-read path: no `--fresh`, `CANDIDATE_READS` on).
- A read that exits non-zero, comes back empty, is a refusal, a repetition loop, or is cut by Gemini's filter (the
  reply wrapper is cut before its end marker) is **counted apart** and not judged as a misread.

### Judges (Opus 5.5 through `claude -p`, image in the workspace, blind to S/F and the engine)
1. **Route judge, sitting 1** (`judgePrompt` task `ocr`): every S and F text, one call each. Plus the wrong-page
   controls of `judge.mjs packet`: per language × text, 2 items (this page's image, another book's text). A text
   whose controls are not both rejected at fidelity ≤ 2 is reported as a failed control.
2. **Step T** (T-TASK.md verbatim, one page a call): X/Y/Z are S, F and a wrong-page text (another book's stored read
   in the same language), in a seeded order. The wrong-page arm is the Step T control (expected `misleading` and
   `not_this_leaf`). This gives the first measured cross-table of Step T verdicts against route-judge accept/severity.
3. **Route judge, sitting 2:** the same items and controls again, fresh calls, a different seeded order, after
   sitting 1 is complete. Test–retest on accept and on severity.

### Second reader (a fresh Opus, image open, never shown a severity)
- **Serious spans.** Every `misleads` or `wrong_text` defect from either sitting, deduplicated by quote within an
  item. One call per item; for each span the reader gets the full page and a crop around the span (a horizontal band
  for Devanagari; a vertical band for vertical Chinese columns; the whole page when the span cannot be placed). It is
  told only the quoted span and what the first reader said is wrong, with no severity, and answers two questions:
  `different` (does the text differ from what the page prints there: yes / no / cannot_tell, with what the page
  prints) and `changes_sense` (does the difference change what the sentence says: yes / no).
  A serious call is **upheld** when both are yes.
- **Misses.** 10 seeded items a language among those accepted in sitting 1 with no serious defect: the reader looks
  for any place where the text says something the page does not (wrong word, number, name, negation; a dropped or
  added line). What it finds, and the first reader did not flag as serious, is a miss.

### References
- **Chinese:** Kanripo, through `paddle-table-6388/align.mjs`, where the page aligns. On true print that is another
  edition (Wenyuange), so it is used to check spans (does the flagged span differ from it) and for CER, not as a human
  baseline. The translation test is NOT used on Classical Chinese (#7263's calibration: same-reference noise 12.6 per
  1,000 against 11.2).
- **Sanskrit:** #7243 used model references (two Opus reads + adjudicator, R1–R2 CER 0.30% on print), not typed
  text; only 4 BORI pages matched GRETIL. No served Sanskrit book in the frame has a typed reference. A **reference
  arm**: 20 seeded pages of #7243's 30 print pages, its pass-1 agy Flash-low read (F, its `arms/F.jsonl`) and its
  frozen reference. The route judge reads F (serious spans checked against the reference: present in it = false
  alarm) and reads the reference itself (the floor: flags on a near-clean text). Characters (CER, #7243's `deva-n@1`
  normaliser) are reported for F against the reference.
- `meaning.mjs` on Sanskrit: only if its A-vs-A floor is usable; with no typed reference in the frame it is not run.
  Everything without a reference is named in the results.

### Outputs (per language × text)
Sense errors per 1,000 words (Han characters for Chinese) with a book-cluster bootstrap interval, before and after
the second reader; share of first-reader serious calls upheld; test–retest agreement on accept (κ and raw) and on
the page's worst severity; the Step T × route-judge cross-table (cells that do not map are reported, not forced);
misses on accepted pages; error kinds (`kindOf`); words per serious error in plain terms; 3–5 opened examples per
severity; the pages where F beats S (by both judges), for a lane to apply later.

### Limits
At most 500 Opus calls in total (planned ≈ 128 + 60 + 128 + ≤ 100 + 20 + 40); the route judge's pace guard
(`claudeBlocked`, weekly 85%, session 95%) stops any stage. If the second reader's items would pass the cap, the
reference arm is cut first, then the miss sample to 5 a language. agy only for reads; no Gemini judge on
transcriptions; no paid API. No writes to pages, books, rules.json, current.json or lane_judge_verdicts.

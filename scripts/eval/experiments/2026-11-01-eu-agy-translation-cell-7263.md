---
stage: translation
measure: [judged]
languages: [la, de, it, fr]
scripts: [Latn]
canons: []
n_books: 113
n_pages: 113
verdict: "On 113 untranslated pages (one per book; Latin 30, German 30, Italian 23 = the whole frame, French 30), agy Gemini 3.8 Flash-low at 4 pages a call was accepted more often than the Flash-Lite chained lane on the same pages in all four languages (Latin 16/30 vs 11/30, German 22/30 vs 20/30, Italian 17/23 vs 13/23, French 20/30 vs 17/30), with fewer wrong-text pages (12, 5, 4, 6 vs 14, 9, 8, 10). Neither route reaches 80% accepted, let alone the 90% absolute bar: every print cell is NEEDS-ENGINE."
status: informational
decision: "No routing row. The router (rules.json as of #7892: absolute bar 0.9, priced loss) gives NEEDS-ENGINE on latin/german/italian/french-tr-first/print; the rule before (#7888 margins) gives HOLD -> agy-flash-low@4. The retired switch margin (within 0.08, wrong text +0.04) would pass all four. 75 drawn pages got the accepted agy English (run cli-translate-20261101234912)."
superseded_by: null
issue: [7263]
router_evidence: [latin-tr-first, german-tr-first, italian-tr-first, french-tr-first]
defect_rates: "none — judged with the route-judge translation prompt (accept, wrong text, classes); not run through defect-rate.py"
---
## 2026-11-01 · European first translation: agy Flash-low at 4 a call against the Flash-Lite lane (#7263)

PRIOR ART:
- `scripts/eval/router-confirm/confirm.mjs` (#7263 V4): the stage layout, the read-only Mongo preload for readers, the paired verdict. It runs OCR routes only.
- `scripts/eval/route-judge-6740/judge.mjs`: `judgePrompt` (translation form) and `parseVerdict`, imported unchanged.
- The Tibetan translation router test (`2026-10-27-tibetan-translation-router-agy4-vs-opus10-6948.md`): the same design, run on a diagnostic set.
- `scripts/lib/translate-batch-chained.mjs` `buildRoundRequest` and translate-core `parseBlockTranslations`: arm R sends the Flash-Lite lane's own request and uses its own parse.

**Who it is for.** About 118K untranslated pages wait in visible Latin, German, Italian and French books whose OCR is done (rung `transcribed` / `translating`). The routing table sends them to the `default` row, Flash-Lite on the paid Batch API. No cell had measured agy, the free subscription reader, on them.

### Design

- **Frame** (`run.mjs plan`, seed 72631101). Per language (the book's FIRST language label):
  - visible books with pages, `translation_state.rung` transcribed or translating;
  - no pipeline hold except `scans-only-publish-*` (a publication hold, not a containment), and not loop-quarantined;
  - one page uniform among the book's untranslated, translatable pages (`cli-translate-lane.mjs` UNTRANSLATED) that have 200+ characters of OCR, sit between 15% and 95% of the book, and have an image that loads.
- **Frame sizes.** Latin 260 books / 53,390 pages waiting, German 352 / 44,126, Italian 28 / 7,484, French 43 / 13,483.
  - Italian has only 23 books with such a page, so it has 23 pages. No second pages were drawn.
- **Script.** 106 of 113 pages are print or mixed (mixed counts as print). The manuscript and unknown cells have 1–6 pages: UNTESTED in effect.
- **Stored OCR under the pages.** Mostly Flash-Lite (Latin 29/30, German 17/30 with 12 on 3 Flash, French 27/30). Nothing was corrected first.
- **Arms, on the same page, each reading it as the FIRST page of a block of the book's following untranslated pages, as its lane would.**
  - **A** `agy-flash-low@4`:
    - `claude-translate.mjs --cli=agy --per-call=4 --fresh`, pool `/root/.agy-james` (Gemini weekly 26% left at the start);
    - then a dry run of `cli-translate.mjs apply` (markers, chatter, the `<<<END>>>` cut).
  - **R** `flash-lite`:
    - the chained lane's block request (`buildRoundRequest`, up to 8 pages / 20K characters), sent synchronously to `gemini-3.1-flash-lite` through `gemini-script-client`;
    - the lane's parse, echo-shift and drift guards, then its single-page fallback once.
    - Deviation: `temperature 0` (the script client's default); the lane sends the model default through Batch.
  - **Both arms**: the text then goes through translate-core's door (`writePageTranslation`, `refuseUnhealthy`) against a database proxy that drops every write.
  - A page an arm would not write is not accepted.
  - Prompt: translation v21 (the default) in both arms.
- **Judge.** Opus via `claude -p`, sealed, Read only.
  - Inputs: the page image and the stored OCR, `judgePrompt` translation form, blind to the arm. Identical texts were judged once.
  - 233 calls. Every stream-json transcript shows `./page.jpg` opened (233/233).
  - Wrong-page controls: 2 per language (one page's English against another page's image), all 8 rejected (fidelity 1).

### Results

| cell (print + mixed + other) | n | A agy@4 accepted [95%] | R Flash-Lite accepted [95%] | wrong text A / R | paired d [95% boot] | gained / lost |
|---|---|---|---|---|---|---|
| Latin | 30 | **16/30** [0.36, 0.70] | 11/30 [0.22, 0.55] | 12 / 14 | +0.17 [0, +0.33] | 6 / 1 |
| German | 30 | **22/30** [0.56, 0.86] | 20/30 [0.49, 0.81] | 5 / 9 | +0.07 [−0.10, +0.23] | 4 / 2 |
| Italian | 23 | **17/23** [0.54, 0.88] | 13/23 [0.37, 0.74] | 4 / 8 | +0.17 [0, +0.39] | 5 / 1 |
| French | 30 | **20/30** [0.49, 0.81] | 17/30 [0.39, 0.73] | 6 / 10 | +0.10 [−0.07, +0.27] | 5 / 2 |

- **Written.** agy wrote 112/113 drawn pages; apply refused one, which copied English printed on the page. Flash-Lite wrote 113/113: 98 from the block, 5 through the single-page fallback after a short or drifted block, and 10 single pages to start with.
- **Where the wrong text comes from**, after the Siku study's OCR-CARRIED vs WRONG-SENSE split:
  - **Rule.** A page counts as OCR-carried when every wrong-text defect on it carries an O/I class (the English follows a misread transcription). It counts as the translator's when any is T/E.
  - **Per language** (A: OCR-carried / translator's; R the same):

    | language | A | R |
    |---|---|---|
    | Latin | 1 / 11 | 7 / 7 |
    | German | 3 / 2 | 3 / 6 |
    | Italian | 0 / 4 | 2 / 6 |
    | French | 5 / 1 | 2 / 8 |

  - **Totals.** Translator-made wrong text: **18 pages for agy, 27 for Flash-Lite**.
  - **Latin agy**: T9 (silent omission, 4 pages) and T7 (fluent English over a garbled source, 4).
  - The stored OCR was not judged on its own. The split is from the class codes the translation judge gave.
- **Cost.**
  - agy: 128 calls for 415 pages, 0.31 calls a page; the table's `agy-text@4` stage says 0.267, measured on Tibetan.
  - Flash-Lite: 118 calls for 727 pages, $0.669 at the synchronous list price, so about $0.00046 a page at Batch.
  - Opus: 233 judge calls on the box account's subscription.

### The router's decision (build `2026-11-01-eu-translate-7263`; `current.json` not moved)

New cells `latin-tr-first`, `german-tr-first`, `italian-tr-first` and `french-tr-first`:
- routes `flash-lite` (current; new stage `lite-text`) and `agy-flash-low@4` (stage `agy-text@4`), paired;
- evidence `evidence/eu-agy-translate-7263.score.json`, and the by-script file of the same name;
- each cell carries its own measured `script_share` (`build.py` now reads it where `waiting-split.mjs` never ran).

| cell | pages waiting | rule in force (#7892) | rule before (#7888 margins) |
|---|---|---|---|
| latin-tr-first/print | 50,523 | NEEDS-ENGINE (engine), names flash-lite* | HOLD → agy-flash-low@4 |
| german-tr-first/print | 41,964 | NEEDS-ENGINE (engine) → agy-flash-low@4 | HOLD → agy-flash-low@4 |
| italian-tr-first/print | 4,706 | NEEDS-ENGINE (engine) → agy-flash-low@4 | HOLD → agy-flash-low@4 |
| french-tr-first/print | 12,781 | NEEDS-ENGINE (engine) → agy-flash-low@4 | HOLD → agy-flash-low@4 |
| manuscript / unknown variants | — | HOLD (< 10 pages a route) or UNTESTED | same |

\* `needs_engine` names the route with the highest P(acc ≥ 0.9). In Latin both routes round to 0.00, and the tie goes to the first route listed. agy's posterior mean is higher (0.55 against 0.39).

- **The brief's bar** (within 0.08, wrong text ≤ +0.04 of the current route) passes in all four cells.
  - In German only on the point estimate: the lower bound of d is −0.10.
  - The dispatcher's note of 2026-11-01 23:46Z retired that bar. The router's rule is binding, so **no `channel: "cli"` row is proposed**.
- **What the result does say.** Where these pages are translated, agy at 4 a call is no worse than the Flash-Lite lane and probably better (gained 20, lost 6 over the four cells). It writes fewer wrong-text pages and it is free.
- **What it does not say.** Either route serves these readers well. A reader of the Latin cell gets wrong text on 40% of agy's pages and 47% of Flash-Lite's. Both are far from the 90% bar.
- **Where the engine is missing.** For Latin, both: the stored Flash-Lite OCR (latin-lite/print: lite 17/30 against the image), and the translator's omissions. For German, Italian and French, mostly the translator.

### Pages written

- **Run.** `cli-translate-20261101234912`, written through `cli-translate.mjs apply --apply`.
- **75 pages:** every drawn page whose agy English the judge accepted.
  - On 6 of them Flash-Lite was also accepted, at higher fidelity. agy's was written anyway, because the brief's writer takes CLI reads only.
- **6 pages accepted only for Flash-Lite are not written.** Their lane can still translate them.
- Undo: `scripts/maintenance/revert-run.mjs --run-id cli-translate-20261101234912`.

### Found by eye (image open)

- **`69bda0d7f6d63c919748b44a` p.849** (Traité historique et dogmatique sur les apparitions, printed p.376).
  - The leaf ends at "l'Histoire Ec-". The stored Flash-Lite OCR adds a second column, "Eccléfiaftique … Maxence … nette, &", and a footnote. Both are rebuilt from the clipped edge of p.377 at the side of the scan: invented text in the transcription.
  - Both arms translated it and both were rejected, so no English was written.
  - The book is already held (`scans-only-publish-7270`), so no lane will translate it.
- **`6a08f4e750bd891addfb776e` p.659** (Vita di Benvenuto Cellini).
  - The image is printed p.320. The stored OCR (IA djvu) is p.327, which fits its neighbours (p.658 = 326, p.660 = 328). The image sits one place wrong in the page sequence (I1), but the text is the right text for the sequence.
  - Both arms rejected; nothing written.

### Not checked

- One judge family (Opus). The judge's sensitivity on translation is unmeasured (#7880 covers OCR).
- No Opus translation arm. Derek, 2026-10-28: Opus is the bar, never a candidate.
- Pages with English already, and the existing `german-tr-flash3` / `german-tr-lite` cells (which hold re-translation of served English), are a different frame. agy@4 was not added there.
- No V4 confirmation run: there is no switch to confirm.

Artifacts: `scripts/eval/eu-agy-translate-7263/` (`run.mjs`; `results/score.json` with per-page verdicts, `plan.json`, `verdicts.jsonl.gz`, `waiting.json`, the write list and apply log). Reads, prompts, images and judge transcripts are in the job's scratch directory (archived to R2).

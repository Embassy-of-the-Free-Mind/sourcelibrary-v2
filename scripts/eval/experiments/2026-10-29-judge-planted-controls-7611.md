---
stage: ocr
measure: [judged]
languages: [la, de, fr]
scripts: [Latn]
canons: []
n_books: 36
n_pages: 36
verdict: "PREREGISTERED, not yet judged."
status: informational
decision: "Pending the run."
superseded_by: null
issue: [7611]
router_evidence: []
---
## 2026-10-29 · Does the router's Opus judge catch subtle wrong text on Latin, German and French print? (#7611)

PRIOR ART:
- `scripts/eval/route-judge-6740/judge.mjs`: the judge being tested. Its `judgePrompt`, `opusCall` and `parseVerdict` are imported unchanged. Its own planted controls are Tibetan only (`tib-kangyur`: catch < 0.80 hands the cell to Derge).
- `scripts/eval/pro-translate-6545/plant.mjs`: #6545's planter, the last broad measurement (Opus caught 43/46). It works on English translations only, so it cannot be used on a transcription. The new planter is `scripts/eval/lib/plant-ocr-errors.mjs`.
- `scripts/eval/lane-judge-sampler.mjs`: the store this frame is drawn from. Its only standing control is the wrong-page control (another book's text against this image), which tests gross failure.

**Why.** The router's k/n for Latin, German and French print all come from one Opus judge. Subtle wrong text is the failure that matters, and page metrics hide it. Derek asked (2026-10-29): "can we test the test?"

### Preregistration (committed before any judge call)

**Frame.** Pages that the judge ACCEPTED, with the exact text it accepted:
- `lane_judge_verdicts`: kinds item and draft, print, cells german-lite, french-lite, latin-lite and latin-gpu-7263. The record's `text_hash` is re-checked against the text.
- The router tests of 2026-10-26: the stored `lite` drafts of fr-lite and de-lite. These count only if the page's OCR is older than the verdict.

One page is taken per book. Books are taken in a seeded order (seed 7611), and from each book the first page where every variant B to E finds a site. A page is skipped when its body is not in the cell's language: the latin-gpu cell holds e-rara licence leaves in German, French and Italian. The frame has 12 pages per language, 36 pages in all (frame.json gives the counts tried and skipped).

**Variants.** There are five per page. Each is a separate blind judge call, so the judge never sees the variant or a sibling. The plants go in body text only, never in markup, headers, the first or last printed line, or footnotes. They are kept grammatical.
- **A:** unchanged.
- **B:** one number changed: a numeral (1596 → 1591), a number word (duabus → tribus, zwey → drey, quatre → six), or a Roman numeral (XVIII → XX).
- **C:** one content noun swapped for a noun of the same inflection class that is not on the page (pietatem → humiditatem, Erfahrung → Wirckung, occupation → préparation).
- **D:** one printed line dropped from the middle. Where the text is set as paragraphs, one whole sentence is dropped instead.
- **E:** one invented sentence inserted at a sentence boundary, in the page's language and register (an early-modern bank for old spelling, with ſ where the page uses it).

Each plant is recorded in plants.json as page, variant, line, offset, before → after.

**Score.** A plant is *caught* if the verdict is not accepted, OR if a defect names the plant: the quote holds the planted word or number (B, C), shares three words with the inserted sentence (E), or reports an omission (D: class O5 or "missing" in the note). The named rate is reported apart. Each language × variant cell is reported as k/n with a Wilson 95% interval. For A, the re-accept rate is reported.

**Bar (the same as Tibetan's).** A language passes if its catch rate on B to E pooled (n = 48) is at least **0.80**. Below that, the router table flags the language's k/n from this judge as *judge-unvalidated*. A's re-accept rate is the false-alarm baseline: if A is rejected at rate r, then roughly r of any "catch" is the judge rejecting the page for other reasons. It is reported beside the catch rate, and the bar is not adjusted for it.

**Known bias, declared.** Variant B needs a number in the body, and about a third of accepted pages have none. The frame is therefore pages with a number. German needed 33 books to fill 12 pages.

**Budget.** 180 calls at 0.0124 points a call, about 2.2 Claude points. The run stops if this login's weekly meter reaches 92% (it read 88% at the start).

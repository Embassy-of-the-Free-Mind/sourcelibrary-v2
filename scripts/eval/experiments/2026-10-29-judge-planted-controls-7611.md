---
stage: ocr
measure: [judged]
languages: [la, de, fr]
scripts: [Latn]
canons: []
n_books: 36
n_pages: 36
verdict: "The router's Opus judge passes the 0.80 bar on all three languages. On pages it had accepted, it caught 47/48 planted errors in French (0.98, Wilson 95% 0.89-1.00) and 48/48 in both Latin and German (1.00, 0.93-1.00). It named the planted span in 35/36 for E (inserted sentence) and 36/36 for each of B (number), C (noun) and D (line dropped), quoting the dropped line verbatim in every D case. The one miss was an inserted French sentence ('Il faut y prendre garde avec soin.'), accepted at fidelity 5. It re-accepted the unchanged text on 35/36 pages (German 11/12). No cell is flagged judge-unvalidated."
status: informational
decision: "The router k/n from this judge stand for Latin, German and French print. A standing planted control now runs in lane-judge-sampler.mjs (2 per cell x route per ISO week, rotating B-E). A route whose rolling catch rate falls below 0.80 (from 8 plants in 56 days) leaves the evidence."
superseded_by: null
issue: [7611]
router_evidence: [latin-lite, latin-gpu-7263, german-lite, french-lite]
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

### Results (judged 2026-10-29, after the preregistration above was pushed in PR #7719)

**Judge and cost.** 180 calls to `claude-opus-5-5` (`claude -p`, gex45 subscription), 4 in parallel, with the image attached. All 180 parsed. The weekly meter stayed at 88% (an integer reading). The 5-hour meter went from 9% to 13%. The list-price equivalent was $11.25 (not billed). Artifacts are in `scripts/eval/judge-planted-7611/results/2026-10-29/`: frame, plants, items, texts, verdicts and score.

**Catch rate.** A plant is caught if the verdict was not accepted or the plant was named. Each cell gives k/n, the rate, and a Wilson 95% interval; n = 12 per cell.

| language | A: re-accepted | B number | C noun | D line dropped | E sentence inserted | **B to E pooled** | bar 0.80 |
|---|---|---|---|---|---|---|---|
| Latin | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 | **48/48 = 1.00 [0.93, 1.00]** | pass |
| German | 11/12 | 12/12 | 12/12 | 12/12 | 12/12 | **48/48 = 1.00 [0.93, 1.00]** | pass |
| French | 12/12 | 12/12 | 12/12 | 12/12 | 11/12 | **47/48 = 0.98 [0.89, 1.00]** | pass |
| all | 35/36 = 0.97 [0.86, 1.00] | 36/36 | 36/36 | 36/36 | 35/36 | 143/144 | |

The single-cell intervals at 12/12 are [0.76, 1.00].

**Named, not just rejected.** The stricter count is whether a defect quoted the plant. B, C and D were named on 36/36 each, and E on 34/36. Every D verdict named the dropped line or sentence verbatim, as "a whole line is missing: '…'". So the catch does not ride on rejections for other reasons. The one German E that was caught without being named was rejected on other grounds (the same page's A was also rejected).

**The miss.** On French `69bd935f2d11455793b3f121` (a 19th-century essay on the cult of Mithra, set in paragraphs), the judge accepted the inserted sentence "Il faut y prendre garde avec soin." at fidelity 5, with no defect.

**What this does and does not show.**
- **It shows** the judge reads the leaf: a changed number, a swapped noun, a dropped line or an invented sentence is found and quoted, on 143 of 144 plants.
- **It does not show** that the judge catches a model's *own* subtle misreads (letter-level confusions, a normalised spelling, a dropped abbreviation mark). Those are less salient than a plant, and the A re-accept rate (35/36) says nothing about them.
- The plants are single errors on clean pages. A page with five real errors has its own dynamics.
- The frame is pages with a number in the body (declared above).

**Standing control.** `lane-judge-sampler.mjs` now plants K = 2 errors per cell × route per ISO week (`--planted=K`). It uses pages the judge accepted that still hold that text. The kind rotates B → C → D → E and is held across pages: a page with no number does not skip B.
- The catch rate is written to score.json (`controls[route].planted`, and `judge_planted` on every route block).
- build.py prints it next to k/n ("judge caught k/n planted").
- A route whose catch rate over the last 56 days is below 0.80, counted once it has 8 plants, is listed under `routes_not_counted` as judge-unvalidated, as a failed wrong-page control already is.
- At 2 per week per route, the 8-plant floor is reached in about 4 weeks.

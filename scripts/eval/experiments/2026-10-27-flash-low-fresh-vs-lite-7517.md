---
stage: ocr
measure: [judged]
languages: [de, fr, la]
scripts: [Latn]
canons: []
n_books: 60
n_pages: 60
verdict: "A fresh 3.8 Flash-low read does not pass the router rule on German (16/30 accepted, 12/30 cut by Gemini's filter) or French (23/30, 5/30 cut); Latin was not measured (the second account's weekly quota ran out after 86 calls). lite>agy-flash-low stays the best route on both measured cells (28/30, 27/29, router tests 2026-10-26)."
status: rejected
decision: "No fresh-read lane is built. Flash-Lite Batch stays the draft reader. The second agy account read 89 pages for 96% of its week: on that pool no Flash-low lane can carry Batch's ~30K pages a week."
superseded_by: null
issue: [7517, 6740]
---
PRIOR ART: `scripts/eval/route-judge-6740/results/router-tests-2026-10-26/` — the de-lite and fr-lite cells, the
same 30 pages each, with their lite and lite>agy-flash-low verdicts (reused, not re-judged).
`scripts/eval/estimator/router-table/2026-10-26b.md` — the table and its router rule.

## 2026-10-27 · Can a fresh 3.8 Flash-low read replace Flash-Lite Batch? (#7517)

Derek, 2026-10-27: "we basically want to replace the use of gemini 3.1 flash lite batch". The second Google login
(`AGY_HOME=/root/.agy-james`, PR #7514, held to `gemini-3.8-flash-low`) was to read in Batch's place. Flash-low had
been measured only as a corrector of a lite draft on these cells, never as a reader of the image alone.

**Design.** `scripts/eval/route-judge-6740/judge.mjs` gains a fresh-read route (`FRESH`, `agy-flash-low`): the page
image on the live OCR prompt (`cli-ocr.mjs read`, its prompt, sentinels and guards, `--fresh`, `CANDIDATE_READS=off`),
no draft. Every call went through `AGY_HOME=/root/.agy-james`.
- **de-lite, fr-lite:** the router tests' own 30 pages per cell (`draw --from=… --routes=lite,agy-flash-low`), one
  page per book. The lite verdicts are the stored ones, copied by id (`judge --reuse`); lite>agy-flash-low is the
  stored row on the same pages.
- **latin-lite (new):** the router test draw rule (visible Latin books not held, stored lite OCR, interior, >= 300
  chars, one page per book, salt `rt-latin-lite`), with lite, lite>agy-flash-low and the fresh read. The table's
  Latin cell is the pilot's 30 pages in 9 books, so a new draw was needed.
- Judge: Opus through `claude -p`, the route-judge prompt, each output against the page image, blind to the route,
  with wrong-page controls (both passed on every judged route).
- Rule (`fresh-gate-7517.mjs`): `rules.json`'s router gate, P(acc >= acc_best - 0.05) >= 0.9 and wrong text <= the
  best route's rate + 2%, over lite, lite>agy-flash-low, the fresh read and `fresh|lite` (the fresh read where
  delivered, the lite draft where not: what a lane that hands cut pages back to Batch would serve). Flat
  Beta(1, 1) priors. **A read that Gemini cut or that failed counts as not accepted**, because it is never written.

**Result** (`results/fresh-7517-2026-10-27/fresh-gate.json`, `score.json`):

| cell | route | accepted | wrong text | P(within 0.05 of best) | verdict |
|---|---|---|---|---|---|
| German | lite | 21/30 | 5/30 | 0.04 | fail |
| | lite>agy-flash-low (stored) | **28/30** | 2/30 | best | pass |
| | fresh Flash-low | 16/30 (18 delivered) | 1/30 | 0.00 | **fail** |
| | fresh, lite where cut | 24/30 | 3/30 | 0.19 | fail |
| French | lite | 22/30 | 6/30 | 0.08 | fail |
| | lite>agy-flash-low (stored) | **27/29** | 2/29 | best | pass |
| | fresh Flash-low | 23/30 (25 delivered) | 2/30 | 0.12 | **fail** |
| | fresh, lite where cut | 26/30 | 3/30 | 0.46 | fail |
| Latin | all | not measured | | | the account's quota ran out (below) |

- **Gemini's filter is the failure, not the reading.** 12 of 30 German and 5 of 30 French fresh replies stop
  mid-page with "This request was blocked by Gemini's filters…" (`reply cut before <<<END>>>`, after the one re-read
  cli-ocr.mjs makes). On the pages it delivered, the fresh read beat lite: German 16/18 against lite's 13/18 accepted
  (wrong text 1 against 3), French 23/25 against 19/25 (2 against 5). The corrector route, which gets the lite draft in
  its prompt, was cut on none of these 60 pages in the 2026-10-26 run (one French answer was CONTAIN, below).
- **A filter leak got past the wrapper guard.** French p.386 (printed 359): the reply came back whole, but
  "absous.Filters Ajoûtons" holds a stray word from the filter message. The judge tagged it wrong text. Neither
  `unwrapRead` nor the chatter guard catches it.

**By eye** (this session, image opened beside the read, 3 pages per measured cell):
- German p.18 of *Posaune der…* (6a26ceaf…): the frame carries a strip of the facing leaf, and the fresh read
  transcribed its cut-off line starts as `<margin>`. The judge's I4 holds (lite also failed this page).
- German, Bock herbal, "Von der kreütter vnderscheid" (6958dfb4…): a clean 16th-century leaf. The read stops after
  "Erstlich im hal" with the filter message. A refusal on an ordinary public-domain page.
- German p.107, Greek alphabet history (69aea5c3…): the read matches the leaf, Greek with lunate sigma included
  (accepted; lite was not).
- French p.359 (6a4ad95e…): matches line by line except the inserted "Filters" after "absous.".
- French p.351 (69f8c135…): a faint but legible page of text and footnotes; Flash-low answered `<page-type>blank`
  with a show-through warning. The judge's O18 (page left empty) holds.
- French p.544, *Le roman de Léonard de Vinci* (69af4a49…): the first two paragraphs match word for word
  (accepted, fidelity 5; lite 1).

**Contained in this run** (containment-on-finding.md). French p.554 / printed 544 (book 69af4a49…9792, *Христос и
Антихрист т. 2*, visible, `complete`) serves lite OCR headed and worded as printed 541 under the image of 544. Seen by
eye above, and the 2026-10-26 corrector answered CONTAIN for the same reason. The book is held
(`wrong-leaf-text-7517`) and that page's English is withheld (`withhold-stale-translations.mjs --by-eye-pages=554`).
The repair (re-read or re-pair against the image) is still owed.

**What the quota measured.** At 09:31Z `agy /quota` on the second account read 97% of the Gemini week left (the
window opened 09:24Z). After this test's 86 calls (09:32–09:44Z, 89 conversations counting re-reads), the next call
got `RESOURCE_EXHAUSTED … Resets in 167h40m`, and `/quota` read **0.6%**, resetting 2026-11-03T09:24:51Z. That is
about 1.1% of the week per page. #7498 measured the main pool at 9.6e-6 of a week per Flash-low call (~104K a
week), a thousand times cheaper. No other caller used the account on this box (agy-calls.jsonl), and boxes cannot see
each other's calls. The account's tier is the first suspect.

**Tokens per page** (Derek's inbox, 2026-10-27T09:44Z: does thinking matter?). cli-ocr.mjs did not record agy's usage
envelope (it does from this PR on). The counts below come from agy's own conversation store on the account
(`~/.gemini/antigravity-cli/conversations/*.db`, `gen_metadata` protobuf, decoded without a schema:
`results/fresh-7517-2026-10-27/agy-usage-decoded.jsonl.gz`). Field 2 is read as input tokens and field 3 as output;
the labels are inferred, not documented. Over 89 calls:
- **3 model turns per call** (median and p90). The image is already attached (`@./page.jpg`), but the model opens it
  again with `view_file` (allowed by the tool gate), and each turn re-sends the whole context.
- Input per call: median **34,290** tokens, p90 37,918 (first turn alone: ~10,900). Output: median **553**, p90 1,059.
- No thinking count shows in 263 of 265 turns. Two turns carry an unlabelled ~4,650 in field 5, and every turn carries
  24 in field 6. On this decoding, thinking is not where the quota goes: the re-sent input of the agent loop is.

**Decision.** Per the brief, no cell passed the fresh-read test, so no fresh-read lane is built. The lane code written
before the result (`cli-ocr-lane.mjs --lane=lite`: claim under Phase 2's submit lease, hold, read on the second
account, quota floor, release) is kept unmerged on branch `wip/cli-ocr-lane-lite-7517`. The route that passes,
lite>agy-flash-low, needs the Batch draft, so it cannot replace Batch, and on this account's pool it could not run
anyway. Shipped in the same PR: agy stop files are now per account (`agy@<account>-<model>`). The quota hit in this
test would otherwise have locked Flash-low for every lane on l7a's main account for seven days.

**Not done.** Latin (0 of 30 fresh reads; 6 of 30 corrections read, not judged). A view_file-free prompt (could cut
input about 3x). A rerun after 2026-11-03 once the account's tier is known.

---
stage: ocr
measure: [judged, accuracy]
languages: [en, la, de, zh]
scripts: [Latn, Hani]
canons: []
n_books: 115
n_pages: 115
verdict: "Asking the OCR model for notes, vocab, terms and image descriptions does not measurably change transcription accuracy (agy failed to see the image on 8 plain-arm reads against 3 for A, p ≈ 0.2; unresolved). On 115 pages with a human-typed reference, the blind Opus judge flags A (live v19.1) 7.4 meaning-changing errors per 1,000 words on Flash-Lite and 4.5 on agy Flash. Without notes, vocab and terms (B) the difference is -0.1 (lite) and +0.1 (agy). Without image descriptions too (C) it is -0.6 and -0.2. Every interval includes 0 and stays inside the A-vs-A floor (lite ±1.07, agy ±1.53). The plain arms cut median output tokens by 5 to 7%."
status: informational
decision: "No change to the production OCR prompt. Under the pre-registered rule, neither plain arm is a ship-candidate: B passes on agy only and C on lite only. Both failures come from the marginalia guard, which rests on 10 typed notes; by eye they are one page that spliced its margins into the text and one page the lane did not serve. With accuracy flat, the case for dropping the extras is tokens and simplicity only, to be weighed against their consumers (below)."
superseded_by: null
issue: [7966, 7499, 7941, 7263, 5124, 7701]
router_evidence: "none — prompt arms, not routes. Engines: gemini-3.1-flash-lite (Batch, the orchestrator's request) and gemini-3.8-flash-low via agy -p (cli-ocr's one-page call), both on Standard OCR v19.1 (9d8f959e…)"
defect_rates: "none — severe classes per page and arm (no quotes) are in scripts/eval/ocr-plain-7966/results/pages.jsonl"
---
<!-- PRIOR ART: scripts/eval/judge-cal-7866bar-7263/three-way.mjs (#7941: the normaliser and the blind Opus judge, imported) and lib.mjs (#7263: typed-reference truth, imported); results/en-ocr-ref-5124 (#5124 references; #7941 set B); ocr-v18-ab.mjs (#4195: the lite request shape and Batch submit/poll, imported); plain-6728/prompts.mjs (#6728: anchored prompt edits); 2026-10-06-transcription-error-three-ways-and-by-prompt-5939.md (the nearest earlier OCR-prompt test, CER only). -->
## 2026-11-02 · Does the OCR prompt's notes / vocab / term / image-description load cost transcription accuracy? (#7966)

**Question (Derek, 2026-11-02).** #7499 found that removing the extras from the *translation* prompt made translations more faithful. The OCR prompt asks for the same kind of extras on top of the transcription: `<note>`, `<vocab>` (required at the end of every page), `<term>` and `<image-desc>` with size, type and significance. Does asking for them change transcription accuracy?

### Design

Pre-registered and committed before any model call: `scripts/eval/ocr-plain-7966/PREREGISTRATION.md`, commit `3c2131583`. That file holds the page list with image and reference hashes, the arms and their md5s, and the decision rule.

- **Arms.** Anchored edits to the live default, Standard OCR v19.1 (`prompts.mjs`; each anchor found exactly once):
  - **A**: the live prompt, as each lane composes it;
  - **A2**: A again, with fresh calls (the noise floor);
  - **B**: A without the `<vocab>`, `<note>` and `<term>` lines and without rule 7 ("End with <vocab>…");
  - **C**: B, with `<image-desc …>` replaced by a bare `<image/>` marker ("Do not describe the image").

  Every transcription tag and the required classifiers stay in all arms.
- **Engines, as production sends them.**
  - **lite**: the orchestrator's Batch request: prompt + Document context, image ≤ 1,500 px, `gemini-3.1-flash-lite`, temperature 0.1, thinking 0.
  - **agy**: `cli-ocr.mjs read`'s one-page `sentinels-6523` call to `gemini-3.8-flash-low` through `agy -p`, with the tool gate, the nudge and one re-read. All calls fresh; no kept read reused.
- **Pages.** 115, one per book. Each has a human-typed reference:
  - #7263 print: 20 English, 20 Latin, 20 German (DTA, EEBO-TCP, CAMENA, same edition);
  - #5124 / #7941 set B: 35 English (Wikisource, Gutenberg);
  - 20 Chinese Siku Quanshu manuscript leaves against Kanripo (seeded from #7263's 40). This is the non-Latin-script stratum.
- **Measures.**
  - **Primary**: #7941's blind Opus judge on the normalised read, with the page image attached. It counts severe flags (misleads or wrong_text) per 1,000 words of the typed reference; for Chinese, per 1,000 Han characters of the leaf.
  - **Omissions**: reference lines missing from the read, and typed marginal notes missing from the read.
  - #7263's truth rule (miss and extra), #7941's normalised CER, and output tokens.
  - A read the lane does not serve counts as an empty page: lite RECITATION, or an agy reply that `cli-ocr apply` would refuse.
    - The agy half of this rule was added after the reads came in, and before any agy result was scored. Production never writes such a reply. The deviations from the pre-registration are this rule, the served-in-all-arms cut and median tokens; all three are reported, and none is decided on.
  - The normaliser change fixed in the pre-registration: `<note>` blocks are dropped in every arm, because an interpretive note is not page text.
  - Identical normalised texts are judged once (62 verdicts reused).
- **Rule.** Margin M = max(0.5, q95 of |A2 − A|) on the primary measure. X passes on an engine when the upper 95% bound of X − A ≤ M, and its point change in omitted lines and omitted notes stays inside the omission margins. SHIP-CANDIDATE needs a pass on both engines.

### Results (all 115 pages, page bootstrap; one page per book)

**Severe flags per 1,000 reference words**

| engine | A | A2 | B | C | A2 − A (floor) | B − A | C − A | margin M |
|---|---|---|---|---|---|---|---|---|
| **lite** | 7.44 | 6.98 | 7.33 | 6.84 | −0.46 (−1.19 to +0.14) | **−0.10** (−1.04 to +0.74) | **−0.60** (−1.81 to +0.41) | 1.07 |
| **agy Flash** | 4.49 | 5.33 | 4.63 | 4.25 | +0.84 (+0.17 to +1.67) | **+0.14** (−0.78 to +1.05) | **−0.25** (−1.25 to +0.69) | 1.53 |

- **Primary measure.** Both plain arms are non-inferior on both engines, and neither is superior.
- **Page by page** (pages with more flags than A / fewer than A):
  - lite: B worse on 18, better on 22; C worse on 19, better on 20;
  - agy: B worse on 20, better on 19; C worse on 16, better on 20.
- **No defect class moves beyond the A-vs-A spread.**
  - Misreads (O6): lite A 84, A2 80, B 91, C 89; agy A 51, A2 58, B 50, C 43.
  - Margins spliced into the body (O12): lite 26 / 30 / 27 / 23; agy 21 / 35 / 26 / 28.

**Judged-bad pages, omissions, CER, tokens (all pages)**

| engine | measure | A | A2 | B | C |
|---|---|---|---|---|---|
| lite | judged bad | 56.5% | 60.0% | 53.9% | 54.8% |
| lite | lines omitted / 100 | 23.0 | 23.0 | 19.9 | 22.6 |
| lite | notes omitted (of 10) | 4 | 4 | 5 | 4 |
| lite | CER (normalised) | 31.2% | 31.2% | 29.4% | 30.8% |
| lite | median output tokens | 384 | 389 | 364 | 356 |
| agy | judged bad | 44.3% | 41.7% | 40.9% | 40.9% |
| agy | lines omitted / 100 | 21.3 | 18.4 | 17.8 | 17.6 |
| agy | notes omitted (of 10) | 3 | 3 | 3 | 5 |
| agy | CER (normalised) | 26.6% | 23.5% | 22.9% | 25.1% |
| agy | median output tokens | 694 | 704 | 662 | 645 |

- **The pooled CER and omission rates are dominated by pages the lane did not serve.**
  - lite: RECITATION on the same 20 pages in every arm (17 of them English), plus 1 page in all arms but B.
  - agy: a refused, cut or restarted reply on 62 of 460 reads (A 18, A2 15, B 13, C 16); 11 pages failed in every arm.
- **On the 94 pages served in all four arms**, the picture is the same:
  - lite: CER 3.3% / 3.3% / 3.0% / 2.9%; severe B − A −0.10 (−1.33 to +1.06), C − A −0.81 (−2.38 to +0.53);
  - agy: CER 5.4% / 5.5% / 6.2% / 7.8%; B − A +0.18 (−0.78 to +1.17), C − A +0.14 (−1.02 to +1.30).
  - agy's CER rise for C (+2.5 points, −2.2 to +8.1) is three pages at CER ≈ 1. On each, the model **did not see the image**. It returned only a `<warning>` ("could not be viewed due to tool restrictions"), which counts as a served read.
- **agy failed to see the image in every arm**, and more often in the plain arms: A 2 (one of them an invented page, below), A2 1, B 4, C 4 (one invented), of 115 reads each.
  - That is 3 against 8: Fisher p ≈ 0.2, and the image bytes were identical across arms. The pre-registered measures count these reads as they are.
  - It is the main open question for agy: is the gap the prompt or the lane?
- **The extras are mostly obeyed.**
  - lite A emitted `<vocab>` on 94 pages, 16 `<note>`, 13 `<image-desc>`;
  - agy A emitted 97 `<vocab>`, 20 `<term>`, 16 `<image-desc>`;
  - B and C emitted none of the removed tags. C wrote 5 `<image/>` markers on each engine.

**By language** (severe flags per 1,000; reported, not decided on; n = 20 except English 55)

| | lite A / B / C | lite A2 − A | agy A / B / C | agy A2 − A |
|---|---|---|---|---|
| English (55) | 3.5 / 3.3 / 3.1 | −0.2 | 2.1 / 2.3 / 2.2 | 0.0 |
| Latin (20) | 11.7 / 10.8 / 12.6 | −0.9 | 6.6 / 6.6 / 6.0 | +0.6 |
| German (20) | 2.1 / 3.2 / 3.7 | +0.5 | 1.3 / 2.1 / 2.4 | +0.8 |
| Chinese MS (20) | 27.9 / 27.9 / 22.8 | −2.4 | 17.3 / 16.8 / 14.6 | +5.2 |

- **German is the one cell that leans against the plain arms on both engines.** C − A is +1.6 (+0.5 to +3.0) on lite and +1.1 (−0.5 to +2.9) on agy.
  - That is 3–5 extra flags over 20 pages: two empty pages, a fraction misread, a running head merged into the text.
  - A2 − A is itself +0.5 and +0.8 here. It is exploratory and does not reach the rule.
- **Chinese manuscript leans the other way** (C lower on both engines), inside a floor of ±2.4 to 5.2.

### The pre-registered rule, by the letter

| | lite | agy |
|---|---|---|
| B | non-inferior; **fails the marginalia guard** (5 vs 4 notes omitted of 10: +10 per 100 > 2) | **passes** |
| C | **passes** | non-inferior; **fails the marginalia guard** (5 vs 3 of 10) |

**Outcome: ENGINE-SPECIFIC for both arms. No SHIP-CANDIDATE.**

The marginalia guard rests on 10 typed notes on 7 pages, so one note moves it 10 points against a 2-point margin. Both failures are single pages:
- **lite B**, `la-6a503c77…` (by eye, image opened): B did not drop the 9 marginal citations. It switched to line-by-line layout and spliced each citation into the body line beside it, untagged, and repeated the running head as body. The judge charged 2 × O12.
  - The same B read keeps *vno* and *praevidet* as printed; A wrote "uno" and "providet" (A's O6).
- **agy C**, `la-6a432b29…`: agy's reply was cut before its end marker and is not served, so both of the page's notes count as omitted. It is not a marginalia omission inside a read.

### Eye checks (labelled by evidence)

- **By eye, image opened.**
  - `la-6a503c77…` (above).
  - `ge-69aebe72…` (agy): the image (934 × 1506 JPEG, the same bytes in every arm) did not reach the model in 4 calls.
    - A2 and B wrote a `<warning>` that the image could not be loaded.
    - **A and C invented a whole page** of 17th-century English ("VITA DEI"; "The King's Declarat. touching the late Invasion") for a page of Mach's *Die Mechanik*.
    - Both passed cli-ocr's chatter guard. The judge caught both (whole-page wrong_text). One more agy read (`la-69b51e99…` A) said the image could not be inspected.
    - This is a lane finding, not a prompt one. It is posted on #7701, because a first read has no stored text for the 40% shared-words floor to compare against.
- **From the judge's quotes and the reads** (image not reopened):
  - `en5124-…-pg60766p151`, `ge-69c834a3…`, the largest B-over-A rises: the extra flags are O12 margins spliced into the body. A splices the same margins on the same pages; this is arm-independent and varies from sample to sample.
  - `en-6a455ce6…`, the largest fall: every arm writes the printed & as `&amp;`, and #7941's normaliser turns an HTML entity into a space. So the judge charges "& dropped" in every arm: ten times over in A's verdict, grouped in the others.
    - Without that page: lite B − A +0.14, C − A −0.32; agy +0.11, −0.32 per 1,000.
    - **The #7941 normaliser bug** (`oursFurniture` replaces `&amp;` with a space) also touches #7941's own "ours" arm on the pages where we store an entity.

### What it decides, and what it does not

- **Decides:** on these engines and pages, the extras do not cost transcription accuracy, and removing them does not buy any. The #7499 result for translation does not carry over to OCR. Removing them saves about 20–50 output tokens a page (median 5–7%) and nothing measurable in accuracy.
- **Does not decide:**
  - whether the extras are worth what they cost: that is a consumer question, below;
  - the typical page: typed references are cleaner copies (#7941);
  - whether a shorter prompt makes agy miss its image more often (3 vs 8 reads). A second agy pass of A and C on the same 115 pages would settle it at $0;
  - manuscripts beyond the 20 Chinese leaves;
  - GPU lanes.

**Consumers a switch would affect** (inventory for the follow-up, from `git grep` on main):
- **`<vocab>`**:
  - #4695 page_terms (`scripts/lib/page-terms-parse.mjs`, `scripts/maintenance/build-page-terms.mjs`, `aggregate-page-terms.mjs`);
  - the book index route's vocabulary (`src/app/api/books/[id]/index/route.ts`, `extractTerms(…'vocabulary')`);
  - the keyword index, which indexes wrapper text (`scripts/workers/keyword-search/README.md`);
  - the spread prefix in the orchestrator, which asks for a per-page `<vocab>`.
- **`<image-desc>`**:
  - **image extraction selects text-page candidates by the regex `<image-desc` in `ocr.data` and skips trivial ones by its `type` / `significance` attributes** (`scripts/workers/image-extract-worker.mjs` `SKIP_MARKUP_RULES`, `pipeline-orchestrator.mjs`). A bare `<image/>` would silently drop those candidates and that triage. Arm C cannot ship without changing that selector.
  - It is also read by `NotesRenderer`, the exports (`download` route, `export-markdown-html.ts`, `pdf-export.ts`), the IIIF and DTS text, `page-grounding` / Embassy grounding, librarian search and `src/lib/image-extraction*.ts`.
- **`<note>` / `<term>`**: the reader renders them; `<term>` feeds the book index (`build-book-index.ts`).

### Limits

- **One judge family (Opus).** Identical texts share one verdict: 62 reuses, some across engines.
- The agy floor itself excludes 0 (A2 − A +0.84): repeat noise on agy is real, and the margin reflects it.
- The marginalia guard is underpowered (10 notes), as above.
- Pages the lane does not serve are counted in every arm, as pre-registered. Most of them fail the same way in all four arms.

### Spend

- **lite**: 4 Batch jobs, 460 requests, **$0.403** (script meter; tokens 1.97M in, 0.21M out). Logged in the ops spend ledger.
- **agy**: 460 reads (plus re-reads) on the subscription.
- **Opus**: about 710 judge calls via `claude -p` on the subscription; weekly meter 11% → 15%.
- No paid call to any other model. No writes to pages, books, prompts or routing; `batch_jobs` holds the four eval registrations (closed).

### Reproduce

```
E=--env-file=/root/sourcelibrary/.env.production.local; R=scripts/eval/ocr-plain-7966/run.mjs
node $E $R pages && node $E $R prompts && node $E $R lite-build
node $E $R lite-submit --approved-usd=0.8 && node $E $R lite-poll     # repeat poll until done
node $E $R agy --conc=3 && node $E $R judge --conc=4 && node $E $R score
```
`SRC7263` must point at #7263's item cache (the typed DTA / EEBO / CAMENA pages and Kanripo leaves). Committed: `results/score.json` and `results/pages.jsonl` (per page, engine and arm: numbers and defect classes, no page text), `results/prompts.json` (arm md5s) and `results/pages-prereg.json`.

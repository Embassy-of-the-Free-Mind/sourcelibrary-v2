# Pre-registration: OCR prompt v18 (blank narrowing + `<insert>`) vs v16

PRIOR ART: scripts/eval/prompt-ab.mjs (#4610, paired k-run A/B — realtime, 10 hand-picked cases, body-length estimator that its own header retracts for looping pages); scripts/eval/blank-page-study.mjs (#3444, reference-free blank scoring — `bodyText`, `declaredBlank`, `loopCoverage` are reused, not rewritten); scripts/eval/ocr-preprocessing/gemini-score.mjs (#5250, windowed-CER scoring with an A/A noise floor over pages that carry references). None runs three prompt arms through Batch over labelled strata, so this composes them.

Written 2026-10-02, **before any v18 call was made.** Issue: #4195 (items 1 + 2 of the 2026-10-02 candidate list). Owner: session `ocr-prompt-v17`.

## Why
Readers get page text from the live OCR prompt, `prompts` type `ocr`, default **v16**. Two defects in it are still live:
1. **Blank leaves get invented pages** (#4149: 409 confirmed in 264 books). The page-type enum is attached to `<columns>` rather than `<page-type>`. `blank` is undefined. The specimen `"DISCURSUS IV."` is the documented attractor for the invented Latin.
2. **`<insert>` reads "boxed text, later additions"** (#3444 Tier 1). Map cartouches and labels match that description, but the model can just as well put them in `<image-desc>`/`<note>`, which readers can switch off.

## Arms (same model, same params, same images; only the prompt text differs)
| arm | prompt |
|---|---|
| `A`  | v16, live DB row `6a98b8a075660c6a8b09a8f8` (content_hash `0203c264…`) |
| `A2` | v16 again, as an independent request set (the **noise floor**) |
| `B`  | v18 candidate, `prompts/ocr/standard-ocr-v18-candidate.md` |

The v18 candidate is v16 with four edits, and nothing else:
- the enum moves onto `<page-type>`;
- `blank` is defined as no ink on this side of the leaf (show-through is not ink);
- a **Blank pages** section is added (v17's wording, the part that was k=5-verified on the faint-mark page);
- the DISCURSUS and drop-cap specimens are neutralised, and `<insert>` gets the #3444 wording.

Deliberately **excluded**: the `<lacuna>` tag from the shelved v17 (#4605). Its over-declining (a legible cataloguer note became a lacuna) is the reason v17 was shelved, and bundling it would confound this test.

- Model: `gemini-3.1-flash-lite` (production lite OCR), via **Batch API**, with the production generationConfig.
- **k = 3** requests per (page, arm), each with its own request key. The unit of analysis is the PAGE: the k runs are averaged within a page and never counted as n.

## Strata (fixed before the run; seeded selection, seed 4195)
| id | what | n | source | correct output |
|---|---|---|---|---|
| **S1 fabricated-blank** | blank image, where a past run invented a page | 40, one per book | `verdict:"FABRICATED"` rows of `fabricated-ocr-corpus-2026-08-21.jsonl` (#4149) | blank, no body |
| **S2 show-through blank** | blank leaf carrying bleed-through | 38 | `blank_page` rows of `dataset/v0.4-difficulty` | blank, no body |
| **S3 sparse ink** | little ink, but real content (the over-decline guard) | 40, one per book | `has_ink` rows with ink_coverage 0.003–0.03 from the same #4149 file, plus `prompt-ab.mjs` cases faint-mark p.4, basmala p.266, cataloguer p.197 | NOT blank |
| **S4 labels / inserts** | map and diagram labels, marginalia | 28 | `image_only_labels` (10) + `marginalia_missed` (18), v0.4 | label text in transcription tags |
| **S5 clean controls** | pages with a reference text | ≤ 40 | #5250's reference pages (latin / greek / cjk) | CER does not worsen |

A page whose image cannot be fetched is dropped from all arms, and the drop is reported. It is never replaced after the run starts.

## Outcomes (per run, then per page = mean over k)
- **fabricated** (S1, S2): `bodyText(out)` has more than 20 letters (`\p{L}`). This is the **primary outcome, on S1.**
- **blank recall** (S1, S2): `declaredBlank(out)` and not fabricated.
- **false blank** (S3): `declaredBlank(out)` OR `bodyText` has 0 letters.
- **label capture** (S4): characters inside `<insert>|<margin>|<gloss>` ÷ characters inside those tags plus `<note>|<image-desc>`. Diagnostic only.
- **windowed CER** (S5): `scoreAgainstReference` (lib/metrics.mjs). Same abstain rule as #5250: when arm A's read does not align, the page abstains.
- **loop** (all strata): `loopCoverage(bodyText) > 0.5`, reported per arm as a Bernoulli rate with a Wilson 95% interval. Length statistics exclude looped runs (the #4610 finding).

## Noise floor
For each outcome, `floor` = the p90 of |A − A2| over pages in that stratum. A difference smaller than the floor is noise, whatever its p-value.

## Decision rule
**Recommend v18 for promotion** only if all five hold:
1. **S1 (primary):** the mean paired difference in fabricated rate (A − B) > `floor`, and the exact sign test over non-tied pages gives p < 0.05.
2. **S3 guard:** the mean false-blank rate under B does not exceed A by more than max(`floor`, 0.05).
3. **S5 guard:** the median paired windowed-CER difference (B − A) ≤ `floor`(S5).
4. **Loop guard:** the Wilson intervals for loop rate do not show B above A (B's lower bound ≤ A's upper bound).
5. **S2:** blank recall under B ≥ A − `floor`.

S4 is reported but does not gate. The `<insert>` change is justified by a reader bug (#3437), not by this measurement. With n=28 the test is underpowered, as #3444 says.

Anything else is reported as **not established**, with the table, and is not argued around. **The promote itself is Derek's call.** This run only recommends. No `prompts` row is written by the run, and v18 gets its DB row only if Derek approves.

## Budget
Flash-Lite through Batch: about 186 pages × 3 arms × 3 runs ≈ 1,700 requests, under $2 at Batch prices. The hard cap is **$5**, inside the spend floor. A ledger line goes in `~/sourcelibrary-ops/costs/spend-ledger.md`.

## Amendments
Any amendment is appended here with a date, before the affected arm runs.

### 2026-10-02 (job `ocr-v18-ab`): operational details, fixed before any arm was submitted
None of these changes an outcome, a threshold or the decision rule. They pin down what the text above left open.
1. **S5 source.** #5250's reference pages are reachable on the box (`pp5250/gemini/pages.jsonl`, which holds the refs; the committed `results/ocr-preprocessing-2026-09-29/gemini-pages.jsonl` has them stripped). S5 = 40 pages: 14 Latin (la.wikisource, external), 13 Greek, 13 CJK. They are drawn with seed 4195 from the pages that did **not** abstain in #5250, because a page whose v16 read never aligns would abstain here too and only cost money.
2. **S1 corpus parse.** Node's `JSON.parse` accepts the lone-surrogate escapes. Line-by-line parsing with try/catch skipped **0 of 46,805** rows.
3. **S3 size.** 40 `has_ink` pages from the corpus (one per book) **plus** the three named `prompt-ab.mjs` cases makes 43. A named case is not drawn twice.
4. **Drawing.** For each stratum the books are shuffled with `makeRng(4195)` (`lib/paired-stats.mjs`), each stratum with its own stream, and one row per book is drawn with that stream. Books are taken in shuffled order. A book is skipped at draw time, with the reason logged, if (a) any of `language` / `original_language` / `languages[]` is Tibetan or Syriac, (b) the page is not in `pages`, or (c) `getPageSource` returns no URL. This happens before any call, so it is a selection rule and not a replacement. An image that fails to **fetch** is dropped from all arms per the rule above.
5. **Request.** Each arm uses the production cross-book Batch request (`pipeline-orchestrator.mjs`): the prompt with the `{language_instruction}` substitution, then the `**Document context:**` suffix (title, author, year), the same five `BLOCK_NONE` safety settings, and `OCR_GENERATION_CONFIG` = {temperature 0.1, maxOutputTokens 16384, thinkingBudget 0}. The image is `getPageSource(page)`, resized to fit 1500 px (JPEG q80) when it is over 100 KB, as `fetchImageBase64` does. Every arm sees the byte-identical image. The external Latin S5 pages have no book in the DB, so they get #5250's image URL and no document context. Each arm goes to its **own** Batch job, so A2 is an independent request set.
6. **Run outcomes.** A run whose response is an `error`, or a refusal with no text, is excluded from that page's mean. If a page then has no runs left in an arm, the page drops out of the paired comparisons that need that arm. A `truncated` run (MAX_TOKENS) is scored on its text, because a runaway invention is exactly what S1 measures. An `empty` response counts as no body.
7. **S5 abstain with k=3.** Following #5250, a run whose read fails the guard or is not `text` scores windowed CER 1.0. A page **abstains** when fewer than 2 of arm A's 3 runs pass the alignment guard. The page value is the mean over k.
8. **Loop rate unit.** As written, the unit is runs pooled over all strata, Wilson 95% per arm. The page-level count (pages where any run looped) is shown alongside.
9. **"Spread across k"** in the report is the mean within-page SD of the outcome across the k runs.

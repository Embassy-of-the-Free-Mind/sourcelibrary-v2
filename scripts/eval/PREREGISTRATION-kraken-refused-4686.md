# Preregistration — Kraken on the pages Gemini refuses as RECITATION, English print (#4686)

PRIOR ART: `experiments/2026-10-05-engine-contest-5870.md` (closest: Kraken 7.1 niced on this box, preregistered rule, but judged on the English of Greek/Arabic-script pages, not on English transcription); round 3 of #5660 (PR #5786, `experiments/2026-10-04-ocr-bakeoff-round-3-5660.md`: Kraken CATMuS-Print on the human-keyed EEBO-TCP stratum, English 1600–1699 CER 0.046 vs lite 0.053, no worse; English 1700+ 0.018 vs 0.022; ſ read as f in 34 words vs lite's 1,030); #5730 (PR #5805: the EEBO fine-tune, trained on 41 English + 3 Latin EEBO books); #4686 itself (5/5 refused pages read, n = 5, no reference). None measured an engine **on the refused population**, where the production engine's output is nothing.

Committed and pushed before any arm read a sealed page. Job `kraken-refused-4686`, Derek approved 2026-10-06 ("yes to kraken"), $0 (CPU only).

## Question

Gemini (lite and flash, every tier) returns zero characters with `finishReason: RECITATION` on pages of famous English texts. The Drebbel collection needs four hidden *Philosophical Transactions* volumes (4, 5, 6, 11–12; 1669–1678) and the two volumes of Birch's *History of the Royal Society* (1756). **715 pages** in them carry `ocr.recitation_blocked: true` and have no text (PT4 161, PT5 100, PT6 220, PT11–12 231, Birch I 1, Birch II 2; Mongo 2026-10-06). Is Kraken's read of these pages good enough to serve, and is it better than the Archive's ABBYY text of the same leaf?

## Stratum `refused-en-4686`

- **Draw** (`kraken-refused-4686/draw.mjs`, seed 4686, registry `benchmark/refused-en-4686.json`): per Phil Trans volume, eligible pages sorted by page number, cut into k equal bins (k = 4, 4, 4, 5), one seeded pick per bin; every eligible Birch page (3). **20 pages**, 6 books. One spare per Phil Trans volume, used only if a drawn page has no printed text (plate or blank), recorded in the registry.
- Vol. 4 p. 9 is excluded: before this design Kraken was run on it once to time the lane on this box (≈ 250–300 s/page at `nice 19`, load 14–18). That output was not compared with anything.
- **Grade.** 6 books: a census of the books at stake (`census 6 of 6`), not a sample of a language. It can decide this lane for these books (small tier: $0, fill-only, reversible) and nothing wider.

## Reference

No human-keyed text of these editions exists that I could find: the EEBO-TCP catalogue (61,315 rows, `TCP.csv`) has no *Philosophical Transactions* volume and no Birch; ECCO-TCP has no Birch either. So:

- **Blind by-eye full-page transcription** of each sealed leaf, made by Claude (model-eye) from the archived master image (`archived_photo`, ≈ 2,700 × 3,950 px), **before any arm's output for that page is opened**. `made_by: {engine: model, model: claude-opus-5-5}`. Conventions: every printed character on the page in reading order, including running head, page number, signature and catchword; side-notes after the paragraph they stand beside; ſ kept as ſ (the scorer folds ſ→s, so it costs nothing and lets long-s errors be counted); ligatures as their letters; line breaks as printed, a line-end hyphen kept; italics not marked; a word I cannot read is `[?]`.
- **One adjudication pass** after scoring: where an arm disagrees with the reference, I reopen the image; the reference is changed only where the image shows it wrong. The number of corrections per 1,000 reference characters is reported as the reference's own error rate. Headline scores use the adjudicated reference; scores against the blind reference are reported beside them.
- This is a model-made reference, not a human one. The human-referenced accuracy for the same engine on 17th-c. English print is the #5660 r3 EEBO-TCP figure above; this stratum asks whether that holds on **these** pages (italic-heavy Phil Trans type, 1756 Birch).

## Arms

| arm | what | cost |
|---|---|---|
| `kraken-catmus` | Kraken 7.1, CATMuS-Print large (`catmus-print-fondue-large`, CC-BY-4.0, S. Gabay; sha256 `1ed39e73…5b64`), default blla segmenter, `segment -bl ocr`, archived master image, `nice -n 19` | $0 CPU |
| `kraken-catmus-ft-5730` | same, the #5730 fine-tune (`catmus-print-ft-eebo-5730`, sha256 `4e4ead34…f5`; 41 English EEBO books) | $0 CPU |
| `ia-abbyy` | the Archive's ABBYY text for the same leaf (`<item>_djvu.xml`, leaf n = the `/page/n<k>/` index of `pages.photo`, via `scripts/lib/ia-djvu-leaves.mjs`) | $0 |
| `mineru` | MinerU 3.4.0 pipeline backend on CPU, as `scripts/workers/mineru-ocr-worker.mjs` runs it (markdown sanitised, footnotes appended) | $0 CPU |
| `gemini-3.1-flash-lite` | **not re-run.** The pipeline's recorded outcome: empty text, finishReason RECITATION (`ocr.recitation_blocked`, 3 attempts on Phil Trans). Scored as a refusal (#5581), never as a misread | $0 |

GLM-OCR (the best open English reader in #5660 r3) is not on this box's CPU; it needs a GPU, so it is out at $0.

## Measures (per page, then median with bootstrap 95 % CI over pages)

1. **CER** against the reference, `benchmark-score.mjs` normalisation (lower case, ſ→s, hyphen rejoin, whitespace folded). Catastrophic = CER > 0.5. Reading-order `gap`, loop flag and invention as the scorer reports them.
2. **Long-s**: reference words containing ſ that the arm writes with f in that place (`ſhould` → `fhould`), per 100 such words.
3. **Numbers**: digit strings in the reference reproduced exactly in the arm's output (multiset), pooled share.
4. **Dropped lines**: reference lines (≥ 15 letters) with no window in the arm's output at line CER ≤ 0.5, pooled share and worst page.

## Gate — "usable" means

The reader of a refused page today gets nothing. Production lite ships English 1600–1699 at median CER 0.053 against TCP, flash at 0.038. "Usable" is "about as good as what we already serve on this kind of page", with room for a model-made reference:

- **G1** median CER ≤ 0.08, and the upper bound of its 95 % CI ≤ 0.12;
- **G2** catastrophic pages ≤ 2 of 20;
- **G3** dropped lines ≤ 5 % of reference lines pooled, and no page dropping more than 20 %;
- **G4** ≥ 90 % of reference digit strings reproduced, pooled.

Applied to the Kraken arm chosen as follows: `kraken-catmus` unless the fine-tune's paired median ΔCER has a 95 % CI wholly below 0 (then the fine-tune). **All four pass → write that arm to the refused pages. Any fails → STOP, no writes, the evidence goes on #4686.** ABBYY and MinerU are reported against the chosen arm (paired, descriptive). They are not written by this job: the Archive text was already refused on Birch at agreement 0.62, and whether it should fill is #5124's rule, not this lane's.

## If it passes: the write

Fill-only, to pages that are refusal-marked and have no `ocr.data`, never a page with `ocr.edited_by` or `ocr.source: 'manual'` (in the update filter). `ocr.source: 'kraken'`, `ocr.model: 'kraken/<model>'`, `ocr.pipeline: 'kraken-refused-4686'`, `ocr.content_hash`, and an `ocr.engine` block (`specialist-engine/1`: Kraken version, model file, sha256, licence, segmenter, run id, code version, host, image url, and the Gemini refusal stamps under `ladder`). The top-level refusal stamps are unset (the ladder keeps them). Revision snapshot first (a no-op on a fill), a `sweep_log` row and a `book_events` row per book, `pages_ocr` recounted. English books: no translation step runs (`translate-core.mjs` `english-book`), the lane is not in `WITHHOLD_LANES`, no `pipeline_auto` field is touched, and `visible`/`hidden` are not touched.

## Not decided here

Routing every future RECITATION refusal to Kraken automatically (a pipeline change, other languages, other books) is Derek's, after this result.

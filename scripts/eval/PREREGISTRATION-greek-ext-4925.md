# Preregistration — Greek print per period, decision-grade (#4925 step 2, #4744)

PRIOR ART: `PREREGISTRATION-chinese-ext-4925.md` (the extension-draw shape, the by-eye class rule,
the lite-vs-lite noise floor and the ≥ 50-referenced-page grade this reuses) and the #4744 result
comment of 2026-09-15 (Greek: every specialist loses to lite on 42 19th-century reference pages;
flash-preview beats lite 10/1 pinned) — neither has a single referenced Greek leaf before 1800,
and #4744's rule ("≤ half lite's CER") was written for specialists, not for the lite-vs-preview
routing question. `PREREGISTRATION-per-language-ocr-suitability.md` fixes the draw rule but has no
leaf-script screen, which the Greek pool needs (#4884).

Written 2026-09-19, before any engine ran on the extension pages. Nothing below changes after the
run; deviations are reported as deviations.

## Question

For Greek **printed** pages, per period of print, which of the three routes should production take:

- `gemini-3.1-flash-lite` (production, `OCR_LITE_ONLY`) — is it good enough?
- `gemini-3-flash-preview` — the #4744 finding (10/1 over lite on 19th-c pinned pages) at n that
  can decide;
- Kraken `greek-cllg` (self-hosted, CPU) — tied lite on clean 19th-c print, lost on the wider mix;
  never measured on early type.

The 19th-century cell is close to settled (38 referenced books, lite CER ≈ 0.4 %). The open cells
are **1450–1699** and **1700–1799**, which had zero referenced Greek leaves.

## Why the draw is screened (the #4884 trap, measured)

`books.language = Greek` is the WORK's language on most of our pre-1800 records: the pool is Latin
dissertations on Aristotle, Latin and vernacular Plutarchs, Greek–Latin editions whose leaves are
mostly Latin. The sealed `greek` stratum drew 17 Latin leaves in 20. Measured on this draw with a
free Tesseract `grc+lat` screen: 3,845 interior pages of 769 books screened (2,054 pages / 412
books for 1450–1699, 1,791 / 357 for 1700–1799); 4.6 % of pages Greek-majority; 22 % of pre-1700
books and 23 % of 18th-century books have at least one Greek-majority leaf in six tries. A by-eye
audit of 40 screen-rejected pages found 29 Latin, 10 other-language (French, German, English,
Italian) and ONE Greek-majority leaf (an even parallel page), i.e. the screen misses ≈ 2.5 % of
the leaves it should keep and its rejects are what the tag said they were not. A blind one-page draw
would need thousands of pages per fifty Greek leaves, so the extension draw screens: per book, six
interior pages are pre-drawn from the PRNG; the first whose recognised letters are ≥ 40 % Greek
(≥ 80 Greek letters) is kept; a book with none is skipped. One page per book still holds. The
screen decides SCRIPT only; positive control: the three Greek early-print pages of the sealed
stratum (1531 Plutarch, 1533 Diogenes Laertius, 1554 Anacreon, all ligatured type) pass at 236–704
Greek letters. The by-eye labels below are the ones that count.

## Sample (sealed before this file was finished; the registry file is the seal)

- `scripts/eval/benchmark/greek.json` — sealed 2026-09-13, 30 pages (20 pre-1700, 10 19th-c), of
  which 3 pre-1700 leaves are Greek type by eye and 5 of the 19th-c leaves are ≥ 45 % Greek (#4744);
  its pages get by-eye class files in the same pass as the extension before scoring.
- `scripts/eval/benchmark/greek-ext.json` — sealed 2026-09-19, seed 47441, sub-strata
  `greek-1450-1699` (n = 90, from 412 books walked of 3,525 eligible) and `greek-1700-1799`
  (n = 80, from 350 of 357 books — the 18th-century pool is EXHAUSTED at one page per book), no
  spares (every drawn page is classified; the cell is the referenced Greek subset), books in
  `greek.json` excluded. 170 images exported, 0 failed.
- Images exported at max width 2400 px; every engine reads the identical JPEG.
- **Classification by eye before anything else**, every exported page: `leaf_language` ∈ {grc, lat,
  mixed, other}, `greek_share` (tenths), `script_class` ∈ {typeset-print, manuscript, illustration,
  textless}, `ligatured`, `spread`, confidence, note — eight Sonnet readers, disputed and
  low-confidence pages re-read by a second reader (Fable). Files in
  `<root>/greek-ext/out/script-class/` (scorer input) mirrored to `scripts/eval/benchmark/script-class/`.
  **Result (2026-09-19, before any engine ran):** 1450–1699: 76 grc / 12 mixed / 2 lat, but
  **18 of the 90 are manuscripts** (Greek codices from the Bodleian, Laurenziana, e-codices, BnF,
  BSB carrying an edition-era `published`; the title filter cannot see them) — 72 typeset;
  1700–1799: 34 grc / 42 mixed / 4 lat, all typeset. Second reader opened 20 close calls and
  overturned 8 (four parallel-edition leaves scored 0.4–0.45 are even splits, 0.5; one Aldine-type
  Aeschylus leaf called manuscript is typeset; a Phaedo leaf whose lower half is Greek scholia is
  0.9, not 0.6; two others up); every arbitration is recorded in the class file.
- **Cell membership:** a page enters a Greek cell iff `greek_share ≥ 0.5` (grc, or mixed with a
  Greek majority — the #4744 "≥ 45 % Greek" convention, rounded to the by-eye tenths) AND
  `script_class = typeset-print` AND it has an accepted reference. Latin leaves, manuscripts, plates
  and referenceless pages are listed, never counted. No proxy top-ups. **Before references:**
  1450–1699 cell 69 (59 pure Greek ≥ 0.9; 3 / 58 / 8 by century; all ligatured type), 1700–1799
  cell 65 (27 pure Greek; 38 parallel Greek–Latin leaves; 47 ligatured). The pure-Greek subset is
  reported beside each cell as a robustness slice. The 18 manuscripts get the Gemini arms too
  (cents) and are reported as an exploratory Greek-manuscript row, never in a print cell.
- **Scoring is Greek-letters-only for Greek strata** (`benchmark-score.mjs`, `GREEK_STRATA`): a
  parallel leaf's Latin half is neither charged nor credited to any engine. Without this the
  scorer's whole-output Levenshtein would demote every parallel page (≥ 0.5 CER from the Latin
  insertions alone) and the 1700–1799 cell would measure layout, not reading.

## References

- Sources, cheapest first, all free: (1) local First1KGreek + Perseus canonical-greekLit TEI
  (1,898 editions, 213 M chars, flattened by `build-greek-corpus.mjs`); (2) el.wikisource proofread
  texts (its search folds diacritics); (3) the Patrologia Graeca ground truth (Zenodo 7296539) —
  **504 again on 2026-09-18 from Hetzner; recorded, not retried.**
- Builder: `benchmark-refs.mjs --stratum=greek-ext` — work identified by a folded-trigram phrase
  vote (ripgrep over the corpus, ≥ 3 distinct phrases, clear winner), window cut by the Syriac
  word-bigram vote on folded words and mapped back to the ACCENTED edition text, trimmed on content
  bigrams; accepted at ≥ 0.35 bigram overlap. Phase A used the Tesseract screen read as the probe, a LOWER bound:
  1700–1799 cell 22 references + 11 work-identified-without-window; 1450–1699 cell 0 + 5 — the
  Tesseract read of ligatured early type does not yield three consecutive correct words, so the
  phrase vote fails there, not the corpus (on the sealed stratum the Gemini probe referenced all 5
  early Greek-type pages and 11 of 14 Greek-probe pages overall). Expected with the Gemini probe:
  ≈ 60–80 % of cell pages, i.e. ≈ 41–55 pre-1700 and ≈ 39–52 (≥ 22) for 1700–1799 — **both cells
  are borderline on the 50-book grade, and the run decides; a cell that lands under 50 is reported
  directional by rule (e)**, and the 18th-century one cannot be grown from this catalogue at one
  page per book. **Phase B rebuilds every window with the longer Gemini read (`--force`) before
  scoring**, the #4744 convention.
- These are editions of the WORK, not of our page: a 1550 Basel and a 1908 OCT differ in
  accentuation, breathings, iota subscript, readings and abbreviations, and the scorer's CER keeps
  diacritics. So (a) every row records the edition and overlap; (b) the scorer's mismatch demotion
  (no engine within 0.5 CER → proxy, not counted) is expected to fire on some early pages and its
  count per period is reported; (c) CER on early print has an edition floor that the lite-vs-preview
  and Kraken-vs-lite PAIRED comparisons cancel and the absolute "is lite good enough" number does
  not — the absolute number is reported with that caveat, and a diacritic-folded CER is reported
  beside it as a secondary, exploratory figure.
- Contamination: these are public e-texts and may be in any engine's training data. The
  invention metric partly guards against recitation; a by-eye read of the five worst and five best
  pages per engine per period is the rest (lite's Anacreon read in #4744 was indistinguishable from
  recitation).

## Arms

| arm | version | where | cost |
|---|---|---|---|
| `gemini-3.1-flash-lite` (production) | as `lib/runners.mjs` resolves `lite`, `thinkingBudget: 0`, temperature 0 | Hetzner (laptop is geo-blocked) | ≈ $0.002/page |
| `gemini-3.1-flash-lite` REPEAT (`gemini-3.1-flash-lite-b`) | same settings, separate out dir | Hetzner | ≈ $0.002/page |
| `gemini-3-flash-preview` | same settings | Hetzner | ≈ $0.006/page |
| Kraken `greek-cllg` | `/root/bench2-kraken`, `segment -bl ocr`, the #4744 invocation, `nice`, per-page `timeout 900` | Hetzner CPU | time only (≈ 166 s/page measured) |

Gemini arms run over every exported page (the Latin leaves are cheap and give the Latin-leaf
control for free); Kraken runs over the Greek-by-eye pages only. Approved spend: see the #4925
estimate comment; nothing runs before the yes.

## Metrics (as `benchmark-score.mjs` computes them)

Per page and engine against the reference window: CER (Levenshtein over the reference letters,
diacritics kept); catastrophic = CER > 0.5; invention = share of content tokens found in neither the
reference nor any other engine's output; loop flag. Paired per page against production lite.

## Decision rules, per period (1450–1699; 1700–1799), evaluated only when the period holds ≥ 50 referenced Greek leaves

Δ = CER(arm) − CER(lite) per page; Δ₀ the same for lite-REPEAT (noise floor).

(a) **Is lite good enough?** Report lite's median CER with its bootstrap 95 % CI and the
    catastrophic count. Fixed threshold, from the 19th-c cell where lite is trusted: lite is
    "adequate" for the period if median CER ≤ 0.05 AND catastrophic ≤ 5 % of pages; "inadequate" if
    median CER > 0.10 OR catastrophic > 15 %; between: "degraded", routing decided by (b)/(c).
(b) **flash-preview vs lite** (routing): preview is preferred for the period if it wins the paired
    sign test (p < 0.05 on the untied pairs) AND median Δ ≤ −0.01 with CI-upper < 0 AND catastrophic
    ≤ lite's AND median invention ≤ lite's; else lite stays (a tie is a lite verdict — preview costs 3×).
(c) **Kraken greek-cllg vs lite** (the #4743 "better reader" rule): Kraken wins the period if the
    paired sign test p < 0.05 AND Δ ≤ −0.05 on ≥ 60 % of pages AND invention not higher AND
    catastrophic ≤ lite's. Otherwise record and close for that period (as #4744 did for the 19th c.).
(d) **Noise floor:** any margin narrower than |median Δ₀| decides nothing; the cell is then reported
    "engine noise exceeds the margin".
(e) A period under 50 referenced Greek leaves is reported **directional** with intervals and no
    routing decision; the shortfall is a draw-more or acquire-more item (the 1700–1799 pool is 357
    books and may simply not hold 50 Greek-leaf editions), never a proxy top-up.

The decision script is `benchmark-cost-lane.mjs --by=period --leaf=grc --strata=greek,greek-ext
--engine=<arm>`; (a)–(c) are read from its table. The evidence dashboard
(`benchmark-dashboard-data.mjs` → `/platform/admin/ocr-evidence`) is regenerated after scoring.

## Outputs

- `scripts/eval/benchmark/greek-ext.json` (registry), `benchmark/script-class/greek-ext-*.json`,
  `benchmark/refs/greek-ext-*.{txt,json}` (committed).
- `scripts/eval/results/benchmark/greek-ext-<date>.json`, `greek-<date>.json` (rescored with by-eye
  classes and rebuilt references), `decisions/greek-period-<date>.json`.
- `src/data/ocr-benchmark-evidence.json` (dashboard).
- Result table + verdict per period on #4744, one summary line on #4925, an `EXPERIMENTS.md` entry.
- A measurement comment on #4884 (the screen numbers are its step 1 for Greek, free).

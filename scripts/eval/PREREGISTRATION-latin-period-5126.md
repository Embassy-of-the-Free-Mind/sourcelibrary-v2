# Preregistration — Latin print by century: does flash-lite read well enough? (#5126, #4925)

PRIOR ART: `PREREGISTRATION-greek-ext-4925.md` — the house template for "which engine reads a script, per
period of print": this file copies its decision rules (a), (b), (d), (e), its catastrophic definition and
its lite-vs-lite floor, unchanged. What differs is the sample (reference-defined, like
`eebo-tcp-5488`, not a screened draw) and the prompt (production's, because the question is routing).
`experiments/2026-10-01-early-english-ocr-accuracy-against-eebo-tcp-5488.md` — the same reference route
for English; its 15 Latin 1600s books ran with the generic prompt and are not pooled here.

Written 2026-10-04, after the references were built and sealed and **before any engine read a sealed
page**. Nothing below changes after the run; deviations are reported as deviations.

## Question

For Latin **printed** books, per century of the scanned edition — pre-1500, 1500s, 1600s, 1700s — should
production OCR stay on `gemini-3.1-flash-lite`, or move to `gemini-3-flash-preview` (about 2× per page on
Batch, #5575)? 14M pages of Latin sit behind this. This job produces the evidence cell and the rule
output; it does not change routing.

## Sample (sealed; `scripts/eval/benchmark/latin-period-5126.json` is the seal)

One page per book, our own scans. A page is in the set only if an open, human-made transcription of
**the same edition** exists and a reader opened the image and found the reference to be that leaf.

- **Sources searched** (all $0): the CAMENA TEI corpus (1,751 files, 543 works; CC BY-SA 4.0 mirror,
  `nevenjovanovic/camena-neolatinlit` @ 771bb7f), EEBO-TCP (our 915 EEBO/ECCO-microfilm Latin books joined
  on STC/Wing number; 31 matched, 15 already in `eebo-tcp-5488` and excluded), la.wikisource `Liber:`
  indexes dated before 1800 (172; proofread pages only, quality ≥ 3).
  Not usable, recorded: GT4HistOCR (lines are shuffled and diplomatic); CAMENA ITALI (headings only);
  the CAMENA site itself (timed out; the mirror was used); TML (index moved, licence unstated, and this
  box has no private store); Bibliotheca Augustana and Corpus Corporum (normalised texts tied to no
  edition, so no leaf check can pass).
- **Match.** Catalogue match (year ± 2, author, title words), then the stored OCR of 10–60 pages against
  the transcription: the same text on ≥ 2–3 pages, and the transcription's page breaks falling where our
  pages break (`same_edition: page-breaks`), or the STC/Wing number (`catalogue-number`). 89 books
  passed. A further 13 books that match by catalogue but have no stored OCR were located by eye
  (`page-unit-by-eye`): a seeded transcription page (Mulberry32(5126), interior 10–90 %, ≥ 600 letters)
  found in our scan by a reader.
- **Page.** `build-edition-refs.mjs --draw=8 --seed=5126`; the accepted pages in page order, middle one
  first, the first with a reference of ≥ 500 characters. Where none of the 8 was accepted (a partly
  transcribed book) the same seeded permutation was read further (24, 72, all).
- **Leaf check, by eye, before any engine ran** (`results/latin-period-5126/leaf-check.json`, 136 rows):
  Sonnet readers opened every image and compared start, end and three spots with the reference; verdicts
  ok / edge / wrong-leaf / unusable, the leaf's language, page type, abbreviation load. Refused: 14 edge
  (mostly marginal-note blocks the transcription omits), 12 wrong-leaf (the stored OCR and the image are
  different leaves, #3368), 7 unusable, 3 different edition, 1 corrupted reference, 1 not found; index,
  table and title pages and vernacular leaves were refused even when the text matched. Up to two
  alternates per refused book were checked the same way. Opus opened a sample and overruled two "ok"
  (Newton 1687 and Columella 1787 on Wikisource: right leaf, another edition's wording).
- **Result: 82 books.** 1500s **27**, 1600s **50**, 1700s **5**, pre-1500 **0** (the one incunable with a
  same-edition transcription failed the leaf check). 65 CAMENA, 11 EEBO-TCP, 6 la.wikisource. Edition established by page breaks 56, STC/Wing number 11,
  page located by eye 9, same text confirmed on the leaf 6. Page type by eye: 57 prose text, 14 verse,
  10 front matter (dedications, prefaces), 1 dictionary — fewer front-matter pages than limit 2 feared.
- **Corrected-OCR sub-strata (11 pages, never in a century cell).** The #5695 T1 transcriptions
  corrected against the image (PR #5721): 5 incunabula, 2 from the 1500s, 4 from the 1600s. Each is a
  correction OF a served read (8 of flash-preview, 3 of lite) and so leans toward that engine (#5700
  A5). They are run and reported as their own exploratory rows, split by the engine they were corrected
  from, because they are the only incunable pages with any reference.

**Known limits of this sample, fixed before the run.**
1. **Selection by the served read.** For 73 of the 82 books the page was located with the stored OCR
   (overlap ≥ 0.35). A page the served engine read catastrophically cannot be located and is absent.
   This flatters whichever engine made the stored read — mostly lite. The 9 books located by eye have
   no such filter and are reported as a slice.
2. **Front matter.** Many of our Latin books have OCR on their first 25 pages only, so drawn pages lean
   to dedications and prefaces. The leaf check recorded `page_type`; body text vs front matter is
   reported as a slice.
3. **The reference is not perfect.** CAMENA says of itself that only the image is citable; the leaf
   check met typos (Scaliger 1628: *Niprius* for *Nil prius*). CAMENA and most Wikisource pages expand
   abbreviations and write `et`/`que`; EEBO-TCP keeps them and has `<gap>` spans. Absolute CER therefore
   carries a floor that is not reader error. The paired comparison cancels it; rule (a) does not, and is
   read beside a diagnostic: the share of reference letters on which BOTH engines agree against the
   reference (an upper bound on reference error plus convention).
4. **German and Swiss printing dominates** (CAMENA): roman and italic type, humanist Latin. Incunable
   gothic type with heavy abbreviation — the case the #5126 comment of 2026-10-03 is about — is covered
   only by the five corrected-OCR pages.
5. Public e-texts may be in either engine's training data. Non-canonical texts were preferred (two
   records are flagged `canonical`); recitation is watched through refusals and the by-eye read.

## Arms

Identical JPEG bytes (exported by `benchmark-seal.mjs`, max width 2400). The **production OCR prompt**,
loaded live by `lib/production-prompt.mjs`: version **19.1**, `content_hash`
**`9d8f959e053491362b2c4acec1e20c9a`**, asserted by the runner (`--prompt-hash`); a different hash stops
the run. `temperature: 0`, `thinkingBudget: 0`, `maxTokens: 16000`. One retry of a refused page, as
production does; the first refusal stays in the meter.

| arm | out dir | pages |
|---|---|---|
| `gemini-3.1-flash-lite` (production) | `gemini-3.1-flash-lite` | all 93 |
| `gemini-3.1-flash-lite` repeat (the A-vs-A floor) | `gemini-3.1-flash-lite-b` | 20, `results/latin-period-5126/repeat-slugs.txt` (Mulberry32(5126) shuffle of the 82 cell pages) |
| `gemini-3-flash-preview` | `gemini-3-flash-preview` | all 93 |

Runner: `benchmark-run-api.mjs --prompt=production --refusal-retry=1` (realtime; it has no Batch mode).
Spend cap **$5** Gemini in total (`--cap`), expected ≈ $1.

## Metrics (as `benchmark-score.mjs` computes them — no second scorer)

Per page and engine against the reference: CER (Levenshtein over the reference, the scorer's Latin
normalisation: tags out, case folded, long s folded, line-break hyphens rejoined); **catastrophic = CER >
0.5**; refusals from the meter (`finishReason`), scored as CER 1.0 in the headline and reported apart;
invention; loop flag. Paired per page against lite.

## Decision rules, per century cell

Δ = CER(flash-preview) − CER(lite) per page; Δ₀ the same for the lite repeat. Computed by
`benchmark-cost-lane.mjs --strata=latin-period-5126 --cells=results/latin-period-5126/cells.json
--engine=gemini-3-flash-preview`; its `prereg` block is the rule output.

(a) **Is lite good enough?** lite's median CER with bootstrap 95 % CI and its catastrophic count. "Adequate"
    if median CER ≤ 0.05 AND catastrophic ≤ 5 % of pages; "inadequate" if median CER > 0.10 OR catastrophic
    > 15 %; between: "degraded", routing decided by (b). (Thresholds as in the Greek prereg; the Greek run
    showed they do not transfer cleanly across a convention floor, so (a) is read with limit 3.)
(b) **flash-preview vs lite.** Preview is preferred for the century if it wins the paired sign test
    (p < 0.05 on the untied pairs) AND median Δ ≤ −0.01 with CI-upper < 0 AND catastrophic ≤ lite's AND
    median invention ≤ lite's (`invention_indep`, the definition the Greek run fixed; all three are
    reported). Else lite stays: a tie is a lite verdict, because preview costs about twice as much.
(d) **Noise floor.** A margin narrower than |median Δ₀| decides nothing. At temperature 0 the repeat is
    expected to be near-identical, so this check can hardly fail; it is reported as measured.
(e) **Grade.** A century with ≥ 50 referenced books gets the rule output as a decision-grade statement
    ("keep lite" / "move to flash"). With 30–49 it is **directional**: intervals and the direction of (b),
    no routing statement. Under 30 it is **exploratory**: numbers only, and the cell's line is "not enough
    refs". No proxy top-ups, no pooling of centuries to reach a grade.

Known before the run from the counts above: the 1600s can be decision-grade (50, if no page is dropped);
the 1500s (27) and 1700s (5) are exploratory; pre-1500 has no cell. A pooled 1500–1799 row is reported as
a secondary, labelled as pooled, never as a century's verdict.

## By eye, after scoring

The five worst pages per engine in each cell (and all five incunable pages): image opened, each error
classed — abbreviation expansion, long s, ligature, misread, layout/order, omission, reference error. A
page whose reference is wrong is marked `reference_error` and dropped from its cell, with the reason
disclosed and the rule re-run; the count of such drops is reported.

## Outputs

`benchmark/latin-period-5126.json`, `benchmark/refs/ed-*` (text public, licences in each record),
`results/latin-period-5126/` (candidates, leaf check, cells, repeat slugs, packed engine outputs, by-eye
classes), `results/benchmark/latin-period-5126-<date>.json`,
`results/benchmark/decisions/latin-period-5126-<date>.json`, `src/data/ocr-benchmark-evidence.json`,
one file in `experiments/`, rows in `DECISIONS.md` (Decision = UNJUDGED — for Derek), a result comment on
#5126 and one line on #4925.

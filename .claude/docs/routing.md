# Routing: which route reads or translates a page

PRIOR ART: merged from `archive/ocr-lane-decision-tree-2026-11-06.md` and `archive/ocr-engine-routing-2026-11-06.md`
(#8283), whose hand-written routes had drifted from the code. `scripts/eval/DECISIONS.md` is history. `router-optimization-paper.md`
is how the table is validated. `scripts/eval/ocr-routing/README.md` is the page-kind lookup behind `/quality`.

**Read this when** a book or a page needs text or English, a page came back empty or refused, or you are about to pick
`--model`, an engine or a lane by hand.

## The one place routes are decided

The router table, `scripts/eval/estimator/router-table/`: `rules.json` holds the evidence and the rule, `build.py` builds a
dated table, and `current.json` names the table that is live. A cell is language or source × script type. To change a route,
add evidence: the nightly `lane-judge-sampler.mjs` rebuild moves `current.json` through a PR it opens, and reverting that PR is the
rollback. No other file decides a route, including this one.

Lanes read it through `scripts/lib/router-binding.mjs`, and the OCR router through `router_cells` in `ocr-routing-table.json`. The
translation routers read their hand rows; `tests/unit/router-bound-table.test.ts` fails when either router disagrees with the table.

## The four routes

| route | what runs |
|---|---|
| **agy** | agy 3.8 Flash reads or translates alone |
| **GPU>agy** | agy 3.8 Flash corrects a draft |
| **Opus** | Claude Opus (`claude -p`) reads or translates alone |
| **GPU>Opus** | Opus corrects a draft |

A draft is a GPU read from a named engine, or a read we already store, which costs nothing. The table below writes the draft's name: `pero>agy`, `lite>Opus`.

## The rule

Severity-weighted defects per 1,000 words, against the live route (`rules.json` `decision_rule`). agy is the default. Opus runs
only where every agy route fails the hard floor (invented or wrong-leaf text). **An untested cell gets agy, never the incumbent.**
A kept route faces the same bar as a candidate.

## GPU draft engines

Each is tied to the cell or script that earned it.

| engine | drafts | lane |
|---|---|---|
| PaddleOCR-VL | Chinese, Japanese print; Chinese manuscript | `scripts/workers/paddle-print-lane.mjs`, `paddle-zh-guarded-lane.mjs` |
| Kraken | Syriac. Kraken lane on Hetzner (`syriac-kraken-lane.mjs`). Never Gemini: it recites the printed edition (#4883). No cell yet | books held |
| Yigdzin (BDRC) | Tibetan | `scripts/maintenance/apply-reocr-verdicts.mjs` |
| LightOnOCR | English 1800+, Fraktur | `scripts/workers/gpu-print-lane.mjs` |
| PERO | Latin-script print | `scripts/batch/pero-draft.py` |
| GLM | Latin-script print | `scripts/gpu/glm-english-run.py` |

## The table (generated)

Written by `node scripts/maintenance/router-routing-rows.mjs --write`; `tests/unit/router-routing-rows-7913.test.ts` fails when it is stale.

<!-- BEGIN GENERATED route-table: scripts/maintenance/router-routing-rows.mjs writes this section from the router table. Do not edit it by hand. -->

From `current.json` (`2026-11-12-nightly`, set 2026-11-12; 6 cells moved alone, 4 waivers). `A>agy` and `A>Opus` correct draft A. `*` = agy by default, not measured here. `†` = undecided (HOLD, held, planned, untested), showing the route the row names. `—` = no such cell.

**OCR**

| cell | pages waiting | print | manuscript | unknown |
|---|---:|---|---|---|
| `latin-flash3` | 1.3M | 3flash>agy † | 3flash>Opus | agy * |
| `latin-lite` | 862K | agy | agy * | lite>Opus |
| `zh-paddle-dice-lt090` | 454K | — | paddle>Opus † | paddle>agy * |
| `greek-flash3` | 419K | 3flash (off menu) † | 3flash>Opus † | 3flash (off menu) † |
| `german-lite` | 419K | lite>Opus | agy * | lite>agy * |
| `german-flash3` | 353K | 3flash>Opus | 3flash>Opus | 3flash>agy * |
| `tibetan-yigdzin` | 281K | yigdzin>agy * | yigdzin>Opus † | yigdzin>agy * |
| `french-lite` | 151K | agy * | lite>Opus | lite>agy * |
| `chinese-flash3` | 104K | 3flash (off menu) † | 3flash>agy * | 3flash>agy * |
| `hebrew-flash3` | 51K | 3flash>Opus | 3flash>Opus | 3flash>Opus |
| `italian-lite` | 47K | lighton>agy * | agy * | agy * |
| `greek-lite` | 43K | lite (off menu) † | lite>Opus † | — |
| `sanskrit-lite` | 39K | lite (off menu) | agy * | agy * |
| `arabic-flash3` | 30K | 3flash>agy * | 3flash>agy * | 3flash>Opus |
| `arabic-lite` | 28K | lite (off menu) | lite>Opus † | — |
| `zh-frame-6871` | 22K | — | paddle>agy | — |
| `russian-lite` | 19K | agy * | agy * | agy * |
| `zh-lite` | 19K | agy † | agy * | — |
| `spanish-lite` | 17K | agy * | agy * | agy * |
| `korean-lite` | 17K | agy * | agy * | agy * |
| `danish-lite` | 6K | agy * | agy * | agy * |
| `middle-english-lite` | 5K | agy * | agy * | agy * |
| `old-french-lite` | 2K | agy * | agy * | — |
| `portuguese-lite` | 2K | agy * | agy * | agy * |
| `mhg-lite` | 1K | agy * | agy * | agy * |
| `tamil-lite` | 225 | agy * | agy * | agy * |
| `ottoman-lite` | 131 | agy * | agy * | agy * |
| `hindi-lite` | 65 | agy * | — | agy * |
| `turkish-lite` | 50 | agy * | agy * | agy * |
| `english-blank-pre1800` | 0 | — | — | scans-only (off menu) |
| `english-gpu-7263` | 0 | gpu-glm>agy * | agy * | — |
| `french-blank` | 0 | agy | agy * | — |
| `french-gpu-7263` | 0 | agy * | agy * | — |
| `german-blank` | 0 | agy | agy * | — |
| `german-blank-antiqua` | 0 | agy | — | — |
| `german-blank-fraktur` | 0 | lighton>agy † | — | — |
| `german-gpu-7263` | 0 | gpu>agy * | agy * | agy * |
| `italian-gpu-7263` | 0 | agy * | — | — |
| `latin-blank` | 0 | pero>agy | — | — |
| `latin-gpu-7263` | 0 | pero>agy | agy * | — |
| `zh-6561-served` | 0 | paddle>Opus | paddle>Opus | — |

**Translation**

| cell | pages waiting | print | manuscript | unknown |
|---|---:|---|---|---|
| `german-tr-flash3` | 307K | agy | agy * | flash3 (off menu) * |
| `german-tr-lite` | 151K | flash-lite (off menu) † | agy * | flash-lite (off menu) * |
| `latin-tr-first` | 53K | agy * | agy * | agy * |
| `zh-siku-tr` | 51K | — | agy | — |
| `german-tr-first` | 44K | agy * | agy * | agy * |
| `french-tr-first` | 13K | agy † | agy * | agy * |
| `italian-tr-first` | 7K | agy * | agy * | flash-lite (off menu) † |
| `tengyur-tr` | 0 | — | — | agy * |
| `tibetan-tr` | 0 | — | Opus | — |
| `zh-siku-first-tr` | 0 | agy * | agy | — |

<!-- END GENERATED route-table -->

## What holds on every route

1. **A lane without provenance does not run.** `ocr.source` names the producer, the engine block comes from `write-provenance.{mjs,ts}`, and every write snapshots to `page_revisions` and refuses a human edit. Registry and rules → `data-provenance.md` §5.
2. **No OCR on the paid API** (`API_OCR_MODELS` is empty, `assertApiOcrModel` refuses). Gemini runs on the agy CLI (`cli-ocr.mjs`), Claude on `claude -p`, both on the subscription. A lane with no quota waits; it never falls through.
3. **No Tesseract**, as an engine or as a free reference (Derek). Never Gemini below v3.
4. **Split spreads before any read.** A two-leaf page is two discontinuous halves. A photo of several pecha leaves is split into one page per leaf, and each leaf is read and translated alone (Derek, #5771). A whole-page read invents lines where the leaves meet, so never keep it over its own leaf reads because it is longer. Cutting a stored whole-page read is not a split: re-read the leaves. A leaf read alone needs a blank- and title-leaf guard. Evidence: `scripts/eval/experiments/2026-10-25-split-leaf-reread-gate-5771.md`.
5. **`language` is the EDITION's language** (`invariants/language-fields.md`). Fix a wrong one before routing.
6. **A write is actuation.** Gap-fill retranslates a released book whose English is older than its OCR. Hold first if that needs approval.

## A page that came back empty or refused

Read `batch_jobs.fail_reasons` and the stamps `ocr.recitation_count` / `ocr.fail_reason` first; the reason picks the branch.

- **RECITATION, or MAX_TOKENS on a dense page:** agy again → MinerU with grounded correction (`mineru-ocr-worker.mjs`, 1820+ only; before that it reads ſ as f) → the Archive's text for that leaf, under an accepted by-eye verdict (`ia-ocr-ingest.mjs --by-eye`; Greek never, and never over a read on a date-dense book) → by eye on the subscription, or leave it stamped `recitation_blocked` / `fail_blocked`.
- **SAFETY or `error:<status>`:** transport or key, not the page. Fix the submission.
- **STOP with no text:** usually a blank leaf; `blank-page-guard.mjs` decides.
- **Text that is wrong** (another book's page, a loop, an invention): a repair, not a re-OCR → `invariants/derived-metadata-lane.md`, `page-error-taxonomy.md`.

A canonical e-text (Derge, Perseus, Sefaria) is a reference for evals, never page text.

## Testing a route

`Skill: paired-arm-judge`, on the pages the other arms were judged on. On a page with no text the alternative is nothing, so the
gate is the harms only (no invented text, planted errors caught, the script's letters kept). A bar on the score belongs only where the read
replaces stored text, paired against that text (#6559). Where a page has a complete draft, correcting it usually beats re-reading it, unless the draft is near perfect (#6694, #6561).

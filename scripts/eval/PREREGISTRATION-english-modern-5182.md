# Pre-registration — modern English print: is lite adequate, or should 1800s / 1900+ pages go to flash? (#5182)

_Written 2026-09-26, **before any model call**. Routing question #4877 (lite-only
carve-out unreachable, measured bad on early print and manuscripts — never measured
on modern print), reference strata #5124, design `.claude/docs/eval-design.md`
(#5106). Derek's brief (ops handoff 2026-09-26): "do it and spot check", ≈ $2 of
model spend, **hard cap $5**. One background session, one worktree._

PRIOR ART: `PREREGISTRATION-per-language-ocr-suitability.md` (house format; its
1.0 pp / catastrophic / coverage rule is the template this narrows); `PREREGISTRATION-greek-ext-4925.md`
(the sealed-draw + e-text-window + by-eye pattern for a library stratum);
`benchmark-seal.mjs`, `benchmark-refs.mjs`, `benchmark-run-api.mjs`, `benchmark-score.mjs`,
`benchmark-dashboard-data.mjs` (the standing bench this adds two strata to). None of them
holds an English library page with a reference: the design's gap table (§11) shows
English at 0 references for 940K live pages.

## Question

Production routes every English book to `gemini-3.1-flash-lite` (`LATIN_SCRIPT_LANGUAGES`
→ lite; `OCR_LITE_ONLY` on top). For **modern English print** — catalogue years
1800–1899 (`english-1800s`, ≈ 367K live pages, 914 books) and 1900 on (`english-1900s`,
≈ 306K live pages, 954 books; 92 % of them 1900–1939) — is lite *accurate* enough, or
should these pages go to `gemini-3-flash-preview`?

`measure: accuracy` only (design §2). Agreement between the two engines is reported
nowhere as a quality number.

## Population and sample

- Atlas `books`: `visible: true`, `pages_count > 5`, `language` ∈ {English, eng},
  catalogue year (first 1400–2029 four-digit number in `books.published`) in range,
  title not matching the manuscript regex used by every other stratum
  (`manuscript|MS|codex|palimpsest|lectionary|mss`). Books already sealed in
  `longs-en-fr` are excluded (none overlap by year; the guard is kept).
- **One page per book** (§3.1). The book list is id-sorted and Fisher–Yates-shuffled with
  Mulberry32(seed × 100 + 0); the page is uniform over the **interior 15 %–95 %** of
  `pages_count` (§3.2: front matter lies; the earlier strata used 10–90 %, this one follows
  the design doc). Up to 6 page draws per book; a page is skipped when it has no usable
  image (`getPageSource`) or its stored OCR shows fewer than 120 letters (plate, blank).
- **Seeds:** `english-1800s` 5182, `english-1900s` 5183 (issue number, as `latin-1700s` used
  4801 next to 4800).
- **Draw order is the seal.** The stratum file records the first 50 books as sealed pages
  and a long tail of spares (150) in the same deterministic order. The reference step walks
  the order: a page with no e-text is retired `skipped: no-e-text`, a page whose reference
  window is not that leaf is retired `leaf_check: shifted`, a page the identity guard cannot
  place is retired `skipped: no-align`, and the next spare is promoted — until **50
  referenced pages per stratum** with `leaf_check: ok`. Every retirement is written to the
  registry with its reason; the spare count exceeds the earlier strata's 4–10 because the
  e-text hit rate for this library's English holdings (occult, Theosophical, alchemical
  reprints, sermons) is unknown and expected well below 100 %. Walking further down a sealed
  order is not a redraw.
- **Probe.** The page's stored production read (`pages.ocr.data`, tags stripped) is the probe
  that locates the e-text window. It is never the reference. Books whose drawn page has no
  stored OCR are skipped at draw time (`no-probe`) and counted; on a 40-book sample ~12 % of
  interior pages lacked OCR (recent imports), which biases the sample toward books already
  processed, not toward a print quality.

### Classification from the page (§3.2)

Every page that reaches the leaf check is classified **by eye from the image** (the image is
opened; the label says `by: eye`): `observed.script` (latin / other), `observed.kind`
(print / manuscript / mixed), `observed.period` (the leaf's print date as read from
typography and layout, in the catalogue bucket or `earlier` / `later` / `unknown`),
`observed.canonical` (Bible, Shakespeare, Milton, Homer and other classics in translation,
canonical scripture = true; a stratum keeps ≤ 10 canonical pages, non-canonical preferred in
draw order — a canonical page past the tenth is retired `skipped: canonical-quota`). The
catalogue→observed transition rate is reported per stratum. Pages retired before the leaf
check (`no-e-text`) are not opened; their classification is `unclassified`, stated as such.

## References (§4)

Sources in order, all free, none a model:
1. **en.wikisource, `Page:` namespace (ns 104)** — a page-level proofread transcription of a
   specific scan. Search by 3–6 quoted content phrases from the probe; a title needs ≥ 2
   phrase hits; text via `action=query&prop=revisions` (wikitext → `lib/wikisource-text.mjs
   cleanPageText`), `source_revision` = revid. `unit.kind: page`; `alignment.method:
   wikisource-page`. `edition_match: same` when the djvu/pdf is our IA identifier, else
   `different`.
2. **en.wikisource, main namespace** — a whole-work transcription (no scan): window cut by
   word-n-gram vote against the probe. `unit.kind: window`, `edition_match: different`
   (unknown edition) unless the page header names ours.
3. **Project Gutenberg** — Gutendex `books?search=<author> <title words>` (Gutendex was
   timing out on 2026-09-26; fallback: the Gutenberg catalogue CSV
   `cache/epub/feeds/pg_catalog.csv`, fetched once, matched by title words + author
   surname), plain text from `cache/epub/<id>/pg<id>.txt`, PG header/footer stripped, window
   by n-gram vote. `unit.kind: window`, `edition_match: unknown` (Gutenberg rarely records the
   edition) — counted separately from `same`.
- **Window acceptance:** ≥ 0.35 of the probe's distinct word 4-grams inside the window
  (the bench's `MIN_OVERLAP`), else `skipped: no-e-text` with the best candidate named.
  Window ends are trimmed to the probe's outermost matching 4-grams (an edge omission by the
  probe engine is the one blind spot; the by-eye leaf check reads the first and last lines
  of the image against the reference and catches it).
- **IA `_djvu.txt` is never a reference** and is not used as a probe either; it may inform a
  leaf check only.
- **Leaf check by eye on every referenced page** (§4.1 "no reference without a leaf-identity
  check"): the image is opened, the reference's first and last lines are read against it,
  `leaf_check: {status: ok|shifted|wrong-work, by: eye, at, note}` — the note says what was
  read from the image. Shifted → retire, promote the next spare.
- Fields on every record: `slug, source, source_url, source_revision, licence, unit,
  alignment, leaf_check, canonical, memorization_risk, edition_match, made_by: null,
  reference_error_rate: null` (no hand-read error rate this round; stated as a limit).
- Licence: Wikisource transcriptions CC BY-SA 4.0 (public-domain text); Gutenberg
  "Project Gutenberg License" (PD text, trademark terms). Both exportable.

## Engines (arms)

| arm | engine dir | prompt | runs | pages |
|---|---|---|---:|---:|
| production | `gemini-3.1-flash-lite` | live production OCR prompt (`prompts` v16, hash recorded) via `lib/production-prompt.mjs` | 1 | all referenced (≈ 100) |
| candidate | `gemini-3-flash-preview` | same prompt | 1 | all referenced |
| noise floor | `gemini-3.1-flash-lite-b` | same | 1 | the first 10 referenced pages of each stratum in draw order (20) |

`thinkingBudget: 0`, temperature 0, one image per call at ≤ 2400 px width (the bench's
export), `maxTokens 16000`. Every metering row records `prompt_id`, `prompt_hash`,
`thinking`, `temperature`, `finish_reason`, tokens (incl. thoughts), `cost_usd`;
`provenance_captured: true`. The production prompt is used for BOTH Gemini arms because the
question is what production would produce if the routing constant changed, and the bench's
generic prompt would not measure that.

**Expected spend:** ≈ 220 calls × (≈ 4K input incl. the 9.3K-char prompt, ≈ 1K output):
lite ≈ $0.0025/page, flash ≈ $0.005/page → **≈ $0.80**. Stop and report BLOCKED if the
running total passes $5.

## Scoring

- Primary: `scoreAgainstReference(reference, output, 'english')` from `lib/metrics.mjs` —
  a new `english` script definition (lower-case, diacritics folded, ſ→s; **no** v/u, j/i,
  w/uu folding, which the `latin` def applies for early-modern Latin and which would blind
  the metric to real modern-print confusions). Identity guard: word-subsequence WER ≤ 0.35.
  `cer = 1 − charAccuracyWindowed` (fitting alignment: leading/trailing insertions — running
  header, page number, catchword the Wikisource page keeps in `<noinclude>` — are free;
  interior insertions charged). `acc_upper` (free-skip) is recorded beside it as the bracket.
- **Unaligned** (`aligned: false`) is an outcome, not a score: `cer: null`, counted in
  coverage and as catastrophic for the engine that failed to align while the other aligned;
  a page **no** engine aligns is a reference fault → `skipped: no-align`, retire and promote.
- **Catastrophic:** CER > 0.5 or unaligned-while-the-other-aligned. **Loop:** the bench's
  repeated-line / 3× length detector. **Refusal / empty / truncated:** from `finish_reason`
  and content length — outcomes, counted as failed reads.
- Structural: `len_ratio`, lines vs reference lines (a dropped first line is invisible to an
  order-free score).
- Paired only on shared referenced pages, one page per book: wins–losses–ties, median Δ CER,
  bootstrap 95 % CI, exact sign test (`benchmark-dashboard-data.mjs paired_vs_production`).
- **A-vs-A first:** lite vs lite-b on the 20 repeat pages — median |Δ| and the tie rate are
  the noise floor; the lite-vs-flash margin is read against it. At temperature 0 the earlier
  strata saw byte-identical repeats on ~86 % of pages; a floor near 0 is expected and is
  still reported.

## Decision rule — fixed now

Per stratum, **lite is adequate** if all three hold on the referenced, leaf-checked,
non-canonical-first pages:

1. **median CER(lite) ≤ 2.0 %**;
2. **catastrophic rate(lite) ≤ 2 %** (≤ 1 of 50);
3. **paired loss to flash: median Δ CER (lite − flash) ≤ 1.0 pp** on the shared pages.

Otherwise the result is **"propose flash for this stratum"** — a proposal on #5182 quoting
the cell id, the paired table, the noise floor and the cost delta per year at production
volume. **Derek decides**; this session changes no routing constant, allowlist or lane
(design §10). The two strata are decided separately and never pooled with each other or
with `longs-en-fr` (1600–1779, different type).

Grades follow the dashboard thresholds: decision-grade ≥ 50 referenced books **and** ≥ 50
untied pairs; directional 30–49; below 30 exploratory and not quoted as a rate. A cell that
is decision-grade only with canonical pages is labelled `canonical-dependent`. Edition
match is reported as a split (`same` vs `different`/`unknown`): a "difference" on a
different edition may be the edition's, and the by-eye read of the five worst pages per
engine (#4735 rule 5) names the error kind before any number is read as an engine fault.

## What this cannot see (stated now)

- The reference's own error rate is not hand-read this round (`reference_error_rate: null`);
  Wikisource validated pages (level 4) are near-clean, Gutenberg texts carry modernised
  punctuation and occasional silent corrections — CER differences under ~0.5 pp are inside
  that.
- A window from a **different edition** charges the edition's variants to both engines
  alike; the paired verdict survives, the absolute CER is an upper bound on error.
- Pages **without** an e-text (the `no-e-text` list) are the transcription queue, and they
  are plausibly the harder pages (obscure reprints, poor scans). The rate quoted is for the
  referenced population; the skip list is committed so the bias is visible.
- Both engines were run once each on the main arms; day-to-day model drift is not measured.

## Landing (§9)

Registry `scripts/eval/benchmark/english-1800s.json`, `english-1900s.json`; references
`scripts/eval/benchmark/refs/english-*.{txt,json}`; results
`scripts/eval/results/benchmark/english-1800s-<date>.json`, `english-1900s-<date>.json`,
`summary-<date>.json`; `src/data/ocr-benchmark-evidence.json` regenerated; `EXPERIMENTS.md`
entry (date · question · design · result · replicated? · artifact, cost, grade); PR to main
(review-gated); result comment on #5182 with cell ids; one line to the dispatcher.

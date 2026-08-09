# Datasheet: Source Library First-Translation Verification Corpus

*Format follows Gebru et al., "Datasheets for Datasets" (CACM 2021). This file is
copied into every export as `DATASHEET.md` by `scripts/eval/export-ft-dataset.mjs`;
per-snapshot counts, checksums, and the generating git SHA live in the accompanying
`manifest.json`. Figures quoted below are from the 2026-08-09 snapshot unless dated
otherwise.*

## Motivation

**Why was this dataset created?** Digital libraries increasingly attach AI-generated
"first English translation" claims to books. Such a claim asserts a *universal
negative* — that no prior translation exists anywhere — which no lookup can prove and
which fails in both directions (false firsts on famous works; genuine firsts never
assessed). Source Library's response was to stop asserting the bare negative and
instead record the *search*: every verification attempt, its sources, queries,
result, and evidence grade, in an append-only provenance ledger. This dataset is
that ledger, published. To our knowledge no library publishes documented
evidence-of-absence at this scale, and the dataset exists so that (a) every public
first-translation claim on sourcelibrary.org is independently auditable, and (b)
researchers studying LLM factuality, negative-existence claims, and metadata quality
have a real deployed-system corpus to work with.

**Who created it?** Source Library (Embassy of the Free Mind), 2026. The verification
instruments are AI systems (grounded Gemini calls, Claude tool-using agents,
deterministic catalogue matchers) plus a small number of human reviews; the pipeline
code is AGPL at https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2.

## Composition

**What do the instances represent?** Four related tables:

1. **`attempts.jsonl` / `.csv` (63,173 rows)** — one row per verification attempt on
   one book: instrument (`method`), date, match key, sources consulted, verbatim
   queries (present on 17,736 rows), result (`found` / `none` / `not_applicable` +
   legacy variants), structured priors found (18,189 rows carry at least one),
   evidence strength, model id, cost, and free-text rationale. Append-only in the
   source system; 29,938 distinct books are covered.
2. **`verdicts.jsonl` / `.csv` (10,377 rows)** — one row per book carrying a resolved
   graded verdict under the 8-verdict taxonomy, with public bibliographic metadata
   (title, author, language, original language, year), the qualifiers
   (evidence strength, our-item completeness, match key, prior relationship), the
   resolving tier, and a pointer (`best_attempt_id`) into the attempts table.
   Distribution at snapshot: 9,630 `first_no_prior`, 339 `not_first`,
   124 `first_modern`, 106 `needs_review`, 79 `first_complete`, 77 `not_applicable`,
   22 `first_from_source`. Evidence strength: 238 strong, 987 moderate, 9,152 weak.
3. **`screening_decisions.jsonl` (82 rows)** — durable screening judgements keyed on
   (work, prior), which persist across regenerations of the underlying search efforts.
4. **`reference-set-summary.json`** — composition statistics of the 149,096-row
   bibliographic reference set (LoC / ESTC / Wikidata / internal classification)
   that catalogue-tier absence claims are asserted against, including its measured
   recall (see *Known limitations*). The full reference set is derivable from public
   catalogue dumps and is summarised rather than redistributed.

`taxonomy.json` is the codebook: definitions for every verdict, qualifier, method,
and result value, verbatim from the production type definitions.

**Does the dataset contain confidential or personal data?** No reader or usage data
of any kind. Book metadata is public bibliographic fact. Free-text fields are
model-written bibliographic prose, swept at export time for email addresses and
URL query-string credentials (tallies in `manifest.json`). The handful of human
attempts are labelled by role (`human`), not by name.

## Collection process

**How was the data acquired?** By the production verification pipeline,
February–August 2026, in tiers: deterministic registry links (tier 0), catalogue
sweeps against the reference set (tier 1), per-book grounded model adjudication
(tier 2: nightly grounded-Gemini crons and independent Claude verification
subagents, each running real catalogue/web searches), and human review. Each
attempt records which instrument ran, what it consulted, and what it concluded.
Since #3778 automated rows carry a `prompt_version`; a `transcript_ref` points into
a transcript store (full prompt + raw grounded response) where persisted. Rows
ingested from legacy stores are marked via `ingest_source`, and legacy backfilled
rows without an original timestamp carry epoch or nominal dates (e.g.
`2026-06-01T00:00:00Z`, `1970-01-01`) — treat `date` as reliable only on rows
written by the live instruments.

**Sampling?** This is the full production ledger, not a sample — minus the
exclusions below. The companion working paper additionally describes stratified
samples drawn *from* it (n=462 precision, n=1,000 recall) whose row-level records
are part of this ledger.

## Preprocessing / cleaning

- **Exclusions:** books hidden by takedown or owner/curator removal request, and
  test records, are excluded entirely — verdicts, attempts, and identifiers
  (2026-08-09 snapshot: 508 verdict rows, 1,661 attempt rows). Books hidden for
  ordinary curation/processing reasons are retained and flagged `visible: false`.
- **Redaction:** email addresses → `[email-redacted]`; URL query parameters named
  like credentials (`key`, `token`, `signature`, …) → `[redacted]`. Counts per
  snapshot are in `manifest.json`.
- **Determinism:** rows are sorted and field order fixed; two runs against the same
  database state produce byte-identical data files.

## Uses

**Recommended:** studying LLM behaviour on negative-existence claims (fabrication,
grounding, abstention); metadata-quality auditing methodology; translation-studies
bibliography (the structured `priors` are leads, graded by evidence); reproducing
or extending the companion working paper; building better instruments against a
documented baseline.

**Uses to avoid:**

- **Do not read a `none` result — or a `first_no_prior` verdict with `weak`
  evidence — as proof no prior translation exists.** Absence is graded evidence
  bounded by the reference set and the search; 9,152 of 10,377 verdicts rest on
  weak evidence, and the public site excludes weak-evidence claims from its
  headline counts for exactly this reason.
- Do not treat model-written `notes` or `priors` as verified citations: sampled
  audits found fabricated or muddled priors at material rates (see below). A prior
  is verified only when its cited record has been independently opened.
- Do not use the dataset to identify or profile any person; it contains none, and
  attempts to join it against personal data are out of scope of the license intent.

## Known limitations and biases

Measured, not hypothetical — each figure has an instrument in the repo:

- **Reference-set recall is 32.1%** (catalogue-only, 2026-08-07,
  `scripts/eval/ft-reference-set-recall.mjs`): roughly two of three known prior
  translations are invisible to the catalogue tier, so `none_found` at tier 1 is
  weak by construction. A sampled check put `none_found`'s positive predictive
  value near 50% pre-v2.
- **Post-1950 blind spot:** 80.8% of known Latin/Greek priors are post-1950
  imprints, while the deepest catalogue layers (e.g. ESTC) cover 1473–1800; the
  residual loss sits in modern scholarly publishing.
- **Badged-precision estimate ~46–58% first-family** on stratified samples
  (n=462 + an independent n=12 spot audit, 2026-08-09) — the dominant error being
  *ill-posed* claims (multi-work containers, standard liturgy copies, unique
  documents), not missed priors. False firsts concentrate on famous works.
- **Instrument fabrication:** single-pass model verdicts on the demote direction
  fabricated priors at ~63% before independent verification was made binding; the
  well-formed fabrication (a real scholar attached to a nonexistent work) defeats
  structural detectors.
- **Grounding is load-bearing:** a configuration flag that silently suppressed
  search grounding inflated "first" rates by ~4 points before being caught; rows
  from that period were re-run, but the incident is documented in the paper as a
  hazard of the method.
- **Source quality is uneven:** grounded search consults authoritative catalogues
  alongside low-authority aggregators, and WorldCat blocks automated agents —
  per-row `sources_checked` makes this auditable.
- **No human gold standard yet:** accuracy figures are AI-vs-AI agreements; the
  150-book human annotation pass (the binding step for the accuracy claim) is
  designed and tooled but not yet run.

## Distribution

Zenodo, versioned by snapshot date, under **CC BY 4.0**. The generating code is
AGPL-3.0 in the sourcelibrary-v2 repository; each snapshot's `manifest.json` pins
the git SHA that produced it. Cite the dataset DOI plus the snapshot version.

## Maintenance

Source Library maintains the dataset. New snapshots are produced by re-running the
exporter; the underlying ledger is append-only, so later snapshots strictly extend
earlier ones apart from verdict re-resolutions (which are themselves recorded as
new attempts) and any newly excluded takedowns. Errata: open an issue on the
sourcelibrary-v2 repository or use the site's feedback channel.

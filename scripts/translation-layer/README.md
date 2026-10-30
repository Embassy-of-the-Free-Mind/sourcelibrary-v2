# Work-level external-translation-prior layer (issue #2626)

Builds a **trustworthy, work-level** answer to "has this early-modern Latin work
ever been translated to English, by anyone, *before* Source Library?" on
`ustc_editions.work_cluster_id` — replacing the unreliable author-level
`has_english_translation` flag.

Full design, numbers, and invariants: `.claude/docs/work-identity-coverage.md`
(§"The external-translation-prior layer").

## Run

```bash
set -a; source .env.production.local; set +a
node scripts/translation-layer/01-build-external-works.mjs   # external works ∪ quarantine
node scripts/translation-layer/02-pull-ustc-clusters.mjs     # denominator (slow, ~80s)
node scripts/translation-layer/03-match-and-gap.mjs          # work-level match + gap report
node scripts/translation-layer/05-spotcheck.mjs              # Filelfo/Pico/Valla regression
node scripts/translation-layer/04-write-provenance.mjs       # DRY-RUN; add --write to mutate Supabase
node scripts/translation-layer/09-scan-coverage.mjs          # evidence-backed scan coverage (IIIF) + scanned x translated 2x2
node scripts/translation-layer/10-sl-coverage.mjs           # SL holdings/translations x external priors 2x2 (#7751)
node scripts/translation-layer/11-work-graph.mjs            # real WORK unit over USTC editions + our books; 2x2 at work level (#7751)
```

### Multi-language external side, staged (#7769)

```bash
# staged English-translation sets, one JSONL per source → scripts/output/translation-staging/
node scripts/enrichment/ingest-loc-bulk.mjs --parts 1-43 --out $JOB_SCRATCH/loc-bulk --staging $JOB_SCRATCH/loc.jsonl
node scripts/enrichment/ingest-openlibrary-translations.mjs --dumps <ol dump dir> --out $JOB_SCRATCH/openlibrary.jsonl
node scripts/enrichment/ingest-wikidata-translations.mjs --staging $JOB_SCRATCH/wikidata.jsonl
node scripts/translation-layer/01-build-external-works.mjs --staging   # → external-translation-works-staging.jsonl
node scripts/translation-layer/11-work-graph.mjs --lang german         # any of the 8 target languages
```

Staged rows go to `external-translation-works-staging.jsonl` and never over
`external-translation-works.jsonl`, because 03 reads that file and 04 writes
its priors into Supabase. Nothing here touches `translation_catalogs`, which feeds the
public badges and /census. Merging the staged set into it is a separate decision.
Phase 11 attaches each external work (an x node) to ONE existing work after
clustering, so the external side cannot reshape the denominator it is measured
against. `external_landing` in the report gives per-source counts, before and after.

Outputs land in `scripts/output/` (gitignored, regenerable):
`external-translation-works.jsonl`, `quarantine-sl-works.jsonl`,
`ustc-latin-clusters.jsonl`, `cluster-external-priors.jsonl`,
`translation-gap-report.json`.

The hand-built, authoritative series enumerations are committed under `series/`
(`i-tatti.json`, `brill-doml.json`) — these are the durable input, not scratch.

## The two invariants

1. **External priors only.** SL-origin evidence (`sl_ft_llm_claim`,
   `sl_ft_catalog_verified`, `validated_additions`, `in_source_library`,
   `sl_translation_percent`) is NEVER a prior — it rides a separate quarantine
   channel. Counting our own output circularly erases the gap we exist to fill.
2. **Match at the WORK level, not the author level.** `lib.titleFit`:
   surname-stem anchor + rare-token (IDF) title containment + author-name
   stripping. This is what fixes Filelfo (over-flag) and Pico (under-flag).

## Caveats before trusting a headline number

- The denominator is USTC **print** year 1400-1700 — includes reprints of
  ancient/medieval works → an UPPER bound on the Renaissance-composed corpus.
- ~10-15% residual false positives at the low-IDF boundary make the gap a
  *conservative* (lower-bound) figure.
- Keep public copy qualitative ("millennia" / Shuger's "90% never translated"),
  not a point estimate.

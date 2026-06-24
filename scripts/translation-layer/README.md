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
```

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

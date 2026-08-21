# Corpus snapshot & data-products build-out — 2026-07-23/24

Technical handoff for the #3327 data-products work (business/outreach side lives in
the private ops repo: `outreach/2026-07-23-ai-data-partnerships.md` — pricing
analysis, entity/legal structuring, outreach drafts, delivery runbook).

## What shipped (all merged)

- **#3329** `scripts/export/build-corpus-snapshot.mjs` — versioned corpus snapshot
  builder: per-language gzipped JSONL shards (book metadata + provenance +
  wrapper-stripped OCR/translation pages), manifest with per-shard sha256, counts,
  license block, itemized exclusions. Rights filters in code (visible+paged,
  non-artwork, numeric year ≤ 1930, `--exclude-file` hook). Verify phase re-queries
  eligible count and asserts sampled output carries no ZWC runs / wrapper tags.
- **#3332** eligibility fix: stale `hidden_reason` on visible books (see invariant
  below) had silently dropped 6,289 books (12,517 → 18,749 eligible).
- **#3337** editorial apparatus exported as labeled fields: per-page `annotations`
  (meta/summary/keywords/vocab) + `scan` (language/script/page-type/…) extracted
  from raw text BEFORE stripping; book-level `summary` + `chapters`. Quote-integrity
  invariant untouched.
- **#3339** length-guard before regex work (a degenerate page wedged the full build
  1h at 100% CPU — unclosed tag × lazy unbounded interior = O(n²), #3195 family);
  bounded annotation interiors; `current-book.txt` breadcrumb.
- **#3343** streaming sha256/verify (Latin shard is 4 GB gzipped — readFileSync caps
  at 2 GiB and killed finalization after a clean 11h build) + `--finalize-only`
  recovery mode that rebuilds manifest+verify from existing shard bytes.
- **#3345** verify flags ZWC *runs* (≥8), not single chars — isolated U+200C is
  Persian orthography (Rumi false-positive), while a real steganographia payload is
  ≥9 consecutive ZWCs/byte.
- **#3338** /licensing + /dataset + llms.txt: Grounding/RAG tier ($499/mo, $1,999/mo
  SLA), clean-data + living-corpus statements; /dataset Enterprise "exclusivity" →
  "custom scopes". **Deployed to prod** via deploy:prod (purge+warm verified).
- **#3349** `ai_crawlers` block in `/api/admin/metrics-snapshot` — 7-day per-bot
  hits from `analytics_bot_access` for the Monday digest (warm licensing leads).
- **#3334/#3335** stale-hidden_reason cleanup (6,411 unset, backup in ops repo,
  0 remaining) + CLAUDE.md invariant "hidden_reason is a flip-guard, not a read-gate".

## The artifact

**Snapshot v2026.07.23, certified:** 18,479 books · 5,025,784 pages ·
3,926,087,292 words (~6–8B tokens) · 210 language shards · 9.07 GB gzipped ·
88,371 flagged pages (1.76%). Verify: PASS. Top shards: Latin 1.70B words,
English 466M, Greek 389M, German 340M, Tibetan 159M.

- Origin copy: Hetzner `/root/corpus-snapshot-v1` (kept pending a full 210-shard
  checksum sweep before deletion; disk there is 87% full).
- Delivery copy: private R2 bucket `sl-corpus-snapshots/v2026.07.23/` (212 objects,
  byte-verified incl. the 4GB Latin shard; presigned fetch tested 200; unauth
  access probed and refused; no r2.dev public domain). Presign runbook in ops repo.

## Gotchas encountered (each now guarded in code)

1. `hidden_reason` residue on visible books — reconcile any filter's result count
   against itemized exclusion counts; unexplained residual = bug.
2. Degenerate pages × unbounded regex = wedge; length-guard BEFORE regex, breadcrumb
   for diagnosis.
3. `readFileSync` 2 GiB cap on big shards — stream hashes and reads.
4. ZWNJ is a letter in Persian/Indic scripts — detect provenance marks by RUNS.
5. `pkill -f` from an ssh command whose string contains the pattern kills the ssh
   itself — use `[b]racket` patterns.
6. Hetzner env file exports `AWS_REGION=eu-central-1` — force `AWS_REGION=auto`
   after sourcing when using aws-cli against R2.

## Open threads

- #3327 Phase 2 remainder: delta feed (needs a second snapshot), full-checksum
  sweep → delete Hetzner origin copy.
- IA-OCR quality-differential benchmark (pitch collateral; sample non-canonical
  pages per #3235).
- ~576 books excluded for missing/post-1930 year — curation pass could recover some.
- Entity/legal + outreach: gated on Derek (see ops repo).

## CLAUDE.md check

Done this session — the hidden_reason invariant landed via #3335. No further
doctrine needed; remaining lessons are encoded as code guards + this handoff.

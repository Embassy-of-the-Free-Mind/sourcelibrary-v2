# Scope envelopes shipped + Forum of Conscience run + the bug family it exposed — 2026-09-01/02

Session: scope-progress worktree. Everything below is merged or PR'd; tree is clean.

## What shipped (all merged unless noted)

- **#4540 scope envelopes** — PR #4556 (+#4557 additive `--books`): `allow_scopes.<tag>.budget_usd`
  opens a confined dispatch lane past the closed daily dial, measured per run from both
  usage stores by book_id since scope `created_at`; fails closed per lane. Orchestrator
  decides mode at run start ("ENVELOPE MODE" in pipeline.log); 3 workers gate + confine.
  Tools: `scripts/maintenance/set-scope.mjs`, `scripts/audit/scope-progress.mjs` (#4551).
- **#4563** — Phase 2 OCR $project dropped `language` → every full OCR routed flash-preview
  (2.75×). **#4565** — ten more projection-starvation bugs (manual-cover overwrites,
  publisher clobbers w/ lying provenance, Phase 4 infinite ocr↔archive bounce, dead
  translate circuit breaker, blind artwork embeddings, 4 `--book` override twins).
  Structural fix still open: named projection const per phase shared with applyBookOverride.
- **PR #4583 — OPEN, green, awaiting Derek**: `--book-ids` on archive-gallica +
  archive-iiif-local, plus the dangling-`buffer` fix — **archive-iiif-local archived 0
  pages since the #4406 refactor** (uploads to R2 then throws pre-record). ~2,300
  generic-IIIF stalled books wait on this worker; merge unblocks them.
- Issues filed: #4561 (opj_decompress OOM guard), #4566 (pooled batch charges pool cost to
  book_ids[0] — 16% of 48h spend misattributed at book grain), #4567 ($0 placeholders until
  collect, ~12min committed-unpriced), #4579 (Hetzner deploy green-but-dead).

## Infra fixed live on Hetzner (not in git)

- cron.service OOM-killed 09-01 (opj swarm, 14.7G) → `/etc/systemd/system/cron.service.d/resilience.conf`
  (OOMPolicy=continue, Restart=on-failure). App-layer memory bound = #4561.
- Box git remote had an **expired embedded ghp_ token** → every fetch 401'd while the
  deploy action stayed green (reset to stale ref "succeeds"). Fixed: anonymous https
  (repo is public, box never pushes). Hardening = #4579. Token needs revocation check.

## Forum run (#4541) state at close — envelope CLOSED by Derek ("closed", 2026-09-02)

- Spent ≈ $65–72 final (committed tail of 6 translate jobs was draining at gnite;
  settle-watcher may still be running — harmless, read-only).
- **OCR ~97% done** (~799 pages left of 25K). **Translation ~9,000 pages remain.**
  5/34 books complete through every stage. Ledger artifact:
  https://claude.ai/code/artifact/11701b6d-10ef-4568-a7dc-dc3e83aea170
- **To resume:** `set-scope.mjs --tag forum-of-conscience --budget <n> --by ...` — honest
  remaining price ≈ **$30–35** at measured rates. Monitor:
  `scripts/audit/scope-progress.mjs --scope forum-of-conscience`.
- Unsticks done en route: 6 books reset from images_complete strand (July Lambda), 10
  requeued from needs_attention (quality gate misreads 25-page PREVIEW coverage as bad
  OCR — design wart, unfiled), MDZ+iiif books hand-archived to 100% via new --book-ids,
  IA book via archive-bulk --book-id (check it finished), 2 gallica books DEFERRED
  (Gallica throttling this IP to ~1KB/s — retry later).

## Measured facts that supersede folklore

- **$0.00079/page batch OCR is STALE ~2.3×**: measured 09-02 = **$0.00178/pg** lite batch
  OCR, **$0.00285/pg** lite realtime translation. (Memory updated.)
- Envelope meter = instrument: surfaced the 2.75× anomaly in 2h.
- `ft_ladder_skeptic` spent **through the closed dial again** ($5.47 on 09-02, $13 on
  09-01) — ungated caller, another session's workstream, unowned fix.

## Open threads for whoever picks this up

1. Merge PR #4583 (one click, unblocks 2,300-book IIIF backlog).
2. #4566/#4567 envelope-metering hardening; #4561 memory bound; #4579 deploy assertion.
3. Quality-gate wart: parks preview-only books as "very low OCR coverage" — should
   distinguish preview from failure (unfiled).
4. Named-projection-constant refactor (the structural fix for the #4565 class).
5. Forum: gallica ×2 archiving retry; then the B3/B4/B5 publish steps in #4541 once
   books are readable.

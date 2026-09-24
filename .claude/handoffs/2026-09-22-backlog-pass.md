# Backlog pass — 2026-09-21/22

Derek asked "what still needs to be done, merged, cleaned up?", then "merge", then
"do it, decide and merge". One session, main checkout + throwaway worktrees + 8
Sonnet/Opus rebase agents.

## Outcome
- **Open PRs 41 → 7.** 28 merged (list: `gh pr list --state merged --search "merged:>=2026-09-21"`),
  13 closed with a reason comment each (branches kept), 1 issue filed (#4977, the one live
  bug from closed #3651). Left open on purpose: #4236 (Catalogue v2, parked till October),
  #4712 (Tibetan blog, draft flag), #4973 (batch-continuity, its owner is iterating),
  #4952 (30 prod bumps — genuinely red: six `batch-split` auth tests fail only on the branch),
  plus three PRs other live sessions opened the same day.
- **Reverted the same day:** #3851 (Alpheios reading tools) — Derek: no third-party
  script on reader pages. #4986 reverts it and its pin (#4984). Latin lookup API from
  #3840/#3883/#3961 untouched. Code is in history if a vendored popover is ever wanted (#3823).
- **Not merged, deliberately:** stripe (#3442), genai 2.x (#3441), the security-labelled
  ingest endpoint (#2956), anything that hides books (#4430).
- **Cleanup:** worktrees 57 → 29 (16 live, 12 hold uncommitted work — run the reaper to
  list them), local branches 535 → ~135, remote 1,704 → ~680 (608 of the rest never had a
  PR — untouched). Main checkout pulled; three blocking untracked files moved to
  `.sibling-bak/2026-09-21-pre-pull/` (the pre-registration draft there differs from the
  merged one by 52 lines — check before discarding).
- Auto-memory: 77 dangling links repaired, 47 stale "review-gated" lines updated.

## Open decision (Derek's)
**Phase 7.7 is LIVE.** #4662's pipeline-time prior-translation check was described in
its hold comment as "gated off by `RUN_PHASE_7_7`", but `--phase` defaults to `all`, so
the 5-minute Hetzner enrich run started writing cards at 18:35Z on 2026-09-22 — 36 by
20:00Z (18 `no_prior_known`, 18 `under_review`). Deterministic (catalogue + OpenLibrary /
archive.org / K10plus, no model), never demotes, never edits a settled card. Every card
it wrote carries `review.verified_by: "pipeline_prior_check_v1"` in
`work_translation_history`. Keep, or flip the default and delete those — asked, not answered.

## Six merged-PR branches with post-merge content, kept locally
`es-reader-chrome`, `worktree-mcp-post-listing`, `worktree-translation-prompt-v15-eval`,
`worktree-fix+email-endpoint-rate-limits`, `fix/tenant-segment-allowlist`,
`worktree-fix+stale-page-counters` — each has commits after its PR merged that are not on
main. PR or delete.

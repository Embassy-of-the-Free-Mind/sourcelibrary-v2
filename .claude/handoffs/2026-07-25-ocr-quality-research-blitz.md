# OCR quality research blitz — 2026-07-23 → 07-25 (one session)

Everything merged; nothing in flight. Eleven PRs: #3319 (research/lab page), #3320
(within-work canonicity pairs), #3322 (pair sweep, results 9–12), #3331 (reader-first
experiment specs), #3336 (calibration scorecard), #3340/#3347 (occlusion pilot v1/v2,
results 13–17), #3341/#3351 (IA-OCR baseline + independent replication), #3344
(public scorecard on /research, deployed), #3353 (HF dataset package + CHR venue),
#3355 (full paper first draft). Total paid spend ≈ $6.5 across three sweeps.

## State

- **Paper**: `paper/reading-or-reciting-chr2027.md` (complete first draft, ~3,600 w)
  + `paper/VERIFICATION.md` (24 numeric claims → source files). Venue **CHR 2027,
  deadline 2026-08-14 AoE**; outline + timeline in
  `.claude/docs/ocr-memorization-paper.md` (results 1–17, dossier, decisions).
- **Dataset**: HF package ready in `scripts/eval/dataset/hf/` for
  `sourcelibrary/reading-or-reciting` (v0.3: 44 pages / 1,737 runs).
  **Blocked on Derek**: HF org + write token + `hf auth login`, then
  `./scripts/eval/dataset/hf/publish.sh v0.3`.
- **Public**: /research carries the lab identity (Wisdom Frontiers affiliation) and
  the calibrated accuracy scorecard incl. honest "not yet calibrated" strata.
- **Hetzner**: IA replication finished and harvested; `/root/ia-cache` +
  `/root/ia-full-run.{sh,log}` can be deleted anytime; nothing running.

## Next (sequenced in VERIFICATION.md)

Number-verification pass (Aug 5–8, re-derive every claim from JSONLs) → ACH LaTeX
port → tables/figures BY SCRIPT from data → BibTeX from dossier → anonymized dataset
mirror (double-blind) → Derek read/freeze Aug 10–11 → submit Aug 12–13. Blog note +
arXiv at submission. Also open: `--per-stratum` flag in `ia-ocr-baseline.mjs` for the
true full-corpus harvest; Phase 3 note-review clicks (Derek,
`scripts/output/note-quality-phase0/phase3-review.html`).

## Lessons already encoded elsewhere (don't re-learn)

Same-day `scorecard-outputs-<date>.jsonl` collides across parallel sessions — suffix
per-purpose and rebuild observations from the UNION after rebasing (in auto-memory).
qa-eval dies as plain background Bash — nohup+disown + monitor + snapshot loop
(existing lesson, confirmed twice). sharp `composite().resize()` silently shifts
masks — materialize first (paper doc result 17). `--only` matches gt FILENAMES incl.
`.json`, not slugs. Subagents idle-stop awaiting their own background jobs — resume
via SendMessage with "single foreground call" instructions, and verify their claimed
process/file state yourself (a PID misread as a line count killed a healthy fetch;
manifest resume made it free).

CLAUDE.md check: no new repo-wide invariant — the failures above are eval-harness
scoped and now live in the paper doc + harness comments + auto-memory.

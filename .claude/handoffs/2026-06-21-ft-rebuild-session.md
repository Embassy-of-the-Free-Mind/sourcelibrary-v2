# Handoff — First-Translation rebuild session (2026-06-19 → 06-21)

Branch `worktree-feat+ft-rebuild` / PR #2573. Issue #2564 is the canonical
record (consolidated-state + calibration comments). This is the session note.

## State: branch is clean, rebased on main, pushed
- Rebased onto main (was 62 behind). One conflict resolved (blog index — kept
  both `counting-first-translations` and `cannabis-bangue`). tsc 0, 41 tests.
- **Rebase hazard hit + fixed:** force-push clobbered Sink A (#2634, branch-only
  `ft-ingest-verdicts.ts` enhancement). Restored verbatim from `756fcb90`.
  Lesson: before force-pushing a rebased shared worktree branch, diff branch-only
  merges (here `git diff <old-remote-tip> HEAD -- <files>`) — commits that never
  reached main are dropped by a rebase-onto-main and the force-push overwrites them.

## What shipped (built + tested, no blind writes)
- `src/lib/first-translation/` — graded verdict model, single-writer derived flag
  (`isFirstByVerdict` → `isFirstTranslation` → `isPublicFirst`), **bidirectional
  hygiene gate `canPromoteToFirst`** (promotion needs a stored verdict from a real
  adjudicator + non-weak evidence — disposition is ~53% wrong, blind promotion
  injects ~170 FPs), append-only attempt log, effort-tier resolver, Wilson-CI
  stratified inference.
- `scripts/eval/ft-gemini-adjudicate.mjs` — Gemini grounded adjudicator (~$0.01/bk,
  durable jsonl sidecar + resume, sharpened prompt: decisive source-language rule).
- `scripts/maintenance/reconcile-first-translation-flag.ts` — single writer, dry-run
  default, `--verdict=` filter, evidence-gated promotions.
- Blog post `/blog/counting-first-translations`; working paper merged into the
  unified `ft-first-translation-paper.md` (other lane; census draft dropped here).

## Numbers (best AI-only estimate)
- Denominators: 13,970 eligible (translated, non-English); 5,696 badged; 8,306
  never-assessed.
- **Recall: 21.3% strict** (Derek's grounded n=300 with the *sharpened* prompt;
  my n=1,000 at 25.5% used the OLD prompt and over-estimated) → ~1,770 missed firsts.
- Precision: ~66% of badged genuine → ~3,774.
- Corpus ≈ **5,500–5,900 strict first translations (~40% of eligible)**; missed-firsts
  ≈ over-claims, so re-balancing ≈ flat but evidence-backed. Error tracks fame, not
  language (Kircher/Fludd stay, Tsongkhapa/Thurman goes).
- Ceiling, explicit: AI-vs-AI catches independent error, NOT correlated error
  (offline/uncatalogued priors). Derek's gold-standard layer (annotator + scorer +
  Rogan–Gladen) is the binding accuracy step — his lane.

## Production writes so far
- 39 evidence-backed `not_first` demotions applied; de Serres re-badged. Nothing else.

## Gated / next (all need Derek's go)
- Enumeration: ~1,230 of the 7,306 delta ran then was interrupted (old non-durable
  script; lost). Durable script now in place. Full 7,306 run is OPTIONAL given the
  random-300 number. If run: `node scripts/eval/ft-gemini-adjudicate.mjs
  scripts/eval/results/ft-enum-delta-worklist.json scripts/eval/results/ft-gemini-enum-delta.json`
  (resumable). Then ingest → reconcile (dry-run, review the promotion/demotion diff)
  → `harvest --apply`. The mass flag-write must show its diff for confirmation first.
- Three sinks wired: A (evidence→attempts, restored), C (#2633, +351 priors into
  `translation_catalogs`), gold-standard instrument.

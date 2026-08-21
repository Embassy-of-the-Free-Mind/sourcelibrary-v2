# Identity machinery: dupes validated, FT Tier-2 pass, architecture filed — 2026-07-19

Session goal (Derek, verbatim): "getting core machinery finished and validated and integrated."

## Shipped (all merged; sibling-link deployed to prod with purge+warm)
- **PR #3237** — `scripts/maintenance/duplicate-integrity-check.mjs`: validates the whole
  `duplicate_of` graph (orphans / chains / dark clusters / prose tail / visible-flagged /
  volume-aware both-visible edition clusters). Plus writer convention in `hide-efm-duplicates.mjs`.
- **PR #3250** — `--flatten-chains` repair mode. Post-state: **orphans 0, chains 0**;
  queues: 1,993 dark-cluster pointers, 296 both-visible edition clusters (+340 copies), 7
  fingerprint keeper-choice pairs.
- **PR #3238** — #3033 sibling-edition routing: untranslated edition (<5%) with a ≥50%-translated
  `work_id` sibling shows "library holds this work in English". Verified live on the Pymander case.
  Reach: 157 books / 117 works. Issue closed.
- **PR #3251** — FT derive: **targeted tier-2 refutes (verdict `not_found` + coverage) outrank
  lower-tier untrustworthy found-hints** (symmetric §17). Generic sweeps still defer (Bacon/Davis
  test pins why). Plus `ft-catalog-absence-attempt.mjs` (catalog-family absence vote; surname
  prefix-matched so Ficini/Ficino can't fabricate absence).
- **Data repairs** (single-doc, old values in session log): Nero/Clarke orphan cleared;
  De Secretis 1662 stale `efm_duplicate` label cleared; 37pp Somnium hidden with pointer to the
  202pp keeper. First restore applied end-to-end: **De Voluptate (Ficino) badge restored** —
  fabricated prior disproven → targeted refute → catalog absence → `first_no_prior/moderate` →
  scoped reconcile.

## FT Tier-2 pass — PAUSED (Derek: "don't want to do more ft work now, still seems disorganized")
- Queue re-measured live: **532** all-priors-fail-guard demotions (+1,922 with NO cited prior;
  +430 needs_review). **165/532 verified** (pilot + rounds 02–17; session hit the 200-subagent cap).
- Results so far: ~60/155 demotions don't survive (fabricated citations, self-matches, backwards
  years); ~95 confirmed with better priors; ~200 verified translations added to `translation_catalogs`.
- **Interim flag diff on #2933: 54 promote / 0 demote**; recommended apply = 45; HOLD 9
  (Hesiod/Most false-promotion — Evelyn-White 1914 missed — + 8 weak rows). **NOT applied; awaiting sign-off.**
- **Resume state lives in the MAIN checkout: `scripts/output/ft-tier2-state-2026-07-19/`**
  (round-18…54.json, ORCHESTRATOR.md, evidence files, SKIPPED.txt with 5 books, stray results).
  Do not resume without Derek asking.
- Verifiers surfaced catalog metadata bugs to sweep later: Seneca Ep. vol 2 (1639/English on a 1920
  Gemmere text), Doré vol 10 (title page says Tome XVII 1936), Arcana Coelestia set (year:1784 vs
  1938 printings), Tauler (1568 vs 1826).

## Architecture filed
- **#3258** — identity stack: person/work/edition/copy as keys on `books`; expressions via
  `text_role`; typed work relations (`derived_from`/`recension_of`; substitutability litmus —
  Ficino's De mysteriis epitome = own work + relation, per the casebook flagship); works-within-books
  via `contents_works[]`; works-across-books share work_id + edition_key+volume. USTC = external
  edition authority; USTC-absence = strong bounded negative (fixes #2476's provenance-free boolean).
  Author thesaurus treated as PRIMARY authority (Derek: better than VIAF for this domain).
- Standalone workstreams: **#3260** (edition_key + external ids — next build), **#3261**
  (period-translation re-tag, 19 vs 47,139), **#3262** (work-relations pilot on Ficino/Iamblichus).

## Gotchas learned (also in auto-memory)
- **Batch/orchestration state must live in the main checkout's `scripts/output/`, never a
  worktree's** — merged-PR worktrees get reaped and take the state with them.
- Session subagent cap is 200; plan long fan-out passes to be file-resumable across sessions.
- Round-orchestrator pattern (agent per round of 10, self-ingesting, 2 in flight, 10-min
  stall→skip) worked well; leaf verifiers occasionally can't address their parent and route
  results to main — save strays to a file.
- Issue-body drift bit twice more (#3102's backfill was already done; #2567's checklist 3-for-5
  stale). Re-measure before executing plans in this cluster.

## Next (in Derek's stated preference order)
1. #3260 edition_key (+ admin queue + "other scans" rail) — non-FT, unblocks the 296 clusters.
2. #3262 work-relations pilot; #3261 period-translation re-tag (pair on the Ficino cluster).
3. FT (only when Derek asks): apply-45 sign-off → resume rounds 18–54 → 1,922 no-prior reconcile.

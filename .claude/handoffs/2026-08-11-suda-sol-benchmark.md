# Suda–SOL benchmark: from "do we have the suidas?" to a published research note

**Session span:** 2026-08-10 → 08-11 · **Issue:** #3884 (full evaluation trail) · **Blog:** `/blog/suda-benchmark` (PR #3929, merged, live) · **Also filed:** #3886 (MDZ curation sweep)

## What exists now

- **Four-witness Suda** under `work_id local:a:suidas:lexicon`: Bekker 1854 (translated, `69a99ce86c7545e2236e12de`), Küster 1705 ×3 vols (IA import, hidden), Portus 1619 ×2 vols (MDZ import, hidden). Adler 1928–38: **no free scan exists anywhere** (IA/HathiTrust-by-OCLC/MDZ all checked; library scan or purchase only). SOL supplies Adler numbering + Adler's Greek per entry, so this is not a blocker.
- **Local dataset + tooling** in `scripts/output/sol-harvest/` — **UNTRACKED, this machine only**:
  - `raw/` — full SOL mirror, 31,342 entry pages (harvest.mjs, resumable)
  - `sol.jsonl` — parsed entries (Betacode→Unicode, translations, Adler Greek, vetting, translator)
  - `bekker-entries.jsonl` — segmented Bekker OCR (segment-bekker.mjs)
  - `aligned.jsonl` — **27,149 entries aligned (86.6%)** with Adler IDs (align.py: alphabetical re-sort because Bekker alphabetized vs Adler's antistoichic order; LIS skeleton; interior-split using SOL headwords; homonym disambiguation by trigram sim vs Adler's Greek — Adler numbers do NOT follow Bekker's print order within homonym groups)
  - `gold-labels-merged.jsonl` — 49 cross-family (Claude subagent) fidelity judgments
  - `census.jsonl` — flash-lite categorical census of all 27,149 ($1.11)
  - pilot/, census-verdicts/, lite-verdicts/, flash-verdicts/, summarize-pilot.py, validate-lite.mjs, validate-flash.mjs, census.mjs, make-pilot.mjs, judge-instructions.md
- **Promotion to a reviewed PR is pending** — until then this data is one `rm -rf` from gone (reproducible, but ~10h of wall-clock).

## Headline numbers (all on #3884)

- Fidelity (n=49 gold): 57% faithful / 43% minor / **0 major-error entries**; 64 errors catalogued (nuance 22, mistranslation 17, omission 7, silent-emendation 6, addition 6, garble-passthrough 6).
- Census (n=27,149): 97.4% clean; 1.6% translation-not-found; 1.3% alignment flags; **0.24% recitation flags** (66 entries).
- Edition differences Bekker↔Adler: 42/49 sampled entries — pervasive; never grade against SOL without the Greek arbiters.
- SOL itself errs in ~12% of sampled entries (6/49) — upstream report owed (courteous, with evidence).
- **Same-family judge blindness: κ=0.107** — both gemini-lite AND gemini-flash-preview miss ~90% of Gemini-translation errors that Claude judges catalogue; zero false positives (pure leniency). Both went 2/2 on categorical flags (misalignment, recitation) → census design: cheap model for categorical screens only, cross-family for fidelity. Memory: `lesson_same_family_judge_leniency_measured`.

## Operational notes

- MDZ has an undocumented JSON search API (contract in memory `reference_mdz_search_api`); 3.19M objects; #3886 has the curation-sweep plan.
- SOL license is **CC BY-NC-SA** (not BY-SA) → dataset release = two files (full aligned under NC / ours-only under BY-SA).
- Long batch subagents stalled repeatedly (600s watchdog); per-entry verdict files on disk made every crash resumable — single-packet agents are the reliable unit.
- ssh + `pgrep -af pattern` self-matches through the remote bash wrapper — verify with `ps -p <pid>` before believing the entities-sweep interlock is hot.
- Blog conflict: another session added then REMOVED "The Library Card" index entry on main; resolution took main verbatim + our entry. If Library Card is missing from /blog, that's that session's state.

## Next steps (none urgent, all free unless noted)

1. Subagent verification of ~750 census flags — 66 recitation flags first.
2. Grow gold set 49 → ~200 for tighter CIs.
3. Promote tooling from scripts/output to a reviewed PR (+ decide where the dataset artifacts live).
4. Release: JSONL files, Zenodo DOI (scholarly-edition flow), methods writeup; SOL error report upstream.
5. Optional/paid: OCR+translate Küster & Portus (adds Latin translation columns); Adler vol I acquisition (library scan).
6. `/promote-lessons` should pick up `lesson_same_family_judge_leniency_measured` + `reference_mdz_search_api` next hygiene pass.

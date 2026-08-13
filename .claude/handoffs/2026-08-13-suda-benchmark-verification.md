# Suda benchmark, part 2: five corrections, and what verification actually cost

**Continues** `.claude/handoffs/2026-08-11-suda-sol-benchmark.md` · **Issue** #3884 · **Blog** `/blog/suda-benchmark` (now carries a dated Corrections section) · **New issue filed** #3953 (OCR στ-ligature defect) · **Merged PRs** #3934, #3935, #3947, #3952, #3964

## The shape of this session

Session 1 built the benchmark and published confident findings. Session 2 attacked them. **Three of the published claims did not survive**, and the corrections were produced for roughly four cents of API spend plus free subagent time. Everything is logged publicly.

| claim as published | what verification found |
|---|---|
| SOL errs in 6/49 entries | **5/49.** One dissolved when re-judged with SOL's own footnotes visible — SOL faithfully rendered the transmitted προφαίνειν and *our* translation had normalised it. The error was ours. |
| "A model cannot grade its own family's homework" (κ=0.107) | **Withdrawn.** The 2×2 control showed task collapse, not family loyalty: on focused entry pairs the same cheap judge detects 6/7 known issue-entries in its own family's output and matches Claude's error rates on identical fresh artifacts. Our packet format asked it to locate-then-judge inside a full page; it can't, and it answers "faithful" instead of erroring. |
| Census: 97.4% clean, 0.24% recitation | **Demoted to a screen.** Scored against the 49 gold entries it already covered, it missed all 3 known events and added a false positive. On 12 seeded contradictions it caught 4/12 (page-grouped) / 5/12 (single-entry). Verifying all 66 recitation flags: **2 real, 64 false — 3% precision.** |
| Fidelity 57% faithful / 43% minor / 0 major (n=49) | **77.3% / 20.7% / 2.0% (n=150 uniform).** The pilot was stratified toward long narrative entries. Corpus is cleaner on fidelity; major errors exist at ~2% where the pilot found none. |
| Recitation rate 2.0%, CI 0.4–11% | **0/150 uniform, CI 0–2.5%** (≤~680 entries). Three confirmed instances exist in total. |

## Things established (not retracted)

- **Anchoring critique answered.** 75 blind vs 75 SOL-anchored packets, randomized: identical verdicts (17/75 each, z=0.00). Gold labels measure fidelity, not agreement-with-SOL. Secondary: blind judges catalogued **62 discrete faults vs 41** — seeing the reference reduces granular scrutiny without changing verdicts.
- **The 64 rejected recitation flags are informative.** Dominant mode: our translation faithfully following corrupted OCR and so diverging from Adler — the *inverse* signature, i.e. positive evidence the translator read the page.
- **Byproduct → #3953:** judges repeatedly identified Bekker's **στ ligature losing its tau** (ἱστορίαν→ἱσορίαν, στόματι→σόματι, and the γάζαν case behind the pilot's worst error). Corpus-wide, fixable, and invisible to any translation-quality check because the translations *of it* are faithful.
- **Human review queue built** — 16 cases (3 recitation, 7 translation failures, 5 SOL queries, 1 withdrawn) as a private artifact with both Greek witnesses, both English renderings, and the machine's argument deliberately folded behind a disclosure. Doubles as the SOL outreach artifact: invite adjudication rather than assert errors.

## State

- Data + all verdicts: `scripts/output/sol-harvest/` (untracked; SOL content is CC BY-NC-SA). Backups on Hetzner `/root/backups/sol-harvest-2026-08-{11,12,13}.tar.gz`.
- **`results.json` is the single source of truth** for every number the blog or a future paper cites. Update it first.
- Tooling in `scripts/eval/suda-sol/` (PR #3933) — README carries the invariants.
- Gold labels now 199 (49 stratified + 150 uniform). Verdicts in `gold2/`, `recit/`, `rejudge/`, `control/`, `seedtest/`.

## Next

1. Send the review queue to SOL (Catharine Roth — ~2,200 vetting events since 2022; Raphael Finkel for infrastructure; `suda@lsv.uky.edu`). Invite adjudication; do not assert.
2. Remaining checklist, all free: gold-label test-retest stability; audit the unaligned 13.4%; n-gram check that the clean-room control translations aren't SOL-shaped.
3. Verify the ~690 remaining census flags (translation-not-found + alignment) — candidates only, precision unknown.
4. Dataset release: two files (full aligned CC BY-NC-SA / ours-only CC BY-SA), Zenodo DOI, then the methods paper — where the corrections log is a section, not a liability.
5. #3953 OCR sweep: local regex scan for σ-forms whose στ counterpart is a real word.

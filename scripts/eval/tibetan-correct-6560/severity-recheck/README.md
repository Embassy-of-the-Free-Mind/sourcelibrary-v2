# Severity re-check of the Tibetan Flash correction (#6560, 2026-10-27)

<!-- PRIOR ART: ../profiles-diffqa/ (PR #7505), whose verdicts this re-classes; ../pass/leafcheck.mjs; ../../route-judge-6740/tib-derge.py (PR #7465). -->

This directory re-reads #7505's "severe" errors and measures the lane on pages it has already written. Write-up:
`scripts/eval/experiments/2026-10-27-tibetan-severity-recheck-6560.md`.

| file | what it does |
|---|---|
| `classify.py` | gives a span its reader-impact class (normalisation / mantra / minor / severe) by rules plus `hand-labels.json` |
| `recompute.py` | recomputes Derek's rule for #7505's variants from `hunks-7505.jsonl.gz` |
| `derge-spans.py` | places each draft in Derge (`locate`) and says which reading of each severe span Derge carries (`spans`) |
| `zoom.mjs` | cuts a brightened full-resolution strip of a page image, for the by-eye check |
| `realworld.mjs` | runs `draw`, `span-req`, `confirm-req`, `page-req` and `score` on pages the lane wrote (read-only) |

## hunks-7505.jsonl.gz

The file was produced by #7505's `profiles-diffqa/judge.mjs score --root=<that job's scratch>`, with one addition in
the per-hunk loop. Before `if (h.line_hunk) lineH.push(`, the patched copy pushes every hunk to `row.all_hunks`, as
`{id, base, arm, line, draft_line, line_hunk, before, after, side, diff, seen, confirm}`. It also keeps the
whole-page judge's wrong-text defects on the row: `page_defects_draft`, `page_defects_text`, `page_added`. The scores
it prints are identical to #7505's `score.txt`.

## Run

```
cd severity-recheck
python3 recompute.py ../../results/tibetan-correct-6560/severity-recheck-6560/hunks-7505.jsonl.gz OUT.json
python3 derge-spans.py locate --p1 <P000001 checkout> --texts DRAFTS.json HUNKS LOC.jsonl   # ~3 min
python3 derge-spans.py spans  --p1 <P000001 checkout> HUNKS LOC.jsonl OUT.jsonl
node --env-file=<.env.production.local> realworld.mjs draw --n=20 --exclude=HUNKS
node realworld.mjs span-req; node realworld.mjs page-req      # then run-claude-arm.py on each
node realworld.mjs confirm-req                                 # then run-claude-arm.py
node realworld.mjs score --out=realworld-score.json
```

---
stage: translation
measure: none
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: 33
n_pages: 100
verdict: "Re-run in the same mode and prompt, 53 of 100 not-applicable Tengyur pages failed again (40 denied tool, 13 plan replies), so a page's failure is per call, not per page. Without plan mode, or with an 'output only the translation, use no tool' suffix, 100 of 100 passed the stage-2 gates, but neither is the judged configuration: thinking dropped to zero on 94% (no plan mode) and 51% (suffix) of pages, against 35% of the applied pages."
status: undecided
decision: "Re-staging the 6,494 pages in arm C (plan mode + suffix) is a decision for Derek (#6361)."
superseded_by: null
issue: [6361]
---
PRIOR ART: 2026-10-10-tengyur-cli-retranslation-gate-6361.md (stage 2 of the same run, which found the plan-mode replies); this entry re-runs a sample of the pages it could not apply.

## 2026-10-10 · Does a re-run fix the 6,494 Tengyur pages the CLI run could not apply, and does a simple mode or prompt change?

**Question (Derek, 2026-10-10, on "leave the 6,494 plan-reply pages on stored English"): "test if that is true".**

**Design.** 100 pages drawn with seed 6361 (mulberry32) from `scripts/maintenance/tengyur-cli-6361/results/not-applicable.tsv`
(6,494 pages: 993 stage-1 failures + 5,501 refused at the gates). The draw held 82 plan-mode pages and 18 stage-1 failures
(denied tool). Each page was run once in each of three arms, through `agy` 1.3.2, `gemini-3.8-flash-low`, the same v13 one-page
prompt file, empty working directory, 4 at a time:
- **A**: the stage-1 call exactly (`--mode plan`).
- **B**: no `--mode plan`, plus `--disable-slash-commands`. Same prompt. Headless mode still denies every tool.
- **C**: `--mode plan`, with `scripts/batch/cli-translate.mjs`'s `CLI_SUFFIX` appended to the prompt ("Output only the English
  translation in the format above. Do not open, read or write any file, do not use any tool, and add no preamble or commentary.").
Each reply was classed with the stage-2 rules: driver classes, the gates' plan-mode regex and `cliChatterReason`, reasoning leak,
then the write door's sanitize → guard → unwrap → stray-script → health check. Script: `scripts/maintenance/tengyur-cli-6361/rerun-sample.mjs`.
No quota error was hit. 300 calls, $0 (subscription), no API call. Raw outputs: R2 `sl-corpus-snapshots/runs/tengyur-cli-6361/item3/rerun-sample.tgz`.

**Result.**
| arm | pass gates | plan reply | denied tool | thinking tokens, median (pages with 0) |
|---|---|---|---|---|
| A (same as stage 1) | 47 | 13 | 40 | 871 (23 of 47) |
| B (no plan mode) | 100 | 0 | 0 | 0 (94 of 100) |
| C (plan mode + suffix) | 100 | 0 | 0 | 0 (51 of 100) |
| applied stage-1 pages, for reference | 17,135 | | | 2,668 (35%) |

By stratum in arm A: plan-mode pages 37 of 82 pass, stage-1 failures 10 of 18 pass.
Median reply 2,914 characters in B against 2,958 for A's passes.

**Reading.**
- The claim is roughly true for the same call: re-running gives about the same failure mix again (13% plan replies, 40% denied
  tool, against 23% and 36% of calls in stage 1). The failure is per call, not per page: almost half of these pages pass on
  one more try. Three more rounds of the same call would leave about 6,494 × 0.53³ ≈ 970 pages.
- One simple change fixes all 100: either drop plan mode or add the suffix. But both change how much the model thinks. B
  almost never thinks, and C thinks on half the pages. The #6182/#6321 judging that justified the run was of plan-mode
  output, which thinks on about two pages in three. A gate pass is not a quality measure, so neither arm's English has been judged.

**Limits.** 100 pages, one call per arm, by detector only: no page was read against its image. The 44 pages refused for
other reasons (reasoning leak, door health, stray script) had no page in the draw.

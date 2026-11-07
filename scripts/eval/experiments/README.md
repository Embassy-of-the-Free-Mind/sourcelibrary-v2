# Experiment log — what we ran, and what it concluded

PRIOR ART: `recommend-experiments.mjs` ranks experiments still *worth running*;
`INDEX.md` lists the scripts that exist. Neither records **what a run concluded**,
which is the thing that evaporates. This is that record.

**Where to write (#5436).** One entry = ONE new file in `scripts/eval/experiments/`,
named `YYYY-MM-DD-<slug>.md`, beginning with the heading `## YYYY-MM-DD · <question>`
(the date in the name and the heading must agree). Never edit `EXPERIMENTS.md`
itself: it is generated from these files on `main` after every merge
(`.github/workflows/eval-ledgers-regenerate.yml`), and CI refuses a PR that
hand-edits it. Why: when every eval PR appended to the same tail of one file, two
PRs on the same day were a textual conflict every time — 6 of 11 conflicting PRs
on 2026-10-01 — and auto-merge never merges a conflicting PR. Two files never
conflict. To read the whole log locally without waiting for main:
`node scripts/eval/build-experiments.mjs --print`.

Standing series (one table, a row per run, e.g. the monthly corpus audit) live in
`_series-<slug>.md` and render before the dated entries; notes about the log itself
in `_note-<slug>.md`, rendered last. The series files are `merge=union` in
`.gitattributes` so two rows appended by two PRs both survive a local rebase.

Newest first in the generated file. One entry per *question*, not per invocation. A
null result and a retraction are both first-class entries — the retractions are the
most valuable rows here, because a wrong number that stays uncorrected in a PR
description is how a mistake becomes doctrine.

**Rare-event discipline.** These runs happen a few times a month at most, so
nobody remembers them and nobody will re-read the code. Two lines here when you
finish is the whole mechanism. If you ran something and did not log it, the next
person pays for it again.

**Format.** Date · question · design · result · *replicated?* · artifact.
The replication column exists because of 2026-09-02, below.

## The header (#5939)

Every dated entry opens with YAML front matter: the first line of the file is `---`,
above any `PRIOR ART` line and the `## YYYY-MM-DD` heading. It is what lets the
index (`index.json`), the `/quality` Experiments section and the canon pages read an
entry without anyone editing a page by hand, and what lets a superseded result drop
off them. The builder leaves it out of `EXPERIMENTS.md`.

```yaml
---
stage: translation
measure: judged_vs_reference
languages: [sa, pi, lzh]
scripts: [Deva, Hani]
canons: [sanskrit, pali, chinese-buddhist]
n_books: 68
n_pages: 68
verdict: "Flash reverses fewer statements than Flash-Lite in all three languages."
status: adopted
decision: "Flash routes Sanskrit, Pali and Chinese translation (PR #5740)"
feeds: route
landed: "scripts/lib/translation-routing-table.json#flash-measured"
supersedes: []
superseded_by: null
issue: [5695, 5740]
---
```

| field | required | value |
|---|---|---|
| `stage` | yes | `ocr` \| `translation` \| `metadata` \| `image` \| `pipeline` — the stage the result is about |
| `measure` | yes | `accuracy` \| `agreement` \| `stability` \| `preference` \| `judged` \| `judged_vs_reference` (eval-design.md §2, §5.2), or `none` for a plan, census or repair log. A list when one entry reports two, the deciding one first |
| `languages` | no | ISO 639 codes, `[la, grc, lzh]`; `[]` when not language-specific |
| `scripts` | no | ISO 15924 codes, `[Latn, Grek, Tibt]`; `[]` when not script-specific |
| `canons` | no | canon-gap ids (`derge-tengyur`, `pali`, `sanskrit` … the `corpora` and `traditions` ids in `scripts/catalog-coverage/results/canon-gap-status-*.json`); `[]` for none |
| `n_books`, `n_pages` | no | whole numbers, the sample the verdict rests on; `null` if not stated |
| `verdict` | yes | one line, quoted: what the run found |
| `status` | yes | `adopted` (a lane or prompt changed) \| `rejected` (tested, not taken) \| `undecided` (a decision is still owed) \| `superseded` (a later file answers the same question) \| `informational` (a measurement, no decision asked of it) |
| `decision` | no | what it changed, with the PR or issue: `"v19.1 is the production OCR prompt (PR #5655)"` |
| `feeds` | on new entries (dated 2026-11-05 on) | what the result should change if taken: `route` \| `prompt` \| `detector` \| `judge` \| `reference` \| `figure` (a published number) \| `cost` \| `guard` \| `surface` (search, the reader, the Librarian) \| `repair` \| `none` (a probe, plan, census). A list when it feeds two (#6553) |
| `landed` | with `status: adopted` and `feeds` other than `none` | where the change is: a repo path that exists (an `#anchor` after it is allowed, `scripts/lib/ocr-routing-table.json#latin-lite/print`) or `"PR #7874"`, which CI checks is merged. A list when it landed in two places. Of 75 sampled write-ups that asked for a change, 12 claimed one the repo could not show (#6553) |
| `supersedes` | no | on the LATER entry: the earlier files this one overturns, `[2026-10-30-read-surface-box-behnken-6740.md]`. The builder marks each of them `superseded` in `index.json` (keeping its own header's value as `status_declared`), so it leaves `/quality` without anyone editing the old file |
| `superseded_by` | with `superseded` | the later file's name in this directory (the old way; prefer `supersedes:` on the later file) |
| `issue` | no | the issue number, or a list |
| `router_evidence` | for a judged `ocr` / `translation` result | the router-table cells (`scripts/eval/estimator/router-table/rules.json` `cells[].id`) this run added evidence to, `[latin-lite, german-lite]` — or `"none — <why>"` (a prompt test, no route compared). Required on NEW entries whose `measure` includes `judged` or `judged_vs_reference` (#7263): a judged result the router never reads does not change a route |
| `defect_rates` | for an `ocr` / `translation` result dated 2026-10-30 or later | a repo path to the JSON with, per route, misleads and wrong_text per 1,000 words and the mean fidelity (`scripts/eval/route-judge-6740/defect-rate.py` writes one: run its `inventory` stage, then the `.py`) — or `"none — <why>"` (nothing was judged for defects). Required on NEW entries with a `measure` other than `none` (#6740): routes are decided on severity-weighted defect rates against the live route; accept k/n is a summary (eval-design.md §10.3, proposed in `scripts/eval/route-judge-6740/results/defect-rate-2026-10-30/eval-design-10.3.md`) |

Strings are double-quoted; lists sit on one line; nothing else of YAML is read
(`scripts/eval/lib/experiment-header.mjs`). **When a later run or PR overturns an
entry, the LATER entry says so:** `supersedes: [<earlier file>]`. The earlier file is
not touched; its effective status is derived. (The old rule, editing the earlier
header to `status: superseded` in the same PR, was followed about 25 times in 566
files; every one of the 7 overturns #6553 found had been missed.) If production
moved without a write-up, add a short entry that records the change and supersedes
the stale one. Never rewrite the body of an entry that has already landed.

CI (`scripts/eval/experiments-lint.mjs`, in `unit-tests.yml`) refuses a new dated
entry without a valid header, a new judged OCR or translation entry without
`router_evidence`, a new OCR or translation entry (from 2026-10-30) without
`defect_rates`, a new entry (from 2026-11-05) without `feeds`, a new adopted entry
that feeds something without `landed` (or whose `landed` PR is not merged), and an
invalid header on any file. A weekly detector
(`scripts/audit/experiments-garden.mjs`) lists entries with no header, `undecided`
entries left over 21 days, public pages that cite a superseded entry, and live
entries whose verdicts disagree.

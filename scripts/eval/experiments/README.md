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
| `superseded_by` | with `superseded` | the later file's name in this directory |
| `issue` | no | the issue number, or a list |

Strings are double-quoted; lists sit on one line; nothing else of YAML is read
(`scripts/eval/lib/experiment-header.mjs`). **Changing a result's status is
editing the header only** — e.g. when a later run overturns this one, set
`status: superseded` and `superseded_by:` here, in the same PR that adds the later
file. Never rewrite the body of an entry that has already landed: add a new entry.

CI (`scripts/eval/experiments-lint.mjs`, in `unit-tests.yml`) refuses a new dated
entry without a valid header, and an invalid header on any file. A weekly detector
(`scripts/audit/experiments-garden.mjs`) lists entries with no header, `undecided`
entries left over 21 days, public pages that cite a superseded entry, and live
entries whose verdicts disagree.

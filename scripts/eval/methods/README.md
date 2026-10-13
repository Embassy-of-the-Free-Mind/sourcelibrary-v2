<!-- PRIOR ART: scripts/eval/experiments/ (one file per RESULT, with the #5939 header) and the frozen briefs in
scripts/eval/spot-check/ (REVIEWER.md, the addenda) describe runs and prompts. Nothing named an INSTRUMENT with a version
that a per-book verdict could cite; #6174 needs one so that a `book_checks` row says how its verdict was reached. -->
# Methods registry (#6174)

One file per QA instrument that can leave a verdict on a book. A row in the `book_checks` collection cites a method by
`method_id` + `method_version`, and `scripts/lib/book-checks.mjs` refuses a row whose method is not here or whose
version is not this file's `version:` line. So a number or a verdict never travels without the instrument that made it.

## The header

Front matter, the first thing in the file. Flat `key: value` lines; lists on one line. It follows the experiment
header (#5939, `scripts/eval/experiments/README.md`) where the fields mean the same thing (`stage`, `measure`, `issue`,
`status`).

```yaml
---
id: shelf-overview            # = the file name; what book_checks.method_id holds
version: 1                    # bump when the sampling, the reader, the brief or the verdict scale changes
stage: [ocr, translation, structure]
measure: judged               # eval-design.md §2: judged | judged_vs_reference | accuracy | detector
reader: model                 # model | human | detector
image_opened: true            # true | false — does the reader see the page image?
verdict_scale: [show, caveat, fix]
issue: [6056, 6174]
status: active                # active | retired
---
```

## The body

Each file answers, in this order: what the method is for; **sampling** (frame, seed, books, pages per book); **reader
and input** (who reads, whether the image is opened); **what "serious" means** (classes from
`.claude/docs/page-error-taxonomy.md`); **verdict** (what show / caveat / fix mean for this method, and how its native
output maps onto them); **consistency** where it has been measured; **known blind spots**; **who writes its rows**.

## Changing a method

Never edit a method's meaning under the same version: rows written under v1 must keep meaning what v1 said. Bump
`version:`, add a line to the file's *Versions* list, and say what changed. A frozen brief (REVIEWER.md) is part of the
method: a change to it is a new version.

## The verdict scale, across methods

`show` — the pages read are sound for a reader of this tradition. `caveat` — usable, with a named weakness.
`fix` — fix before showing, or do not show. A verdict covers the **pages read**, not the book; `pages_read` says
which. Rates are never pooled across methods: they sample different frames with different readers (#6174 *Why*).

| method | reader | image | unit |
|---|---|---|---|
| [shelf-overview](shelf-overview.md) | Opus reviewer | yes | stratified random, 4 books × 4 spread pages |
| [curation-check](curation-check.md) | Opus reviewer or session | yes | hand-picked, 2 consecutive mid-book pages |
| [fortnightly-spot-check](fortnightly-spot-check.md) | Opus reviewer | yes | random per book, 3 consecutive pages |
| [monthly-corpus-audit](monthly-corpus-audit.md) | Opus judge | no | random, 1 interior page |
| [refusal-empty](refusal-empty.md) | detector | no | every page of a sampled book |
| [reasoning-leak](reasoning-leak.md) | detector | no | every page record |
| [retranslation-gate](retranslation-gate.md) | Opus reviewer, blind A/B | yes | 5 random + 2 extreme volumes of a run, 3 consecutive pages |
| [hide-broken-text](hide-broken-text.md) | session acting on a check | inherits | the pages of the check that led to the hide |

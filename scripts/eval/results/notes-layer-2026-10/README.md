# notes-layer-2026-10 (#5942, phases 1–2)

Write-up: `scripts/eval/experiments/2026-10-06-notes-layer-phase1-2-5942.md`. Scripts: `scripts/eval/notes-layer/`,
and for the arms `scripts/eval/translation-notes-free/` (#5926) pointed here by environment variables.

## `lite/` — is the note-free prompt safe on Flash-Lite?

| file | what |
|---|---|
| `sample.jsonl` | the pinned draw: 40 pages, 40 books that route to Lite, public references, none used by #5919 |
| `prompt-v13-plain.txt` | the edited prompt as sent (md5 `655488d8ecd524d7f3139fe9aeec50f5`, the same as #5919) |
| `arms.jsonl` | 120 model outputs (page × arm): text, tokens, cost, prompt row |
| `records.jsonl` | the 40 pages in harness shape, three arms as candidates |
| `mechanical.json` | string counts per page and arm, paired CIs against v13-a |
| `results-fidelity.json`, `fidelity-verdicts-j{1,2}.jsonl`, `fidelity-key.json` | the #5695 harness, two blind Opus judges; gate and controls inside |
| `results.json` | the preregistered rule applied (P1, P2), by judge and language |

Rebuild: `NOTES_FREE_DIR=…/lite NOTES_FREE_SAMPLE=…/lite/sample.jsonl NOTES_FREE_ISSUE=5942` then `score.mjs --pack`,
`score.mjs`, `translation-vs-reference/score.mjs --packet work/fidelity --out results-fidelity.json --seed 5942`,
`score.mjs --rule`. The `work/` directory (per-page outputs, judge packets) is not committed.

## `parser/` — does text + annotations reproduce today's reader?

| file | what |
|---|---|
| `draw.jsonl` | 800 pages, one per live book, seed 5942: ids, prompt version, length, hash of the stored string |
| `results.json` | round-trip classes, anchor resolution, counts by type and prompt version |
| `per-page.jsonl` | one row per page: classes, annotation counts, anchors |
| `diffs.jsonl` | every page that is not byte-identical, with 160 characters of each side at the first difference |
| `by-eye-sample.json`, `by-eye.jsonl` | the 40 pages read by eye and the verdict on each |

The stored markup itself (`work/pages.jsonl`) is not committed; `draw-pages.mjs` re-reads it (pages may have changed
since: compare `sha16`).

## `consumers.tsv`

Every file on origin/main that names `translation.data` (342), with its surface, what it does with the field, the
cleaning helpers present in the file, and what it would read after phase 3. `python3 scripts/eval/notes-layer/consumers.py`.

Measures: fidelity is judged against a human reference; everything in `parser/` is an exact string comparison or a
count, except `by-eye.jsonl`, which is one reader's verdict. None is accuracy in the eval-design §2 sense.

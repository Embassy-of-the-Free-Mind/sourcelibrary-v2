# Collection copy verdicts, 2026-10-03 (#5689)

This is the evidence for the first pass at "one card per work-volume" on collection grids. The verdicts are in `../collection-copies-2026-10-03.jsonl` (in `scripts/identity-evidence/`), one JSON object per line.

**Who reads this:** whoever applies these verdicts further (the tagger guard, site-wide collapse through `applyKeeperChoice`), and whoever later asks "why is this book not in that collection?".

## Row types

- `row: "pair"` is one keeper↔copy pair from a cluster the visual reviewer called `copies`.
  - `status: "applied"` means the copy was removed from `books.collections` for every collection in `applied.removed_from_collections`, and any `highlighted_books` entry for it was swapped to the keeper. **No book was hidden.**
  - `status: "reversed"` means the removal was undone after a check. `spot_check.finding` says why.
- `row: "cluster"` is a cluster the reviewer called `not_same` or `unsure`. Nothing was written for it.

## Provenance fields

| field | meaning |
|---|---|
| `reviewer` | Which model gave the verdict, from which sheet, with its stated reason and the rubric it applied. |
| `override` | A keeper changed by the dispatching session (Claude Opus), with the reason. |
| `text_check` | Word-set overlap: the keeper's mid-page OCR against the best-matching page anywhere in the copy. A rough screen only; it is **not** the #4285 comparator. Low scores where `copy_ocr_pct` < 30 carry no evidence either way. |
| `spot_check` | The pair was looked at by eye, with the method and the finding. |
| `comparator_4285` | Empty. To be filled by the #4285 character-4-gram comparator before any site-wide collapse. |

## Method (scripts here, in run order)

1. `1-scan-clusters.mjs` groups collection members by work_id + edition_key volume + language and flags same-year clusters (same edition).
2. `2-manifest.mjs` collects, for each member, its cover URL and mid-book page URL.
3. `3-build-sheets.py` builds one comparison sheet per three clusters (cover and mid page per member, labelled with library, pages, OCR %, translation %). The sheets were not kept (29 MB); rerun to regenerate them.
4. `4-reviewer-brief.md` is the brief given to the eight visual reviewers.
5. `5-text-check.mjs` is the text screen above.
6. `6-apply-membership.mjs` applies the membership and highlight changes (DRY unless `APPLY=1`).
7. `7-covers.mjs` sets title-page covers that were picked by eye.

The scratchpad paths inside the scripts (`S=...`) are from the original session. Point `S` at a working directory to rerun them.

## Known limits

- Grouping relies on `work_id` and `edition_key`. Copies that sit under different work ids were not found.
- Visual review is fallible: 3 of 235 applied pairs were reversed after checks. Pairs the text screen could not test were checked by eye on headers and page numbers.
- Clusters with more than four members (unnumbered Chinese multi-juan sets) were excluded.

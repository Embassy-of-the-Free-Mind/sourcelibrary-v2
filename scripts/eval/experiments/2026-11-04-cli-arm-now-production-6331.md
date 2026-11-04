---
stage: translation
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 2026-10-08 gate failure (the agy CLI arm not declared equal to the API outside Tibetan) no longer describes production: later per-language tests put translation on the CLI (Greek via greek-cli-gemini38, #7360; Latin, German, Italian and French print first translations on agy Flash-low, #7917), and Flash OCR for Greek, Persian, Sanskrit, Arabic and Chinese runs through agy (#7075)."
status: informational
decision: "Records a production change made elsewhere; supersedes 2026-10-08-cli-arm-xl-365-6331.md (#6553)"
feeds: none
supersedes: [2026-10-08-cli-arm-xl-365-6331.md]
superseded_by: null
issue: [6553, 6331, 7075]
router_evidence: "none — records a change already made, no route compared"
defect_rates: "none — nothing judged"
---
PRIOR ART: `2026-10-08-cli-arm-xl-365-6331.md` — the entry this one supersedes; found by `2026-11-04-experiment-kinds-6553.md` §7.

## 2026-11-04 · The Antigravity-CLI arm, rejected outside Tibetan on 2026-10-08, now carries production lanes (#6553)

The 2026-10-08 entry is right about what it measured: on 365 reference pages the CLI arm reversed sense
on 26 pages against the API's 19, and the preregistered gate failed. It is no longer right as a
statement of what production does. Per-language tests after it moved lanes to the CLI one at a time:

- `scripts/lib/translation-routing-table.json` row `greek-cli-gemini38` (PR #7360, 2026-10-25) and
  `pali-cli-opus` (2026-10-23).
- PR #7917 (2026-11-02): Latin, German, Italian and French print first translations on agy Flash-low.
- `scripts/lib/ocr-routing-table.json` rows `greek-print`, `persian-sanskrit-pali-arabic-print`,
  `chinese-print`, `manuscripts`, `tibetan` name agy (#7075).

The CLI was never declared equal to the API in general; it won cell by cell.

Found by the status-against-production check in `2026-11-04-experiment-kinds-6553.md` (§7), re-checked
against `origin/main` f193ddebc.

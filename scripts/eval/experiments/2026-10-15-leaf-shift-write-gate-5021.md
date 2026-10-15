---
stage: translation
measure: none
languages: [la, de, it, ja, fa, sa, he]
scripts: [Latn, Jpan, Arab, Deva, Hebr]
canons: []
n_books: 162
n_pages: 26664
verdict: "The whole-leaf shift gate in dropDriftedPages catches all 12 by-eye wrong-leaf pages (in 6-8 of their 8 block alignments; the misses are runs cut by a block edge) and rejects 7 of 3,321 single-page-lane blocks (0.21%, 3 of them tier-A strength), each costing a single-page translation of that block."
status: decided
decision: "Ship the gate in all four block lanes through dropDriftedPages (PR for #5021)."
superseded_by: null
issue: [5021, 6553]
---
## 2026-10-15 · Does a write-time leaf-shift gate catch the known shifts without rejecting clean blocks? (#5021)

PRIOR ART: `scripts/audit/translation-leaf-shift.mjs` (2026-10-13 entry) judges whole books with both neighbours of
every page in hand. A write-time gate sees one 8-page block and nothing past its edges, so recall and false alarms
were measured on blocks. `scripts/lib/block-drift.mjs` already rejects a clause moved across one boundary; it cannot
see a leaf shifted whole.

**Design.** `scripts/audit/leaf-shift-gate-controls-5021.mjs`, read-only, $0. The gate is `blockLeafShiftRuns`
(the audit's classifier, moved unchanged to `scripts/lib/leaf-shift.mjs`): two or more adjacent pages of a block whose
English votes only for the neighbouring leaf's printed numbers.

- **Positive control:** the 12 pages withheld on 2026-10-13 after being read against their scans. Their English was
  rebuilt from `page_revisions` as of 2026-10-13T15:45Z (before the withhold). Every 8-page block alignment that
  contains the page was run through the gate.
- **False-alarm control:** 150 books drawn at random (seed 5021) whose every translated page came from the
  single-page lane (prompt v1-v6), which cannot put one leaf's text on another. Each book was cut into 8-page blocks
  at page 1.

**Results.**

| control | n | rejected |
|---|---:|---:|
| positive: wrong-leaf pages caught in at least one alignment | 12 pages | 12 |
| positive: alignments caught | 96 | 75 (6-8 of 8 per page) |
| false alarm: single-page-lane blocks | 3,321 | 7 (0.21%), 3 tier-A strength |

The 21 missed alignments are blocks where the run is cut by the block edge, so fewer than two shifted pages have
both neighbours in hand. A false alarm costs eight pages a single-page translation and never writes a wrong text.

**Limits.** One draw. The false-alarm frame assumes `prompt_version` v1-v6 means single-page; a few of the 7
rejections may be real OCR-side leaf errors rather than false alarms, and none were opened. A shift with no printed
numbers in the body is invisible to this gate, as it is to the audit.

---
stage: ocr
measure: [judged]
languages: [la, fr, es, it, de, en, nl, pt]
scripts: [Latn]
canons: []
n_books: 247
n_pages: 300
verdict: "First reads of the John Carter Brown Library's pre-1600 scans (hidden, held, tier A/B of the New World content screen) by GPU draft then agy Flash-low with the page image, one page per book, blind Opus judge. Two languages pass the rule: Latin (PERO draft), with two draws pooled: 60 pages, 30 written, 29/30 accepted, 0 wrong text, P(acc>=0.8) 0.99. French (LightOnOCR-3-1B draft), with two draws pooled: 60 pages, 55 written, 51/55 accepted, 2 wrong text (3.6%), P 0.99. Six languages are held after one draw: Spanish 15/18 (1 wrong text), Italian 23/27 (3), German 13/19 (5), English 19/25 (5), Dutch 15/22 (3), Portuguese 26/29 (1, P 0.877; no unsampled book left for a second draw). The Latin fallback for the pages the GPU route leaves unwritten, agy-flash-low reading 4 pages a call, fails: 24/30 written, 18/24 accepted, 5 wrong text. Wrong-page controls were rejected in every cell (2/2 each). Planted errors were caught 2/2 in each cell that has a planter (la, fr, de; the planter knows no other language). LightOnOCR drafted 2,744 pages/h on gex45 (210 pages in 275 s, 16 clients, util 0.6, 0 errors). PERO on CPU took 13.8 s/page. Latin used 53 agy calls for 30 written pages (1.8 per written page)."
status: decided
decision: "Latin and French go into ARMC_CAMPAIGNS (cli-ocr-lane.mjs --frame=campaign, PR #8137): tier A whole, then tier B hit pages ±2, holds kept. Every other language waits. The unwritten half of Latin is ledgered and waits for a fallback that passes its own cell. 209 judge-accepted test pages were written as first reads (holds kept); rejected pages stay unread."
superseded_by: null
issue: [8049]
router_evidence: "none: score files are in scripts/eval/route-judge-6740/jcb-1600-8049/results/ (score-cell, -la2, -la4, -frpt); router-table not edited"
---
## 2026-11-04 · JCB pre-1600 first reads: which languages may the GPU-draft route read? (#8049)

Part of #8049.

PRIOR ART: `scripts/eval/route-judge-6740/cheap-routes-7701/run.mjs` (the cell-test shape and the Beta rule),
`en-pre1800-gpu-6871` (a bare GPU read fails on pre-1800 print; never served), `gpu-latin-route-pilot-7263`,
`euro-print-gpu-correct-e3-e5-7567` (the per-language draft engines).

**Rule** (per cell): at least 10 judged, wrong text ≤ 4%, P(acc ≥ 0.8) ≥ 0.9 under Beta(1+k, 1+n−k) over written
pages, wrong-page controls rejected, planted errors not both missed. A second draw is taken from books not already
sampled, and pooled only for a language whose first draw came close (Latin: 14/15, half of its pages written; French: 25/28).

| cell | draft | drawn | written | accepted | wrong text | P | decision |
|---|---|---:|---:|---:|---:|---:|---|
| Latin (2 draws) | PERO | 60 | 30 | 29 | 0 | 0.99 | PASS |
| French (2 draws) | LightOnOCR | 60 | 55 | 51 | 2 | 0.99 | PASS |
| Portuguese | LightOnOCR | 30 | 29 | 26 | 1 | 0.877 | HOLD |
| Italian | LightOnOCR | 30 | 27 | 23 | 3 | 0.686 | HOLD |
| Spanish | LightOnOCR | 30 | 18 | 15 | 1 | 0.548 | HOLD |
| English | LightOnOCR | 30 | 25 | 19 | 5 | 0.253 | HOLD |
| German | LightOnOCR | 30 | 19 | 13 | 5 | 0.086 | HOLD |
| Dutch | LightOnOCR | 30 | 22 | 15 | 3 | 0.071 | HOLD |
| Latin fallback | agy-flash-low@4 | 30 | 24 | 18 | 5 | 0.221 | HOLD |

Why a page goes unwritten: the apply guards decline it. Most often a diff-guard flag that is not a like-for-like
substitution, or one that spans a tag. Also: a corrector `<script>handwritten|mixed</script>` tag, under N% of the
words in the GPU draft, or no draft. These refusals are guards working, not reads lost to quota.

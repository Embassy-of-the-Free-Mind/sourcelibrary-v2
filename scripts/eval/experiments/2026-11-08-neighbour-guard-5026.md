---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: 5989
verdict: "The write-time neighbour guard refuses 0.43% of correct stored pages on an out-of-sample random draw (13/2,997, Opus-read against the sources) and 0.27% in-sample (8/2,992); it refuses all 21 pre-repair Atalanta Fugiens receiving pages and 8 of the 11 L'escole des filles pages named in feedback."
status: adopted
decision: "scripts/lib/neighbour-guard.mjs wired into both translation write doors (translate-core.mjs and src/lib/translate-write.ts), always on, reasons 'neighbour-leak' and 'absorbs-neighbour' (#5026)."
feeds: none
supersedes: []
superseded_by: null
issue: [5026, 8399]
---
## 2026-11-08 · Can a write-time check refuse a page holding its neighbour's English without refusing correct pages? (#5026)

PRIOR ART:
- `scripts/eval/context-bleed-5274/door-refusals.mjs` — the false-refusal count for a door change over a `$sample` of pages; it runs the one-page health check. The neighbour check needs n-1, n+1 and the book's K, so `scripts/eval/neighbour-guard-5026/measure.mjs` reads those per page.
- `scripts/audit/translation-page-boundaries.mjs` — `sharedRun`, `LEAK_MIN_CHARS` and the source-repeat exemption (moved into the guard module, re-exported by the audit).
- `scripts/lib/block-page-guard.mjs` `lengthRatioK` / `blockAbsorptions`, `scripts/lib/leaf-shift.mjs` `ABSORB_*` — the length rule, which ran only inside multi-page calls and only forward.

**Who it is for.** A reader of page n+1 who is shown page n's English (Atalanta Fugiens, 21 pairs; L'escole des filles, feedback 6aeff0e1e94c27b5c3c82d3b on #8399). The one-page health check cannot see it: the copy is good English, 1.5–1.9× the OCR, under `isExcess`'s 3×.

**Design.** Each stored page's English is put through `neighbourVerdict` as if it were written again, against its stored neighbours and its book's K. Draw A: 2,992 random pages (`$sample`, translated with OCR), used to tune. Draw B: 2,997 fresh random pages, the rule frozen, out of sample. Every refusal was read blind by an Opus subagent against the two sources and both Englishes: carries neighbour text / otherwise defective / correct. Positive controls: Atalanta's 21 receiving pages as stored before the 2026-09-24 repair (`page_revisions` `anomaly-fix`), and L'escole as stored today.

**Result.**

| set | n | refused | carries neighbour text | otherwise defective | correct (false refusal) |
|---|---:|---:|---:|---:|---:|
| draw A, the brief's literal rule | 2,992 | 51 | 18 | 8 | 25 (0.84%) |
| draw A, final rule (in sample) | 2,992 | 31 | 17 of 18 | 6 | 8 (0.27%) |
| draw B, final rule (out of sample) | 2,997 | 31 | 15 of 16 | 3 | 13 (0.43%: leak 7, absorb 6) |

- The literal absorption rule (own > 0.5 and the length of two leaves) refused 20 pages in draw A and **none** held the neighbour's text (14 were correct); it now also requires the page to be 0.5 longer than that neighbour's own English. In draw B it refuses 9: 1 real, 2 defective, 6 correct.
- Leak test: run ≥ 200 chars the sources do not share (the shorter of 200 and half the shorter source, ≥ 40, for title pages), on the side with more English per source character, and either ≥ 30% of the page, or (no K) ≥ 15%, or taking the run out brings the page back toward the book's ratio.
- Atalanta: **21/21** refused (all `neighbour-leak`). L'escole: **8** refused (pp. 13, 14, 25, 26, 33, 61, 111 leak; 72 absorb). Feedback named 12–14, 25–26, 32–33, 61, 72, 111, 132–133; p.15 passes (its run is shared with p.14, the longer side, which is refused), 132–133 match no signal.
- Moving `leakNorm` from the audit's bare `/<[^>]+>/g` to `stripMarkupTags` (#5564) drops one draw-B real leak: the bare strip ate text after a `<-` centring marker and made a 593-char run 49% of the page; on the whole text it is 12% and the length test passes it. The correct-page count is unchanged.
- Side finding: ~0.5% of random stored pages (16/2,997) hold a neighbour's English, mostly FORWARD (n's English runs into n+1's opening). The guard prevents new ones; repairing the stored ones is not in this change.

*Replicated?* Yes for the false-refusal rate: tuned on A, measured on B (0.27% → 0.43%). Labels are one Opus read per page, no second reader.

Artifact: `scripts/eval/neighbour-guard-5026/measure.mjs`; draws and labels in the job scratch (`neighbour-guard-5026`, archived to R2).

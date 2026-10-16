---
stage: translation
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 253
n_pages: 506
verdict: "One added edge instruction does not cut broken page joins on the production CLI lane (3.8 Flash): 15.4 vs 16.2 defective per 100 joins, Δ +0.8 (95% CI −4.7 to +6.3), inside an A-vs-A swing of 6.7. Not shipped. The lane already makes few of the shapes the instruction names."
status: rejected
decision: "NO MEASURABLE EFFECT by the registered rule; the v13 default stays (DECISIONS.md)"
superseded_by: null
issue: 6742
---
## 2026-10-16 · Can one prompt instruction stop new broken page joins on the production translation lane? (#6742)

PRIOR ART: #5349 (the "stop where the page stops" restraint block, judged on page-level invention, null), #5675 (seam
lines alone, null), #5678 (folio markers, p 0.105 twice; "the defect is the model"). Those ran on the paid flash-lite
lane. The #6742 write-ups (`2026-10-15-seams-scale-opus-flashlite-6742.md`, `2026-10-15-seam-repair-pilot-6742.md`,
`2026-10-16-seam-repair-lean-6742.md`) supplied the junction set, the judge and the defect shapes this targets.

**Who this is for.** Readers turning pages. #6742 measured 31% of served prose joins defective. The nightly lean runner
repairs the backlog; this asked whether new translations could be made with fewer broken joins.

**Design** (preregistered and committed before any arm ran: `scripts/eval/seam-prompt-6742/PREREGISTRATION.md`).
- The change: `candidate.mjs`, one instruction (`1a`) after v13's instruction 1. It names the three shapes the pilot
  found: an ellipsis at the foot or head of a page, a sentence closed that the source carries on, a catchword rendered.
- The request is production's: `buildTranslationPrompt` with the v13 default, `PAGE_BREAK_SCOPED`, neighbour OCR and
  the CLI suffix, through `gatedTextCall`, model `gemini-3.8-flash-low`. That is what `cli-translate.mjs` and
  `stale-retranslate-6567.mjs` send. Through them, 3.8 Flash wrote 31K of the ~42K pages translated in the 3 days before
  this run; Opus via the Claude CLI wrote most of the rest.
- Arms: **P** (production), **P2** (production again, the A-vs-A floor), **C** (candidate). Per junction, page N was
  seeded with the stored translation of N−1, and N+1 with the arm's own read of N.
- Sample: the #6742 300-junction set, one per book. 46 dropped before any call: 40 English books (production no longer
  translates them), 5 English pages, 1 hidden page. 254 kept; 253 have all six reads.
- Join judge: the blind Opus pairwise judge of `judge-repairs.mjs`, both orders in different calls, 10 pairs per call,
  on C vs P and P2 vs P, plus 20 byte-identical pairs per order. A version is defective when flagged in both orders.
- Whole-page guard: a seeded 127 of the junctions, one page each. A blind Opus judge saw the full source and both full
  translations and named the more faithful and complete one, or tie. Both orders; 10 identical pairs per order.
- Rule (card 3): ship only if Δ's 95% interval excludes 0, Δ ≥ 8 per 100, Δ lies outside the A-vs-A interval, both
  script groups agree, and the whole-page L − W upper bound ≤ 10 points.

**Result.**

| | P | C | P2 |
|---|---:|---:|---:|
| joins defective (both orders), C-vs-P judging | 16.2% | 15.4% | — |
| joins defective (both orders), P2-vs-P judging | 12.6% | — | 19.4% |
| defective in either order, C-vs-P judging | 27.3% | 24.1% | — |
| feet ending in an ellipsis (of 254) | 4 | 0 | 3 |
| heads opening with an ellipsis (of 253) | 0 | 0 | 1 |
| feet ending without closing punctuation | 163 | 180 | 163 |
| failed reads after retries (junctions) | 1 | 1 | 1 |

- **Δ (P − C) = +0.8 per 100 joins, 95% CI −4.7 to +6.3** (book bootstrap). Discordant joins: 28 better on C, 26 on P.
  Preferred in both orders: C 29, P 26, tie 158, split 40.
- **A-vs-A: P2 − P = +6.7 per 100 (−12.3 to −1.2 for P − P2).** Two draws of the same request differ by more than the
  candidate does. #5678 saw the same: the count is noisy and which joins fail is not stable.
- **By script:** Latin script (211) P 14.2 / C 15.2; other scripts (42) P 26.2 / C 16.7. The groups disagree in sign.
  The non-Latin drop is exploratory (n = 42, not registered as a pool).
- **By stratum:** random 23.8 / 17.8 (n = 101), flagged 14.7 / 16.7 (102), good 4.2 / 8.3 (24), plant 3.8 / 7.7 (26).
- **Whole page (127 pages):** C preferred in both orders on 23 pages, P on 27, tie 41, split 36. L − W = +3.1
  points (−7.9 to +14.2). The A-vs-A arm shows the same width: +2.4 (−7.9 to +12.6). At n = 127 this judge cannot
  resolve a 10-point margin, so the guard fails for both arms. Median C/P page length is 0.991.
- **Judge floor:** 128 of 128 identical join pairs and 20 of 20 identical page pairs were called tie.
- **Rule output: NO MEASURABLE EFFECT. Not shipped.** No migration and no prompt version.
- Read by eye: 8 random decisive C-vs-P verdicts. Each note named a real, specific difference at the turn, and they split
  both ways: a dropped footnote, "seyn" omitted, a duplicated "after his death", an invented header, an untranslated
  phrase. The judge is not calling noise, but the differences are idiosyncratic per draw, not the shapes `1a` names.

**What it means.**
- **The production lane rarely makes the shapes the pilot found.** 3.8 Flash ends 1–2% of pages on an ellipsis and
  opens almost none with one. On the stored text of these junctions, made mostly by older lanes (flash-lite,
  `gemini-3-flash-preview`), the 300-set's Opus labels found 31% of the random stratum defective (32 of 102 kept).
  The instruments differ (a single Opus label vs. a pairwise flag in both orders), so that is not a measured drop.
  It agrees with #5678, where Flash cut seam defects against Lite.
- **The prompt does change behaviour, not quality.** C leaves more feet unpunctuated (180 vs 163), as instructed, and
  the judge saw no difference in broken joins. The defects left on this lane are idiosyncratic per draw: a footnote
  lost, a word left out, a clause doubled. A prompt line cannot target them.
- So prevention on this lane means checking the join after the write (the write-time guard, `SEAM_GUARD`, #6742),
  not adding another line to the prompt.

**Replicated?** No. One run. The non-Latin difference needs its own registered run before anyone acts on it.

**Spend.** agy (subscription, $0): 1,537 translation calls. The account was locked for ~70 minutes mid-run by other
jobs' use, and the run waited. Claude CLI (subscription, $0): 120 join-judge and 106 page-judge calls,
$53.69 list-equivalent, not billed. The box's account went from 37% to 43% weekly over the run, shared with other jobs.

**Artifact.** `scripts/eval/results/seam-prompt-6742/` (report.json with the rule output, reads, both judges' verdicts,
calls). Harness: `scripts/eval/seam-prompt-6742/ab.mjs build|translate|joinjudge|pagejudge|score`. The OCR context
(`ctx.jsonl`) is rebuilt from Mongo by `build` and not committed.

---
stage: translation
measure: [judged, cost]
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics]
n_books: 30
n_pages: 120
verdict: "Siku lane (agy 3.8 Flash-low, Paddle OCR), 30 books drawn from the lane's cohort, blind Opus judge with the image (4/4 planted controls caught). 4 pages a call (B) holds quality (drawn pages: accept 21/30 vs 19/30 at 1/call, 0 wrong-leaf, 0 translator-invented by eye) but costs 0.53 calls and 0.65 of the token index per page (0.48 calls planned on whole books): above the 0.5 bar. Two leaf lines (C) cut margin furniture rendered as English from 12 to 7 of 120 pages, acceptance unchanged (79 vs 78/120)."
status: adopted
decision: "B fails its quota bar, so D was not run and nothing goes to the router table; #7503 owns the 4/call switch. The leaf lines (C) go to the lane's 1/call reader via --instructions-file (lane-local)."
superseded_by: null
issue: [5600, 7503]
---
PRIOR ART: `scripts/eval/agy-per-call-7503/` and `2026-10-27-agy-pages-per-call-siku-7503.md` (#7518), which ran the
same question on 60 pages with a token index only. `2026-10-27-caseless-block-drift-guard-7503.md` is the Han guard.
New here: the lane's cohort as it picks books today, untranslated pages only, the agy meter read, the lane's own
rubric plus margin/bleed flags, and a prompt-line arm.

## 2026-10-29 · Siku lane: 4 pages per agy call, and two leaf lines in the prompt (#5600)

**Question.** Two questions about the Siku lane:
1. Does reading 4 pages per agy call (B) keep quality while drawing well under half the quota per page?
2. Do two prompt lines (C) stop margin furniture appearing as English, and stop the last sentence being completed
   from the next leaf? Both faults were seen in the 2026-10-29 spot check.

**Draw** (`siku-percall-5600/draw.mjs`, seed 5600, committed before any read).
- **Frame:** 8,780 books, the lane's cohort as `rankBooks` picks it: three hold reasons; rung transcribed or
  translating; OCR on 80% or more of pages; residue, seal and #7090 books excluded.
- **Sample:** 30 books. From each, one untranslated, translatable Paddle page, uniform among the pages that sit
  inside a run of 4 such pages. That run of 4 is the page's block, and the drawn page's position in it is seeded.
- **Which pages each arm read:** every arm read all 120 block pages in page order, so the drawn page has its real
  neighbour context. For B, the block is one 4-page call.
- Read-only: nothing was applied.

**Arms.** All arms used gemini-3.8-flash-low on the james pool (`AGY_HOME=/root/.agy-james`), with `--fresh`, and
kept their reads.
- **A:** `cli-translate.mjs read`, 1 page per call (the lane's route).
- **B:** `claude-translate.mjs read --cli=agy --per-call=4`.
- **C:** A plus the two lines (`--instructions-file`).
- **D** (B plus the lines) was not run, because B failed its bar.

**Judge** (`siku-percall-5600/judge.mjs`).
- Opus via `claude -p` on l7a's subscription, `--restricted` with Read only, one output per call, blind (hashed ids;
  the key is never in a prompt).
- The prompt is route-judge-6740's `judgePrompt` (accept, fidelity, taxonomy defects). Added to it: the lane's
  spot-check rubric (wrong_leaf, invented, sense_errors, verdict), `margin_furniture_in_english`,
  `next_leaf_bleed` / `prev_leaf_bleed`, and the neighbouring pages' OCR.
- A verdict counts only if its stream-json transcript shows `page.jpg` opened. All 268 calls did (57 supplement verdicts were reused from the drawn-page run: same page, arm and text).
- **Controls:** 2 planted next-leaf bleeds and 2 wrong-leaf controls. **4/4 caught**, each flagged and rejected.
- **Which pages were judged:**
  - Primary test: the 30 drawn pages, in every arm.
  - Supplement, added after the primary test because n = 30 was too small for C's flag: all 120 block pages, A and C
    only.

**Gemini's filter.** On 證治準繩 (a medical book), Flash replied "This request was blocked by Gemini's filters…".
- B refused those calls (page tags mismatch), so the page has no read.
- In A and C the notice came back with exit 0, but `cli-translate.mjs apply` refuses it ("reply cut before
  <<<END>>>"; dry runs: 4 of 120 in each arm).
- None of the 711 cohort books that already have English holds the notice.
- Scoring: such a page counts as **no read**, which means not accepted. It is never counted as invented.

### Decision rule, fixed in the brief, decided by it

- **B passes** if all of: wrong-leaf 0; invented 0; acceptance within 0.08 of A; quota per page below 0.5 of A.
- **C passes** if the margin/bleed flags drop and acceptance is not lower than A.

### Results: the 30 drawn pages (`results/score-drawn.json`)

| arm | accept | accept 95% CI (by book) | wrong text | fidelity | wrong-leaf | invented (judge) | sense-error pages | margin furniture in English | next-leaf bleed | no read |
|---|---|---|---|---|---|---|---|---|---|---|
| A 1/call | **19/30** | 0.47–0.80 | 5 | 4.00 | 0 | 0 | 10 | 5 | 0 | 2 (filter) |
| B 4/call | **21/30** | 0.53–0.87 | 6 | 4.00 | 0 | 1 | 8 | 6 | 0 | 1 (filter) |
| C 1/call + lines | **20/30** | 0.50–0.83 | 5 | 3.97 | 0 | 1 | 10 | 3 | 0 | 1 (filter) |

Paired by book:

| comparison | accept difference | 95% CI | lost | gained |
|---|---|---|---|---|
| B − A | +0.067 | −0.10 to +0.23 | 2 | 4 |
| C − A | +0.033 | −0.17 to +0.23 | 4 | 5 |

**The one "invented" in B and C is the same page**, read by eye: 全芳備祖集 vol 6, p.15.
- The leaf's 欽定四庫全書 head is cut at the edge, and Paddle read it as 自以工人之.
- All three arms translated that OCR line: "considered by workers…" (A), "from the craftsmanship of human artisans" (B),
  "work of human craftsmanship" (C). The judge flagged only B and C.
- It is OCR-borne margin furniture, so **translator-invented = 0 in every arm.**

### Supplement: all 120 block pages, A and C (`results/score-all.json`)

| arm | accept | accept 95% CI (by book) | wrong text | fidelity | sense-error pages | margin furniture in English | next-leaf bleed | invented (judge) |
|---|---|---|---|---|---|---|---|---|
| A | **79/120** | 0.55–0.77 | 21 | 3.87 | 40 | **12** | 1 | 3 |
| C | **78/120** | 0.58–0.73 | 21 | 3.95 | 40 | **7** | 1 | 4 |

C − A, paired, by-book bootstrap:

| measure | difference | 95% CI | pages |
|---|---|---|---|
| accept | −0.008 | −0.10 to +0.08 | 19 better, 20 worse |
| margin flag | −0.042 | −0.092 to +0.008 | 8 fixed, 3 new |
| bleed | 0 | | 1 page in each arm |

The judge's "invented" flags, read by their notes:
- 3 of A's and 2 of C's are OCR-borne: a garbled running head, or a fabricated OCR line.
- The translator's own: A 1 ("until we reach the Yellow Springs", finishing the Zuozhuan story from memory); C 2
  ("became disordered", and one name that reads as a sense error).

### Quota

| arm | agy calls | calls / page | refused calls | pages re-read alone | input / page | cached | output + thinking / page | token index / page | vs A | vs A, uncached |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 120 | 1.00 | 0 | 0 | 8,023 | 1,961 | 814 | 12,906 | 1.00 | 1.00 |
| B | 64 (17×4, 6×3, 5×2, 36×1) | **0.53** | 5 (all Gemini's filter) | 5 | 4,237 | 1,219 | 697 | 8,417 | **0.65** | 0.66 |
| C | 120 | 1.00 | 0 | 0 | 7,055 | 2,977 | 674 | 11,096 | 0.86 | 0.74 |

How to read it:
- **The token index is input + 6 × (output + thinking).** As in #7518, the 6 is assumed, not measured.
- **Token counts are noisy.** C sends a longer prompt than A, yet agy reported about 1,000 fewer input tokens per
  page. Run-to-run noise in agy's counts is about ±10–15%, as #7518 found between its two 1/call runs.
- **Calls per page are exact.**
- **Why B makes so many single calls: the block floor.** 23% of Siku pages (991 of 4,357 untranslated pages in the 30
  books) are under translate-batch-seam's `MIN_OCR_CHARS_FOR_BLOCK` (200), and each is read alone. On those books'
  whole untranslated page lists, 4/call **plans 0.48 calls a page** (`lane-calls.mjs`), before retries and re-reads.
  With B's in-sample overhead (7 extra calls in 120 pages) that is about 0.54. **That floor is the lever.** Siku
  pages are short (median OCR about 225 characters). This test did not try a lower floor.
- **The meter did not resolve the arms** (`results/meter-readings.jsonl`, one reading a minute, 22:11–22:43Z).
  - The lane on main drew from the same james account the whole time, at 0.00012–0.00025 of the week per minute (its
    rate doubled between the baselines before and after).
  - Readings from different processes disagree by up to 0.001.
  - Over the measured window (22:14:53–22:28:31) the week fell 0.0036. The lane accounts for 0.0016–0.0034 of that,
    which leaves 0.0003–0.0020 for this test's 304 calls.
  - Per arm, the meter is unreadable, so the ratio rests on calls and tokens.
  - The mesh cannot touch main's STOP file, and its verbs cannot read main's `pool-readings.jsonl`. So the arms were
    run in tight blocks (177, 126 and 178 s) and the lane's rate was read from this job's own readings of the same
    pool between arms.
- A stale local lock (`/root/.model-limits/agy_.agy-james-gemini-3.8-flash-low.json`, written 2026-10-27 09:44Z while
  the account was still on Starter quota) blocked every james-pool agy call on l7a until 2026-11-03. It was moved
  aside (`.stale-2026-10-27`); the pool read 54% left and calls succeeded.

### The Han page-break guard (#7503 condition) (`results/drift.json`)

The floor: `detectCaselessDrift` flags **4.58%** of this lane's breaks at 1/call (13,937 breaks, 138 books; measured
2026-10-29 21:25Z).

| arm | breaks tested | flagged | rate | P(≥ k flags at the 4.58% floor) | guard fired in production | pages re-read alone | index after re-reads | flags on final texts (90 breaks) |
|---|---|---|---|---|---|---|---|---|
| A (each break read as if in a block) | 90 | 4 | 4.4% | 0.60 | n/a | 0 | 1.00 | 4 |
| B (in-block breaks the guard saw) | 61 | 1 | **1.6%** | 0.94 | **yes, once** (涇野子內篇 54→55, shift 0.44) | 2 for drift (+3 for Gemini's filter) | **0.65** | 3 |
| C (each break read as if in a block) | 90 | 4 | 4.4% | 0.60 | n/a | 0 | 0.86 | 4 |

The guard ran on the agy 4/call reader as the lane would run it, and fired once. B's in-block flag rate (1/61) is not
above the 1/call floor; no flag in B exceeds it. 61 breaks cannot show a false-flag rate on this lane: that needs the
guard on the reader in production, as #7503 asks.

### Decisions (by the rule)

**B does not pass.**
- Quality passes: wrong-leaf 0; translator-invented 0 by eye; acceptance +0.07 against A.
- Quota fails: 0.53 calls and 0.65 of the token index per page are not below 0.5 of A, and the whole-book projection
  is 0.48 calls before re-reads.
- So D was not run, and no router-table cell was added.
- **Conditional recommendation for #7503:** per Derek's 2026-10-29 condition, nothing changes until the caseless guard
  runs on the agy 4/call reader in production with its false-flag rate confirmed on this lane. If 4/call is
  reconsidered, test it together with a lower `MIN_OCR_CHARS_FOR_BLOCK` for Siku. At no floor at all, 4,357 pages
  would take 1,126 calls (0.26 a page) instead of 2,089.

**C passes, narrowly.**
- Margin furniture in English: 5 → 3 on the drawn pages, and 12 → 7 of 120 in the supplement. The interval just
  touches 0.
- Next-leaf bleed: 0 → 0 drawn, 1 → 1 of 120. It is rare at 1/call, so the second line shows no measured effect and
  no measured harm (omission 3 vs 3).
- Acceptance: 20 vs 19 drawn, 78 vs 79 of 120 (a difference of −0.008).
- The two lines go to the lane's 1/call reader (`siku-translate-lane.mjs` `LEAF_LINES`, `--instructions-file`, written
  per book). They do not go into cli-translate's shared prompt, nor into the block reader, where they were not tested.

**Caveats.**
- One judge, with a stricter prompt than the lane's spot check. On it, all three arms miss the lane's own bar
  (sense-error pages are about 1 in 3), which the 2026-10-29 spot check passed with 20 pages on a lighter prompt.
- n = 30 drawn pages: an acceptance difference under about 15 points cannot be detected there.
- The supplement's pages are 4 per book, so its intervals are by book.

**Cost.**
- 304 agy calls, about 0.2–0.4% of the james week.
- 268 Opus judge calls on l7a's subscription, $17.3 list-equivalent.
- Nothing written to pages or books. The readers' `lane_job_books` label uses the job name
  `siku-lane-5600-percall-test`, so the lane does not skip these 30 books.

Files: `scripts/eval/siku-percall-5600/`
- `draw.json`
- `results/`: `score-drawn.json`, `score-all.json`, `drift.json`, `lane-calls.json`, `arm-runs.json`, `calls-B.jsonl`,
  `meter-readings.jsonl`, `reads.jsonl.gz` (all 360 reads), `verdicts-opus.jsonl.gz`, `judge-key-*.json`

The reads are also kept in R2 `candidate-reads/`.

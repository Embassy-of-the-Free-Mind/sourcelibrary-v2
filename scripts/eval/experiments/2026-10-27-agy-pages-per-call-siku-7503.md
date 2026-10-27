---
stage: translation
measure: [judged, stability]
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics]
n_books: 15
n_pages: 60
verdict: "Gemini 3.8 Flash-low through agy, 60 held Siku pages (Paddle OCR), blind Opus judge with the image, 5/5 planted controls caught. Usable: 1 page/call 82% and 75% (two fresh runs), 2/call 80%, 4/call 80%. Both block arms sit inside the floor between the two 1/call runs. Quota index (input + 6 x output, the 6 is assumed): 2/call 0.70, 4/call 0.55 of 1/call. Zero refused calls. One new defect: inside a block, a sentence that runs across a page break is finished on the earlier page (2 of 26 in-block breaks at 2/call, 3 of 39 at 4/call, 0 in the 1/call runs). block-drift.mjs cannot see this in Chinese."
status: undecided
decision: "Recommend 4 pages/call for the Siku lane, once the drift guard covers caseless scripts. The production default is a separate PR (#7503)."
superseded_by: null
issue: [7503, 5600]
---
## 2026-10-27 · Gemini CLI translation, 1 vs 2 vs 4 pages per call, on Siku pages (#7503, job agy-per-call-7503)
<!-- PRIOR ART: #6443 (pages per call for Gemini IMAGE transcription; error 12% -> 22% at 5 per call). Nobody had tested translation from text. PR #7504 is the tool (claude-translate.mjs --cli=agy, call_usage in metas). -->

**Question.** An agy call carries a fixed CLI system prompt on top of our template. If 2 or 4 pages per call keeps quality, the ~1.37M-page Siku backlog (#5600) uses much less of the shared weekly Gemini pool.

**Draw** (`agy-per-call-7503/draw.mjs`, seed 7503, committed before any read). The frame is the 10,343 live books held as `paddle-zh-5600-ocr-only` or `gpu-backlog-5660`, minus the 20 books of the skqs-flash-pilot-5600 pilot. 15 books were drawn. From each, one run of 4 consecutive translatable pages with `ocr.source: paddle`, starting at a seeded random point: 60 pages, 167–557 OCR chars per page (`draw.json`).

**Arms.** All 60 pages in every arm, `--fresh`, `CANDIDATE_READS=off`, gemini-3.8-flash-low via agy. The four arms ran at the same time, so their wall times are comparable.
- **A1**: `cli-translate.mjs read`, the production single-page prompt, one page per call.
- **A1b**: A1 again. This is the noise floor.
- **B2**: `claude-translate.mjs read --cli=agy --per-call=2`, the block prompt.
- **C4**: the same with `--per-call=4`.

**Judge** (`prep.mjs`, `judge.mjs`). Opus via `claude -p`, one page per call, Read tool only. Each call got:
- the page image;
- the page's OCR, plus the OCR of the page before and after (so bleed can be seen);
- the four versions under shuffled letters W–Z, with `<summary>`/`<keywords>` cut.

The arm key is in `judge-key.json` and was never in a prompt.

**Controls.** Five controls were planted on 5 pages from 5 different books. Each control is a fifth version, made from a SEPARATE fresh 1/call read (arm CTL), so it could not be caught by diffing it against a shown arm:
- 3 had a middle sentence dropped;
- 2 had the next page's first sentence appended.

**All 5 were caught** (each drop flagged as an omission, each bleed as cross-page bleed, all marked unusable), so `status: ok`.

### Results (n = 60 pages / 15 books per arm; Wilson 95% CI on the share of pages)

| arm | usable | omission | addition | sense error | cross-page bleed | name/term garbled |
|---|---|---|---|---|---|---|
| A1 1/call | **49/60, 82%** [70–89] | 2 (3%) [1–11] | 5 (8%) [4–18] | 20 (33%) [23–46] | 0 [0–6] | 19 (32%) [21–44] |
| A1b 1/call again | **45/60, 75%** [63–84] | 5 (8%) [4–18] | 5 (8%) [4–18] | 20 (33%) [23–46] | 0 [0–6] | 18 (30%) [20–43] |
| B2 2/call | **48/60, 80%** [68–88] | 4 (7%) [3–16] | 8 (13%) [7–24] | 16 (27%) [17–39] | 1 (2%) [0–9] | 17 (28%) [19–41] |
| C4 4/call | **48/60, 80%** [68–88] | 6 (10%) [5–20] | 4 (7%) [3–16] | 18 (30%) [20–43] | 2 (3%) [1–11] | 11 (18%) [11–30] |

Paired difference in usable rate against A1, with a 95% bootstrap that resamples the 15 books:

| comparison | difference |
|---|---|
| A1b − A1 (the floor) | **−6.7 pts** [−16.7, +3.3] |
| B2 − A1 | −1.7 [−15.0, +10.0] |
| C4 − A1 | −1.7 [−16.7, +13.3] |

Pages whose usable verdict differs between two arms: A1~A1b 10/60, A1~B2 13, A1b~C4 13, A1~C4 17. Neither block arm is further from A1 than the two A1 runs are from each other.

Unusable pages cluster in the two 御定佩文韻府 volumes, a rhyme thesaurus of short quotations. They account for 5 of A1's 11 unusable pages, and every arm finds them hard.

| arm | calls (pages per call) | refused calls | input / page | of which cached | output / page | thinking | quota index / page | vs A1 | vs A1, uncached input only | English chars / page | wall (parallel) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 60 (60×1) | 0 | 6,397 | 3,655 | 606 | 0 | 10,034 | **1.00** | 1.00 | 2,546 | 388 s |
| A1b | 60 (60×1) | 0 | 6,921 | 3,114 | 580 | 0 | 10,402 | 1.04 | 1.14 | 2,479 | 390 s |
| B2 | 34 (26×2, 8×1) | 0 | 3,941 | 1,896 | 519 | 0 | 7,056 | **0.70** | 0.81 | 2,221 | 263 s |
| C4 | 21 (12×4, 1×3, 1×2, 7×1) | 0 | 2,517 | 1,151 | 500 | 0 | 5,515 | **0.55** | 0.68 | 2,160 | 215 s |

How to read the token table:
- **The quota index** is input + 6 × (output + thinking) per page. The 6× weight is an ASSUMPTION (Gemini's list-price ratio), not a measured agy quota rate. The second "vs A1" column counts only uncached input.
- **The cache adds noise.** agy reports `cache_read` on about half the input, and it varied between the two identical A1 runs (3,655 vs 3,114 per page). So the uncached index carries about ±10% noise from caching luck alone.
- **The block arms were never refused.** No `page_tags_mismatch`, and no drift or seam re-reads.
- **Some pages are always read alone.** 5 of the 60 pages fall under translate-batch-seam's 200-char block floor (`MIN_OCR_CHARS_FOR_BLOCK`) and are read alone in every arm, which is part of why B2 and C4 have single calls. The share of Siku pages under that floor decides how much of the saving the full backlog gets.
- **Thinking was 0 on every call** (flash-low).

### The new defect: a sentence across a page break is finished on the earlier page

Every cross-page bleed the judge found in B2 and C4 is paired with an omission at the top of the next page in the same block. The model completes the sentence that runs over the page break on page N and starts page N+1 at the next sentence. Read by hand at the seam:

| book | break | arm | what the block reads put on page N | how A1 split it |
|---|---|---|---|---|
| 論語商 | p.37→38 | B2, C4 | 非與驕傲相反（若以謙恭解之便非本旨矣） | no fault at this break (both A1 runs) |
| 天原發微 | p.56→57 | C4 | 至哉言也學者宜深味之 | no fault at this break (both A1 runs) |
| 經濟類編 | p.63→64 | C4 | "Use a white flag for stone" | "For stones / , use a white flag" |
| 學易記 | p.122→123 | B2 | "…and cannot be disordered." | "…cannot be altered. / cannot be disrupted." |

Rates:
- B2: 2 of 26 in-block breaks.
- C4: 3 of 39 in-block breaks.

So the rate per break is about the same (~8%) at both block sizes, and 4/call has more in-block breaks per page. The two 1/call runs put no text on the wrong side of a page break.

Nothing is lost from the book and nothing is invented. One clause sits on the page before its own, which is exactly the error a page citation inherits. `scripts/lib/block-drift.mjs` exists to catch this move (#5021), but it makes no claim on caseless scripts: its first test is a lowercase opening letter. Unpunctuated SKQS OCR is invisible to it, and none of the five moves was re-read.

### Recommendation

**4 pages per call for the Siku lane**, after the drift guard learns caseless scripts.
- **Quality:** usable, sense errors and names are not distinguishable from one page per call; every difference lies inside the A1-vs-A1b floor.
- **Quota:** the index is 0.55 of one per call (0.68 counting uncached input only).
- **The page-break shift:** it happens at about the same rate per break at 2/call, so choosing 2 does not avoid it. The choice between 2 and 4 then comes down to quota, and 4 saves more.
- **Before switching the lane:** extend block-drift to Chinese. For example, flag an in-block break where page N+1's English opens on a capitalised fresh sentence while its OCR continues page N's (SKQS pages almost never begin a new sentence at the top of a half-leaf). Otherwise accept that roughly 5% of pages carry a clause one page early.

**Caveats:**
- **Prompt confound.** A1 uses the single-page production prompt (sentinel markers) and B2/C4 the block prompt, so this compares the lane as it is against the block lane, not pages per call alone.
- **Sample size.** At n = 60 across 15 books, a difference under about 15 points in usable rate is not detectable.
- **One judge.** A single Opus judge rated every version, which the controls validate only for gross faults.
- **Cost of the run:** about 180 agy calls; 60 judge calls at about $5.7 notional, on the subscription; Gemini weekly 70% → 69%.

Files: `scripts/eval/agy-per-call-7503/`
- `draw.json`, `page-ids.json`
- `controls.json`, `controls-tamper.json`
- `reads.jsonl` (every read, all arms)
- `calls-B2.jsonl`, `calls-C4.jsonl`
- `judge-verdicts.jsonl`, `judge-key.json`
- `tokens.json`, `results.json`

Re-score with `node scripts/eval/agy-per-call-7503/score.mjs --scratch=<dir with the arms>`. Nothing was written to pages or books. The readers recorded their book lists in `lane_job_books`, which is a label: nothing selects or skips a book from it.

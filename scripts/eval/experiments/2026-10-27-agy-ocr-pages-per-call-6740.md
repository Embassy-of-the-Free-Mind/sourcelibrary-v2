---
stage: ocr
measure: [accuracy, judged]
languages: [lzh, de]
scripts: [Hant, Latn]
canons: []
n_books: 30
n_pages: 60
verdict: "Two pages per call holds for a fresh Siku read (accepted 8/30 vs 8 and 7 at 1/call, paired CER -0.6 pts, 0 cross-page faults) at 0.83 of the quota per page, and fails for the German Flash-Lite correction (23/30 vs 27 and 27), where the block corrector put new errors into correct drafts (hyphen seams read as s, a Latin word replaced by Chinese characters) and missed fixes both 1/call runs made. The saving is 17-25%, not ~30%: agy's fixed context is ~10K tokens a call, each page image ~17-18K."
status: undecided
decision: "T2 (correction): 1 page per call stays. T1 (fresh read): the rule is met, so 2 per call is ALLOWED for agy fresh reads of Siku pages; nothing is wired here (no routing edit in scope), and Flash low is accepted on only 8/30 Siku pages whichever arm reads."
superseded_by: null
issue: [6740, 7503, 7522]
---
## 2026-10-27 · Does agy 3.8 Flash low hold OCR quality at 2 pages per call, for a fresh read and for a correction? (#6740)

PRIOR ART: `scripts/eval/agy-per-call-7503/` (PR #7518: 1/2/4 pages per call for TRANSLATION; its quota index, its
A-vs-A noise floor and its planted controls are reused here); `scripts/eval/route-judge-6740/judge.mjs` (the
image-grounded Opus judge prompt, imported unchanged); `scripts/eval/paddle-zh-qa-6388/kanripo.jsonl` and
`ground-truth-5935` (the Kanripo leaf rule and body CER); the #6443 context arm (Flash low, Siku, 1/call 12.1% vs
5/call 21.6% CER, one 5-page call returned text from none of its pages). Sibling: #7522 tests FRESH German/Latin
reads at 1/2/4; this entry is the Siku fresh read and the German CORRECTION request, and does not cover #7522.

**Why.** The agy pool is shared (~104K Flash-low calls a week, `2026-10-27-agy-quota-pool-6740.md`), and every agy OCR
and correction route reads one page per call. If 2 pages a call holds quality, each route costs less of the pool.

### Pre-registration (committed before any arm was scored)

**Pages** (`draw.mjs`, salt `6740-ppc`, `draw.json`): 15 books × 2 adjacent pages per task.
- **T1, fresh read, Siku Chinese:** the Kanripo-scored books of `paddle-zh-qa-6388/kanripo.jsonl`, seeded. Both pages
  of a pair have their own trusted Kanripo screen (dice ≥ 0.6) on adjacent Kanripo pages, ≥ 40 Han each.
- **T2, correction, German Flash-Lite drafts:** the router tests' `de-lite` pages (#7434), seeded, each with its next
  (else previous) page, also a Flash-Lite draft ≥ 300 characters. Drafts are frozen at draw time.

**Arms** (`read.mjs`, `gemini-3.8-flash-low`, nothing kept or written):
- **A1, A1b:** one page per call, twice (the noise floor). The request is `cli-ocr.mjs read`'s byte for byte: T1 the
  live OCR prompt + the sentinel image instruction; T2 the #5924 one-page correction template (`fc-prompt.mjs`), the
  router tests' `lite>agy-flash-low` request.
- **B2:** the pair in one call: the same prompt, both images attached as p01/p02, one answer per page under
  `===== PAGE pNN =====` markers inside the sentinels (T2: `correctInstruction(2)` adapted as `fc-prompt.mjs` adapts
  `correctInstruction(1)`). A reply without exactly p01, p02 in order is read once more, then each page alone (a
  REFUSED BLOCK, counted and paid for).
- **C3** (3 per call) only if B2 passes the rule below on a task.

**Measures.**
- **Accepted:** the route-judge's Opus judge (`judgePrompt`, one output per call, the page image attached, blind: the
  item ids are opaque and shuffled). T1 items carry the page's own Kanripo leaf as a reference, as the router tests'
  `zh-dice` cell did. A text two arms share exactly is judged once.
- **T1 CER:** body CER against the page's own Kanripo leaf (`bodyCer`, the #5935 window: the leaf and its neighbours).
- **Cross-page faults**, per page, mechanical (`score.mjs`), every flag then checked by eye against the reference
  (T1 Kanripo leaf, T2 the frozen drafts):
  - an empty or failed page;
  - a swap: the output is closer to the other page of the pair (Han bigram dice for T1, word-trigram overlap for T2)
    than to its own;
  - bleed / moved lines: T1, a run of ≥ 8 Han that is in the other page's leaf and not in the own leaf; T2, a line of
    ≥ 25 letters that matches a line of the other page's draft (trigram Jaccard ≥ 0.6) and nothing in its own (< 0.3).
  The same checks run on A1 and A1b, so a flag a 1/call arm also raises is the detector's noise, not a block fault.
- **Quota per page:** from agy's own usage on every call made (refused and re-read calls count), the #7518 index
  input + 6 × (output + thinking) per page (the 6× weight is an assumption, not a measured agy rate), and the
  uncached variant. `agy -p /quota` is read before and after each arm, as a coarse check only.
- **Controls:** 5 per task, built from A1b reads (seeded): 3 with a middle line dropped, 2 with the first line of
  the next page's A1b read appended (a planted bleed). Judged blind among the others. The judge passes a task at
  ≥ 4/5 caught (not accepted, or a `wrong_text` defect); below that the task's acceptance is "probe broken". The two
  planted bleeds must also be flagged by the mechanical cross-page check, else that check is "probe broken".

**Decision rule, per task.** 2/call is adopted for the task if all three hold:
1. **Quality inside the noise floor:** B2's accepted count ≥ the lower of A1's and A1b's (and, T1, B2's mean CER ≤ the
   higher of A1's and A1b's).
2. **Cross-page faults:** 0 of 30 B2 pages, or every one is caught by a guard that runs without the eval's reference
   (the block-marker refusal, or for T2 the line check against the drafts the lane already holds).
3. **Saves quota:** B2's quota index per page is below both A1's and A1b's.
Otherwise one page per call stays. At n = 30 a difference under about 20 points of acceptance cannot be detected;
the rule asks only that 2/call is not visibly worse than 1/call is from itself.

**Limits.** $0 (subscriptions). agy Flash low only; ~160 agy calls, ~200 Opus judge calls. No page, book or R2
write; no routing-table edit.

### Amendment (before the final score, after the controls ran)

The pre-registered T2 line check (line-to-line trigram Jaccard) caught 0 of 2 planted bleeds: the reads and the
drafts break lines differently, and German letter trigrams are shared by any two pages. It now asks whether a line's
letter 8-grams are >= 70% in the other page's draft and < 30% in its own (2/2 caught). The 1/call baseline was also
made explicit in code: a block flag is a fault only if neither 1/call read of the page carries the same foreign run
(`score.mjs` `novel`), and each remaining flag was checked by eye (`by-eye.json`). No verdict had been read for the
decision at that point; the judge was still running.

### Results (2026-10-27, `results.json`, `pages.jsonl.gz`)

163 agy calls (gemini-3.8-flash-low, agy 1.4.8, this box's agy-guard), 0 quota replies; 182 Opus judge calls
(`claude -p --model opus`), 0 unparsed. **Controls: 5/5 caught by the judge in each task, and 2/2 planted bleeds
caught by the cross-page check in each task**, so neither probe is broken.

| task | arm | accepted (Wilson 95%) | Δ vs A1, pts [95% by book] | wrong text | CER mean / median | cross-page faults | calls | in / out tok per page | quota index (rel A1) | uncached rel | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 Siku fresh read | A1 1/call | 8/30 [14–44%] | — | 17 | 0.223 / 0.047 | — | 32 | 28,145 / 472 | 30,977 (1.00) | 1.00 | |
| T1 | A1b 1/call | 7/30 [12–41%] | −3.3 [−16.7, +10.0] | 15 | 0.231 / 0.060 | — | 34 | 28,136 / 470 | 30,954 (1.00) | 0.89 | |
| T1 | **B2 2/call** | **8/30** [14–44%] | 0.0 [−20.0, +16.7] | 18 | **0.159** / 0.065 | **0/30** (2 flags, both cleared by eye) | 17 | 22,886 / 465 | 25,677 (**0.83**) | 0.81 | **rule met** |
| T2 German correction | A1 1/call | 27/30 [74–97%] | — | 2 | — | — | 30 | 26,726 / 683 | 30,825 (1.00) | 1.00 | |
| T2 | A1b 1/call | 27/30 [74–97%] | 0.0 [−10.0, +10.0] | 3 | — | — | 30 | 28,403 / 688 | 32,531 (1.06) | 1.10 | |
| T2 | **B2 2/call** | **23/30** [59–88%] | −13.3 [−36.7, +6.7] | 3 | — | **0/30** | 15 | 19,531 / 626 | 23,287 (**0.76**) | 0.80 | **rule failed (quality)** |

Thinking tokens were 0 on every call. "Cross-page faults" counts block pages only; at 1/call there is no other page in
the call.

**T1, Siku fresh read: the rule is met.**
- Accepted 8/30, the same as A1 (A1b 7/30). Mean CER 0.159 against 0.223 and 0.231.
- The mean flatters B2. Gemini's safety filter ("This request was blocked by Gemini's filters") cut 4 A1, 8 A1b and 2 B2
  replies, on numeric 三易洞璣 and 佩文韻府 pages, and it is random. The one re-read rescued both B2 blocks but not 2 A1
  and 4 A1b pages, which score CER 1. **On the pages both arms read, paired CER B2 − A1 = −0.6 pts [−4.5, +2.9]**
  (28 pages), against A1b − A1 = −4.3 [−11.0, +0.1]: no difference either way.
- Cross-page check: 4 B2 flags, 2 of them shared with the 1/call reads. The other 2 are Kanripo's page break falling a
  column off the scan's: both 1/call reads carry the same text at the head of the second page. One B2 page also holds
  A1's entries in another order (CER counts that). No text moved between the two pages of a call (`by-eye.json`).
  #7518 saw a sentence finished early across the break in block translation; nothing like it shows here.
- Quota 0.83 of 1/call per page (0.81 uncached).
- Flash low is a poor Siku reader at any k: 22–23 of 30 pages are not accepted, mostly omissions (O5) and misread
  characters on dense dictionary pages. The rule allows 2/call; it does not make this a good route.

**T2, German correction of Flash-Lite drafts: the rule fails on quality.**
- B2 accepted 23/30, below both 1/call runs (27 and 27). B2 is rejected on 5 pages that both 1/call runs accept. They
  come from 3 books and include both pages of two blocks, so errors are correlated within a call. B2 gains 1 page that
  both 1/call runs reject (*Tuba visitationis* p. 19, where they read the facing page's edge strip as a column).
- The block corrector **makes correct drafts worse**. Counts of the word in draft / A1 / A1b / B2:
  - *Unparteiische Samlungen* pp. 34–35: line-break hyphens turned into a letter s: `Natiosnal` (0/0/0/1),
    `unserbitlichen` (0/0/0/1), `wesder` (0/0/0/1).
  - *Augsburgs Buchdruckergeschichte* p. 220: `immanissimo` (1/1/1/0) replaced by the Chinese characters 变形. That is
    two letters, so the wrong-script guard (3+ letters, `reread-lane-gate.mjs`) would let it through.
  - *Kreuter Buch* pp. 581–582: the draft's `Rölkraut` (3/0/0/3) is left as it is. Both 1/call runs restored
    `Kölkraut`.
- No cross-page fault: no text moved between pages, none swapped, none empty. The failure is in the correction itself.
- Quota 0.76 of 1/call per page (0.80 uncached).

**Why the saving is 17–25% and not ~30%.** At 1/call a call carries ~28K input tokens; at 2/call ~46K. So agy's fixed
context is ~10K tokens a call and each page image (with its share of the prompt) ~17–18K. Halving the calls saves only
the fixed part. Even unlimited pages per call would save at most ~37% on a fresh read. Translation saves more (#7518:
0.70 at 2/call) because its per-page input is text, not an image.

**The `/quota` meter cannot see an arm.** The weekly fraction moved 0.0003–0.0007 per 30-page arm, while every other
job drew on the same pool (`quota-readings.json`). Only the per-call tokens separate the arms.

**3 per call was not run.** T1 met the rule, but a C3 arm needs three adjacent Kanripo-aligned pages per book, i.e. a
new draw. Its best case is ~0.75 of 1/call, against 0.83 at 2/call, and the lane is one Flash reads badly.

**Caveats.**
- n = 30 pages in 15 pairs. A difference under ~20 points of acceptance is not detectable. T2's −13 pts
  [−37, +7] is a failure of the pre-registered rule, not a measured effect size.
- The T1 judge had the Kanripo leaf as a reference, as the router tests' zh-dice cell did.
- One account and one day. The filter-block rate on these Siku pages is its own finding: 14 of 163 replies.

**Writes:** none to pages, books, page_revisions or R2; no routing table edited; every read is in `reads.jsonl.gz`.

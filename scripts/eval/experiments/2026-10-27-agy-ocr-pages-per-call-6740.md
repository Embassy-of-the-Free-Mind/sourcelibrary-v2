---
stage: ocr
measure: [accuracy, judged]
languages: [Chinese, German]
scripts: [Hant, Latn]
canons: []
n_books: 30
n_pages: 60
verdict: "PENDING: pre-registered before any read was scored."
status: undecided
decision: null
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

### Results

PENDING.

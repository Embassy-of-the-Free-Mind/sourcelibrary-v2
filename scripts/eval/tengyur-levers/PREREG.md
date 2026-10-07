# #6121 preregistration: does context or a stronger model fix the reversals in the Tengyur's weak sections?

PRIOR ART: `scripts/eval/experiments/2026-10-04-tengyur-characterize-random-sample-5829.md` (the
instrument: rubric, two blind Opus reviewers, planted controls, by-eye check) and
`scripts/eval/experiments/2026-10-03-tengyur-quality-arms-5497.md` (the production request and the
levers already ruled out: glossary, Sanskrit, thinking, negation detector + Pro fix pass). This file is
committed before any arm output exists. Written 2026-10-06.

## Sample (drawn; `results/tengyur-levers-6121/sample.json`)
- 60 mid-text pages of the Derge Tengyur draft: **30 Pramāṇa, 10 Madhyamaka, 10 Vinaya, 10 Jātaka**,
  exact counts. Per section a seeded (`mulberry32(6121 + section index)`) uniform draw by global index
  over that section's pages with `translation.data` (never `$sample`).
- Redrawn when the page or the side before opens a text (`{D####}`), the page has a colophon, or either
  of the two previous sides has no e-text. 1 redraw (a colophon).
- Population: Pramāṇa 12,784, Madhyamaka 10,845, Vinaya 10,229, Jātaka 2,954 pages with English
  (36,812 in all). All 60 stored pages are `gemini-3-flash-preview`, prompt v13.

## Arms (`run-arms.mjs`; outputs to files only, no page writes)
- **S** the stored English (control).
- **A** production again: `gemini-3-flash-preview`, the pinned v13 prompt document, `buildTranslationPrompt`
  + `PAGE_BREAK_SCOPED`, one page, no context, thinking budget 0, temperature 1.0, realtime. A-vs-A floor.
- **C** A's request + a read-only context block appended after the page: the text's Tohoku number and its
  Tibetan and Sanskrit titles (from the text's opening side), and the Tibetan of the two previous sides,
  with the instruction to translate only this page (`CONTEXT_HEAD` in `run-arms.mjs`).
- **P** `gemini-3.1-pro-preview`, A's request unchanged, thinking budget 128 (the lowest Pro accepts; a
  3-page probe off the sample billed 0 thinking tokens, $0.016 a page realtime). Billed thinking is
  recorded per call.
- **PC** Pro with C's context. **Run only if both P and C pass the rule below** in Pramāṇa or in the
  pool. If run, it is judged in a second round beside a fresh review of S on the same pages, with 10 of
  the plants, and compared with that S.

## Judging (`build-packet.mjs`, reviewers = Claude Opus subagents on the subscription)
- Round 1: 240 items (60 pages × S, A, C, P) + 20 planted controls, shuffled (seed 6122), opaque ids, the
  English rendered by #5829's `renderEnglish`, arm unlabelled. Two independent partitions (A, B) of
  batches of 10; no batch holds the same page twice. Each item is read by two blind reviewers, at most
  8 subagents at a time.
- Prompt: #5829's `REVIEW-PROMPT.md` verbatim + `REVIEW-ADDENDUM.md` (one added field, `span`:
  ok / extra / short).
- Controls (`build-controls.mjs`, pages in the four sections outside the sample): 6 negation flips,
  6 agent swaps, 4 wrong terms (#5829's planters, unchanged) and 4 span plants (the previous side's last
  sentences prepended).
- **Gate:** each reviewer finds ≥ 10 of the 12 reversal/agent plants (typed reversal or agent at the
  planted spot), and the two together mark ≥ 3 of 4 span plants as not `ok` or as an addition. A failed
  gate is reported and the rule output is "instrument failed".

## Measures
- **R** per page per arm = reversal + agent findings by either reviewer (the union; a spot both flag
  counts once, matched as in #5829's `analyze.py`). Reported per 100 pages. Secondary: the both-reviewer
  count; all findings; score; verdict.
- **Span error page** = either reviewer marks `span` ≠ ok.
- Cost per 1,000 pages per arm from the run's billed tokens (`ledger.jsonl`), realtime and
  batch-equivalent (× 0.5), thinking tokens included.

## Rule (fixed here, before any arm output)
For each section (Pramāṇa n = 30; Madhyamaka, Vinaya, Jātaka n = 10 each) and for the registered pool
of all 60 pages, an arm X ∈ {C, P, PC} is **adopted** for that section only if all three hold:
1. **Beats the floor:** mean R(S) − mean R(X) > |mean R(A) − mean R(S)| (per page, same pages).
2. **Paired test:** one-sided p < 0.10 for R(X) < R(S), by a paired sign-flip permutation test on the
   per-page differences (10,000 draws, seed 6121; exact enumeration when n ≤ 20 nonzero differences).
3. **Span does not rise:** span-error pages(X) ≤ span-error pages(S) + |span-error pages(A) − span-error pages(S)|.
Otherwise the rule output for that section is **no change: publish as is, put the money into human
review (#5800)**. A section at n = 10 is exploratory and can only support a small-tier step; the pool
can be reported for the four sections together. Secondary, not part of the rule: the decision-card
minimum effect for a rate (8 per 100 pages, `eval-design.md` §10.2).

## By eye
20 reversal/agent findings drawn by seed (6121): 5 from each of S, A, C, P (from the union), each read
against the Tibetan and marked confirmed / debatable / rejected. Reported as per-arm precision; if one
arm's precision differs sharply, the per-arm R is reported adjusted as well (not part of the rule).

## External references (step 4, time-boxed to 2 hours, evaluation only)
Look for a published English or French translation of at least one Pramāṇa and one Madhyamaka text
of the Derge Tengyur that aligns to ≥ 20 sides (candidates: Stcherbatsky's *Nyāyabinduṭīkā*, Candrakīrti's
*Madhyamakāvatāra*, Āryadeva's *Catuḥśataka*, Nāgārjuna's *Ratnāvalī*). If found: A, C, P run on those
sides and two blind Opus judges grade S/A/C/P against the reference with `tengyur-arms/JUDGE-PROMPT.md`'s
rubric. Secondary evidence; it does not enter the rule. Reference text stays in `/root/tlev/` and is
never committed. If nothing aligns to ≥ 20 sides in 2 hours, that is reported and the test continues
without it.

## Spend
Gemini cap **$5** for everything (arms, probe, reference sides), enforced by `run-arms.mjs` against
`/root/tlev/ledger.jsonl`. Expected: A ≈ $0.22, C ≈ $0.30, P ≈ $1.00, PC ≈ $1.10 if triggered.

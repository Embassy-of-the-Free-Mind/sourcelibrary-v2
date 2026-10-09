# #6121 round 2 preregistration: do newer models fix the Tengyur's weak sections?

PRIOR ART: `PREREG.md` (round 1, same directory) and
`scripts/eval/experiments/2026-10-07-tengyur-weak-section-levers-6121.md`. Round 2 reuses round 1's
sample (60 pages), its 58 reference-aligned sides (D4231 / Stcherbatsky 1930, D3862 / La Vallée Poussin
1907), its arm files S and A, its packet builders and judge prompts. Nothing is redrawn. Written
2026-10-07, committed before any round-2 arm output on the sample or the reference sides exists (a 2-page
probe per Gemini model, off the sample, ran first; it billed 0 thinking tokens and returned the house
format).

## Arms
- **S** stored English (gemini-3-flash-preview, v13). Reused.
- **A** round 1's production rerun (`arms/A.jsonl`, `arms/A-ref.jsonl`). Reused, not rerun.
- **G38** `gemini-3.8-flash`, A's request unchanged: `buildTranslationPrompt` + `PAGE_BREAK_SCOPED`, the
  pinned v13 prompt document, one page, no context, thinking budget 0, temperature 1.0, realtime.
- **G35** `gemini-3.5-flash`, the same request.
- **O** Claude Opus (claude-opus-5-5) as a subagent on the subscription. Its instructions are the exact
  production prompt text for the page (the same string G38/G35 receive), one page, no context; it may not
  read any other file, translation or database. At most 6 subagents at a time. Its output is
  `sanitizeTranslationTags`-cleaned like the others.

Every new arm runs on the 60 sample pages and the 58 reference sides (118 pages each).

## Primary measure: fidelity against the published references (58 sides)
- Two blind Opus judges (J1, J2) with round 1's `JUDGE-PROMPT-REF.md`, changed only to allow up to five
  candidates. Each item holds S, A, G38, G35 and O for one side in random order. S and A are judged again
  in this round beside the new arms (round-1 scores are not mixed in).
- Controls as round 1: 6 PLANT items (A beside A with one planted reversal) and 4 DUP items (S beside an
  identical S). **Judge gate:** each judge catches ≥ 5 of 6 plants and ties ≥ 3 of 4 duplicates. If a
  judge fails, the primary measure is reported as "instrument failed".
- Per side and arm: fidelity = mean of the two judges; inversions = the two judges' inversion lists summed.

## Rule (fixed here)
For each reference text, which stands for its section (Pramāṇa = D4231, 28 sides; Madhyamaka = D3862,
30 sides), and for the pool of 58, an arm X ∈ {G38, G35, O} is **worth a priced re-translation** for that
section only if all three hold:
1. **Beats S by more than A does:** mean(fid X − fid S) > |mean(fid A − fid S)| (and so > 0).
2. **Paired test:** one-sided p < 0.10 for fid X > fid S, by a paired sign-flip permutation test on the
   per-side differences (exact when ≤ 20 nonzero differences, else 10,000 draws, seed 6121).
3. **Inversions do not rise:** total inversions of X (both judges, all sides) ≤ total inversions of S.

Otherwise: **no re-translation for that section; publish as is and put the money into human review
(#5800).** Vinaya and Jātaka have no aligned reference, so the primary rule cannot pass them; the
secondary measure is reported for them as exploratory only.

## Secondary: the round-1 reviewers on the 60 sample pages
- 300 items (60 pages × S, A, G38, G35, O) + 20 fresh planted controls, packet built by `build-packet.mjs`
  (round 2), two reviewer partitions (A, B), batches of 10, never the same page twice in a batch,
  #5829's `REVIEW-PROMPT.md` + `REVIEW-ADDENDUM.md` verbatim.
- **Gate fix first.** Fresh plants (new seed, pages outside the sample and outside round 1's controls):
  6 negation flips, 6 agent swaps, 4 terms, 4 spans. Two planter defects seen in round 1 are filtered:
  a plant that leaves the sentence unchanged, and the `the opponent → we` swap that produces
  ungrammatical English ("we argues"), which a reviewer reads as a typo. **Gate:** each reviewer finds
  ≥ 10 of the 12 reversal/agent plants. If a reviewer misses, re-plant: a calibration packet of 12 fresh
  reversal/agent plants mixed with 8 unplanted real pages, read blind by new subagents of the failing
  partition; at most two re-plants. Every attempt's recall is reported. If a reviewer still has not reached
  10 of 12, the reviewer measure is reported as **"instrument failed"** and the verdict rests on the
  primary measure.
- Reported as round 1 (reversal + agent per 100 pages, union of the reviewers; the round-1 rule with
  |A − S| as the floor), per section and pooled. It does not override the primary rule.

## By eye
20 reversal/agent findings (seed 6121): 5 from each of G38, G35 and O and 5 from S, read against the
Tibetan and marked confirmed / debatable / rejected.

## Cost
Per 1,000 pages from billed tokens (thinking included), realtime and Batch (× 0.5). For O: the API list
price (claude-opus-5-5, $4 / $20 per million, Batch half) from token counts measured on a sample of
prompts and outputs, and the subscription usage (subagent runs and tokens) the 118 pages took.

## Spend
Gemini cap **$5** for round 2 (`/root/tlev2/ledger.jsonl`, endpoint `eval/tengyur-models-6121`).
Expected: G38 ≈ $0.60, G35 ≈ $1.40. Judges, reviewers and O run on the subscription. No writes to
`pages` or `books`. Reference text stays on the box (`/root/tlev/ref/`) and is never committed.

## Known threat
O is the same model family as the judges and reviewers, which can favour its own prose. The reference
anchors the primary measure, the arms are unlabelled, and the by-eye read checks O's findings; the
verdict states this.

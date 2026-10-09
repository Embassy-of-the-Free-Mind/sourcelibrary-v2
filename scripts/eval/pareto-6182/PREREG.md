# #6182 preregistration: translation-model Pareto frontier, Tengyur replication first

PRIOR ART: `scripts/eval/tengyur-levers/PREREG-R2.md` (#6121 round 2: G38 and Opus pass on 2 Tengyur
reference texts, 58 sides), `scripts/eval/experiments/2026-10-07-tengyur-newer-models-6121.md`, the #5497
84000 test (`2026-10-03-tengyur-quality-arms-5497.md`, 113 sides, 8 Tengyur texts) and the five #5695
reference tracks plus the #5873 top-up (`build-translation-pareto.mjs` reads them for /quality). Nothing
here is redrawn except the fresh Tengyur reviewer sample. Written 2026-10-07, committed before any arm
output on a judged page exists. Before writing it, $0.09 of realtime probes ran on 2 off-sample pages per
new model (pages whose reference is withheld, never judged): every Flash and Flash-Lite call billed
0 thinking tokens and finished STOP; `gemini-3.1-pro-preview` billed 0 and 2,362 thinking tokens at
budget 128; `gemini-3.5-flash-lite` refuses `thinkingBudget: 0` (400) and runs at `thinkingLevel: minimal`.

**Already decided, not reopened here:** context does not help; a glossary, a Sanskrit parallel, thinking
and the negation detector are noise; the verse memory is dropped. No re-translation and no routing change
is made by this work; it ends in decisions for Derek.

## Questions
- **(A)** Does round 2's `gemini-3.8-flash` gain over the stored Tengyur English replicate on fresh texts
  and on a fresh random sample of the weak sections? Decides re-translating Pramāṇa + Madhyamaka (~$52),
  plus Vinaya and Jātaka (+$29).
- **(B)** Per language stratum, which model sits on the cost × fidelity frontier, and is any of them worth
  a routing change from today's engine?

## Pages
| set | pages | reference | use |
|---|---|---|---|
| `tib-ref58` | 58 sides: D4231 (28, Stcherbatsky 1930), D3862 (30, La Vallée Poussin 1907) | #6121 alignment | Pareto (Tibetan) |
| `tib-ref113` | 113 sides of 8 Tengyur texts (Toh 3808 50, 1183 25, 1189 25, 4377 6, 4400a 3, 3990 2, 1777 1, 1996 1) | 84000 (eval only, CC BY-NC-ND) | **replication (A)** + Pareto (Tibetan) |
| `tib-rev` | 100 fresh random pages: Pramāṇa 40, Madhyamaka 30, Vinaya 15, Jātaka 15 (`tengyur-levers/sample.mjs --round 3`, seed 6182; every page of rounds 1–2, their controls and the aligned sides excluded) | none | **replication (A)**, reviewers |
| `xl` | 365 pages (one per book) with a reference: #5695 T1–T5 and the #5873 top-up (389 pages; the 24 whose reference is withheld are out) | published human translations | Pareto (B) |

`xl` per language (books): Latin 71, Greek 69, German 22, French 14, Italian 10, Dutch 7, Spanish 6,
Hebrew 29, Aramaic 5, Arabic 24, Persian 23, Sanskrit 30, Pali 30, Chinese 25 (T3 pool 59, T4 pool 81, T5 pool 85) (`results/pareto-6182/xl-pages.json`).

## Arms (exact model ids; every output row carries its model id and date)
Request for every Gemini arm: production's one-page request — `buildTranslationPrompt` with the pinned v13
prompt document (`/root/tref/arms/state.json`, md5 516510147237…), the book record, the page text,
`PAGE_BREAK_SCOPED`, no context; temperature 1.0; thinking budget 0 (`gemini-3.5-flash-lite`:
`thinkingLevel: minimal`, its lowest; Pro: budget 128, billed thinking recorded); Batch API, one job per
model, metered on `eval/pareto-6182` and registered as `external_eval`.

| label | model | where it comes from |
|---|---|---|
| S | stored English (Tengyur only; `gemini-3-flash-preview`, v13) | `pages.translation.data` read 2026-10-07 |
| FP | `gemini-3-flash-preview` (production for Tibetan, Greek, T4 and T5 languages) | tib-ref58: round-1 `A`; tib-ref113: #5497 `B2`; tib-rev and xl: new |
| AA | a second run of the page's production engine (A-vs-A) | tib-ref113: #5497 `B`; else new |
| L31 | `gemini-3.1-flash-lite` (production for Latin and the T3 vernaculars) | new |
| L35 | `gemini-3.5-flash-lite` | new |
| G35, G36, G37, G38 | `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` | tib-ref58 G35/G38: round 2; else new |
| PRO | `gemini-3.1-pro-preview` | tib-ref58: round-1 `P`; else new |
| O | Claude Opus (`claude-opus-5-5`), subscription, the exact prompt string, no tools, ≤ 6 at a time | tib-ref58: round 2; tib-ref113: #5497 `X3` on 40 + new on 73. xl: the tracks' existing Opus arms only (~90 pages, a context request), plotted off the frontier |

On xl, "production" is `getTranslateModelForBook(book)` today: FP for Greek, Hebrew, Aramaic, Arabic,
Persian, Sanskrit, Pali, Chinese; L31 for Latin and T3. **Deviation from production, stated:** the
non-Tibetan lanes send the previous page's English with the page; every arm here gets no context, so arms
differ only by model (context was measured as noise, #6121).

`tib-rev` runs S, FP, G38 only (reviewer load).

## Primary instrument: fidelity against the published reference
- Two blind Opus judges (J1, J2), all arms of a page in one item, labels shuffled per item (seed 6182).
  Tengyur: `JUDGE-PROMPT-REF-R3.md` (= R2 with "two to eleven" candidates and the 84000 reference
  described). xl: `translation-vs-reference/JUDGE-PROMPT.md` verbatim (already n-candidate).
- Per side × arm: fidelity = mean of the two judges; a reversal = either judge lists an inversion
  (Tengyur) or a reversal (xl).
- **Controls, per judge and per packet:** 8 PLANT items (an FP English beside a copy with one planted
  reversal shaped like a real one: a dropped/added negation or a swapped agent; no-op flips filtered) and
  4 DUP items (two identical candidates beside a third). **Gate:** the plant is caught (reversal listed,
  or a lower fidelity than its twin) in ≥ 6 of 8, and the duplicates tie in ≥ 3 of 4. A judge that fails
  is re-run once on fresh controls; if it fails again the packet is reported as "instrument failed".

## Rule A: Tengyur replication (fixed here)
On the **113 fresh sides** (texts G38 never saw), G38 replicates if all three hold, exactly round 2's rule:
1. mean(fid G38 − fid S) > |mean(fid FP − fid S)|;
2. one-sided paired sign-flip p < 0.10 (exact ≤ 20 nonzero differences, else 10,000 draws, seed 6182);
3. total inversions(G38) ≤ total inversions(S).
Reported also per text with ≥ 20 sides (Toh 3808, 1183, 1189) and pooled with the 58.

**Reviewer replication** on `tib-rev` (S, FP, G38 + 20 fresh plants; the #6121 round-2 packet, reviewer
prompt and two partitions; gate ≥ 10 of 12 reversal/agent plants per reviewer, up to two re-plants, else
"instrument failed"). G38 replicates on the reviewers if its reversal + agent findings per 100 pages
(union of the two reviewers) are below S's by more than |FP − S|, one-sided paired permutation by page
p < 0.10 (seed 6182). Per section reported; sections at n ≤ 15 are exploratory.

**Verdict A:** re-translation is supported for Pramāṇa + Madhyamaka if rule A passes on the 113 sides
**and** on the reviewers (pooled over Pramāṇa + Madhyamaka, 70 pages). One of two = "partly replicated";
the decision is Derek's. Vinaya/Jātaka: reviewers only, exploratory.

## Rule B: the frontier and the recommendation per stratum (fixed here)
Strata: Tibetan (171 sides, pooled 58 + 113), Latin, Greek, the T3 pool (German, French, Italian, Dutch,
Spanish), the T4 pool (Hebrew, Aramaic, Arabic, Persian), the T5 pool (Sanskrit, Pali, Chinese). Pools
are named here; a pool is used only if its heterogeneity check passes (every language with ≥ 10 books
has the pool's sign of the effect, and the pooled effect lies inside each such language's 95 % interval).
1. Per arm: fidelity mean [seeded bootstrap 95 % CI over pages], reversal pages per 100, and **$ per
   1,000 pages at the Batch rate from this run's billed tokens** (thinking included).
2. Paired Δ against production with a 95 % CI; the A-vs-A floor = Δ(AA − production).
3. **Frontier:** the arms no other arm beats on both cost (≤) and fidelity (≥). Every other arm is named
   as dominated, with the arm that dominates it.
4. **best** = the Gemini arm with the highest fidelity. **Inside the margin** = fidelity ≥ fid(best) −
   0.25 (the decision card's minimum effect) and reversals ≤ rev(best) + 8 per 100. **Recommended** = the
   cheapest arm inside the margin (equal price: higher fidelity).
5. A recommended arm other than production is a **routing proposal** only if the decision card's effect
   rule holds against production: costlier → Δ's 95 % CI excludes 0, Δ lies outside the A-vs-A floor's
   interval and Δ ≥ 0.25; cheaper → non-inferior, Δ's lower bound > −0.25. Otherwise: keep production.
   Grade by referenced books (exploratory < 30, directional ≥ 30, decision ≥ 50).
6. Opus is the ceiling, not a lane (no working Anthropic key; subscription is not a lane); its price at
   the API list rate is quoted from #6121 ($19.1 / 1,000 pages Batch).

## By eye
Per stratum, 20 judge findings (reversals/inversions): 10 from the recommended arm (or, where production
is recommended, the best other arm) and 10 from production, seeded draw 6182, one per page, read against
the source (and the reference) by a Claude subagent, marked confirmed / debatable / rejected. Precision is
reported beside each arm's rate.

## Spend
Gemini cap **$20** for #6182 (`/root/pareto-6182/ledger.jsonl`, endpoint `eval/pareto-6182`; the runner
refuses a job when ledger + uncollected estimates + the job exceed it). Expected ≈ $15 at the Batch rate.
Opus arms, judges, reviewers and the by-eye reads run on the subscription, ≤ 6 at a time; if the
subscription limit binds, the Gemini arms are finished and reported. Reference texts stay on the box
(`/root/pareto-6182/`, `/root/tlev/ref/`, `/root/tref/`) and are never committed. No writes to `pages`,
`books` or `page_translations`.

## Order (each stage posts a comment on #6182 with the running spend)
1. This preregistration. 2. Tengyur replication (rule A, both instruments). 3. The Tengyur Pareto set.
4. The other strata. 5. Charts on /quality (`build-translation-pareto.mjs` extended, no new page),
`DECISIONS.md` rows, the experiment file, verdict comments on #6182, #6121 and #5700.

## Known threats
- O and every judge are Opus (self-preference). O is a ceiling only; no recommendation can be O.
- The 84000 texts are not the weak sections; the reviewer sample is. The two instruments cover each other.
- xl sends no context where production sends the previous page's English; arms differ only in model.
- Tracks were drawn by different sessions; T3 languages are below 30 books each (pooled only as above).

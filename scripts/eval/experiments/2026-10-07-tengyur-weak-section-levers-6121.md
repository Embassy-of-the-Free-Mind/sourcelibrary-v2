## 2026-10-07 · Tengyur weak sections (Pramāṇa, Madhyamaka, Vinaya, Jātaka): does context or a stronger model fix the reversals? (#6121)
<!-- PRIOR ART: 2026-10-04-tengyur-characterize-random-sample-5829.md (the instrument reused here: rubric, two blind Opus reviewers, planted controls, by-eye check) and 2026-10-03-tengyur-quality-arms-5497.md (production's one-page request; glossary, Sanskrit, thinking and the negation detector + Pro fix pass were already ruled out, on 84000's texts only). Neither tested a lever where the errors are. -->

**Question.** #5829 found the Tengyur draft's reversed statements and wrong speakers/agents concentrated in Pramāṇa (74 per 100 pages), with verse and Jātaka also high. Does either lever that had never been tried there fix them: (C) giving the production model the text's title and the two previous sides as read-only context, or (P) a stronger model, Gemini 3.1 Pro? And what would each cost per 1,000 pages?

**Answer.** **No lever clears the preregistered bar, so nothing changes.** The draft is published as it is, and the money goes to human review (#5800).
- **Context (C) does not help, and on the reference sides it hurts.**
  - Reviewers: 68 reversal/agent findings per 100 pages, against 63 for the stored English. Better on 13 pages, worse on 14.
  - Reference judges: fidelity −0.14 [−0.28, +0.01] against S, with more inversions and more span errors.
- **Pro (P) looks better to the reviewers, but nothing else confirms it.**
  - Reviewers: pooled 38 against 63 per 100 (−25 [−47, −5], p = 0.016); Pramāṇa 33 against 60 (p = 0.068).
  - **The gate failed:** reviewer B caught 9 of 12 planted reversal/agent errors, and the preregistered bar was 10. The registered rule output is therefore "instrument failed".
  - **Two other instruments disagree with the reviewers.**
    - Reference judges against Stcherbatsky's and La Vallée Poussin's published translations: Pro is +0.03 [−0.15, +0.22] in fidelity. On the Pramāṇa text (Dharmottara's *Nyāyabinduṭīkā*) it has *more* inversions than the stored English.
    - By eye: only 2 of 5 of the stored English's findings were confirmed, against 5 of 5 for Pro's. Weighting each arm by its precision removes Pro's lead.
- **Cost per 1,000 pages** (billed tokens, thinking included; Batch-equivalent, with realtime in brackets):
  - A (production): **$1.74** ($3.47);
  - C (context): **$2.25** ($4.51);
  - P (Pro, thinking budget 128): **$10.17** ($20.34);
  - PC: not run (C failed). It would cost about P's price plus 30 % more input.
  - A Pro re-translation would cost about **$130** for Pramāṇa (12,784 pages) or **$375** for all four sections (36,812 pages), at Batch rates.

These are AI reviewers and judges (Opus), checked by Claude. They are not a human review.

**Design** (preregistered at `6c8a45e17`, `scripts/eval/tengyur-levers/PREREG.md`, before any arm output).
- **Sample.** 60 mid-text pages: 30 Pramāṇa, and 10 each of Madhyamaka, Vinaya and Jātaka.
  - The draw is uniform by global index within each section, seeded with 6121 (never `$sample`).
  - A page was redrawn if it, or the side before it, opens a text, or if it holds a colophon. This happened once.
  - Population: 36,812 pages with English. All 60 were `gemini-3-flash-preview`, prompt v13.
- **Arms** (outputs to files only; no page writes). Spend: **$3.31 of the $5 cap**, endpoint `eval/tengyur-levers-6121`.
  - **S:** the stored English.
  - **A:** production again. `buildTranslationPrompt` + `PAGE_BREAK_SCOPED`, the pinned v13 prompt, one page, thinking 0, realtime. This is the A-vs-A floor.
  - **C:** A plus a read-only block: the Tohoku number and Tibetan/Sanskrit titles from the text's opening side, and the two previous sides' Tibetan, with "translate only this page".
  - **P:** `gemini-3.1-pro-preview`, A's request unchanged, thinking budget 128.
    - It billed thinking on 9 of 60 pages, a mean of 344 tokens. A 3-page probe off the sample billed none.
- **Review (round 1).** 240 arm items (60 pages × S, A, C, P) plus 20 planted controls.
  - Items were shuffled, given opaque ids and left unlabelled. No batch of 10 held the same page twice.
  - Each item was read by two blind Opus reviewers, with #5829's `REVIEW-PROMPT.md` verbatim plus one field, `span` (`REVIEW-ADDENDUM.md`). 52 subagent runs.
  - Plants: 6 negation flips, 6 agent swaps and 4 term swaps (#5829's planters, moved to `plants.mjs` unchanged), plus 4 span plants (the previous side's last sentences prepended).
- **Rule.** Per section, and for the pooled 60 pages, an arm is adopted only if all three hold:
  - its reversal+agent rate (union of the two reviewers) is lower than S's by more than |A − S|;
  - a one-sided paired sign-flip test gives p < 0.10;
  - its span-error pages do not exceed S's + |A − S|.
  - Gate: each reviewer finds at least 10 of the 12 reversal/agent plants.
- **External references (step 4, about 1 hour of the 2-hour box).** Two published translations aligned by hand (subagents), 58 sides in all:
  - Pramāṇa: Stcherbatsky, *Buddhist Logic* vol. 2 (1930), English from the Sanskrit. Dharmottara's *Nyāyabinduṭīkā* D4231, 28 consecutive sides (vol. 189, pp. 72–99), 25 high and 3 medium confidence.
    - The obvious file, D4230, turned out to be Vinītadeva's commentary, not Dharmottara's.
  - Madhyamaka: La Vallée Poussin, *Le Muséon* 8 (1907), French from the Tibetan. Candrakīrti's *Madhyamakāvatārabhāṣya* D3862, 30 sides (vol. 102, pp. 437–466), 28 high and 2 medium.
  - A, C and P were run on these sides. Two blind Opus judges graded S/A/C/P against the reference with `tengyur-arms/JUDGE-PROMPT.md`, changed only in the reference paragraph (`JUDGE-PROMPT-REF.md`). Controls: 6 planted reversals and 4 duplicates.
  - The reference text stays on the box (`/root/tlev/ref/`). Only alignment ids and scores are committed.

**Result 1: the review round** (`r1/analysis.json`). Reversal + agent findings per 100 pages, either reviewer [95 % bootstrap CI].

| | S stored | A again | C context | P Pro |
|---|---|---|---|---|
| **pool (60)** | 63 [43–87] | 58 [40–77] | 68 [47–90] | **38** [23–57] |
| Pramāṇa (30) | 60 | 57 | 67 | 33 |
| Madhyamaka (10) | 30 | 50 | 40 | 0 |
| Vinaya (10) | 120 | 60 | 70 | 40 |
| Jātaka (10) | 50 | 70 | 100 | 90 |
| both reviewers, pool | 28 | 35 | 35 | 22 |
| all findings, pool | 258 | 238 | 240 | 185 |
| span-error pages, pool | 1 | 0 | 1 | 2 |
| mean score / light share | 3.61 / 57 % | 3.69 / 61 % | 3.69 / 59 % | 3.73 / 63 % |

| rule vs S | gain / 100 [CI] | better / worse pages | p (one-sided) | floor | span | rule |
|---|---|---|---|---|---|---|
| C, pool | −5 [−30, +20] | 13 / 14 | 0.70 | 5 | ok | no |
| **P, pool** | **+25** [+5, +47] | 20 / 9 | **0.016** | 5 | ok | passes on its own terms |
| P, Pramāṇa | +27 [−3, +57] | 10 / 4 | 0.068 | 3 | ok | passes on its own terms |
| P, Vinaya | +80 [+30, +130] | 6 / 0 | 0.016 | 60 | ok | passes on its own terms |
| P, Madhyamaka | +30 | 3 / 0 | 0.125 | 20 | ok | no (p) |
| P, Jātaka | −40 | 1 / 5 | 0.98 | 20 | rises | no |
| A (floor), pool | +5 | 16 / 15 | 0.39 | — | — | — |

- **Gate (controls): failed by one plant.**
  - Reviewer A found 10 of 12 reversal/agent plants; reviewer B found 9 (the bar was 10). Both missed a mild "is not → is" flip inside a long Pramāṇa sentence and an agent swap whose result read as ungrammatical ("we argues"). B also missed one "you → I" swap.
  - Terms: 3 of 4 for each reviewer. Span plants: 3 of 4 marked by either reviewer.
  - Recall on reversal/agent plants is 79 % (19 of 24 reviews), against 97.5 % in #5829. These pages are denser, and the plants are less blunt.
  - Under the preregistered rule, **the rule output is "instrument failed"**, and no arm is adopted.
- **Floors are noisy at n = 10.** A against S is +60 per 100 in Vinaya (S 120, A 60), so in that section the stored English happened to fare worst.
- **Agreement:** the two reviewers' verdicts agree 80 % of the time. Pages flagged for reversal/agent: A 83, B 89, both 62 (of 240 page-arms).

**Result 2: against the published translations** (`refjudge/scores.json`). Judge gate passed: plants 6/6 and 6/6, duplicates tied 4/4 and 4/4, and the two judges were within one fidelity point everywhere.

| 58 sides | S | A | C | P |
|---|---|---|---|---|
| fidelity (1–5) | 4.41 | 4.40 | 4.28 | 4.45 |
| … vs S [95 % CI] | — | −0.02 [−0.13, +0.10] | **−0.14** [−0.28, +0.01] | +0.03 [−0.15, +0.22] |
| inversion sides, either / both judges | 8 / 3 | 6 / 4 | 9 / 6 | 5 / 3 |
| omission sides, either | 8 | 9 | 10 | 3 |
| span off, either | 1 | 4 | 5 | 2 |
| Madhyamaka (Poussin, 30): fidelity / inversions per 100 | 4.45 / 13.3 | 4.37 / 8.3 | 4.25 / 11.7 | **4.57 / 3.3** |
| Pramāṇa (Stcherbatsky, 28): fidelity / inversions per 100 | 4.38 / 5.4 | 4.43 / 8.9 | 4.30 / 14.3 | 4.32 / **10.7** |

- On the one Pramāṇa text a published translation lets us check, Pro is **not** better: fidelity −0.05, and more inversions than the stored English.
- On Candrakīrti, Pro is the best arm (fidelity +0.12 [−0.12, +0.37], inversions 13 → 3 per 100), but inside the interval.
- Context is the worst arm on both texts.
- These sides have lower error rates than the random sample, and the reference judge counts inversions more strictly than the reviewers count reversal/agent findings, so the two scales are not directly comparable.

**Result 3: by eye, 20 findings read against the Tibetan** (`r1/byeye.tsv`). Seeded draw, 5 reversal/agent findings per arm, one per page.

| | confirmed | debatable | rejected |
|---|---|---|---|
| S | 2 | 2 | 1 |
| A | 4 | 1 | 0 |
| C | 5 | 0 | 0 |
| P | 5 | 0 | 0 |
| **all** | **16** | **3** | **1** (precision 80 %) |

- **Confirmed examples:**
  - (A) སྤོང་བར་བྱེད་པའི་གཉེན་པོ, "the antidote that abandons" wrong views, rendered "to counteract the abandonment of" them;
  - (C) ནུས་པ་ཐོགས་པ་མེད་པའི་དོན་མ་ཡིན ("it is not a case of unhindered capacity") rendered "this does not mean the capacity is hindered";
  - (C) "how is the cause hollow because the effect is" turned round into "how can the effect be hollow because the cause is";
  - (P) གྲང་བ་ལ་སོགས་པའི་མེ ("fire, the counter of cold") rendered "cold acts upon fire";
  - (P) an anticipated objection (གལ་ཏེ…ཞེས་དོགས་པ་བསུ་བ) half given as the author's statement.
- **Rejected:** a reviewer read a denial into an affirmative …རྣལ་མ་ཡིན་ནོ (S).
- **Debatable:** two readings where the e-text supports the draft but the doctrine supports the reviewer. One is the genitive དྲང་སྲོང་མཆོག་གི in a quotation of MMK 17.2.
- **What this means for P's lead:** the stored English's findings were the least reliable (precision 0.6 counting debatable as half, against 1.0 for P). Weighting each arm by its precision gives S ≈ 38 and P ≈ 38 per 100. At n = 5 per arm this is only suggestive, but it points the same way as Result 2.

**Consequences.**
1. **Decision (default): no re-translation of the weak sections. Publish the draft as is, with its stated shortcomings (#6120), and put the money into human review (#5800).** No arm cleared the preregistered rule, and the instrument failed its own gate.
2. **Do not add context to the one-page request.** It did not reduce reversals on either instrument. It lowered reference fidelity (−0.14), and span errors went up against the reference. This confirms #5704's choice of one page with no context.
3. **Pro is the only lever with a signal, and it is unconfirmed.**
   - It is 6 times the cost of Flash: $10.17 against $1.74 per 1,000 pages, Batch.
   - Before anyone prices a Pro re-translation of Pramāṇa (about $130), it needs a confirmatory run: 60 fresh Pramāṇa pages, the same rule, a gate the reviewers pass, and Pro with a real thinking budget as a second arm. That run is about $2–5.
   - Nothing here says Pro is better on Dharmottara, the one Pramāṇa text with a published reference.
4. **The error class is the model's, not the request's.** As in #5713, the confirmed errors are of the same kinds in every arm: case roles misread (las, gis, gi), prasaṅga turned into assertion, an objection's scope lost. They belong to the model, not to the prompt, and they are what a human reviewer (#5800) should be pointed at.
5. **Instrument note.** On dense Pramāṇa pages, reviewer recall on planted reversal/agent errors is about 80 %, not 97 %. A future gate on these sections should use plants that are as subtle as the real errors (#5647's lesson), and should say in advance what happens at a one-plant miss.

**Replicated?** No.
- One run. Pro's reviewer-side gain is p = 0.016 pooled, but the gate failed, and two other instruments (the reference judges, n = 58, and the by-eye precision, n = 20) do not support it.
- Context's null holds on both instruments.
- Per section, n = 10 is exploratory (decision card §10.2: below directional).

**Artifacts** (`scripts/eval/results/tengyur-levers-6121/`; code in `scripts/eval/tengyur-levers/`):
- **Sample and controls:** `sample.json`, `controls-log.json`.
- **Arms:** `arms/{A,C,P}.jsonl` (sample), `arms/{A,C,P}-ref.jsonl` (reference sides), `arms/probe-P.jsonl`, `arms/ledger.jsonl` (every call, billed tokens).
- **Review round 1:** `r1/key.json`, `r1/reviews/{A,B}-NN.json` (52), `r1/analysis.json`, `r1/byeye-draw.json`, `r1/byeye.tsv`.
- **Reference round:** `ref-alignment.json` (ids, folios, confidence, source; no text), `refjudge/key.json`, `refjudge/scores.json` (numbers only).
- **Kept on the box, not committed:** `/root/tlev/ref/` (the Stcherbatsky and La Vallée Poussin texts and the aligned cuts), `/root/tlev/refjudge/` (the judge packets and verdicts, which quote the reference), and `/root/tlev/r1/items.jsonl` (the packet).
- No writes to `books`, `pages` or `page_translations`.

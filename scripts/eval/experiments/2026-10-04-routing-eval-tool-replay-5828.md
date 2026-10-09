---
stage: ocr
measure: [judged, agreement]
languages: [fa, sa, pi, ar, gez]
scripts: [Arab, Deva, Ethi]
canons: []
n_books: 117
n_pages: 117
verdict: "Replayed #5795: the registered rule reproduces every stored verdict; with margin-v1 Persian flips to route to flash (1 discordant page in 30), nothing else changes."
status: informational
decision: "No routing change; supports Derek's Persian override (#5812); margin-v1 is the default rule file for new routing evals"
superseded_by: null
issue: [5828, 5795]
---
## 2026-10-04 · Does #5795's Persian verdict survive a rule with a margin? (replay through the routing-eval tool, #5828)
<!-- PRIOR ART: 2026-10-04-hidden-flash-5795.md — the run whose stored pages are replayed here; it applied one rule, "flash catastrophic ≤ lite", with no margin. benchmark-cost-lane.mjs has a margin rule but on reference CER, which this run does not have. -->

- **Question.** #5795's rule sent Persian's hidden backlog to "stay on lite" on one looping flash page in 30, and Derek overrode it (#5812). Applied to the same stored pages, what does the rule as registered say, and what does a rule with a margin say?
- **Answer.** **As registered: the stored verdicts, exactly, for all five families. With a margin on (b): Persian becomes "route to flash"; nothing else changes.** Sanskrit, Pali and Arabic still fail the label check and go to relabelling; Ge'ez is still one page. So the override and the margin rule agree, and the label failures do not depend on how (b) is read.
- **measure:** by eye (label check, blinded A/B adjudication) plus engine-to-engine **agreement** and a catastrophic count, as in #5795. Not accuracy. No new page was read and no model was called: this is a re-analysis of `results/hidden-flash-5795/results.json`.

### Design

`node scripts/eval/routing-eval.mjs decide --run hidden-flash-5795` applies two rule files to the stored per-page rows:

- `routing-eval/rules/hidden-flash-5795-registered.json`: (a) label correct on ≥ 90 % of pages with text; (b) flash catastrophic count ≤ lite's; (c) flash wins more than it loses by eye, no flash-invented page. This is the preregistration written as data.
- `routing-eval/rules/margin-v1.json`: the same (a) and (c); (b) becomes flash count ≤ lite + 1 **and** the upper 95 % bound of (flash rate − lite rate), paired by page, ≤ 0.10 (seeded bootstrap, 4,000 resamples). The +1 is the catastrophic clause of the cost-lane rule (`benchmark-cost-lane.mjs`).

**The margin is post hoc for this run.** It was chosen on 2026-10-04 after #5795's pages were seen. It is a what-if for #5795 and the registered default for runs sealed from now on.

### Result

| family | pages (with text) | label yes / text | catastrophic lite / flash | flash − lite rate [95 %] | by eye flash / lite | flash invented | as registered | margin-v1 |
|---|---:|---|---|---|---|---:|---|---|
| Persian | 30 (27) | 25 / 27 | 0 / 1 | +0.033 [0, 0.10] | 9 / 0 | 0 | a ✓ b ✗ c ✓ → **stay on lite** | a ✓ b ✓ c ✓ → **route to flash** |
| Sanskrit | 30 (30) | 22 / 30 | 7 / 3 | −0.133 [−0.267, −0.033] | 5 / 0 | 0 | a ✗ → relabel (#4884) | a ✗ → relabel (#4884) |
| Pali | 26 (26) | 18 / 26 | 8 / 5 | −0.115 [−0.308, 0.077] | 0 / 1 | 1 | a ✗ (c ✗) → relabel (#4884) | a ✗ (c ✗) → relabel (#4884) |
| Arabic | 30 (30) | 23 / 30 | 3 / 3 | 0 [0, 0] | 4 / 0 | 1 | a ✗ (c ✗) → relabel (#4884) | a ✗ (c ✗) → relabel (#4884) |
| Ge'ez | 1 (1) | 1 / 1 | 0 / 0 | 0 | 1 / 0 | 0 | undecided: n too small | undecided: n too small |

- **Persian passes exactly at the margin.** One discordant page in 30 gives an upper bound of 0.10. A margin of 0.05 would still say "stay on lite"; two flash-only failures in 30 would fail at 0.10 too. At n = 30 a margin rule separates "one page" from "several", not 3 % from 10 %.
- **Negative control.** An arm made inferior by construction (it fails every page lite fails, plus 20 % more) is refused by both rules in all four families with n ≥ 10: 7 failures against 0 (Persian), 13 against 7, 16 against 8, 9 against 3.
- **Reproduction.** `tests/unit/routing-rules.test.ts` pins that the registered rule returns every stored verdict and every stored a/b/c, and that the committed `routing-eval.json` is what the tool writes.

### Limits

- A re-analysis of one run: one page per book, n ≤ 30 per family, readers were Claude models (see the #5795 entry's limits, which all apply).
- The margin (0.10) and the slack (+1) were not registered before #5795. Read the margin-v1 column as "what this rule would have said", not as a second decision.
- The bootstrap interval of a rate difference with one discordant page is coarse (its upper bound moves in steps of 1/n).

### Decision

None taken here and no routing constant changed. Persian's hidden backlog was already moved to flash by Derek's override (#5812); this replay supports it under a margin rule and does not reopen it. `margin-v1` is the default rule file for new routing evals (`scripts/eval/routing-eval/README.md`).

- **Cost.** $0. No model call, no Mongo write.
- **Files.** `scripts/eval/results/hidden-flash-5795/routing-eval.json` and `.md`; rules in `scripts/eval/routing-eval/rules/`; tool `scripts/eval/routing-eval.mjs`, library `scripts/eval/lib/routing-rules.mjs`.
- *run_id:* `hidden-flash-5795` (replayed). *Replicated?* The registered-rule verdicts replicate the original scorer's exactly; the margin result is new and not replicated on fresh pages.

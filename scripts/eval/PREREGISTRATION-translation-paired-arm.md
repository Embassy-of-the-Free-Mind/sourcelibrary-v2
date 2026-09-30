# Pre-registration: paired lite-vs-flash re-translation of the corpus-audit pages (#5274)

PRIOR ART: `PREREGISTRATION-translation-restraint.md` (#5305, same pages, same judge, three arms with an A-vs-A
floor, but the arms differ by PROMPT on production's routing; here the prompt is fixed and the arms differ by
MODEL). `translation-model-ab.mjs` (#4759) compares the two models pairwise on fluency with no source-grounded
judge and no same-arm control (#5127). Neither answers the audit's open question.

Written 2026-09-30, before any arm output was read or judged.

## Question

The corpus audit (#5274) judged 311 served pages and found lite omits more (20% vs 9% of pages) and flash
invents more (15% vs 8%). Those arms were unpaired: different books, different prompt eras. **On the same
pages, with the same prompt and the same context, does the model change judged fidelity, omission or
invention?** The reader of the answer is Derek, deciding whether routing translation to lite (#4762,
≈ $12K/yr) costs readers fidelity.

## Sample

The audit's 311 `kind: main` pages (`results/translation-corpus-audit-2026-09-30/manifest.jsonl`), one page
per book, 15 languages, not redrawn. **Excluded: the 6 Internet Archive pages whose OCR text belongs to a
neighbouring leaf** (#5311: `02ec073c0c`, `05b1da1988`, `134c51dfa7`, `40d19cba36`, `4b4d01bf24`,
`d9f45e5b0a`); their source text and continuity context do not belong to the same page. n = 305 books.
Source text is the audit's `items.jsonl` `source`, so every arm and the judge read the text the audit read.

## Arms

Same prompt, same context, same generation settings; only the model differs.

| arm | model | role |
|---|---|---|
| L1 | `gemini-3.1-flash-lite` | lite |
| L2 | `gemini-3.1-flash-lite` | lite again: the A-vs-A noise floor (sampler + judge) |
| F | `gemini-3-flash-preview` | flash |

- Prompt: the production door, `buildTranslationPrompt` with the DEFAULT `translation` and
  `english_modernization` prompts loaded from `prompts` at draw time (versions and hashes recorded in
  `arms.json`), book header from the `books` row, `PAGE_BREAK_SCOPED`, the previous and next page's OCR, and the
  previous page's SERVED translation as continuity context. The prompt sent is byte-identical across arms
  (one hash per page, recorded). English books take the modernisation prompt, as in production.
- Generation: `thinkingBudget: 0`, production's `maxOutputTokensFor`, `SAFETY_SETTINGS`, default temperature.
- Batch API, one job per model, submitted from Hetzner. Nothing is written to `pages`.
- Not production's shape in one respect: the realtime worker translates 8-page blocks; this is the
  single-page prompt (as in #5305). The arms share the shape, so the comparison holds; the absolute rates
  are for single-page translation.

## Judge

Claude Opus subagents, the audit's rubric unchanged (`translation-corpus-audit/JUDGE-PROMPT.md`), one item =
source + one arm's output under an opaque id. Packets of 15; a page's three arms never share a packet; arm
counts per packet are balanced by rotation. 30 repeat controls (the same item under a second id in another
packet) measure the judge's own noise. The key stays out of the packets.

## Outcomes and statistics

The unit is the page (= the book). Per page and arm, three PRIMARY binary outcomes:

1. fidelity ≥ 4
2. omission flag
3. invention flag

For each: the rate per arm; the paired difference **Δ = F − L1** in percentage points with a 95% bootstrap CI
over pages (10,000 resamples, seeded); discordant pages each way with the exact two-sided sign test; and the
same three numbers for **L2 − L1** (the floor) and **F − L2** (the replication). Fidelity itself: wins /
losses / ties per page and mean Δ with CI.

Secondary (reported, no rule): any major defect, fidelity ≤ 2, garble passthrough, untranslated, truncated;
the primaries by language and by script class (the audit's split: Latin, English, German, French, Italian,
Dutch, Spanish = Latin-script; the rest non-Latin-script). Subgroups are exploratory unless n ≥ 30 books.

**Failed reads.** Each request's outcome is one of `text | refusal | truncated | empty | error`. A page
enters the paired analysis only if all three arms returned text (a `truncated` output is text and is
judged). Failed reads are counted per arm and reported beside the rates, with a sensitivity row that scores
a failed read as fidelity < 4.

## Rule (written before the read)

For each primary outcome, **the model makes a difference** only if all three hold:

- the 95% CI of Δ(F − L1) excludes 0;
- the 95% CI of Δ(F − L2) excludes 0 with the same sign;
- |Δ(F − L1)| is larger than |Δ(L2 − L1)|.

Otherwise the result for that outcome is **no measurable difference at this n**, and the CI is the statement
of what could have been missed.

What follows from it (a proposal on the issue; no routing constant changes here, `eval-design.md` §10):

- Flash better on fidelity ≥ 4 by the rule, overall or in a script class with n ≥ 30 → propose re-opening
  #4759 for that stratum, with the cost delta per year.
- No difference on fidelity ≥ 4 → lite stays; the audit's unpaired omission/invention gap is recorded as not
  a model effect unless the omission or invention outcome passes the rule on its own.
- Omission or invention passes the rule while fidelity ≥ 4 does not → report the trade (which model, which
  defect, how large) and leave routing unchanged.

`measure: judged` (source-grounded judge, no human reference); never "accuracy".

## Cost

915 requests. Estimate printed by `--draw` before `--submit`; expected ≈ $1 on the Batch API (#5305 ran 288
for $0.34). Under the $10 spend floor; ledger line in the ops repo.

## Amendment, 2026-09-30, made AFTER the result was read

Everything above is as written before the run. This section is not pre-registered.

The statistic named above, the seeded bootstrap in `scripts/eval/lib/paired-stats.mjs`, is defective: its
random generator is not uniform (100,000 draws into 304 bins give chi-square 3,105 against about 303
expected). The first score, computed with it, read fidelity ≥ 4 as +3.6 pp (1.0 to 6.9) for flash − lite and
(1.0 to 8.2) against the second lite run, and the rule printed a difference. The analytic paired interval for
the same 304 differences is −0.2 to 7.4, and a bootstrap on a sound generator (mulberry32) gives 0.0 to 7.6
and −0.3 to 7.6.

Change: the rule is evaluated on the sound-generator bootstrap. The library interval and the analytic
interval are both kept in `report.json` (`ci_library`, `ci_analytic`) beside each `ci`. The rule's three
conditions, the outcomes, the sample and the judge are unchanged.

Effect: fidelity ≥ 4 moves from "difference" to "no measurable difference". Omission and invention read the
same under all three intervals. The change was made with the result in view; it removes a claim, it does not
add one.

Two departures from the design as written, neither affecting the comparison:
- The first flash Batch job returned all 305 requests cancelled at $0; they were resubmitted once with the
  same request bytes.
- One judge (packet 53) wrote its verdict file twice; the second, complete write is the one scored.

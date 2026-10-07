# Pre-registration: does a restraint instruction stop the translator bridging gaps? (#5305)

_Written 2026-09-30, **before any paid run and before any arm output exists**. Issue #5305 (follow-up to the
#5274 corpus audit, PR #5282). Harness: `scripts/eval/translation-restraint-ab.mjs`. The sample and the three
arm prompts are drawn and pinned (`results/translation-restraint-ab-2026-09-30/sample.jsonl`, `arms.json`).
Nothing has been translated. The rule below is fixed now so that it cannot be picked after the numbers are seen._

PRIOR ART: `PREREGISTRATION-translation-prompt-v15.md` (house format, numeric rule); `translation-prompt-ab.mjs`
(the v13/v15 harness, whose v16 follow-up this arm joins); the #5274 audit's judge rubric
(`translation-corpus-audit/JUDGE-PROMPT.md`), reused unchanged so that arm verdicts sit on the audit's scale;
`.claude/docs/eval-design.md` §7 (the A-vs-A arm first) and §8.

## The decision this changes

**Whether the restraint block goes into the v16 candidate prompt.** The candidate is v16 = v15 + one sentence
that limits v15's "omit the note" clause to `original:` quotations (#4767, the reason v15 was not flipped).
Flipping the production default to v16 remains Derek's call, on this result and on #4767's re-run. This study
only settles whether v16 carries the restraint block. **Nothing is flipped by this study.**

## The instruction under test (verbatim, inserted after v15's `<unclear>` section)

> **Stop where the page stops (CRITICAL):**
> - Translate only the words on this page. If the source breaks off mid-sentence or mid-word at its foot, end your translation at the same point, mid-sentence, with no closing full stop, and add `<meta>continues on next page</meta>` after it. Do not finish the sentence, and never supply the words that probably follow, whether from the previous page's translation, from the next page, or from what you know of the work.
> - Where the source is illegible, fragmentary or garbled, render what is readable and mark the rest with `<unclear>…</unclear>`. Never smooth fragments into fluent prose, and never add a sentence, name, number or claim the source does not carry.

The handoff wrote `[illegible]` / `[continues]`. v15 forbids square brackets and already defines `<unclear>` and
`<meta>`, so the instruction uses the closed tag vocabulary instead.

## Design

- **Pages**: the #5274 audit's own pages (one page per book), which already carry an Opus fidelity verdict on
  the served translation. English books are out of scope because they are modernised under a different prompt.
  - *risk* stratum (72 books): every page the audit judge flagged for invention or garble passthrough (51),
    filled to 72 with seeded pages whose **source ends mid-sentence** (`sourceEndsOpen`, from
    `scripts/audit/translation-bridging.mjs`, a property of the source alone).
  - *control* stratum (24 books): seeded from the rest, to see what the instruction does where there is no gap.
- **Arms**, each on the same pages with the same model (production routing, `getTranslateModelForBook`) and
  the same prompt door as the production single-page worker (`buildTranslationPrompt` with the previous page's
  translation as continuity context, the adjacent pages' OCR and `PAGE_BREAK_SCOPED`, #5103):
  - **A1**: v16
  - **A2**: v16 again, an independent sample. This is the **A-vs-A noise floor** (sampler + judge).
  - **B**: v16 + the restraint block
- **Spend**: Batch API, one job, estimate $0.51. Runs on Hetzner.
- **Judge**: Claude Opus, the audit's rubric unchanged, one page at a time, blinded (opaque ids, arms shuffled
  across 8 packets, no arm or model in the packet). Opus rather than Sonnet because the audit's scale is
  Opus's and was validated by eye (20/21 flagged defects confirmed). Rating each page on its own lets a
  tie happen naturally: two translations that carry the same meaning get the same score and flags.
  **Judge-noise control**: 12 (page, arm) items appear twice under different ids, in different packets.

## Outcomes

- **Primary (P)**: the invention-flag rate in the *risk* stratum, B vs A1, paired by page (exact McNemar on
  the discordant pages).
- **Noise floor (N)**: the same paired comparison, A2 vs A1. It is read FIRST.
- **Guards (G)**, both strata:
  - G1: omission-flag rate, B vs A1.
  - G2: share of pages at fidelity ≥ 4, B vs A1.
  - G3: *control* stratum invention and omission. The instruction must not damage pages without a gap.
- **Mechanical secondary (M)**, no judge involved: the share of pages whose source ends open and whose
  translation closes the sentence without a marker (`openEnd`, the #5305 detector); how often `<meta>continues
  on next page</meta>` is emitted; and `<unclear>` per page.

## Decision rule (fixed now)

Put the restraint block into v16 if **all** of these hold:

1. **P**: B's risk-stratum invention rate is lower than A1's by more than the absolute A2−A1 difference
   (the noise floor), **and** the McNemar p for B vs A1 is < 0.10. At n = 72 that is the most this
   sample can support; the direction must also hold in the flagged sub-stratum.
2. **G1**: B's omission rate is not higher than A1's by more than max(5 pp, |A2−A1| on omission). Stopping
   early must not turn into dropping text.
3. **G2**: B's share at fidelity ≥ 4 is not lower than A1's by more than max(5 pp, |A2−A1|).
4. **G3**: on control pages, B's invention and omission rates are each within max(8 pp, noise) of A1's.

If 1 fails with G1–G3 holding, the verdict is **no measurable effect**: the block adds 700 characters to
every call for nothing measurable and stays out. If 1 holds and a guard fails, the verdict is **effect
with a cost**, reported with both numbers and left to Derek.

Before any number is quoted, the five worst B pages by fidelity are read against their source (#4735 rule 5).

## What this cannot say

- It measures a JUDGE's invention flag, not accuracy (no human reference). The audit's controls and the
  by-eye read are the evidence that the flag tracks something real.
- The judge sees only page N's source, so a sentence completed correctly from the next page counts as
  invention. That is intended: this page's text is the only thing the reader of this page can check.
- n = 72 + 24 books is small and exploratory by the dashboard grades. It can show a large effect, not a
  small one.

## Amendments

Any change after the paid run is logged here with its date and reason, and the rule above is not rewritten.

1. **2026-09-30, after submit, before any arm output was collected or read.** The detector's `sourceEndsOpen`
   (the definition behind outcome M, not behind the drawn strata, which stay pinned) was tightened after a
   hand read of 20 corpus flags. A footnote asterisk after a full stop now reads as closed, and a last line
   that is a numbered verse line or critical apparatus makes no claim. M is scored with the tightened version.

## Result (2026-09-30) — rule output: NO MEASURABLE EFFECT, block stays out of v16

Noise floor read first: A2 vs A1 invention 21.1 vs 18.3 % (risk, n 71). P: B 21.1 vs A1 18.3 %, p 0.80. Rule 1
fails; G1–G3 hold. Mechanical M: unmarked open ends 22.5 → 8.5 % (p 0.006). Full entry: `EXPERIMENTS.md`
2026-09-30; report `results/translation-restraint-ab-2026-09-30/report.json`.

# Pre-registration: the translation output contract for illegible pages (#5305, #4883)

PRIOR ART: `PREREGISTRATION-translation-restraint.md` — the restraint A/B on the same #5274 audit pages (a prompt line for bridging; no measurable effect on judged invention). This one tests a pre-model GATE plus a prompt contract for pages nobody could read. Written 2026-10-02, after the free measurements below and the sample draw, **before any A/B output was generated or read**.

## The contract (proposed; nothing here is on in production)

| Case | What the OCR shows | What the translation lane outputs |
|---|---|---|
| (a) | No legible body (letters + digits < 20, CJK ×3) once `<unclear>`, lacunae and OCR metadata are removed, **and** a mark that the page was not read: `<scan-quality>poor`, a page-scope warning ("most/majority … illegible", "almost entirely illegible"), or a lacuna written as text (`[illegible — 2 lines]`). Or a warning that the page is *entirely* illegible. Blank, cover, binding and picture pages are exempt. | Exactly `<warning>Illegible: <reason></warning>`: no `<summary>`, no `<meta>`, no model call. The page is stamped `translation.health_blocked: 'illegible_source'`; English already served is withheld through the #4883 path (`staleTranslationReason` arm 5, `--illegible-arm`). |
| (b) | A garble verdict over threshold | Same as (a). The hook takes an injected verdict; **no $0 detector meets the bar**, so nothing feeds it (see step 2). |
| (c) | Partial garble | The OCR wraps unread spans in `<unclear>`; the translator reproduces them unchanged. Already in translation prompt v13. The OCR prompt (v16) works against it: "if you are marking more than ~20% of words as unclear, you are being too cautious". |

(a) and (b) are enforced in code before the model call: `scripts/lib/illegible-source-gate.mjs`, read by `isTranslatablePage` (every Batch lane) and by the realtime worker, only when `TRANSLATE_ILLEGIBLE_GATE=1`.

The warning is **not** written to `translation.data`. Every counter (`page-counts.mjs hasTranslation`) reads a non-empty `data` as "translated", so the contract's text is derived on demand (`illegibleWarning(verdict)`) and no new field is added.

## Free measurements already made (inputs to this design, not outcomes of the A/B)

- **Step 1, OCR self-report.** Of the 29 audit pages the Opus judge flagged `garble_passthrough`, 24% carry any self-report (`poor`, a legibility warning, or `<unclear>`), against 4.6% of clean pages. On the 14 major positives the figure is 14%. `<scan-quality>` is missing on 38% of positives (OCR prompt vintages v3/v5, Feb 2026). When it is present it says `good` on 55% of positives.
- **Step 2, $0 garble score.** The lexicon score (#5313) had already failed: P 0.24–0.60, R 0.09–0.19. A char-trigram plausibility model per language, trained on 4,500 pages from books outside the audit, gives AUC 0.52 (major 0.48). The positive control, held-out clean pages with 40% of words letter-shuffled, separates in every alphabetic script (+0.8 to +1.8 bits/char, AUC ≈ 1). It does not separate in Chinese, Korean or Japanese, so a null there is no evidence. The judged garble is fluent misreading, which character statistics cannot see.
- **The gate on the audit:** it fires on 1 of 311 pages (Herculanensium p.328, a positive) and on 0 of 282 clean pages. Recall of garble is 1/29: the gate is a narrow door, not a garble detector.
- **The gate on the corpus:**
  - Round 1, 300 random books (tuning): the first cut fired on 0.81% of pages. A hand read found blanks, covers, plates and best-reading `<unclear>` pages, so it was tightened.
  - Round 2, 600 new books (held out): 30 of 73 translated fires hand-read, 21 right, 3 ambiguous, 6 wrong. The 6 were then fixed.
  - Round 3, 600 new books (held out from the fixes): 0.10% of translated pages fire. Of 30 hand-read, 26 are right, 3 ambiguous and 1 wrong (strict precision 0.87).

## A/B design

- **Model:** `gemini-3.1-flash-lite`, Batch API, metered to `gemini_usage` (`eval/illegible-gate-5305`). Cap $5; estimate $0.23.
- **Arms**, all on the production translation prompt (v13, hash `51651014`) through the production prompt door (continuity context, page-break devices):
  - **A:** v13.
  - **A2:** v13 again, the noise floor.
  - **C:** v13 plus the contract clause (quoted in `scripts/eval/illegible-gate-5305.mjs`, `CONTRACT`). It asks the model itself to output only `<warning>Illegible: …</warning>` when it cannot read one complete sentence, and to reproduce unread spans in `<unclear>`.
  - **G:** the pre-model gate applied to A, at $0. On a gated page the output is the contract warning; otherwise it is A's output.
- **Sample, seed 5305:**
  - **positive:** every non-Tibetan, non-English audit page the Opus judge flagged `garble_passthrough` (27, 13 major).
  - **control:** 15 judged-clean audit pages (no garble, fidelity ≥ 4). The 4 that carry an OCR warning or `<unclear>` are all such pages available; the rest are seeded random picks.
  - **illegible:** 12 pages drawn from the round-3 corpus fires, all translated, Syriac and Tibetan excluded.
- **Judge:** blind Claude subagents with the #5274 audit rubric (`translation-corpus-audit/JUDGE-PROMPT.md`). Arm identity is hidden by opaque ids. Repeat controls measure the judge's own noise. Warning-only outputs are not judged; they are scored mechanically as withheld.

## Outcomes

- **Primary, positives and illegible:** the share of pages that still carry English the judge flags as invention or garble passthrough ("fabricated"). Compared A vs C and A vs G with exact McNemar tests; A2 vs A is the floor.
- **Primary, loss:** the share of control pages withheld, by C (a self-emitted warning) or by G (the gate).
- **Secondary:** `<summary>` present on positive and illegible pages, and fidelity ≥ 4 on controls (does the clause harm clean pages?).

## Decision rules (fixed now)

1. **The gate (G) is recommended for switch-on** if it withholds 0 of the 15 controls, and the held-out round-3 hand read keeps strict precision ≥ 0.8 (it does: 0.87). The A/B adds what A writes on the illegible stratum: if A fabricates on ≥ 1/3 of them, the gate's value is direct.
2. **The contract clause (C) is recommended** only if, on positives plus illegible pages, fabrication falls below A by more than the A2-vs-A disagreement, and C withholds ≤ 1 of 15 controls. Otherwise it is reported and not proposed.
3. With 27 + 12 pages this is a **pilot**: a difference smaller than the noise floor is reported as "no detectable effect", never as "no effect".
4. **Nothing is switched on.** The flag flip, the withhold sweep (`--illegible-arm`) and any prompt change are Derek's call (#5305).

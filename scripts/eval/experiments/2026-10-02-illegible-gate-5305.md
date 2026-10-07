## 2026-10-02 — What should the translator output for a page nobody could read? A pre-model gate: right on 26 of 30 held-out fires (precision 0.87), 0 false withholds on clean audit pages. It does not reach garble (#5305, #4883)

**Question.** The #5274 audit found fluent English over pages the OCR could not read. On Herculanensium 1871 p.328 the OCR said "almost entirely illegible" and wrote `[...]`, and the translation is a paragraph of Epicurean theology. Can the OCR's own signals, or a $0 text score, decide before the model call that a page gets `<warning>Illegible: …</warning>` instead of a translation? And what does that cost on clean pages?

**Design.** Pre-registered in `PREREGISTRATION-illegible-gate.md`, after the free measurements and before any A/B output existed.
- **Reference:** the Opus judge's `garble_passthrough` flag on the 311 `main` pages of the #5274 audit (29 positive, 14 major); `measure: judged`.
- **Gate:** `scripts/lib/illegible-source-gate.mjs`, three corpus rounds of `--corpus`, each over every OCR'd page of random visible books. Round 1 (300 books) tuned the rule. Rounds 2 and 3 (600 new books each) were hand-read: 30 translated fires each, the OCR and English read side by side. Round 2's six false fires were fixed before round 3 was drawn.
- **A/B:** flash-lite through the Batch API, $0.15, on 54 pages:
  - 27 positives;
  - 15 judged-clean controls, 4 of them carrying a warning or `<unclear>`;
  - 12 round-3 gate fires (Syriac and Tibetan excluded).

  Arms: A = production translation prompt v13; A2 = A again; C = v13 plus a contract clause that asks the model to emit the Illegible warning itself; G = the gate applied to A, at $0. Judging was blind, by six Claude Opus subagents with the audit rubric, plus 8 repeat controls.

**Result.**
- **OCR self-report is not a garble signal.** Positives carry `poor`, a legibility warning or `<unclear>` 24% of the time; clean pages 4.6%; major positives 14%. `<scan-quality>` is missing on 38% of positives (prompt vintages v3/v5, Feb 2026). Where present it says `good` on 55% of them. The OCR prompt v16 itself discourages marking: "more than ~20% of words as unclear … you are being too cautious".
- **No $0 text score finds the judged garble.**
  - Lexicon score (#5313): P 0.24–0.60.
  - Char-trigram plausibility per language (4,500 pages from books outside the audit): AUC 0.52, major 0.48; at +2 bits/char, P 0.60 with recall 0.11.
  - Positive control (clean held-out pages, 40% of words letter-shuffled): separates in every alphabetic script, AUC ≈ 1. It does not separate in Chinese, Korean or Japanese.
  - The judged garble is fluent misreading, which character statistics cannot see. Contract case (b) therefore has a hook (an injected verdict) and no detector.
- **The gate on the audit:** 1 of 311 pages fires (Herculanensium, a positive), 0 of 282 clean pages. Recall of judged garble is 1/29: the gate is a narrow door, not a garble detector.
- **The gate on the corpus:**
  - Round 1: the first cut fired on 0.81% of pages. The fires were mostly blanks ("no legible text" is how the OCR says *blank*), plates, shelfmarks, and pages whose every word sits in `<unclear>` as a best reading, which is exactly what the OCR prompt asks for.
  - Round 2 (held out): 21 right / 3 ambiguous / 6 wrong. The 6 were legible titles under "much/largely illegible", an endpaper written as `[This page is blank]`, and a 13-character calligraphy leaf.
  - Round 3 (held out from those fixes): fires on **0.10% of translated pages** (69 of 67,743; 61 books per 600). The hand read is **26 right / 3 ambiguous / 1 wrong**: strict precision 0.87, 0.97 if ambiguous counts as acceptable. The wrong one is a faint but read note ("Frz Hüttner, geboren 1831").
  - Three of the round-2 "right" pages are OCR *reconstructions*: "transcription is based on … known context of Muret's Hymni Sacri" (also Florus, and a French text), all in `<unclear>` and rendered by the translator as fluent verse and prose.
- **A/B:**

  | Stratum | A | A2 | C | G |
  |---|---|---|---|---|
  | Positives, judged fabricated (invention or garble) | 15/27 | 13/27 | 12/27 | 14/27 (1 withheld) |
  | Illegible, judged fabricated | 1/12 | 1/12 | 2/12 (3 withheld) | 0/12 (12 withheld) |
  | Controls, withheld | 0/15 | 0/15 | 0/15 | 0/15 |
  | Controls, fidelity ≥ 4 | 14/15 | 15/15 | 15/15 | 14/15 |

  - A2 vs A discordance is 4/6 (p 0.75); C vs A is 4/7 (p 0.55). **The clause has no detectable effect on positives**, and the model self-withholds on only 3 of 12 illegible pages.
  - Judge repeats: 8/8 agree on the flags.
  - On the illegible pages the v13 body mostly restrains, writing `<unclear>…illegible…</unclear>`, so the judge flags only 1/12: a page of fluent prose over `...militu... cap. 32` fragments. But **12/12 A outputs carry a `<summary>`**, and by eye about 5/12 summaries or continuity metas assert subject matter the page does not show ("teachings of Leonidas on ascetic practice", "von Hund family genealogy", invented previous-page text). The rubric does not count `<summary>`/`<meta>` as content, so these are outside the judged rate. The gate removes them; the clause does not.
- **Pre-registered rules:**
  - Rule 1 (gate, 0 control withholds and held-out precision ≥ 0.8): **met**. Its sub-clause, "A fabricates on ≥ 1/3 of illegible pages in the body", was **not met** (1/12). The gate's value under v13 is the summary/meta invention and the reader's honesty, not body invention.
  - Rule 2 (clause): **not met**; the clause is reported and not proposed.

**Replicated?** No. One A/B sample; the corpus hand reads are by one reader (this session), from OCR text, not images.

**Decision.** Deferred to Derek (#5305). The gate ships behind `TRANSLATE_ILLEGIBLE_GATE` (off), with an opt-in withhold arm (`withhold-stale-translations.mjs --illegible-arm`, arm 5 `illegible_source`). Nothing is switched on, swept or flipped.

**Cost.** $0.15 actual (estimate $0.23, cap $5), 162 Batch requests, one row in Supabase `gemini_usage` (endpoint `eval/illegible-gate-5305`).

**Artifact.**
- Code: `scripts/eval/illegible-gate-5305.mjs`; `scripts/lib/illegible-source-gate.mjs`; `tests/unit/illegible-source-gate.test.ts`.
- Results in `results/illegible-gate-5305-2026-10-02/`: `measure.json` (steps 1–2), `corpus-round{1,2,3}-*.json`, `handread.jsonl`, `report.json`, `verdicts/`.

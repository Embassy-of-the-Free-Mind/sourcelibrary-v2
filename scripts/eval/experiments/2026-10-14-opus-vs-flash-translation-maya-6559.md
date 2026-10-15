---
stage: translation
measure: judged
languages: [yua, cak, nah]
scripts: [Latn]
canons: []
n_books: 25
n_pages: 68
verdict: "On 20 Mayan-language pages (4 books), Gemini 3.8 Flash Low through the CLI translates better than Opus under both judges, order-averaged: a Gemini 3.8 Flash High judge gives +1.60 and an Opus judge gives +0.38. Opus fails on the 1846 Yucatec sermons and leads only on the Kaqchikel manuscript. On the 30 Nahuatl pages of 2026-10-13, Opus and Gemini tie under the Opus judge (−0.07). Sonnet and gemini-3.1-flash-lite trail both by 1–3 points in every language, and lite OCR trails the stored Opus OCR by 1.3."
status: adopted
decision: "Maya lane: Gemini 3.8 Flash Low, by the 2026-10-14 brief's rule (Opus only if both judges put it ahead). Sonnet and flash-lite are rejected for these languages."
superseded_by: null
issue: [6559]
---
PRIOR ART: `2026-10-13-opus-vs-flash-translation-nahuatl-6559.md` (Nahuatl, one Gemini judge; this entry copies its design and re-judges its 30 pages with a second family); `2026-10-12-nahuatl-maya-ocr-cli-6559.md` (the 18 OCR pages re-used for the lite OCR arm); #6545 (cross-family judge, Opus +0.5 over 3.8 Flash in five other languages).

## 2026-10-14 · Which translator for the Mayan-language books of #6559, and where do Sonnet and flash-lite stand?

**Why.** The 2026-10-13 check found Opus no better than Gemini 3.8 Flash Low on Nahuatl, but it had no Maya pages and only one judge family. The 2026-10-14 brief required a gated Maya test before any Maya fan-out. Its rule: Opus takes Maya only if BOTH judges, order-averaged, put it ahead. Derek's notes that day added two more arms: `gemini-3.1-flash-lite` on the paid API (translation and OCR, 19:27 UTC) and Sonnet (20:18 UTC).

**Design.**
- **Pages.**
  - Maya: 5 consecutive body pages mid-book from each of 4 books:
    - Domínguez, *Platicas* 1758 (colonial Yucatec), pp. 25–29;
    - *Coleccion de sermones* 1846 (Yucatec), pp. 245–249;
    - Ripalda, *Catecismo* 1847 (Yucatec), pp. 49–53;
    - Saz, *Libro de pláticas* (Kaqchikel manuscript), pp. 163–167.

    The list is in `selection-maya.json`.
  - Nahuatl: the 30 pages of 2026-10-13 (pp. 60–69 of three books). Its Gemini and Opus reads were re-used, not re-read.
  - OCR: the 18 pages of 2026-10-12, one per book. The stored Opus OCR (written 2026-10-13) is the comparator.
- **Arms.** Nothing was written to any page.
  - **Gemini:** `cli-translate.mjs read`, `agy -p gemini-3.8-flash-low`, one page per call, seeded with its own previous page.
  - **Opus / Sonnet:** `claude-translate.mjs read --model=opus|sonnet`, translate-core's block prompt. Blocks were 5 pages for Maya and 10 for Nahuatl (planBlocks splits at 20K characters of OCR). The Maya reads ran with #6722's `<unclear>` line; the 2026-10-13 Nahuatl Opus reads did not have it.
  - **flash-lite:** the paid API through `callGemini`, realtime, temperature 0, thinking off.
    - Translation: translate-core's single-page prompt, with the worker's `maxOutputTokens` and `SAFETY_SETTINGS`.
    - OCR: the live OCR prompt plus document context, image ≤ 1500 px, `maxOutputTokens` 16384. The orchestrator's batch OCR runs at temperature 0.1; this arm ran at 0, as Derek's note asked.
    - Script: `lite-arm.mjs`.
- **Judges.** Every pair of arms was judged in both A/B orders by two judges of different families, and the two orders were averaged.
  - `agy gemini-3.8-flash-high` (`scripts/eval/run-cli-arm.py --kind judge`).
  - A sealed `claude -p --model opus --restricted --tools Read` (`claude-judge.py`, which opens the page image in an otherwise empty folder).

  Each judge call had the page image, the OCR and both translations, with `<summary>`/`<keywords>` stripped (`judge-prompt-translate.md`). Translation was scored 1–5 for fidelity, with omitted, added and mistranslated passages listed. OCR was scored 1–5 against the image alone, with dropped, invented, misread and normalised items listed (`judge-prompt-ocr.md`). The Nahuatl Opus-vs-Gemini pair under the Gemini judge is the 2026-10-13 result. Two unparseable judge replies were re-run (the originals are kept as `unparsed-*.jsonl`).

**Result: one row per arm.** Fidelity is the arm's mean over the pairs it was judged in (each pair order-averaged). The errors are per page per judgement, averaged over both judges. Cost is the API-equivalent:
- lite: metered `gemini_usage`, 68 rows, **$0.1185** in total.
- Opus and Sonnet: `list_cost_usd` from `calls.jsonl`, retries included. They cost $0 on the subscription.
- Gemini: $0 on the subscription.

| test | arm | $/page · s/page | fidelity, Gemini judge | fidelity, Opus judge | omitted · added · mistranslated per page (OCR: dropped · invented · misread · normalised) |
|---|---|---|---|---|---|
| Maya, 20 pp | Gemini 3.8 Flash Low | $0 · 34 s | 4.59 | 3.96 | 0.1 · 0.3 · 1.4 |
| Maya, 20 pp | Opus | $0.060 · 19 s | 3.59 | 3.78 | 0.6 · 0.4 · 2.9 |
| Maya, 20 pp | flash-lite | $0.0014 · 2.3 s | 1.91 | 2.08 | 2.0 · 2.1 · 10.2 |
| Maya, 20 pp | Sonnet | $0.032 · 16 s | 1.86 | 1.98 | 2.1 · 1.9 · 9.3 |
| Nahuatl, 30 pp | Gemini 3.8 Flash Low | $0 · 25 s | 4.28 | 4.13 | 0.6 · 0.4 · 1.3 |
| Nahuatl, 30 pp | Opus | $0.050 · 16 s | 4.04 | 4.24 | 0.8 · 0.2 · 1.1 |
| Nahuatl, 30 pp | Sonnet | $0.032 · 16 s | 2.85 | 3.46 | 1.4 · 0.6 · 3.5 |
| Nahuatl, 30 pp | flash-lite | $0.0019 · 3.0 s | 2.58 | 3.09 | 1.7 · 0.7 · 4.1 |
| OCR, 18 pp | Opus (stored) | ~$0.05 · ~6 s (from the 2026-10-13 calibration) | 4.06 | 3.94 | 0.4 · 0.3 · 2.9 · 2.9 |
| OCR, 18 pp | flash-lite | $0.0019 · 3.4 s | 2.72 | 2.64 | 0.8 · 1.0 · 11.1 · 3.9 |

**The gating pair (Maya, Gemini vs Opus).**

| judge | Gemini | Opus | Gemini − Opus (95% CI) | pages G>O / = / O>G |
|---|---|---|---|---|
| Gemini 3.8 Flash High | 4.12 | 2.52 | +1.60 (+1.15, +2.02) | 16 / 3 / 1 |
| Opus | 3.65 | 3.27 | +0.38 (−0.15, +0.88) | 12 / 2 / 6 |

By book under the Opus judge:

| book | Gemini − Opus |
|---|---|
| *Coleccion de sermones* 1846 | +1.60 (Gemini judge: +2.40) |
| *Platicas* 1758 | +0.70 |
| Ripalda 1847 | +0.10 |
| Kaqchikel *Libro de pláticas* | **−0.90** (Opus ahead) |

**Checked by eye (on the text):**
- **The *Coleccion* Opus pages are the right leaves.** All 5 open on the same sentence as Gemini's, so the faults are not misalignment.
- **Opus gets the sense wrong, as both judges list:**
  - *Ahzáat-zah zipiléex* ('Pardoner of our sins') becomes "our offended Savior" (pp. 247, 249).
  - *hach utzilil iix ɔoyanil* ('out of weakness and frailty') becomes "a very good and loving thing" (p. 246). That reverses the argument.
  - "The hands hang down, the eyes close" becomes "the glances it allows itself" (p. 245).

  Opus seems to rebuild the expected sermon from context instead of reading the Maya.

**Other pairs.**

| test | pair | Gemini judge | Opus judge | note |
|---|---|---|---|---|
| Nahuatl | Opus vs Gemini | Gemini +0.37 (2026-10-13) | Opus +0.07 (CI −0.20, +0.32) | a tie on both judges |
| all | Sonnet vs Opus, Sonnet vs Gemini | −1.4 to −2.9 | −0.6 to −2.2 | Sonnet loses every pair under both judges |
| all | lite vs any arm | −1.3 to −3.0 | −1.0 to −2.1 | lite loses every pair under both judges |
| OCR | lite vs stored Opus OCR | −1.33 | −1.31 | lite: about 4× as many misreads (11.1 vs 2.9 a page), invented text on 1.0 vs 0.3 |

Position bias was small in these runs: the judge picked the same winner in both orders on 16–30 of 20–30 pages. The exception is Nahuatl Opus vs Gemini under the Gemini judge (2026-10-13, 17/30).

**Limits.**
- Each judge leans toward its own family by an unmeasured amount. The verdict rests on the Opus judge, which is the same family as the losing arm.
- n = 20 Maya pages from 4 books. The Kaqchikel result (Opus ahead) rests on one manuscript, 5 pages.
- Judges score both translations side by side, so an arm's score depends on its partner: Opus scores 4.0 next to lite or Sonnet but 2.5–3.3 next to Gemini. Read the pair differences, not the absolute scores.
- The 2026-10-13 Opus Nahuatl reads were made before the `<unclear>` line (#6722).
- One page per book for OCR.

**Decision.** Maya lane: Gemini 3.8 Flash Low, under the brief's rule. Sonnet and flash-lite are not used for these languages. In practice:
- `opus-translate-6559` on l7a had already written the three Kaqchikel books and three Yucatec books (Domínguez 1758, Motul I and II) with Opus before this verdict.
- Derek's note of 2026-10-15 13:30 UTC gave the rest of the held books to Opus on l7a (`opus-translate-rest-6559`). The verdict was posted on #6559 at 15:51 UTC so that the remaining Yucatec books, above all the 490-page *Coleccion de sermones*, can be switched.

**Artifacts.** `scripts/eval/results/paired-translate-maya-6559/` holds:
- per pair: `key.json`, `key-swap.json`, the judge outputs and `requests.jsonl.gz`;
- `score.py`, `summary.json`, `score-all.txt` (every pair's table) and `arm-table.md`;
- the reads (`reads/*.tar.gz`), the lite arm (`lite-arm.mjs`), the packet builder (`judge-build.mjs`) and both judge prompts.

*Replicated?* No.

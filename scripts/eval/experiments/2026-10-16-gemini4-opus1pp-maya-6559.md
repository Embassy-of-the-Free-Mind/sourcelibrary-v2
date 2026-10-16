---
stage: translation
measure: judged
languages: [yua, cak]
scripts: [Latn]
canons: []
n_books: 4
n_pages: 20
verdict: "On the same 20 Mayan-language pages as 2026-10-14, Gemini 4 Argon Low (agy, one page per call) translates better than Gemini 3.8 Flash Low under both judges, order-averaged: +0.63 under a Gemini 3.8 Flash High judge (CI +0.13, +1.11) and +0.72 under an Opus judge (CI +0.42, +1.02). On the 15 Yucatec pages alone it leads by +0.63 and +0.57. Opus at one page per call does not close the gap: it trails 3.8 Flash by 2.12 and 0.60, and leads only on the Kaqchikel manuscript under the Opus judge (+0.40)."
status: adopted
decision: "Yucatec lane: Gemini 4 Argon Low, by the brief's rule (an arm replaces 3.8 Flash only if both judges put it ahead). Kaqchikel stays on Opus: Argon was never judged against Opus, and Opus-1pp leads 3.8 Flash on Kaqchikel under the Opus judge."
superseded_by: null
issue: [6559]
---
PRIOR ART: `2026-10-14-opus-vs-flash-translation-maya-6559.md` (same 20 pages, same judges, same packet builder and scorer; this entry adds two arms against its winner).

## 2026-10-16 · Does Gemini 4 Argon, or Opus at one page per call, beat Gemini 3.8 Flash Low on Maya?

**Why.** The 2026-10-14 test gave Maya to Gemini 3.8 Flash Low over Opus at 5 pages per call. Two questions were left: does a newer Gemini (`gemini-4-argon-low`, available on agy) do better, and was Opus's loss caused by the multi-page block rather than by the model? A dictionary check of *Coleccion de sermones* p. 247 (#6559, 2026-10-16 00:41 UTC) had Flash right on 4 of 5 disputed words and Opus on 1.

**Design.** Same pages as 2026-10-14 (`selection-maya.json`): Domínguez *Platicas* 1758 pp. 25–29, *Coleccion de sermones* 1846 pp. 245–249, Ripalda *Catecismo* 1847 pp. 49–53 (Yucatec), Saz *Libro de pláticas* pp. 163–167 (Kaqchikel MS). Nothing was written to any page. Run by job `maya-g4-6559`; scored by `maya-route-6559`.
- **Arms.**
  - **Argon:** `cli-translate.mjs read --model=gemini-4-argon-low`, agy, one page per call, seeded with its previous page (the 3.8 arm's path and prompt, `Standard Translation` v13, `sentinels-6523`).
  - **Opus 1pp:** `claude-translate.mjs read --model=opus --per-call=1`, subscription. 3 calls on *Platicas* were refused by the tag check and re-read (p. 29 needed a third run).
  - **Comparator:** the stored 2026-10-14 Gemini 3.8 Flash Low reads.
- **Judges.** Each arm was paired with 3.8 Flash and judged in both A/B orders by `agy gemini-3.8-flash-high` and by a sealed `claude -p --model opus` with the page image (`claude-judge.py`), with the 2026-10-14 prompt. One Gemini-judge reply (Kaqchikel, Argon pair) came back empty and was not re-run, so that cell has 19 pages.

**Result.** Fidelity 1–5, each page order-averaged. Positive = the new arm ahead of 3.8 Flash.

| pair | judge | new arm | 3.8 Flash | new − 3.8 (95% CI) | pages new > / = / < | Yucatec only (15 pp) | Kaqchikel (5 pp) |
|---|---|---|---|---|---|---|---|
| Argon vs 3.8 | Gemini 3.8 Flash High | 3.63 | 3.00 | **+0.63** (+0.13, +1.11) | 13 / 1 / 5 | +0.63 | +0.62 (4 pp) |
| Argon vs 3.8 | Opus | 3.98 | 3.25 | **+0.72** (+0.42, +1.02) | 14 / 5 / 1 | +0.57 | +1.20 |
| Opus 1pp vs 3.8 | Gemini 3.8 Flash High | 2.23 | 4.35 | −2.12 (−2.50, −1.68) | 1 / 0 / 19 | −2.33 | −1.50 |
| Opus 1pp vs 3.8 | Opus | 2.95 | 3.55 | −0.60 (−1.15, 0.00) | 5 / 1 / 14 | −0.93 | **+0.40** |

By book (new − 3.8):

| book | Argon, Gemini judge | Argon, Opus judge | Opus 1pp, Gemini judge | Opus 1pp, Opus judge |
|---|---|---|---|---|
| *Platicas* 1758 | +0.20 | +0.60 | −2.00 | −0.40 |
| *Coleccion de sermones* 1846 | +1.10 | +0.70 | −2.80 | −1.60 |
| Ripalda 1847 | +0.60 | +0.40 | −2.20 | −0.80 |
| Kaqchikel *Libro de pláticas* | +0.62 | +1.20 | −1.50 | +0.40 |

Listed errors, summed over both orders (new / 3.8): Argon under the Opus judge has 4/27 omitted, 29/30 added, 80/153 mistranslated; under the Gemini judge 15/46, 31/52, 76/123. Opus 1pp has more of every kind than 3.8 under both judges.

Speed (wall clock per call, from the logs): Argon 38 s a page on agy under that night's load; Opus 1pp 23 s a page.

**Checked by eye (on the text).** *Coleccion* p. 247, the 2026-10-16 dictionary arbiter page: Argon has *Ahzáat-zah c zipiléex* "the Forgiver of our sins" ✓, *ti iké* "spoken to the wind" ✓, *zinil kab* "stretch out your hand" ✓, *káaxóob* "forests", with a note that the Maya departs from the Latin *montes* ✓, and *zebchilah* "speaks to us in prophecy" ✗ (Pío Pérez: "presto, á priesa"). 4 of 5, against 3.8 Flash's 4 of 5 (it missed *káax*) and Opus 10pp's 1 of 5.

**Limits.**
- Same 20 pages and 4 books as 2026-10-14, so the two tests are not independent.
- The Gemini judge shows a large position bias in the Argon pair: Argon − 3.8 is +1.10 with Argon shown first and +0.16 shown second. Under the Opus judge the two orders agree (+0.65, +0.80). The verdict rests on the Opus judge, the family of neither arm.
- Argon was not judged against Opus, so the Kaqchikel question (Opus ahead of 3.8 there in both 2026-10-14 and this run, under the Opus judge) stays open.
- Judges score side by side; read the differences, not the absolute scores.

**Decision.** Yucatec lane: **Gemini 4 Argon Low**. Applied by job `maya-route-6559` to the Yucatec prints of #6559 (the 11 books now on 3.8 Flash, and the 4 maya-modern imports on Opus). Kaqchikel stays on Opus. The Motul dictionary (Spanish glosses) is out of scope.

**Artifacts.** `scripts/eval/results/paired-translate-maya-6559/`: `maya-argon-gemini/` and `maya-opus1-gemini/` (keys, judge outputs, `requests.jsonl.gz`), `reads/maya-argon.tar.gz`, `reads/maya-opus1.tar.gz`, and `score-all.txt` / `summary.json` regenerated by `score.py` over every packet.

*Replicated?* No.

---
stage: translation
measure: judged
languages: [nah]
scripts: [Latn]
canons: []
n_books: 3
n_pages: 30
verdict: "On 30 Nahuatl pages (3 books), a blind Gemini 3.8 Flash High judge scored Opus 3.58 and Gemini 3.8 Flash Low 3.95 for translation fidelity (−0.37, 95% CI −0.77 to +0.03), averaged over both A/B orders. Opus is not better under this judge. The judge's position bias (about ±0.6) is larger than the gap, and it is the same family as one arm."
status: undecided
decision: null
superseded_by: null
issue: [6559]
---
PRIOR ART: #6545, a cross-family judge that found Opus +0.5/5 over 3.8 Flash in five languages (none of them Nahuatl). `2026-10-13-opus-ocr-calibration-6559.md` used the same judge model, for OCR. This is the free paired check Derek asked for on 2026-10-13, before switching the #6559 books' translation to Opus.

## 2026-10-13 · Is Opus a better translator than Gemini 3.8 Flash Low on the #6559 Nahuatl books?

**Why.** On 2026-10-13 Derek switched the #6559 translation lane to Opus, on the evidence of #6545. The condition: first run a paired check on about 30 pages Gemini had already translated, with a blind judge from the other family. If Opus is not better, say so and stop.

**Design.**
- **Pages.** 10 consecutive pages (pp. 60–69) from each of 3 Nahuatl books: the *Sermonario* dedicated *A Iesu Christo S.N.* (`6acc3c2677e6be3481e74709`), the *Evangeliarium, epistolarium et lectionarium Aztecum* (`6acc3b31c1411f8cc628f943`), and Paredes's *Promptuario manual mexicano* (`6acc3ae4c1411f8cc628f4e5`). In each book this was the first run of 10 pages from p. 60 on that the Gemini reads covered (`selection.json`). The OCR on all of them is the Opus OCR written 2026-10-13.
- **Arms.**
  - Gemini: `cli-translate.mjs`, `agy -p`, `gemini-3.8-flash-low`. One page per call, seeded with its own previous page.
  - Opus: `claude-translate.mjs`, `claude -p --model opus` (resolved `claude-opus-5-5`), with translate-core's block prompt over p. 60–69. p. 60 had no seed, because no translation was stored.
- **Judge.** `agy`, `gemini-3.8-flash-high`, `run-cli-arm.py --kind judge` (`judge-prompt.md`). Each call had the page image, the OCR and both translations as A and B; the `<summary>`/`<keywords>` blocks were stripped from both. The judge scored each 1–5 for fidelity and listed omitted, added and mistranslated passages. A first run with a seeded A/B order showed heavy position bias, so every page was judged again with A and B swapped (`key-swap.json`). The scores are the mean of both orders (`score.py`).

**Result.**

| book | pages | Opus | Gemini | Opus − Gemini | judge preferred, O/G (2 orders × 10) | omitted O/G | added O/G | mistranslated O/G |
|---|---|---|---|---|---|---|---|---|
| *Sermonario* | 10 | 3.40 | 4.10 | −0.70 | 5/15 | 27/13 | 8/10 | 45/17 |
| *Evangeliarium* | 10 | 3.80 | 3.60 | +0.20 | 11/9 | 13/19 | 6/7 | 35/38 |
| *Promptuario* | 10 | 3.55 | 4.15 | −0.60 | 5/15 | 29/12 | 9/13 | 27/19 |
| **all** | 30 | **3.58** | **3.95** | **−0.37** (bootstrap 95% CI −0.77 to +0.03) | 21/39 | 69/44 | 23/30 | 107/74 |

- Per page: Opus was higher on 7, tied on 10, and Gemini was higher on 13.
- **Position bias:** Opus − Gemini was +0.20 with Opus shown as A and −0.93 with Opus as B (n = 30 each). The judge preferred the same translation in both orders on only 17 of 30 pages.
- **Checked by eye (on the text):**
  - *Sermonario* p. 62 is on Romans 13:12, *induamur arma lucis*. Gemini's "armour of light" for *teotlahuiztli in tlanextlahuiztli* is right; Opus's "the shining radiance" is wrong.
  - Opus dropped a running header (*Sermonario* p. 64).
  - *Promptuario* p. 67: the OCR marks many doubtful words as `<unclear>`, and Opus copied those Nahuatl words through untranslated ("never will we <unclear>timiquizque</unclear>"). Gemini translated inside the tags.

**Limits.**
- The judge is the same family as the Gemini arm.
- The position effect is larger than the gap.
- n = 30, all Nahuatl prose (sermons, lectionary). No Maya or Kaqchikel pages were included.
- The seeding was unequal on p. 60 only.

**Decision.** None taken. Derek's rule was "if Opus is not better, say so and stop to ask". Under this judge Opus is not better, so the 48 untranslated #6559 books wait for his call (posted on #6559).

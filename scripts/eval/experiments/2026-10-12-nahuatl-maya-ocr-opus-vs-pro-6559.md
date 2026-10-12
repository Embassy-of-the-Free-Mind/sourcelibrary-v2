---
stage: ocr
measure: judged
languages: [nah, yua, cak]
scripts: [Latn]
canons: []
n_books: 18
n_pages: 18
verdict: "Opus 5.5 vs Gemini 3.1 Pro reading Nahuatl and Mayan-language pages: the two judges split by family on overall fidelity (inconclusive), but both find 3.1 Pro normalises indigenous orthography 2-4x more often than Opus."
status: undecided
decision: null
superseded_by: null
issue: [6559, 6553]
---
PRIOR ART: `2026-10-12-nahuatl-maya-ocr-cli-6559.md` (same 18 pages; 3.1 Pro beat 3.8 Flash under an Opus judge). This entry adds Opus as a READER, so Opus can no longer be the only judge.

## 2026-10-12 · Would Opus read the Nahuatl and Mayan-language pages better than Gemini 3.1 Pro (#6559)?

**Design.** Same 18 pages (one per book). Opus 5.5 transcribed each whole page as an OCR reader (two subagents, 9 pages each, Claude subscription), following the production OCR prompt except one instruction from the brief: keep abbreviations rather than expand them (the production prompt expands; the judges were told abbreviation choice is trivial). Each page's Opus read and its `gemini-3.1-pro-low` read were put in a fixed random order as X/Y (`opus-vs-pro/key.json`, Opus is X on 12 of 18) and judged against the image by two judges of different families, same 0–5 fidelity rubric and error counts as the first entry:
- **Gemini 3.1 Pro (high)** through the CLI, shown the image and the two texts only: blind. 17 of 18 parsed (one unparsed reply); quota 429s were waited out, not skipped.
- **Opus 5.5** (fresh subagent): **not blind**. The input listed the transcription paths, whose directory names named the engines. It reported this itself and says it scored against the image only; treat its verdict as unblinded.

**Result** (means of 0–5; failed reads counted, not scored).

| group | judge | Opus mean (n) | 3.1 Pro mean (n) | Pro failed | normalisations Opus / Pro | pages won Opus–Pro–tie |
|---|---|---|---|---|---|---|
| Nahuatl | Gemini (blind) | 3.56 (9) | 3.56 (9) | 0 | 31 / 62 | — |
| Mayan | Gemini (blind) | 3.00 (8) | 3.29 (7) | 1 | 25 / 93 | — |
| all | Gemini (blind) | | | | 56 / 155 | 7–10–0 |
| Nahuatl | Opus (unblinded) | 4.30 (10) | 3.60 (10) | 0 | 7 / 47 | — |
| Mayan | Opus (unblinded) | 4.25 (8) | 3.29 (7) | 1 | 3 / 82 | — |
| all | Opus (unblinded) | | | | 10 / 129 | 14–1–3 |

- **Overall fidelity: inconclusive.** Each judge prefers its own family's reader, the exact bias the two-family rule exists to expose. The blind Gemini judge has the two level on Nahuatl and Pro slightly ahead on the Mayan pages; the unblinded Opus judge has Opus well ahead on both.
- **Robust across both judges:** 3.1 Pro changes original spellings or special letters toward Spanish/Latin/modern forms 2–3× (Gemini judge) to ~13× (Opus judge) as often as Opus: Kaqchikel cuatrillo-h → "ch" and tresillo → "E" (~60 times on one manuscript), long s and nasal tildes dropped, Yucatec barred h dropped. Opus's own normalisations are fewer but real (long s and tildes on one 1605 print; cuatrillo/tresillo as "tt"/"h" on one Kaqchikel manuscript).
- **Only 3.1 Pro failed a page** (the 1750 Kaqchikel print, empty read). On the Codex Osuna page (Spanish secretary hand) the Opus judge records Pro filling illegible spans with fluent wording not on the page, where Opus marked them unclear.
- **Opus's worst page:** the Motul dictionary, every headword "Hiʒ" read as "Hij".

**Caveats.** n = 18, one page per book; the per-group cells rest on 7–10 pages. One judge per family, no planted-span controls, no A-vs-A noise floor. The Opus judge was unblinded by a path leak (a setup error, fixed by using neutral paths next time). Opus kept abbreviations while 3.1 Pro expanded them, which a strict judge may have scored as error; the Gemini judge's lower absolute means for Opus may partly reflect this. This is a screen, not a calibration.

**What it means.** On fidelity alone, neither Opus nor 3.1 Pro is shown better. On the property that matters most for these books, keeping the colonial orthography that makes Nahuatl and Mayan texts what they are, both judges agree Opus is the more conservative reader. The decision owed (status `undecided`): before routing ~20K pages, run a calibration pass with neutral paths, a third judge family or planted-span controls (`eval-design.md`), and Opus with abbreviations expanded as production requires. Owner: #6559.

**Artifacts.** `scripts/eval/results/nahuatl-maya-ocr-6559/reads-opus-5.5/` (Opus reads), `opus-vs-pro/` (`key.json`, `judge-gemini.json` with per-page parsed scores and any raw reply, `judge-opus.json`, `run.mjs`: the Gemini judge harness).

*Replicated?* No.

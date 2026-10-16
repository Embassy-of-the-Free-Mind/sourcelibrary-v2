---
stage: ocr
measure: judged
languages: [nah, cak]
scripts: [Latn]
canons: []
n_books: 3
n_pages: 15
verdict: "Opus reads through claude-ocr.mjs scored 3.80 / 5 mean fidelity from a blind Gemini 3.8 Flash High judge (15 pages, 3 books), just under the 4.0 gate; the judge caught 3 of 3 planted errors, and its one 'invented line' on a real page was a judge misreading, checked by eye."
status: undecided
decision: null
superseded_by: null
issue: [6559]
---
PRIOR ART: `2026-10-12-nahuatl-maya-ocr-cli-6559.md` (screening, 18 pages, one page per book, Opus as judge of Gemini reads, no planted controls). This is the calibration gate the #6559 brief set before any Opus OCR is written: the reader is now Opus and the judge is Gemini, with planted controls.

## 2026-10-13 · Does the Opus read pass the calibration gate (#6559)?

**Why.** Derek decided on 2026-10-12 that Opus reads the Nahuatl and Mayan-language books. The brief set a gate before any write: a blind judge from the other model family; mean fidelity ≥ 4.0; at least 2 of 3 planted errors caught; and no read that invents text.

**Design.**
- **Reader:** `scripts/batch/claude-ocr.mjs` (Opus `claude-opus-5-5`, sealed `claude -p`, 10 pages per call, live OCR prompt v19.1 with the orthography slot).
- **Calibration set:** 150 pages, all read: *Cathecismo cenca yn tech monequi…* (1683, Nahuatl print, 16 pp); the Códice Aubin, León y Gama's copy (Nahuatl manuscript, 78 pp); *Libro de pláticas* (1662, Kaqchikel manuscript), pp. 1–56.
- **Blind sample:** 5 text pages per book, drawn with a seeded RNG (`build-packet.mjs.txt`). Plants: 3 copies of reads, one per book: about 8 words dropped from mid-paragraph (Aubin), an invented Nahuatl line (Cathecismo), and one respelled word, *ruyaom → royaom* (Kaqchikel). The 18 items ran under random ids. The judge saw the image and one transcription only, with no engine names; the key stayed on l7a.
- **Judge:** Gemini through `agy` on the main box (`judge-prompt.md`). The brief named 3.1 Pro, but every call failed on 2026-10-13: 3.1 Pro had been withdrawn from `agy`, which now offers only 3.8 Flash Low/Medium/High plus Claude models. So the judge is **gemini-3.8-flash-high**, the strongest Gemini still offered.

**Result.**

| book | n | fidelity per page | mean |
|---|---|---|---|
| Códice Aubin copy (Nahuatl MS) | 5 | 4, 4, 4, 4, 3 | 3.8 |
| Cathecismo 1683 (Nahuatl print) | 5 | 4, 4, 4, 5, 2 | 3.8 |
| Libro de pláticas (Kaqchikel MS) | 5 | 4, 4, 4, 3, 4 | 3.8 |
| **all** | **15** | | **3.80** |

- **Plants caught: 3 of 3.** The dropped words were quoted exactly (fidelity 2). The invented line was quoted exactly (fidelity 2). The respelling was listed as a misread (fidelity 4, as the rubric gives for one word-level slip).
- **Invented text on real pages: one flag, and it is the judge's error.** On Cathecismo p. 11 the judge called *huan … çencane- / chtequipachohua yca mochi innoani-* "a garbled duplicate line". Checked by eye against the image (2026-10-13), both lines are printed on the page, and the Opus read matches the page line for line. Its one true error on that page is *ocçepa* → *occepa* (a dropped cedilla). Rescored by eye, that page is 4, and the mean would be 3.93: still under the gate.
- **Error profile:** 0 dropped and 0 invented on the other 14 real pages. The judge listed 31 word-level misreads (mean 2.1 per page) and 10 normalisations. These were not checked by eye; the p. 11 false positive shows the judge's lists contain errors of its own.
- **Reads:** 150 of 150 calibration pages ok, 0 page-marker refusals; about $0.05/page at list price on the subscription.

**Caveats.**
- n = 15 pages from 3 books, one judge, one run; no A-vs-A noise floor.
- The judge is 3.8 Flash. The screening eval found that model the *weaker* reader of these languages (it normalises Mayan letters), so as a judge it may mark correct colonial spellings as misreads.
- The 0.2 gap to the gate is within one page's rescoring.

**What it means.** By the brief's rule, the Opus lane does not clear the gate as measured, and nothing was written. Opus never invented text in this sample and kept the orthography; its errors are letter-level. The decision owed: accept 3.8–3.9 with these caveats and apply, or re-judge with a stronger judge (a second judge family, or by-eye spot checks of the listed misreads) before deciding. Owner: #6559.

**Artifacts.** `scripts/eval/results/opus-ocr-calibration-6559/`: `KEY.json` (uid → page, plants), `judge-prompt.md`, `judge-out-gemini-3.8-flash-high.jsonl`, `build-packet.mjs.txt`. The packet (`items.json`) is on branch `eval/blind-judge-6559`.

*Replicated?* No.

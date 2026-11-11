---
stage: translation
measure: judged_vs_reference
languages: [nah, es]
scripts: [Latn]
canons: []
n_books: 3
n_pages: 60
verdict: "Against the published scholarly English of the Florentine Codex's Nahuatl column (the Getty Digital Florentine Codex, used as a private answer key), the two-pass English (a Gemini 4 Argon Low draft reviewed by Opus against the page image, on the new Argon-high transcription) scores 4.39/5 fidelity with 1.32 meaning errors a page, on 38 leaves from Books 1–9. The Opus English it replaces, made on the old flash-lite transcription, scores 3.26 with 4.21 errors. Two-pass beats it by +1.13 (95% CI +0.86, +1.40), winning 29 of 38 pages, tying 9 and losing 0. It beats the Argon draft alone by +0.34 (CI +0.16, +0.53), 13/24/1. On the transcription, 52 leaves scored against the Getty paleographic transcription: Argon-high cuts the Nahuatl character error rate from 0.152 (flash-lite) to 0.061 and is better on 49 of 52 leaves. On the Spanish the two are even at the median (0.118 / 0.120)."
status: adopted
decision: "Re-OCR with Gemini 4 Argon High and two-pass translation are what the three volumes get (#6865, Derek 2026-10-18); this measures the result. The 20 Vol. 3 leaves of the sample (Books 10–12) are not in the English table: their two-pass waits on the agy weekly quota."
superseded_by: null
issue: [6865, 4226]
---
PRIOR ART: `2026-10-17-florentine-two-column-opus-gemini-6865.md` (the same three volumes, paired judging between engines with no reference: Argon ahead of Opus on the Nahuatl under the Gemini judge only); the job florentine-twopass test on #6865 (2026-10-18 03:15: two-pass +0.9 to +1.7 over each single reader, paired, no reference). Neither scored against a published translation or measured the transcription.

## 2026-10-18 · The Florentine Codex against its published translation and transcription

**Why.** #6865 re-translated the three volumes of the Florentine Codex twice in one day. Both passes, and the paired judging behind them, measured one machine reader against another. Derek, 2026-10-18: compare against a published Florentine translation. A spot check that evening (Book 6 p.401, Book 11 p.701) showed the stored flash-lite transcription was itself wrong in ways that carried into the English, for example *njcço, njcçoço* ("I pierce it, I string it") read as "njcco, njccoco" and translated "I buy it, I sell it". So the transcription was re-read with Gemini 4 Argon High and measured too.

**Reference.** The Getty Digital Florentine Codex (florentinecodex.getty.edu) gives, per folio, the Nahuatl transcription and English of Anderson & Dibble (1953–1982) and the Spanish transcription of López Austin & García Quintana (2000). We do not hold Anderson & Dibble. It is used here as a **private answer key**. Its text is not in this repository, in Mongo, or in any public comment beyond a few words per example below. The per-page judge output, which quotes it, stays on the job box.

**Sample.**
- 60 two-column leaves: 5 per Book I–XII, one from each fifth of the Book's leaves.
- Seed 6865. None of the leaves was used in the earlier #6865 tests or by-eye checks.
- Each leaf is aligned to its Getty folio by the IIIF image id the two sites share; 60 of 60 matched. One leaf whose folio page showed another canvas was replaced by its neighbour (Book 9).
- Listed in `sample.json`.

**Transcription (OCR) arms.**
- **flash-lite:** the `gemini-3.1-flash-lite-preview` OCR served until this job, taken from `page_revisions` where it had already been replaced.
- **Argon-high:** the `cli-ocr.mjs read --model=gemini-4-argon-high` re-read made for the whole re-OCR.
- **Scoring:** CER and WER per column against the Getty transcription (`ocr-score.mjs`). Normalisation A changes only case, whitespace and line breaks, and joins a line-end hyphen. Normalisation B also folds u/v, i/j and macrons. Our metadata tags and the Getty footnotes are removed first.
- 52 leaves have both arms split into two columns. 7 Vol. 3 leaves had no Argon read yet (agy quota), and 1 Argon read was unsplit.

| column | norm | flash-lite CER | Argon-high CER | flash-lite WER | Argon-high WER |
|---|---|---|---|---|---|
| Nahuatl | A | 0.152 | **0.061** | 0.706 | 0.472 |
| Nahuatl | B | 0.142 | **0.057** | 0.669 | 0.454 |
| Spanish | A | 0.194 | 0.118 | 0.509 | 0.497 |
| Spanish | B | 0.188 | 0.108 | 0.496 | 0.471 |

CER is total edits over total reference characters; WER is the mean over pages.
- **Median page CER (A):** Nahuatl 0.131 → 0.063; Spanish 0.118 → 0.120.
- **Argon better / same / worse by page:** Nahuatl 49/2/1; Spanish 20/10/22.

The Spanish micro-average gain comes from a few leaves where flash-lite dropped or garbled whole lines. WER stays high for both arms because Anderson & Dibble divide Nahuatl words differently from the manuscript's spacing (*qu inmoioa*, *ca miec tlamantli*), so read WER as a relative figure only. Argon-high regularises some final *-j* to *-i* (*monequi* where the leaf has *monequj*), which normalisation B absorbs.

**Translation arms** (the Nahuatl column, the last `<column-break/>` segment, `<summary>`/`<keywords>` removed):
- **two-pass:** the English now on the page. Draft: `cli-translate.mjs read --model=gemini-4-argon-low` with the column instruction. Review: `twopass-review.mjs`, sealed `claude -p --model opus`, 5 leaves a call, with the page image, the OCR and the draft. Both run on the Argon-high transcription.
- **Opus:** the English it replaced (`claude-translate.mjs`, Opus, on the flash-lite transcription, 2026-10-17/18).
- **Argon draft:** the first pass of two-pass, alone.

**Judge.** Sealed `claude -p --model opus`, one call per leaf, run on cloudlayer (`judge.mjs`). It saw:
- the page image, opened with Read;
- the Nahuatl OCR;
- the reference English of that folio's Nahuatl column;
- the three arms, labelled X/Y/Z and shuffled per leaf by a seeded hash (`build-packet.mjs`; the key is `key.json`).

Per arm it reported wrong / omitted / added meaning units counted against the reference (a different but correct rendering is not an error), a summarised flag, and fidelity 1–5. Where the reference itself looked wrong against the image and the Nahuatl, it marked the reference disputed and judged that stretch from the leaf. 38 leaves had all three arms, from Books 1–8 and one from Book 9. The rest of Vol. 2 and all of Vol. 3 were not yet two-passed when the agy weekly quota ran out.

| arm | fidelity (1–5) | meaning errors / page | wrong | omitted | added | summarised |
|---|---|---|---|---|---|---|
| **two-pass** | **4.39** ±0.19 | **1.32** ±0.46 | 1.18 | 0.05 | 0.08 | 0/38 |
| Opus (on flash-lite OCR) | 3.26 ±0.27 | 4.21 ±0.85 | 3.00 | 0.95 | 0.26 | 0/38 |
| Argon draft alone | 4.05 ±0.22 | 2.03 ±0.56 | 1.66 | 0.03 | 0.34 | 0/38 |

- **two-pass − Opus:** +1.13 (95% CI +0.86, +1.40); pages won/tied/lost **29/9/0**.
- **two-pass − Argon draft:** +0.34 (95% CI +0.16, +0.53); 13/24/1.
- **Reference disputed on 6 of 38 leaves.** For example, the reference has "every two hundred and sixty days" where the judge reads *mamatlacpovaltica vmeitica* differently; a negation the Nahuatl lacks; and the reference stops before *ichuipil*, the last word on the leaf.

**Worked examples.** Each is Opus's worst error on a leaf where two-pass scored higher, quoted to a few words:
- Book 2: Opus "the rope of the sun"; the reference has "the sustenance rope".
- Book 2: Opus "the salt sellers, the salt carriers"; the reference has "the salt preparers… salt merchants".
- Book 2: Opus "as with the crown hair"; the reference has "as hath been told in Quecholli".
- Book 3: Opus "seeking their sleep and their rest"; the reference has "they sought their sustenance".
- Book 1: Opus "girded and adorned"; the reference has the goddess "painted with white chalk".

**What two-pass still gets wrong** (its 46 judged errors: 41 wrong, 3 added, 2 omitted):
- **Idioms and paired expressions read literally or in the wrong sense.** The sun's heat (*tonal*) taken as "fortune"; "well into the night" as "the earth had settled into silence".
- **Rare words and costume or regalia terms.** Body paint ("red ochre" for hawk-scratch marks), *izquitl* versus a broom, the back-device of a warrior's array, *oxitl* as turpentine.
- **Verbs of manner in processions and speeches**, read as concrete actions ("stamping his feet" for "showing disdain", "parading his captives" for "vaunting himself").
- **Occasional additions from the Spanish column or the gloss habit.** No summaries and almost no omissions.

**Limits.**
- The English table covers Books 1–9 only, with Book 9 on one leaf.
- One judge, of the same family as the reviewer. The reference is an answer key for meaning, and the judge disputed it on 6 leaves.
- The Opus arm read a worse transcription. Its deficit is partly the OCR's, by design: the comparison is between what readers had and what they have now.

Files (`scripts/eval/results/florentine-vs-published-6865/`): `sample.json`, `ocr-score.mjs` + `ocr-score.json` + `ocr-score.txt`, `build-packet.mjs`, `judge.mjs`, `key.json`, `score.py` + `score.txt`.

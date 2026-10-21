---
stage: ocr
measure: [accuracy]
languages: [sa]
scripts: [Mlym]
canons: [sankhya]
n_books: 1
n_pages: 5
verdict: "Opus (claude -p, subscription) cannot read Sanskrit in Malayalam script on palm leaf. Whole page: it declines to transcribe (no invented text). Half- and quarter-leaf crops: mostly <unclear>, with CER 0.71–0.75 against the GRETIL Sāṃkhyakārikā."
status: informational
decision: "Book stays held (malayalam-palm-leaf-lane). No Opus lane for Malayalam palm leaf. Gemini CLI arm pending its quota reset (~2026-10-23)."
superseded_by: null
issue: 5935
---
PRIOR ART: 2026-10-04-hidden-flash-5795.md — it noted that Claude adjudicators could not read Sinhala palm leaf word for word, but measured no Claude read against a reference. 2026-10-04-reocr-hires-distressed-3186.md — Flash on palm-leaf Pali, judged by an LLM, not against a text. Neither scores a Malayalam-script read against an edition.

## 2026-10-21 · Can Opus read a Malayalam-script Sanskrit palm-leaf manuscript well enough to OCR it? (#5935)

**Question.** Can the Opus OCR lane (`scripts/batch/claude-ocr.mjs`, `claude -p` on the subscription) read this book well enough to queue it? The book is RAS Whish MS 147 (`6ad845ec6037414ddef152af`, IA `raswhish145-147`, Calicut 1822): the Sāṅkhyasaptati with the Jayamaṅgalā and Tattvakaumudī, then Annambhaṭṭa's Tarkasaṃgraha with Dīpikā. It is the leaf labelled "SĀNKHYA-SAPTATI or golden verses of Pythagoras". The kārikās have a standard text (GRETIL), so a read can be scored for accuracy and not merely for agreement.

**Design.**
- **Reader:** Opus via `claude-ocr.mjs` with the live OCR prompt (Standard OCR v19.1, base `34f12611ca3d77e9`), one page per call, language slot `Sanskrit`.
  - The tile runs reuse the lane's own `claudeCall` and the exact prompt it saved, changing only the phrase that says the image is a crop.
  - No prompt names the work, so a read cannot be filled from the model's memory of the kārikās.
- **Pages:** 3 (the contents leaf), 5 and 6 (the start of the text). Pages 61 and 121 (commentary) were read only by eye.
- **Images:** each scan holds two leaves, about 5,300 × 3,400 px. Page 5 was also cut into:
  - 4 half-leaf tiles, about 2,580 px wide;
  - 4 quarter-leaf tiles of the lower leaf, about 1,300–1,425 px wide (under the Read tool's downscale, so seen at native size).
- **Instrument:** the Malayalam-script read is transliterated to IAST (`indic_transliteration`). Both sides are normalised: spacing, punctuation, anusvāra, and scribal gemination after r. Then the Levenshtein distance is taken to the best-matching window of the GRETIL plaintext `sa_IzvarakRSNa-sAMkhyakArikA.txt` (`score_vs_gretil.py`).

**Result.**

| read | Malayalam chars | `unclear` spans | CER vs GRETIL |
|---|---|---|---|
| page 5, whole image | 0 | — | declined: "too small at this resolution to read reliably. I have not attempted a reading, so that no text is invented … please supply … crops of each leaf" |
| page 6, whole image | 2 | 22 | not scorable |
| page 5, half-leaf tiles (4) | 13–351 per tile | 29–62 per tile | 0.74–0.75 (one tile too short to score) |
| page 5, quarter-leaf tiles (4) | — | 18–50 per tile | 0.71–0.75; one tile aligned 7,000 characters away, i.e. no real match |

- **Where it does read:** fragments land in the right region of the text. For example, a tile carries "prakāśa … abhibhava … vṛttayaśca" from kārikā 12, in the leaf where kārikās 8–12 fall. But most of each line is marked unclear or is not recoverable.
- **Caveat on the CER:** the leaves also carry Malayalam glosses that the verse-only reference lacks, which inflates the figure. That does not change the verdict: even the spans that do align to a kārikā differ from it in most letters.
- **Contents leaf (page 3):** this one Opus reads well, because it is a large hand: the English list ("1 SĀNKHYA-SAPTATI or golden verses of Pythagoras …") and the Malayalam list beneath it, with Malayalam numerals.
- **Good behaviour:** on every page Opus marks what it cannot read instead of inventing it.
- **Consistent with #5795:** Claude models can't read South Asian palm-leaf hands word for word.

**Found on the way: the images were shifted by two leaves.** The first read of page 3 showed the cover board. The bulk archiver had fallen back to positional mapping after a transient scandata failure (162 zip files for 159 IIIF leaves), and its dHash check passed the shift. It was repaired and pixel-verified before any read reported above. Details are on #3368.

**Not run.** Gemini 3.8 Flash through `agy`: the CLI account is out of quota until about 2026-10-23, on the laptop and on Hetzner alike. A paid API arm is not allowed for this model. The translation comparison against Colebrooke & Wilson 1837 (`69925814ad311253224cc20c`) waits for a usable read.

- *Replicated?* No. One page of one manuscript, but the whole-page refusal is categorical.
- **Artifact.** `scripts/eval/results/whish147-palm-leaf-opus-2026-10-21/`

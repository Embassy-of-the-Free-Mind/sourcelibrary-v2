---
stage: ocr
measure: [accuracy]
languages: [sa]
scripts: [Mlym]
canons: [sankhya]
n_books: 1
n_pages: 5
models: [claude-opus-5-5, claude-fable-5-1]
verdict: "Neither Opus 5.5 nor Fable 5.1 (claude -p, subscription) can read Sanskrit in Malayalam script on palm leaf. Both decline the whole page without inventing text. On crops, Opus scores CER 0.71–0.75 against the GRETIL Sāṃkhyakārikā, at chance (0.74–0.78); Fable is at chance on quarter-leaf crops and 0.64–0.71 on half-leaf crops, slightly above chance and far from usable."
status: informational
decision: "Collation against the edition with planted errors is the only arm with signal (Opus 3/4 plants, Fable 2/4, no false 'certain'); it needs a multi-leaf planted test before use. Book stays held (malayalam-palm-leaf-lane). No Opus lane for Malayalam palm leaf. Gemini CLI arm pending its quota reset (~2026-10-23)."
superseded_by: null
issue: 5935
---
PRIOR ART: 2026-10-04-hidden-flash-5795.md — it noted that Claude adjudicators could not read Sinhala palm leaf word for word, but measured no Claude read against a reference. 2026-10-04-reocr-hires-distressed-3186.md — Flash on palm-leaf Pali, judged by an LLM, not against a text. Neither scores a Malayalam-script read against an edition.

## 2026-10-21 · Can Opus or Fable read a Malayalam-script Sanskrit palm-leaf manuscript well enough to OCR it? (#5935)

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
| **Fable 5.1**, page 5, whole image | 0 | 4 | declined, the same way ("cannot be read reliably at this resolution") |
| **Fable 5.1**, half-leaf tiles (lower leaf, 2) | 281–315 | 28–46 | **0.64** and 0.71, aligned at kārikās 9–12 (the right region) |
| **Fable 5.1**, quarter-leaf tiles (4) | 148–187 | 26–38 | 0.72–0.74; two of four aligned far from the right region |
| *noise floor:* shuffled reference letters, or a reversed real passage (12 draws, 300 chars) | — | — | **0.74–0.78** |

| contrast-enhanced (CLAHE 3.0, 16×16) half-leaf t03: Opus / Fable | — | 43 / 36 | 0.71 / 0.73 (Fable aligned 6,000 characters away); no gain |

**Read against the noise floor.** The best-window matcher gives 0.74–0.78 to text that contains no reading at all (`noise_floor.py`). So Opus's crops are at chance. Fable's quarter-leaf crops are at chance too. Fable's half-leaf crops, at 0.64 and 0.71, are a little above chance and sit in the right place: some real signal, nowhere near usable. A usable OCR would be under about 0.10.

- **Where it does read:** fragments land in the right region of the text. For example, a tile carries "prakāśa … abhibhava … vṛttayaśca" from kārikā 12, in the leaf where kārikās 8–12 fall. But most of each line is marked unclear or is not recoverable.
- **Caveat on the CER:** the leaves also carry Malayalam glosses that the verse-only reference lacks, which inflates the figure. That does not change the verdict: even the spans that do align to a kārikā differ from it in most letters.
- **Contents leaf (page 3):** this one Opus reads well, because it is a large hand: the English list ("1 SĀNKHYA-SAPTATI or golden verses of Pythagoras …") and the Malayalam list beneath it, with Malayalam numerals.
- **Fable's 0.64 tile is a mix, not uniform noise.** It contains kārikā 11 nearly verbatim: "triguṇamavivèkiviṣayassāmānyama cè … prasavadhaൎmmi vyaktaṃ tathā pradhānaṃ". "dhaൎmmi" has the Kerala scribal gemination that GRETIL does not, which points to reading rather than recall (no prompt named the work). The other lines are noise or Malayalam gloss. A per-line score, against the verse lines only, is the instrument that would separate the two.
- **Not image size, not contrast:** quarter-leaf crops at native resolution and contrast-enhanced crops both stay at chance.
- **Good behaviour:** on every page Opus marks what it cannot read instead of inventing it.
- **Consistent with #5795:** Claude models can't read South Asian palm-leaf hands word for word.

**Combining readers.** Prior work sets the frame:
- Lane B (#6420) adjudicates between two reads, so it needs at least one usable read.
- Correction (#6561, #6545) needs a usable draft.
- Edition fitting (#5560, #5619) needs reads good enough to locate the text in the edition.

None applies to reads at chance. Two cheap probes on the same half-leaf (t03):
- *Agreement:* the runs of 6+ letters on which Opus and Fable agree are precise (70 of 88 characters match GRETIL) but cover about 6% of the leaf. That is a trust filter, not a text.
- *Collation against the edition, with planted errors* (an image-reading variant of #5619's algorithmic fitting). Each model gets the GRETIL kārikās 7–16 carrying 4 planted errors and is asked to list where the LEAF differs from the edition, marking each difference certain or uncertain. No word index was included: a first pilot leaked the GRETIL index, Opus cited it, and that pilot is discarded.

| plant | Opus | Fable |
|---|---|---|
| SK_11 aviveki → aviveka | caught (certain) | caught (certain) |
| SK_11 pumān → puruṣaḥ | missed | missed |
| SK_12 niyamā → viyamā | caught (certain) | missed (said it agrees) |
| SK_13 laghu → guru | caught (certain) | caught (certain) |

- No "certain" difference from either model was false.
- Both models independently flagged two unplanted differences, both as uncertain: `satvaṃ` for sattvaṃ (SK_13) and `vaiśvarūpyasya` for vaiśva-rūpasya (SK_15). These are candidate real readings of this manuscript; not checked by eye.
- Both models also report the scribe's sandhi spellings ("viṣayas sāmānyam", "pradhānan tad"). A copy of the edition would not produce those.
- **Failure mode: copy-through.** Where a word is hard to see, a model can report agreement with the edition: 1 of 4 plants for Opus, 2 of 4 for Fable. That would put the edition's text, not the scribe's, into a transcription.
- n = 4 plants on one half-leaf: far too few to estimate a catch rate. Before any use, the gate is a planted-error test across several leaves (enough plants for an interval) on the verse text and on the published commentaries (Jayamaṅgalā, Tattvakaumudī). It would only ever cover text that has an edition; the Malayalam glosses stay unread.

**Found on the way: the images were shifted by two leaves.** The first read of page 3 showed the cover board. The bulk archiver had fallen back to positional mapping after a transient scandata failure (162 zip files for 159 IIIF leaves), and its dHash check passed the shift. It was repaired and pixel-verified before any read reported above. Details are on #3368.

**Not run.** Gemini 3.8 Flash through `agy`: the CLI account is out of quota until about 2026-10-23, on the laptop and on Hetzner alike. A paid API arm is not allowed for this model. The translation comparison against Colebrooke & Wilson 1837 (`69925814ad311253224cc20c`) waits for a usable read.

- *Replicated?* No. One page of one manuscript, but the whole-page refusal is categorical.
- *Arm added the same day:* Fable 5.1, through the same `claudeCall` and prompt, on the same images.
- **Artifact.** `scripts/eval/results/whish147-palm-leaf-opus-2026-10-21/`

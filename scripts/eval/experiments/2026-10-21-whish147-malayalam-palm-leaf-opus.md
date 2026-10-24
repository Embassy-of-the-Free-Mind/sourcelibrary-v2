---
stage: ocr
measure: [accuracy]
languages: [sa]
scripts: [Mlym]
canons: [sanskrit]
n_books: 1
n_pages: 5
verdict: "Neither Opus 5.5 nor Fable 5.1 (claude -p, subscription) can read Sanskrit in Malayalam script on palm leaf. Both decline the whole page without inventing text. On crops, Opus scores CER 0.71–0.75 against the GRETIL Sāṃkhyakārikā, at chance (0.74–0.78); Fable is at chance on quarter-leaf crops and 0.64–0.71 on half-leaf crops, slightly above chance and far from usable."
status: informational
decision: "Collation against the edition is the only arm with signal. On 36 planted errors over 9 leaves, Opus caught 69% and Fable 61%, and none of their certain substantive flags was false; about a third went unflagged, 5–6 by copy-through. Usable as a variant finder (trust certain flags only), not as a transcription. Book stays held (malayalam-palm-leaf-lane). No Opus lane for Malayalam palm leaf. Gemini CLI arm pending its quota reset (~2026-10-23)."
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

*Correction, 2026-10-22 (`2026-10-22-whish147-line-strips.md`).* This whole-read scorer under-rates any read of a half-leaf, because each row is only the first part of a leaf line and the read is compared with one contiguous stretch of the edition. Re-scored row by row inside the leaf's verse span (floor 0.70), the half-leaf free reads of 9 verse leaves pool at CER 0.51 (Fable, 7 leaves) and 0.54 (Opus): above chance, but about half of all characters differ. The Fable read of this page's lower leaf (`fable-page5-t03.txt`) scores 0.09 row by row, but it named the passage and a fresh read of the same crop scored 0.52.

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

**Multi-leaf collation (same day).** The gate above, run on the verse text.
- *Design.* Fifteen left half-leaves (pages 4–11, the pilot's crop geometry) were located in GRETIL by an Opus pass that only placed each line, with no collation. Nine were placed in sequence: kārikās 1–58, pages 4–9. They were used.
- *Skipped.* Pages 7b, 9b and 10t were placed out of sequence or not at all. Page 10b had too little verse for four plants. Pages 11t and 11b are the commentary that follows the verses.
- *Plants.* Each leaf's excerpt (its verses ±2) got 4 seeded plants, one of each kind: near-homograph letter swap, substitution by a word from elsewhere in the text, a plausible wrong form (case ending or a- negation), and omission. That is 36 plants. Plants went only on words inside a located line's visible span.
- *Prompt and models.* Same collation prompt as the pilot, Opus and Fable on each leaf.
- *Scoring.* `score.py`; plants are in `plants.json`, never in a prompt. A spelling note whose leaf column is the planted word counts as copy-through, not a catch.

| | Opus | Fable | either |
|---|---|---|---|
| plants caught | 25/36 (69%, 95% CI 53–82%) | 22/36 (61%, 45–75%) | 26/36 |
| caught as certain / uncertain | 14 / 11 | 16 / 6 | |
| catch restores the GRETIL word | 23 of 25 | 20 of 22 | |
| missed: copy-through / silent | 5 / 6 | 6 / 8 | |
| near-homograph · substitution · plausible form · omission | 8 · 6 · 5 · 6 (of 9 each) | 7 · 6 · 3 · 6 | |
| unplanted flags: spelling habit / substantive | 8 / 5 | 16 / 6 | |
| substantive unplanted flags marked certain | 0 | 0 | |

- **"Certain" is trustworthy; silence is not.** All 30 substantive differences the two models marked certain were real plants. The unplanted flags marked certain were all scribal spelling: gemination after r, anusvāra written as n, visarga as s.
- About a third of the plants went unflagged, and 5–6 of the 36 were copied straight into the model's reading of the leaf. Agreement with the edition therefore does not show that the leaf agrees.
- The plausible wrong form, a one-letter case ending or an a- prefix, is the weakest catch for both models: Opus 5 of 9, Fable 3 of 9.
- No substantive unplanted difference was raised by both models. The two flags they shared (SK_5 *vacanan tu*, SK_27 *manas*) are spelling habits.
- *Single-model flags, checked by eye afterwards* (Opus 5.5 reading full-resolution crops of page 9, upper leaf; evidence type: image opened). Fable's two strongest unplanted flags, one right and one wrong:
  - SK_52, **real variant.** The leaf reads ‹…ṅgaṃ na vinā bhāvena liṃga-…› where GRETIL has *na vinā liṅgena bhāva-nirvṛttiḥ*: the two members are transposed. *bhāvena* is clear; *liṅga-* is probable.
  - SK_55, **false.** Fable reported the second half of the verse as omitted. It is on the leaf: the segment right of the string hole on the next row reads ‹-tram duḥkhaṃ prāpnoti ceta…›, and the row after reads ‹(tasmā)d duḥkhaṃ svabhāvena›. Fable joined the left segment of one row to the middle segment of the row below. *Corrected 2026-10-22, by eye on page 5:* each leaf has two string holes, and every physical row reads straight across both (lower leaf of page 5, row 3: *pravṛttiniyamā | rthāḥ anyonyābhibhavāśraya | jananamithunavṛttayaś ca*, SK 12). The rows do line up; the error was the model pairing segments from different rows. A half-leaf crop contains one of the two holes.
  - So a single-model uncertain flag is worth opening, and opening it is needed: one of the two was a manuscript reading, the other a reading-order error. The same misalignment may explain some of the plants missed on this leaf (9t: Opus caught 1 of 4, Fable 0).
- **Caveats.**
  - The same Opus model placed the plants (its locate pass), which may favour Opus.
  - Both models missed all three plants in SK_21–22 on page 6t. Those lines may be outside the legible part of the half-leaf rather than true misses.
- **Verdict.** Collation against an edition works as a variant finder on this manuscript: trust its certain flags, and treat the rest as unexamined. It does not certify a text, and it does not touch the commentary or the Malayalam glosses.

**Found on the way: the images were shifted by two leaves.** The first read of page 3 showed the cover board. The bulk archiver had fallen back to positional mapping after a transient scandata failure (162 zip files for 159 IIIF leaves), and its dHash check passed the shift. It was repaired and pixel-verified before any read reported above. Details are on #3368.

**Not run.** Gemini 3.8 Flash through `agy`: the CLI account is out of quota until about 2026-10-23, on the laptop and on Hetzner alike. A paid API arm is not allowed for this model. The translation comparison against Colebrooke & Wilson 1837 (`69925814ad311253224cc20c`) waits for a usable read.

- *Replicated?* The OCR result: no, one page of one manuscript, though the whole-page refusal is categorical. The collation result: across 9 leaves of the same manuscript, not on a second manuscript.
- *Arm added the same day:* Fable 5.1, through the same `claudeCall` and prompt, on the same images.
- **Artifact.** `scripts/eval/results/whish147-palm-leaf-opus-2026-10-21/`

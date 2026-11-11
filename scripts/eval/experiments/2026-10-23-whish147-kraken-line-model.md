---
stage: ocr
measure: [accuracy, agreement]
languages: [sa]
scripts: [Mlym]
canons: [sanskrit]
n_books: 1
n_pages: 12
verdict: "A Kraken line model trained on 881 edition-anchored lines of hand A reads the 9 held-out verse leaves at CER 0.236 (floor 0.748; per leaf 0.15–0.33, no bimodality). That beats Opus pooled (0.34) but not Opus best of 3 (leaf mean 0.18). As a voter it picks Opus's best draw on 8 of 9 leaves (leaf mean 0.178, the oracle's). It does not transfer to the dense hand B (0.62–0.65, floor ~0.72). Learning curve: 100 lines 0.671 (chance), 300 lines 0.315, 881 lines 0.236."
status: informational
decision: "No page writes. Proposed use: a per-leaf selector and gate over Opus/Fable draws, and a placer for hand-A-like leaves in the unplaced stretch (9 of 91 placed in the Tattvakaumudī print, in scan order). Not wired into the book."
superseded_by: null
issue: 7119
---
PRIOR ART: 2026-10-19-mongol-real-pilot-prereg-5664.md and 2026-10-18-mongol-synth-prereg-5664.md (how GPU training ran on gex45 through the gpu-queue); scripts/eval/results/whish147-stability-recall-2026-10-23/ (#7203: the 9 test leaves, the per-row GRETIL scorer, the Opus/Fable/Sonnet draws used here); scripts/eval/results/whish147-best-attempt-2026-10-22/ (leaf boxes, `mlym.py`, the edition-anchored page texts the labels come from). None of these trained a model on this manuscript. The #7119 research comment found no public Malayalam or Grantha manuscript HTR model.

## 2026-10-23 · Can a Kraken model trained on our own edition-aligned lines read Whish MS 147? (#7119, research experiment 3)

Part of #7119.

**Question.** Can a small line model of our own, trained only on lines whose text comes from the edition-anchored transcription, read held-out leaves of this manuscript? How does it compare with Opus 5.5 reading the same leaves? Could it serve as a voter whose errors are independent of Claude's?

**Design.**
- **Book and hands.** Book `6ad845ec6037414ddef152af`. Training uses hand A only (leaf pages 7–129 and 223–310). Hand B (pp. 131–221) is a transfer test.
- **Held out.** Every leaf of the Sāṅkhyakārikā is out of training: the 9 verse leaves of the stability test (`4-b 5-t 5-b 6-t 6-b 7-t 8-t 8-b 9-t`) and their kārikā neighbours. So no kārikā line was ever trained on. The 9 leaves are scored with #7203's scorer, unchanged: Kraken's Malayalam → `mal2iast` → `norm` → per-row best-window CER against the leaf's located GRETIL span ±200 characters, rows of 8+ characters, with a shuffled-text floor.
- **Line segmentation (`segment.py`).**
  - kraken's `blla` failed on leaf 6-t: 78 fragments for 10 rows, broken at every gap and both string holes, and 130 s a leaf on CPU.
  - The fallback is horizontal projection. Each leaf is deskewed first (the angle that sharpens the row profile, ±3°). Rows come from the median ink profile of 24 vertical strips and are followed strip by strip.
  - Leaf edges are dropped by a texture test: horizontal/vertical gradient energy < 0.6.
  - Checked by eye on 17 leaves: 57-b, 6-t, 20-b, 100-b, 30-t, 150-t, 29-b, 42-t, 120-b, 140-t, 7-t, 4-b, 8-b, 9-t, 86-t, 96-t, 108-t. Before deskew, 140-t's rows drifted off-centre; after it they sit on the writing.
  - Training leaves were cut to the label's row count. 164 of the 171 leaves (training + test) gave exactly that count; the 7 that came up short were dropped. Test and hand-B leaves were cut with no row count given.
- **Labels (`labels.py`, `splits.py`).**
  - Each label is one physical row of an edition-anchored leaf page (the re-laid-out rows, #7119). It is converted to Malayalam script with `mlym.py`, using the scribe's spellings. Holes and row-end hyphens are dropped, and the re-layout's repeated split syllable is removed.
  - Rows with any doubt mark (`[leaf: …?]`, `[illegible]`, "not in edition", `?`, `…`) are excluded.
  - **The brief's rule was also applied:** keep a row only where the stored fresh Opus read of that row is within CER 0.15 of it.

| | count |
|---|---|
| hand-A edition-anchored leaves (kārikā leaves excluded) | 195 |
| … laid out as physical rows | 162 |
| rows | 1,477 |
| rows with a doubt mark | 468 |
| rows with no doubt mark | 1,009 |
| **… of which the brief's rule keeps (fresh Opus read within CER 0.15)** | **18** |
| no-doubt rows on leaves whose segmentation matched | 980 (153 leaves) |
| validation: all rows of 15 random leaves | 99 |
| training | 881 |

  The fresh Opus reads scored CER 0.53 against the edition across placed leaves (#7119, 2026-10-23 03:09), so they cannot confirm a row: on commentary, Opus mostly did not read it. 18 lines are too few to train on. They were trained for 10 epochs in the first run, and validation accuracy stayed at 0.000. **So the model was trained on the 980 rows with no doubt mark.** That is the edition text wherever the collation flagged nothing. In the planted-error test, about a third of real differences went unflagged (25/36 found), so some labels carry the edition where the leaf differs.
- **By eye: 3 training lines against their labels** (this job's Opus session, line images at full resolution). Picked at random from three bands of fresh-read CER:
  - `65-b-r06` (fresh-read CER 0.02, a colophon row): the leaf has the label's words. The scribe writes ഭഗവൽപൂ where the generated label has ഭഗവത്പൂ, and ശംകര where it has ശങ്കര.
  - `123-t-r04` (0.53, Dīpikā): segments 1–2 match word for word. In the third segment one word may differ (label *dāha*; the leaf looks like *drava*, not certain).
  - `64-b-r08` (0.82, Jayamaṅgalā): the leaf has the label's words (*ṣaṣṭikhaṇḍaṃ kṛtam iti … vyākhyātāḥ nanu ca ṣaṣṭitantra*), and writes ഖണ്ഡം + ക where the label has ഖണ്ഡങ്ക.
  - **Evidence type:** the labels are right at word level on all three. The noise is in the GENERATED orthography: the scribe writes anusvāra before a stop and chillu ൽ where `mlym.py` writes a conjunct. The fresh-read CER did not predict label quality (the 0.82 row is a correct label).
- **Training (`build-datasets.sh`, `gpu-task.sh`).**
  - Kraken 7.1.1, VGSL default architecture at line height 64 (3.3 M parameters), trained from scratch.
  - No Indic or Malayalam base model exists. The only model on the box is a Latin print model (CATMuS), at height 120.
  - AdamW 1e-3, batch 4, a fixed number of epochs (all 100, 300-line arm 150, 100-line arm 200), and the best checkpoint by validation accuracy.
  - On gex45 through `/root/bin/gpu-queue.sh` (tasks `07-whish147-kraken`, then `071-whish147-kraken-v2`). The card had been held by vLLM; it was free when the first task started.
- **What failed first (v1, kept in `scores-v1-n100.json`).**
  - Raw grey line strips in `path` mode made ketos run its legacy centre-line normaliser on every line, on the CPU. The card sat at 0%, and the 100- and 300-line arms collapsed to one output string for every line.
  - v2 normalises contrast (`normalize.py`, ink dark on white). It trains from binary datasets compiled with `--force-type baseline`, which also turns the normaliser off. 881 lines then took 10 s an epoch at 83% GPU.
- **The same trap at read time.** `kraken ocr -s` turns the centre-line normaliser back on for a whole-image line (`models/ctc.py`: `valid_norm=True` for bbox segmentations). Read that way, the 0.73-accuracy model wrote noise even on its own validation lines. `kraken_nonorm.py` runs the CLI with the normaliser off, so reading matches training. Every score below comes from that path.

**Results.**

Learning curve. Held-out = the 9 verse leaves; "val" = 99 lines of 15 hand-A training-side leaves, scored against their anchored labels.

| arm | training lines | best val accuracy (val CER) | **held-out verse CER** (chars) | floor | hand B dense: 86-t / 96-t (floor) | 108-t |
|---|---|---|---|---|---|---|
| brief's rule | 18 | 0.000 after 10 epochs (v1) | not trainable | | | |
| 100 | 100 | 0.307 (0.69) | 0.671 (2,882) | 0.724 | 0.577 / 0.596 (0.66) | 0.619 |
| 300 | 300 | 0.660 (0.34) | **0.315** (4,799) | 0.748 | 0.622 / 0.647 (0.71) | 0.385 |
| all | 881 | 0.733 (0.27) | **0.236** (4,970) | 0.748 | 0.626 / 0.646 (0.72) | 0.283 |
| Opus 5.5, 3 draws (#7203) | — | — | pooled 0.34 (leaf mean 0.32); best of 3, leaf mean 0.18 | | | |

- **Per leaf (881 lines):** 4-b 0.33, 5-t 0.26, 5-b 0.15, 6-t 0.24, 6-b 0.21, 7-t 0.20, 8-t 0.29, 8-b 0.24, 9-t 0.22; leaf mean 0.238.
  - The spread is narrow. Opus's draws are bimodal (0.03–0.63 on the same leaf).
  - The model wrote as many characters as an Opus read (4,970 vs ~4,800), and all 122 rows are distinct.
  - Example, 6-t row 1: ഷാതപതാൎത്ഥത്വാൽത്ിഗുണാദിവിപൎയ്യയാദവിഷ്ടാനാൽപുരുവോസ്തിഭോക്തൃഭാവാൽ for *saṃghātaparārthatvāt triguṇādiviparyayād adhiṣṭhānāt puruṣo 'sti bhoktṛbhāvāt*: a letter-level misreading here and there, nothing made up.
- **No memory.** The model never saw a kārikā line. It is a 3.3 M-parameter line recogniser, and its errors are visual (ത്രി→ത്ി, സംഘാ→ഷാ), not substitutions of a remembered text.
- **Hand B does not transfer.**
  - On the two dense-hand leaves (86-t, 96-t) the reads are near the floor, and their rows land scattered across the Tattvakaumudī.
  - 108-t lies in the hand-B page range but is written in a larger, hand-A-like hand (by eye). It reads at 0.28, and its 11 rows land in order at Tattvakaumudī print offsets 92,465–93,249: the commentary on kārikā 64, *…ādaranairantaryadīrghakālasevita…*.
- **Validation CER vs held-out CER (0.27 vs 0.24)** are close. Validation is scored against the anchored labels, so it also counts the generated-orthography mismatches. On a validation line the model wrote ചേന്ന (*cen na*, as the scribe writes it) where the label has ചേൽ ന.

**The model as a voter with Opus** (`voter.py`; no new calls; the edition is not used to choose). For each leaf, take the stored draw whose rows disagree least with the Kraken read: each row's best-window CER inside the Kraken leaf text.

| reader | all draws, leaf mean | Kraken-picked | best of 3 (oracle) | picked the best draw |
|---|---|---|---|---|
| Opus 5.5 | 0.322 | **0.178** | 0.178 | 8/9 (the miss: 5-b, 0.046 vs 0.044) |
| Fable 5.1 | 0.340 | 0.169 | 0.168 | 7/9 |
| Sonnet 5.5 | 0.547 | 0.463 | 0.447 | 7/9 |

- Kraken disagreement predicts an Opus draw's accuracy: Spearman 0.93 over 27 draws.
  - The 11 Opus draws with disagreement < 0.30 have mean CER 0.071.
  - The 12 with disagreement ≥ 0.45 have mean CER 0.586.
- On 8-b and 9-t every Opus draw disagrees by ≥ 0.56, and every one is poor (0.57–0.64). So the same number also gates: there is no good draw to keep.
- The 300-line model picks just as well (Opus 0.178, 8/9). Selection needs much less than a good transcription.
- #7203 found that agreement among Opus draws picks the poor mode. Kraken's errors are visual and uncorrelated with Opus's memory-driven fluency, which is why it can pick.

**Placing the unplaced stretch** (`place.py`, all 91 leaves of pp. 131–221, read in 87 s on CPU).
- 9 leaves place in the Tattvakaumudī print, in two runs whose scan order matches the print's order:
  - 106-b → 107-t → 107-b → 108-t → 108-b → 109-t (offsets 88.8K → 94.4K);
  - 110-t → 110-b → 111-t (55.8K → 58.5K).
- The other 82 do not place (row CER ~0.6). The two checked by eye (86-t, 96-t) are in the dense hand.
- These are proposals for the locate/collate step, not checked by a scholar. Nothing was written to the book.

**How it could be used** (not wired in; no page writes in this job):
1. **Selector and gate per leaf.** Read each hand-A leaf with Kraken (CPU, ~1 s a leaf). Draw Opus/Fable N times and keep the draw with the lowest Kraken disagreement. Below ~0.30 it is a good read; at ≥0.45 for every draw, mark the leaf "no good read" and withhold or flag it. On these 9 leaves that turns the pooled 0.34 into 0.18 at no extra model cost beyond the draws.
2. **Span-level third voter** in experiment 1's lattice. Its errors are visual, so where Opus and the edition agree and Kraken differs the leaf is probably the edition's; where Opus differs from both, it is probably memory.
3. **Placer** for the TK leaves in the larger hand (above), feeding the collation lane that never placed them.
4. **Better model:** more lines come from the 34 half-leaf-segment leaves and the 468 doubt-marked rows once a reader confirms them. A small hand-B set (by eye) is needed before hand B can be read at all.

**Caveats.**
- 9 held-out leaves, one hand, one text (verse). Commentary is not measured on held-out leaves; validation (commentary, 99 lines) is 0.27 against labels.
- The scorer measures distance to GRETIL, not to the leaf, for both readers. Scribal orthography and genuine variants count as errors for both.
- A collapsed model scores BELOW the floor on letter frequency alone: v1's one-string model got 0.607 against a 0.676 floor. `score.py` now reports how many distinct rows were read.
- The hand-B "anchor" is our own OCR of Tārānātha's print, with no located span: best window anywhere in 111K characters, against a shuffled floor of the same size.
- **Licence:** the training labels are derived from GRETIL e-texts (Śaṅkara's Jayamaṅgalā, Sarma 1926; Annambhaṭṭa's Tarkasaṃgraha and Dīpikā, Sansknet), which are CC BY-NC-SA 4.0. The trained model inherits that licence question: treat it as non-commercial, share-alike, attributed, until decided. That is why the weights and labels are not in this repo.

**Where things are.**
- Code, ids and scores: `scripts/eval/results/whish147-kraken-2026-10-23/`.
- Models: gex45 `/root/jobs/whish147-kraken/model/whish147-handA-881lines.safetensors` (sha256 `7ab94903…09957`), also the `-300lines` and `-100lines` files.
- Leaf crops, line images and datasets: gex45 `/root/jobs/whish147-kraken/` (`leaves/`, `lines*/`, `n-lines*/`, `ds/*.arrow`).
- GPU: `07-whish147-kraken` (08:30–09:12 UTC, v1) and `071-whish147-kraken-v2` (09:15–09:54 UTC). The card was back at 2 MiB after each.

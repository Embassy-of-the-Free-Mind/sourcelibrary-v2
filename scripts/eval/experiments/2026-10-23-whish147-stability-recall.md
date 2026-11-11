---
stage: ocr
measure: [stability, accuracy]
languages: [sa]
scripts: [Mlym]
canons: [sanskrit]
n_books: 1
n_pages: 12
verdict: "Reading the same Whish 147 leaf three times gives very different results, for Opus and Fable alike: on most verse leaves at least one read is close to the published text (best of three: CER 0.18 Opus, 0.17 Fable) and another is near chance (worst of three: 0.44, 0.49). Sonnet, with a row-count scaffold that held, stays near chance (0.60). Painting over the middle third of a leaf shows no recitation: Opus and Sonnet mark the hidden rows illegible, and Opus's accuracy on the visible rows holds on 3 of 4 leaves. Agreement between reads predicts accuracy only where it is high and rare, and picking the most central read selects the poor mode."
status: undecided
decision: "Not adopted yet. The useful signal is the good read among several, not the majority read: a blind Opus judge rated the good reads as sensible Sanskrit and the poor ones as gibberish, so best-of-N with a sensibility pick is the next test (#7119). On commentary leaves the reads stay near 0.45–0.69, and at least one commentary leaf (20-b) has Malayalam in it, so its score against a Sanskrit edition is not meaningful."
superseded_by: null
issue: [7119]
---
PRIOR ART: 2026-10-22-whish147-line-strips.md — one read per arm, half-leaf vs single-row strips; it noted that one good read did not repeat (0.09 → 0.52) but did not measure repeats. The fresh column read of #7119 (`scripts/eval/results/whish147-best-attempt-2026-10-22/fresh.mjs`, on branch `job-whish147-best`) — its method is reused unchanged here; it read each leaf once (two leaves twice) with Opus only.

## 2026-10-23 · Is the fresh read stable, does another model do better, is the good result memory, and do the reads make sense? (#7119)

**Question.** Derek asked to re-read the same leaves several times ("higher temperature") and with Sonnet, to see the difference, and whether the outputs are sensible. `claude -p` has no temperature setting, so repeated sampling at the default is the variance measure here.

**Design.**
- *Leaves.* The 9 verse leaves of the #7119 gate (4b, 5t, 5b, 6t, 6b, 7t, 8t, 8b, 9t; Sāṅkhyakārikā 1–58), plus 3 commentary leaves the job had placed in an edition: 20-b and 45-b (Jayamaṅgalā) and 129-b (Dīpikā).
- *Method.* Unchanged from #7119's fresh read: three column crops cut at the leaf's two string holes, none over 1,600 px, one sealed `claude -p` call per leaf, Malayalam script as written, physical rows joined with ‖, "nothing from memory". The crops and prompt reproduce the job's byte for byte (same prompt hash, same crop SHA-256), so its Opus reads count as read 1 (and read 2 for 5-b and 6-t).
- *Arms, 3 reads per leaf.* Opus 5.5. Sonnet 5.5 with a scaffold: the leaf's row count (taken from Opus read 1, checked by eye on 7-t, 20-b and 129-b) and "exactly N ROW lines, row by row", with one retry if the count is wrong. No retry was needed. Fable 5.1, same prompt as Opus.
- *Score.* `score.py`: #7148's per-row best-window CER against the leaf's located edition span ±200 characters, with a shuffled-letters floor (≈0.75). Self-consistency is the mean pairwise edit distance between a model's own reads of a leaf.
- *Recall probe.* On 4 verse leaves (4-b, 5-b, 6-t, 8-t), the middle third of the leaf's height was painted flat in the leaf's own colour and the leaf re-read twice each by Opus and by Sonnet (`run.mjs --mask`). A row is counted as recited if it matches the edition (CER < 0.4) at a position inside the text the mask hides, which is located from the unmasked Opus read, and does not repeat a visible row (`probe_score.py`). The positive control is the same rule applied to the unmasked reads, where it must fire.
- *Sensibility.* For 5-b, 7-t, 20-b and 129-b, each model's most central read (most like its other two) went in IAST, labelled A/B/C in shuffled order, to a blind Opus judge with no image and no edition. The judge rated each row as sensible Sanskrit, partly, or gibberish (`judge.mjs`, keys in `reads/judge/*.key.json`).
- 119 calls, all on the subscription. Mean time per call: Sonnet 18 s, Opus 75 s, Fable 352 s.

**Result.**

| | Opus 5.5 | Sonnet 5.5 (+ row scaffold) | Fable 5.1 |
|---|---|---|---|
| verse, pooled CER, 3 reads × 9 leaves | 0.34 | 0.60 | 0.35 |
| verse, best of 3 per leaf (mean) | 0.18 (7 of 9 leaves under 0.2) | 0.45 (2 of 9) | 0.17 (7 of 9) |
| verse, worst of 3 per leaf (mean) | 0.44 | 0.63 | 0.49 |
| leaves where one read is under 0.2 and another over 0.4 | 4 of 12 | 2 of 12 | 6 of 12 |
| self-consistency (mean distance between own reads) | 0.44 | 0.62 | 0.35 |
| commentary, pooled CER (3 leaves) | 0.58 | 0.58 | 0.45 |

- **The bimodality is per read, not per leaf.** For example, Opus on 7-t scored 0.63, 0.62 and 0.03, and Fable on 6-t scored 0.52, 0.03 and 0.54. A model sometimes produces the passage nearly letter for letter and, on the next draw, a string of near-misses. Sonnet mostly writes fragments between `[illegible]` marks. It kept to the row count every time, so the scaffold kept it on track for layout but not for reading.
- **Self-consistency mixes coverage with disagreement.** On 8-t all three Opus reads score 0.03–0.05 yet differ by 0.59, because they mark different rows illegible. So it is not a stand-in for accuracy.
- **Recall probe: no recitation found.** Over the masked reads, 0 recited characters (Opus 2,235 and Sonnet 2,044 characters written). The positive control fired: unmasked Opus reads place 1,288 characters inside the same hidden region. Both models wrote "[illegible — covered by the mask]" for the hidden rows. Opus's CER on the visible rows, unmasked → masked: 4-b 0.25 → 0.25, 6-t 0.12–0.33 → 0.06–0.11, 8-t 0.03–0.07 → 0.06–0.11, and **5-b 0.04 → 0.28**. So the good reads are not invented text. On 3 of 4 leaves they survive losing the context; on 5-b, recognising the passage was doing much of the work.
- **Agreement predicts accuracy only where it is high.** Rows that closely match the same model's other reads (similarity ≥ 0.8; 5,397 characters, about 11% of the text) score CER 0.14, against 0.42 for middling and 0.56 for low agreement. Cross-model agreement ≥ 0.8 is rarer still (414 characters, CER 0.04). A majority vote does not help, because two poor reads outvote one good one: the most central read was the poor one on 7-t (Opus) and 20-b.
- **Sensibility (blind Opus judge, no image).**

  | leaf | Opus | Sonnet | Fable |
  |---|---|---|---|
  | 5-b | sensible | gibberish | sensible |
  | 7-t | partly | gibberish | partly |
  | 20-b | gibberish | gibberish | partly |
  | 129-b | gibberish | gibberish | partly |

  On 5-b the judge called the Opus and Fable reads continuous, grammatical Sāṅkhyakārikā 11–16, and Sonnet's "a few real words among syllables that are not Sanskrit". The judge's ratings follow the measured CER: 5-b reads at 0.04 are rated sensible; Sonnet's reads at 0.4–0.6 are rated gibberish.
- **By eye** (Opus 5.5 reading full-resolution crops; evidence type: image opened). On 7-t row 1, the leaf's letter shapes fit Opus read 3's *svālakṣaṇyaṃ vṛttis trayasya saiṣā bhavaty asāmānyā sāmānyakaraṇa-* (SK 29), including the two *mā*-groups and *kara* at the end. Reads 1 and 2 have *nāmātrā…sthāmātra* there, a misreading of the same shapes. Row 2 fits read 3's *…vṛttiḥ prāṇādyā vāyavaḥ pañca*. My reading of this hand is medium-confidence. On commentary leaf 20-b, row 1 clearly ends **പ്രകാരമെന്നു** (*prakāram ennu*, Malayalam "it is said thus"). Opus read 1 also says the commentary "looks like Malayalam prose", and the judge saw Malayalam-like sequences on 7-t, 20-b and 129-b. So at least this commentary is partly Malayalam (maṇipravāḷam), and its CER against the Sanskrit Jayamaṅgalā edition does not measure reading quality.

**What it means.**
- For verse leaves, three draws from Opus or Fable usually include one read close to the leaf. The problem is picking it without the edition. The judge's sensible / gibberish split lines up with CER on these 4 leaves, so "best of N, picked by a blind sensibility judge" is the method to test next, scored on the 9 verse leaves.
- Sonnet is not a substitute.
- Commentary pages need a language check (Sanskrit or Malayalam) before any score against an edition is quoted.

- *Replicated?* Three draws per model per leaf on one manuscript; the recall probe on 4 leaves; the judge on 4 leaves, with one judge model (Opus, the same family as one of the readers).
- **Artifact.** `scripts/eval/results/whish147-stability-recall-2026-10-23/`

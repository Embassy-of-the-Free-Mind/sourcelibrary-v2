---
stage: ocr
measure: judged_vs_reference
languages: [mn]
scripts: [Mong]
canons: [mongolian-kanjur]
n_books: 5
n_pages: 34
verdict: "Real data works: 494 real columns (900 steps) cut v23 real-prose CER from 56.8 % (arm a re-read; 55.5 % realgt) to 23.6 %, clean3 24.2 %, synthetic held-out 4.2 % (no forgetting). Meaning check 8/30 match (from 0), 12 partial, controls 1/30: below its ≥ 18 bar."
status: undecided
decision: null
superseded_by: null
issue: [5664, 6871]
---
PRIOR ART: `2026-10-19-mongol-real-pilot-prereg-5664.md` (the preregistration this scores, unchanged: arms, mix, steps, bars and qualifiers); `scripts/eval/mongol-realpilot-5664/score_pilot.py` (the scorer, re-run by hand) and `scripts/eval/mongol-synth-5664/judge.mjs` from PR #6924's branch (the frozen meaning check, with the stdin fix).

## 2026-10-19 · Result: real Kanjur columns fix the Mongolian reader's letters; meaning is still short (#5664, #6871 row 6)

This scores the preregistered pilot `2026-10-19-mongol-real-pilot-prereg-5664.md` exactly as written. gpu-queue task `07-mongol-real-pilot` on gex45 ran 22:45–00:33Z. Every stage exited 0:
- **Build:** 494 real columns, 5,760 real and 8,639 synthetic rows, 0 leakage violations, v23-clean3 = 118.
- **Smoke gate:** loss 0.113 at step 25, so the run continued the adapter (`mode=init`).
- **Training:** all **900 of 900 steps**, in 96 min, with final train loss 0.009 and peak VRAM 8 GB.
- **Inference:** 1,059 reads.

### Numbers (pooled CER, `align.py norm()`; `score_pilot.py` re-run by hand, identical to the task's `cer.json`)

| set | n | realgt baseline | arm (a) re-read | **arm (b) pilot** |
|---|---|---|---|---|
| **v23 all (the bar)** | 157 | 55.5 % | 56.8 % | **23.6 %** |
| v23 confirmed | 112 | 52.9 % | 52.7 % | 20.4 % |
| v23 clean3 | 118 | 55.3 % | 57.0 % | 24.2 % |
| real training columns (memorisation) | 468 | 49.7 % | — | 0.0 % |
| real titles held out | 4 | — | — | 3.0 % |
| synthetic held-out (forgetting) | 400 | 3.8 % | — | 4.2 % |

Scores: `scripts/eval/results/mongol-realpilot-5664/cer.json`.

### Applying the bars
- **Determinism qualifier fires.** Arm (a)'s re-read is 56.8 %, against 55.5 % in the realgt reads: a drift of 1.3 points, so arm (b) is compared against arm (a)'s re-read.
  - Hypothesis, not tested: batch-dependent greedy decoding in 4-bit. The re-read ran in a different batch composition.
  - Either baseline gives the same verdict. The drop is **33.2 points** against arm (a) and **31.9** against realgt.
- **v23 all: 23.6 % ≤ 35 %, so "real data works".** The 35 % bar is absolute.
- **clean3 does not demote.** It is 24.2 %, also ≤ 35 %. Stock-phrase memory does not explain the gain: the columns that share no word 3-gram with any training label improve as much as the rest.
- **No forgetting.** Synthetic held-out is 4.2 %, against a 15 % flag.
- **Memorisation is total.** The training columns read back at 0.0 %. That is expected after about 11.7 passes, and it is not a reading measure.

### Regurgitation check (`copycheck.py`, on gex45; scores only)
This checks whether the gain comes from copying training strings onto v23 columns.
- **No v23 read equals a real training label.** That holds for 0 of 157 reads in both arms.
- **Arm (b) is closer to some training label than to its own reference on 13 of 157 columns.** Arm (a) is on 16, so training did not raise this.
- **Per-column CER for arm (b):**
  - median 17.4 %, against 54.3 % for arm (a);
  - 37 columns at ≤ 10 % and 109 at ≤ 25 %, against 0 and 2 for arm (a);
  - 3 columns at ≥ 75 %, against 13.
- **Word count matches the reference** on 114 of 157 columns, against 43 for arm (a).

### Secondary: the frozen 30-column meaning check (unchanged)
- **Method:** `judge.mjs` stages `meaning` then `score`, on the 30 `set == "meaning"` rows of `reads-pilot.jsonl`, with `--eval scripts/eval/results/mongol-synth-5664/eval`. The judge is sealed Opus on the Claude subscription.
- **Real pairs:** **8/30 match**, 12 partial, 8 no, 2 unreadable. The baseline was 0 match and 3 partial.
- **Controls:** 1/30 match, 4 partial, 20 no, 5 unreadable. The one control match is the text's own recurring Prajñāpāramitā formula, which the judge flagged as ambiguous in location.
- **Bar ≥ 18 match with ≤ 3 control matches: NOT met.**
- **The 8 matches name specific content, read by eye in the judge's reasons:** the Indra–Brahmā verse, "absence of own-nature … all dharmas", "Lord of nāgas", "non-humans make it appear thus", "death within six months … the head of self and others". None is a homage formula.
- **Coverage:** the meaning set spans 30 volumes of sūtra and tantra that are not in the training texts. The reader moved there too, but less than on v23, as the prereg's "narrow text" threat predicted.
- Scores: `scripts/eval/results/mongol-realpilot-5664/meaning-score.json`.

### By eye: 5 v23 columns
- **Draw:** seeded, `random.Random(5664).sample`, over the 157 real-prose ids.
- **Render:** each read in Noto Sans Mongolian, under the crop and above the reference.
- **The contact sheet stays on gex45 and in job scratch** (CC BY-NC-ND), so only the ids and the scores are here.

| column | CER b / a | words ref / b / a | by eye |
|---|---|---|---|
| v023_84b/c24 | 7.0 % / 37.2 % | 9 / 9 / 9 | (b) follows the crop word for word. The breaks sit where the block's gaps are, and one letter differs in the third word. (a) has the right skeleton but splits words and garbles three of them. |
| v023_84b/c15 | 31.2 % / 68.8 % | 6 / 6 / 9 | (b) gets the word breaks and the punctuation right. The first two words are misread: the opening glyph and the middle of the second word. (a) is mostly not words. |
| v023_85b/c05 (clean3) | 4.3 % / 47.8 % | 7 / 7 / 9 | (b) looks identical to the reference in render. (a) splits the first word and misreads the last two. |
| v023_84b/c21 | 9.4 % / 50.0 % | 7 / 7 / 7 | (b) is right through the fifth word, then misreads the medial of the sixth word. (a) misreads three words and loses the last one. |
| v023_86b/c27 (clean3) | 17.5 % / 60.0 % | 7 / 7 / 9 | (b) has the right breaks and recognisable words. The second and fourth words differ by one or two letters. (a) inserts spurious particles. |

In all five columns, (b)'s reading follows the crop: the same number of word units, at the block's gaps, with recognisable words. Its errors are letter-level, while (a)'s are word-level.

### What this means, and the threats that still apply
- **The domain gap is closed for letters.** 494 real columns take the synthetic-trained reader from about 56 % to about 24 % CER on a held-out real text, with clean3 intact and no forgetting. realgt's guess of 1,000 columns was not needed to see this.
- **Meaning is not there yet.** 8/30, under a judge that refuses stock phrases, is the first non-zero result, but it is less than half the bar. At 24 % CER, about one letter in four is wrong, which is too many for a reader to follow a sūtra.
- **The threats in the prereg still hold:**
  - **One seed, one run.** There is no variance estimate.
  - **Narrow text.** v23 is a dhāraṇī, like three of the five training texts. The meaning check is the weaker number because it is the broader one.
  - **Selection bias.** The training columns were the ones that were already half-read.
- **Licence:** no model trained on these labels writes `pages` until the B/C/D authors answer.

**Spend:** $0 (the owned gex45 GPU, and Opus on the subscription). **Nothing was written to `pages` or any production store.** No IMU data was used.

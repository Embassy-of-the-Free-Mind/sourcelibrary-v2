---
stage: ocr
measure: judged_vs_reference
languages: [mn]
scripts: [Mong]
canons: [mongolian-kanjur]
n_books: 40
n_pages: 50
verdict: "Fails the preregistered bar. The synthetic-trained Qwen2.5-VL-7B LoRA matches 0 of 30 real Kanjur columns against the Derge parallel (3 partial; controls 0 match, 0 partial; untrained base 0/30). Synthetic held-out CER is 3.9% mean, so by the prereg this is a domain gap and the next data must be real lines. It does read shapes: the Sanskrit title is recognisable in 7/10 text openings and the Mongolian title in 10/10 (controls 0/10 and 1/10), but body prose comes out as non-words spelled with loanword letters."
status: rejected
decision: "No 11-mongol-read task and no second synthetic round. The next arm needs real Kanjur lines with known text (#5664)"
superseded_by: null
issue: [5664, 6871]
---
PRIOR ART: `2026-10-18-mongol-synth-prereg-5664.md` (the preregistration this entry scores, committed before any read; the bar, sets, rubric and outcome rules are all from there); `scripts/eval/mongol-synth-5664/{judge.mjs,cer.py}` (the frozen scorers, run unchanged apart from the stdin fix below); `2026-10-16-mongol-kanjur-argon-opus-probe-5664.md` (the 0/10 baseline for Flash, Argon and Opus).

## 2026-10-18 · Score: the synthetic-trained Mongolian Kanjur reader fails the meaning check (#5664, #6871 row 6)

**Run scored:** gpu-queue task `10-mongol-synth-train` on gex45, 07:06–15:32 UTC.
- 4,505 steps (0.9 epoch), stopped by the 8.3 h budget. Synthetic loss 4.55 at step 25, 0.03 by step 775, 0.012 at step 4,500. Peak 8.3 GB.
- Reads: 1,007 from the LoRA (30 meaning columns, 577 name columns, 400 synthetic held-out columns) and 80 from the untrained base (30 meaning, 50 held-out). Greedy decoding, as preregistered.

**Results, by the preregistered bar:**

| check | LoRA | base | bar |
|---|---|---|---|
| judge calibration (title vs own Derge opening / another text's) | 29/30 match, 1 partial / 0/30 match | (same judge) | ≥ 80 % / ≤ 10 % → **judge valid** |
| **meaning, real columns** | **0/30 match**, 3 partial, 3 no, 24 unreadable | 0/30 match, 13 no, 17 unreadable | ≥ 18/30 match → **fails** |
| meaning, shuffled controls | 0/30 match, 0 partial, 5 no, 25 unreadable | 0/30 match, 15 no, 15 unreadable | ≤ 3/30 → holds |
| names: Sanskrit title recognisable | 7/10 (2 yes, 5 partly) | not run | ≥ 5/10 with ≤ 1/10 control → **met** |
| names: Tibetan title | 6/10 (4 yes, 2 partly) | — | no bar |
| names: Mongolian title | 10/10 (6 yes, 4 partly) | — | no bar |
| names: controls (same reads, another unit's titles) | Sanskrit 0/10, Tibetan 0/10, Mongolian 1/10 partly (the generic čoγtu) | — | |
| synthetic held-out CER (n=400) | mean 3.9 %, median 1.6 %, 87.5 % under 10 % | mean 93 %, median 80 % (n=50) | diagnosis only |

The three *partial* rows (m006, m078, m081) each rest on one or two common words (*usun* "water", *bolbasural* "ripening", *taki* "offering"), and the judge itself hedged them ("may echo"). None comes near a match.

**By the preregistered rule** (primary fails and synthetic CER < 10 %): the model learned the renderer, not the woodblock. **This is a domain gap.** More synthetic steps would not close it, so no `10-mongol-synth-train-2` is queued. The model does not clear the bar, so no `11-mongol-read` is queued either, and no GPU-days are spent.

### By eye: 5 columns, real crop beside the LoRA output (m001, m016, m049, m066, m088)

I rendered each output in Noto Sans Mongolian under its 84 px crop. The sheet is in the job scratch, not committed: the scans' licence is unsettled, the same reason the prereg gives.
- **It is reading, not inventing fluent Mongolian.** In all 5, the output has the same number of words as the crop, the word breaks fall in the same places, and the punctuation (`᠃`, `᠄`) is where the crop's is. Long words come out long and short words short. m049's 2 words · 3 words layout and m088's closing `᠃` are reproduced exactly.
- **The letters are wrong.** Classical Mongolian script writes several letters with one shape (o/u, ö/ü, t/d, q/γ, and medial a/e/n teeth). The model resolves each shape to some letter, but often to the wrong one, and it reaches for the loanword letters of its modern training text. In the reads of the 30 real columns, ᠹ *f* occurs 4.5 times per 1,000 letters, 20× its rate in the training labels (0.2). ᠧ *ee* is 6× its training rate and ᠸ *w* 3×. In the synthetic held-out reads these letters stay at about their training rate. Opus glossed only isolated real words (*jüg*, *keme*, *mön činar*, *kümün*) out of strings of non-words.
- **Galik/name check, read the same way.** The text openings are where it does best, because title vocabulary is what its Buddhist training pool (rKTs titles and colophons) is made of. It is not recall: the 40 evaluated texts' titles were removed from training by rKTs id, and the controls (the same reads beside another unit's titles) score 0/10 and 1/10. On n075 the judge found *lalikā paripṛcchā nāma* in Mongolian letters, and on n010 *śrī vajra maṇḍa-alaṃkāra*.

So the read is anchored to the page where the model's prior knows the words, and falls apart into non-words where it does not. That fits the cause the CER suggests: the 7B model has learned to segment and trace the woodblock's shapes but has no model of 18th-century Buddhist Mongolian spelling to resolve them with. 89 % of its unique training text is general (mostly modern Inner Mongolian); the Buddhist pool is only titles and colophons, oversampled to half of what is rendered; and it is all in one monoline font.

### What real data is needed (the preregistered "fail, CER < 10 %" branch)

The model now needs real Kanjur crops paired with known text. In order of cost:
1. **Title blocks and colophons, aligned from the catalogue ($0, no outreach).** All ~1,100 Kanjur texts open with a title block whose Sanskrit, Tibetan and Mongolian titles rKTs gives, and the name check shows this model can already find them. Locating each text's opening leaf (as `select_eval.py` does) and force-aligning the rKTs strings to the cut columns would give a few thousand real columns with near-known text. The 40 evaluated texts stay out. Limits: it covers title vocabulary, not body prose, and rKTs uses graphemic spelling, which may differ from the print.
2. **~300 body-text columns (≈10 leaves) transcribed by a Mongolist.** This was the ask in #6902. It would be both a real evaluation and a LoRA seed for prose, and nothing else gives prose ground truth.
3. **IMU's 2011 Kanjur word-spotting images (~5,500 words).** These are real Kanjur glyphs. They need the e-mail to Prof. Bao, which is drafted in the #6902 entry and not sent.
4. Not checked: whether an openly licensed Unicode e-text of the Beijing Mongolian Kanjur body exists. If it does, it would turn option 1 into full-page alignment.

### Scoring notes
- **Infrastructure fix, not a rubric change.** The first `judge.mjs meaning` run died with `E2BIG`: five Tibetan windows (up to ~75K characters) are over the 128 KB argv limit. I changed `opus()` to pass the prompt on stdin. The rubric, batch size (5 pairs per call, as preregistered), shuffle seeds and ids are unchanged. The 5 rows from the first run were kept: the runner resumes by qid.
- **One blinding leak, stated:** a column's real and control items carry the same model read, so a judge seeing both in one call can tell they are a pair (it said so twice: "verbatim repeat of q021"). It still cannot tell which of the pair is real. The control result is 0 match either way, so the leak does not change the verdict.
- Judge: sealed `claude -p --model opus` on the subscription, text only. It never saw an image or the other arm's output: each arm ran as a separate process over its own read file.

**Files:** `scripts/eval/results/mongol-synth-5664/score/` holds `score-{lora,base}.json`, the per-item verdicts (`judge-lora-meaning.jsonl`, `judge-lora-names.jsonl`, `judge-base-meaning.jsonl`), `reads-base.jsonl`, `reads-lora.jsonl.gz` and `train-stats.json`. The adapter stays on gex45 at `/root/jobs/gpu-queue/10-mongol-synth-train/adapter-final`.

**Spend:** $0. There were 28 Opus judge calls on the Claude subscription and no Gemini call (gemini-3.1-flash-lite was not used). The GPU work was the already-finished gex45 task, with no new GPU time. **Nothing was written to `pages` or any production store.**

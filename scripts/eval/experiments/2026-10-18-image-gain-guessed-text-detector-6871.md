---
stage: ocr
measure: judged
languages: [la, de, grc, lzh, ar, he]
scripts: [Latn, Grek, Hani, Arab, Hebr]
canons: []
n_books: null
n_pages: 900
verdict: "Interim, on 900 of 2,178 Opus-adjudicated stored reads: image gain (log p | image − log p | no image, Qwen2.5-VL-7B AWQ, teacher-forced) ranks Opus's marked bad words at unit AUROC 0.60 (95% CI 0.57–0.64), far under the preregistered 0.75; no language clears the bar. It is better than text-only perplexity (0.54; paired CI +0.00 to +0.14). It does see INVENTED text: 0.86 (0.78–0.89) on invented spans, where perplexity is 0.30, because invented text is fluent. It is blind to one-letter misreads (0.50). The image-conditioned surprisal alone (0.71) beats both."
status: rejected
decision: "No image-gain pre-screen before Opus review, in any language. The full run (the remaining 1,291 items including the 41 plants, and the noise floor) is queued as gex45 gpu-queue task 50-grounding-6871; its numbers land as a follow-up entry"
superseded_by: null
issue: [6871, 6420]
---
PRIOR ART: arXiv 2605.27750 ("Reading or Guessing? Visual Grounding Failures of VLMs for OCR in Ancient Greek Editions", Karamolegkou, Angleraud, Sagot, Clérice). It defines gain(t) = log p(t | image, prompt) − log p(t | prompt), teacher-forced on the model's own transcription with the image removed. For Greek it reports lower gain on lexical substitutions than on perceptual errors (olmOCR-2, Qwen3-VL-8B); Arabic does not reproduce the split. It gives no AUROC. `2026-10-18-gex45-capability-card-6871.md` timed the same pair on this card (speed only). Preregistration: `scripts/eval/grounding-6871/PREREGISTRATION.md`, committed in 6812ff73b before any span was scored.

## 2026-10-18 · Does image gain find the guessed spans in a stored OCR read, well enough to pre-screen pages before Opus? (#6871 row A)

**No, at least on the first 900 pages.** The pooled unit AUROC is 0.60, against a preregistered bar of 0.75. That is too far below for the other 1,278 real pages to close the gap. The run stopped at 900 because a 10-hour gpu-queue task (Mongolian LoRA, #5664) took `/root/gpu.lock` between two holds. The rest is queued behind it (see State).

**Labelled set (what exists, by language).**
- **#6420 / #6694 lane B adjudications.** These are the only Opus-judged stored reads with marked spans. Sets calib, gate, main200b and q300: 2,183 pages. A sealed Opus read each image and listed the *stored* read's errors as quotes ("'præfertim' — image 'præſertim'").
- The stored texts were never committed, so `build-set.mjs` rebuilt each one read-only: the live text, or the `page_revisions` row, whose normalised length equals the snapshot's `len_stored`. All 2,183 were recovered: 1,408 live, 775 from revisions.
- 2,178 pages have ≥ 40 characters, by lane group: latin 1,022 · german 402 · chinese 356 · greek 257 · arabic 105 · hebrew 36. The group is the book's lane group, so "greek" includes German pages of Greek-German books, and "hebrew" a Wycliffe Bible.
- `prep.py` split the errors into 5,622 parts:
  - 3,693 located in the text: Latin 2,392 spans, German 841, Greek 536, Chinese 391, Arabic 290, Hebrew 75;
  - 481 not locatable;
  - 568 omissions (no tokens to score);
  - 880 "other" (structure, layout), masked.
- Located spans by kind: sub_char 1,628 · sub_lexical 2,005 · invented 455 · garbled 437.
- **#6559:** nothing usable. Its stored pages were empty, and its 3 plants are in Opus reads.
- **#6561:** marks Paddle Chinese against Kanripo, not by Opus. Not used.
- **Planted controls (`plant.mjs`):** 41 pages Opus judged clean.
  - 21 have 3 fluent wrong words each, proposed by gemini-3.1-flash-lite (e.g. *Panis cor hominis confirmat → recreat*, *νηῦς → γῆρυς*).
  - 20 have one sentence swapped in from another page of the same book.
  - The plants were not reached in the interim pass.

**Scorer and units (as preregistered).** The scorer is Qwen2.5-VL-7B-Instruct-AWQ, vLLM 0.31 on the gex45 RTX PRO 4000. Prefix caching was off and prompt_logprobs on.
- Image: the archived master, long side capped at 2,400 px.
- No-image pass: the same prompt with the image part removed.
- Text: the stored read minus `<detected-images>` / `<vocab>`, first 8,000 characters. On all 928 pages scored, the token ids matched the tokenizer's ids.
- Unit: a word, or a 3-character Han chunk. Its window is the word's tokens, widened to ≥ 4 tokens.
- **gain**: the window mean of the two log-probs' difference; flag when low. **Baseline**: text-only perplexity; flag when high. **inll**: −log p(token | image); descriptive only.
- CIs come from 2,000 page-cluster bootstrap resamples.

**Result (interim: 900 pages, the first in item order).** The pages are calib 58, gate 283, main200b 559. q300 (#6694) is not in it.

| group | pages (with a bad span) | bad units / units | AUROC gain (95% CI) | AUROC text-only perplexity | paired gain − perplexity | precision at 10% flag rate (recall) | AUROC image surprisal (descriptive) | bar |
|---|---|---|---|---|---|---|---|---|
| **all** | 900 (618) | 4,966 / 378,116 (1.3%) | **0.60** (0.57–0.64) | 0.54 (0.50–0.57) | +0.00 to +0.14 | 2.8% (22%) | 0.71 | no |
| latin | 588 (401) | 3,136 / 255,868 | 0.59 (0.55–0.64) | 0.55 | −0.04 to +0.15 | 2.7% | 0.69 | no |
| greek | 170 (128) | 1,081 / 84,199 | 0.64 (0.61–0.67) | 0.52 | +0.07 to +0.18 | 2.9% | 0.72 | no |
| german | 75 (50) | 398 / 16,696 | 0.63 (0.42–0.77) | 0.55 | −0.28 to +0.35 | 7.3% | 0.79 | no |
| chinese | 35 (17) | 128 / 8,277 | 0.52 (0.43–0.61) | 0.64 | −0.28 to +0.02 | 2.7% | 0.67 | no verdict (< 30 pages) |
| arabic | 26 (19) | 195 / 9,044 | 0.58 (0.50–0.65) | 0.65 | −0.21 to +0.05 | 4.2% | 0.75 | no verdict |
| hebrew | 6 (3) | 28 / 4,032 | 0.75 | 0.63 | — | 2.7% | 0.85 | no verdict |

**By kind (secondary, all groups).**

| kind | bad units | AUROC gain (CI) | AUROC perplexity | paired gain − perplexity | AUROC image surprisal |
|---|---|---|---|---|---|
| **invented** | 662 | **0.86** (0.78–0.89) | 0.30 | **+0.34 to +0.69** | 0.63 |
| garbled | 478 | 0.64 (0.52–0.72) | 0.60 | −0.18 to +0.18 | 0.84 |
| sub_lexical (a different word) | 2,682 | 0.58 (0.55–0.60) | 0.55 | −0.01 to +0.07 | 0.70 |
| sub_char (one letter, ſ/f, an accent) | 1,145 | 0.50 (0.47–0.52) | 0.62 | −0.18 to −0.07 | 0.71 |

On the 523 pages where every error part was located, gain scores 0.62 and image surprisal 0.76.

**Reading.**
- **The paper's signature is real, but only for invented text.** Invented spans are fluent: text-only perplexity ranks them *below* clean text (0.30). The image does not support them, so gain ranks them at 0.86. That is the low-image-gain prior-override pattern the paper names.
- **Most of what Opus marks is not that.** It is wrong words and letters inside real lines (sub_lexical + sub_char = 77% of bad units). There, gain is at or near chance. A one-letter misread costs the image no likelihood the language prior did not already charge.
- **As a pre-screen, gain is weak even where it works.** Invented units are 0.2% of units, so at a 10% flag rate precision is 1%. Pages are what get routed. On pages, the share of low-gain units ranks the pages holding invented or garbled text at 0.64 (0.59–0.70). That is not preregistered (`explore.py`).
- **The one signal worth a second look is image-conditioned surprisal** (0.71 pooled, 0.84 on garbled). It amounts to asking how improbable the read is to a VLM that sees the leaf. It is not what this row tested, and nothing here is preregistered for it.
- Exploratory, page level: on pages Opus called *serious*, it scores 0.71. Two groups stand out:
  - Greek: low-gain share 0.79 (n 170);
  - Chinese: 0.98 (n 35, of which 22 serious).

  These are leads for a fresh preregistered draw, not results.

**Threats and limits.**
- Interim: 41% of the real set, not a random draw, and no q300 pages.
- Opus's lists are not exhaustive, so some negatives are errors. This lowers every scorer alike.
- The scorer judges Gemini's read, not its own. A low gain can mean "Qwen would not write this", which is not the paper's setting.
- One model, one prompt.
- The noise floor (same pass again; 1,200 px) is not yet run, so the interim CIs carry sampling error only.

**Cost.** gemini-3.1-flash-lite for the word plants: 14,490 input + 2,605 output tokens, $0.0075, logged through `gemini-script-client.mjs`. Two earlier draws, run while the quota was being fixed, bring the total to **$0.022**. GPU: about 60 min of gex45, in a 2-min pilot and 3 holds of 18 min. An inbox note asked for holds of ≤ 10 min; I read it after the holds had run. No Claude model was used and nothing was written to `pages` or any store.

**State.** gex45 gpu-queue task `50-grounding-6871` (`scripts/eval/grounding-6871/queue-task.sh`, timeout 4 h). It runs after `10-mongol-synth-train` and `20-latin-mineru-olmocr`. It scores the remaining 1,291 items (plants included), the 300-page rerun and the 1,200 px pass, then runs `score.py` and `explore.py`. To read it: `ssh root@65.108.136.89 'cat /root/jobs/gpu-queue/50-grounding-6871/task.log; python3 -m json.tool /root/jobs/grounding-6871/results.json | head -120'`.

*Replicated?* No.

*Artifacts:* `scripts/eval/grounding-6871/`:
- `build-set.mjs`, `prep.py`, `plant.mjs`: the labels;
- `ll-score.py`, `hold.sh`, `queue-task.sh`: the GPU pass;
- `score.py`: preregistered; `explore.py`: not preregistered;
- `results/`: `labels.jsonl.gz` (spans and text hashes), `plants.jsonl.gz`, `noise-ids.txt`, `interim-900/*.json`.

Per-token log-probs stay on gex45 in `/root/jobs/grounding-6871/main.jsonl`.

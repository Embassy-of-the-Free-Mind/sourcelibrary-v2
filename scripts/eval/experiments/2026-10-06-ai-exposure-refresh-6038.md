## 2026-10-06 · Is "~40% of our books are new to AI" still true? About 45% of distinct works (a third of books) are not recognised by Gemini 3.1 Pro; the May self-familiarity detector does not survive its own controls (#6038)

**Question.** Re-measure the May 2026 preprint's figures (42.9% "confidently new", 21.1% "confidently in", 39% expected in training; `public/contamination-probe-paper.pdf`) on today's corpus, with current models. Break the result down by the slices we would offer a lab. The measure is WORK-level (does the model know the work through any channel?), never FILE-level (has it seen our scan?). #5549 showed the file-level question is unpowered for current models.

**Design.** `measure: agreement`. There is no ground truth except the controls.
- **Sample.** Every `books` record with `pages_count > 0` (109,004) was grouped into works: `work_id` (86%), else folded author and title, else the book itself (86,461 works). The walk is seeded (6038) over works, so it is work-uniform. A work is kept when one of its first 6 editions (visible ones first) has ≥ 300 normalised characters of OCR in its first 15 OCR'd pages. Main quota 2,000; 58.2% of walked works had text, so about 50K works have OCR text. Five strata of 150 come from the same walk: Nālandā (Tibetan, Sanskrit, Pali), BPH/EFM Hermetica (provider `bph` or a hermetic, kabbalah or alchemy collection), Chinese, Arabic/Persian, Hebrew. A seeded random 500 of the main sample was drawn for the expensive arms. The id list is checkpointed (`ids-manifest.json` holds its sha256; the file itself stays private because it lists hidden books). Mongo was read-only.
- **Controls.** 24 canonical works we hold, with text. 22 known but not canonical works (Agrippa, Kircher, Maier, Fludd, Dee, the Zohar, Mencius …), added after the first pass because the canonical tier was too easy. 40 invented decoys in 11 languages and scripts. The controls ran standalone first (the STOP gate), and every main packet also carries 2 decoys and 1 canonical work.
- **Probe.** As in May §3.2: packets of 28 (25 real), at most one book per work and per author in a packet (#5549 leakage rule). Each book gets `knows_of`, `self_familiar` ("did you see the TEXT … distinguish knowing OF a book from seeing its text") and a verbatim `opening`. Models: `gemini-3.1-flash-lite` and `gemini-3-flash-preview` on all 2,361 works (thinking off); `gemini-3.1-pro-preview` (thinking budget 1024) on the 500 and on every stratum; Claude Haiku through 8 subscription subagents on the 500 and the controls.
- **Opening check, without an LLM judge.** The opening is normalised (NFKC, marks dropped, letters and digits of every script, early-modern Latin folds, no spaces). It is scored by the share of its characters covered by 12-character runs (4 for Han) that also occur in our OCR. A cross-book null pairs it with another book in the same language, by a different author and work: q99 = 0.25. Threshold 0.5. A 5-gram share was tried first and dropped, because generic English sentences scored 0.6–0.75 against unrelated books.
- **Fusion (May §3.3, rebuilt).** The prior's log-odds come from the disposition, plus the number of translations, a canonical imprint, a translation before 1950 and an IA scan. Records without a verification get a fallback of 0.30, ±English, ±`is_first_translation`. The self-familiarity LRs were hand-set before any sample answer was read; sibling Gemini models are averaged and the verified opening has LR 30. The sensitivity arms are no-prior and half-LR.

**Result.**

| control (recognised = knows_of or self_familiar yes, or a verified opening) | Flash-Lite | Flash | Pro | Haiku |
|---|---|---|---|---|
| canonical (24, plus in-packet repeats) | 100% | 100% | 100% | 100% |
| known, not canonical (22) | 100% | 100% | 100% | 100% |
| invented decoys | 2.6% | **18.4%** (in packets) | 2.2% | 2.5% |
| known works: "I have seen the TEXT" | 22/22 | 17/22 | 14/22 | **6/22** |

| works NOT recognised (95% Wilson) | Pro | Haiku | Flash-Lite | Flash | none of the 4 |
|---|---|---|---|---|---|
| random 500, all held | **45.0% [40.7–49.4]** | 70.2% | 62.6% | 37.2% | 32.7% [28.7–37.0] |
| visible / hidden | 42.0% / 48.7% | 64.2% / 77.4% | 58.0% / 68.1% | 35.8% / 38.8% | 32.1% / 33.5% |
| Nālandā (150) | **62.7% [54.7–70.0]** (8% unidentifiable records) | — | 73.3% | 59.2% | — |
| Hebrew | 40.0% [32.5–48.0] (10.7% unidentifiable) | — | 58.7% | 38.5% | — |
| Hermetica / BPH | 30.7% [23.8–38.5] | — | 55.3% | 24.8% | — |
| Arabic / Persian | 29.3% [22.6–37.1] | — | 39.3% | 26.8% | — |
| Classical Chinese | **14.0% [9.3–20.5]** | — | 41.3% | 16.8% | — |

- **The headline is recognition, not the fused posterior.** Self-familiarity "no" is not evidence of absence: Haiku and Pro deny having seen the text of famous works. Recognition, by contrast, separates the controls cleanly for Pro, Haiku and Lite. Pro's tiers on the 500: 45.0% unrecognised, 44.8% known-of only, 10.2% "saw the text". If Flash's 18% decoy rate is subtracted, Flash lands at ~46% unrecognised, which matches Pro.
- **Books against works.** Weighting each work by its editions gives 34% unrecognised (Pro). Multi-edition works are the famous ones. So "~40% of our books" overstates the book count and understates the work count.
- **The May-style fusion is reported and should not be quoted.** Prior + Lite + Flash on 1,979 works: 76.9% P < 0.25, 6.1% P > 0.75, expected in 23.0%. At May's thresholds: 12.6% P < 0.10 and 2.9% P > 0.90. It is not comparable to May. The prior covers 20% of today's sample (62% in May) and it misfires on canonical works: Biblia Hebraica, Ficino's Plato, the Gītā and the Alkoran are `confirmed_first`, because the disposition concerns the *edition's* English translation. With Flash-Lite, 18 of 96 canonical in-packet positives fused to P < 0.25. On the 500 with all four arms the fused share rises to 81%, which is the wrong direction for a claim.
- **Agreement.** Recognition κ on the 500: Pro–Flash 0.69, Haiku–Lite 0.67, Lite–Pro 0.64, Flash–Lite 0.51, Pro–Haiku 0.48, Haiku–Flash 0.36. Self-familiarity κ between Lite and Flash on 1,979 works: 0.69.
- **Recognition is not exposure.** Of the 225 works Pro does not recognise, 47% are MDZ/BSB books (digitised under the Google Books partnership) and 14% have an Internet Archive copy with public OCR. Machine OCR of many may sit in crawls without the model knowing the work. That fits #5549. The defensible claim is "works the models do not know", not "text no lab has".

**What this does not cover.** Larger models (Opus, GPT-5-class), which would likely recognise more, so 45% is a ceiling for the models tested. File-level exposure. Haiku on the strata (agent cap). Calibrated LRs: they are hand-set, like May's. One run per arm, so this is not replicated. The opening check reads only the first 15 OCR'd pages, so it under-verifies works whose opening comes later.

*Grade.* Exploratory → decision-grade for the controls (n = 86 control items × 4 models). `run_id` ai-exposure-6038-2026-10-06. *Decision.* Replace "~40% of our books are new to AI" with "over 40% of the distinct works we hold (about a third of our books) are not recognised by Gemini 3.1 Pro". Lead a lab offer with the Tibetan/Sanskrit/Pali shelf, not with Hermetica or Classical Chinese. The blog and preprint text is proposed in the PR (tier:hold). *Replicated?* No. *Cost.* $3.80 Gemini realtime (`gemini_usage` endpoint `eval/ai-exposure-refresh`). Haiku ran on the subscription (8 subagents, 25 packets). *Artifacts:* `scripts/eval/ai-exposure-6038.mjs`, `results/ai-exposure-6038/` (sample, walk, controls, packets, answers per model, verify, posteriors, report.json/.md). OCR text and the id list stay out of the repo.

---
stage: ocr
measure: agreement
languages: [grc]
scripts: [Grek]
canons: []
n_books: 4
n_pages: 1040
verdict: "Preregistration only, no result: training burst 2 trains GLM-OCR + LoRA on 619 Grec 1839 pages labelled from the Schneider edition fit, and is decided on 307 pages of two alchemical codices from other libraries (Marcianus gr. 299, Ars sacra) against served text and flash-lite. Queued on gex45."
status: superseded
decision: null
superseded_by: 2026-10-23-greek-ms-lora-score-5730.md
issue: [5730, 6871]
---
## 2026-10-22 · Burst 2: can a reader trained on one Greek manuscript read others? (#5730, prereg)
<!-- PRIOR ART: 2026-10-06-greek-manuscripts-full-kraken-fit-5619.md (the edition fit that labels every page here);
2026-10-20-latin-print-distill-glm-ocr-6871.md (row D: the GLM-OCR LoRA recipe on this card, train.py used unchanged);
burst 1 on #5730 (Kraken fine-tuned on EEBO won only on EEBO film, hence the library-shift test decides). -->

**Census first** (the #5730 comment of 2026-10-22, `scripts/eval/greek-ms-lora-5730/census.mjs`, today's Mongo): per
candidate script, (a) image-aligned verified text held, (b) unread or badly-read backlog, (c) whether an open engine
already wins.

- **Already served by an open engine:** Tibetan (Yigdzin, 681K pp), SKQS (Paddle, 1.56M pp) and Syriac (Kraken,
  39K pp). Training adds little there.
- **Too few aligned pages:** Persian/Arabic (≈ 30 pp against 257K unread), Hebrew (≈ 150 pp against 263K unread) and
  Greek print (109 refs).
- **Already tried:** Latin (burst 1 and row D).
- **Chosen: Greek manuscripts.** 385 books, 149,476 pp; Flash is the only reader, and on Grec 1841 its text is mostly not
  what the page says. The #5619 fit gives ≥ 954 usable pages of edition-aligned text.

**Design** (`scripts/eval/greek-ms-lora-5730/PREREGISTRATION.md`, commit fe5cb4b88, before any read):

- **Labels.** Each label is the edition span between the page's two fitted edges: apparatus removed, Greek only.
- **Train.** 619 Grec 1839 pages + 33 val, taken from the first 70 % of Schneider's text.
- **T1 (near).** 81 Grec 1841 spreads from the last 30 % of the text, so no passage in them was trained on.
- **T2 (deciding).** 307 pages of Marcianus gr. 299 (Venice) and the Ars sacra (Florence), scored against
  Berthelot–Ruelle.
- **Arms:**
  - F: GLM-OCR + LoRA (r 16, 3 epochs);
  - G: stock GLM-OCR;
  - S: the served text (Gemini 4 Argon low on all of T1; 3-Flash or lite on T2);
  - L: flash-lite with the generic prompt.
- **Metric.** CER on Greek base letters, with a paired bootstrap of the median Δ.
- **PASS** needs all four on T2:
  - F beats S (CI < 0, |Δ| ≥ 0.5 pt);
  - F beats L (the same test);
  - catastrophic pages for F ≤ S's + 1;
  - F's median below G's.

  Passing T1 alone means in-distribution only, which is not a lane.

**State.**
- Arm L is read: 388 pages, 70 of them ran to the 16K-token cap, 3 stopped on recitation, ≈ $0.60.
  `reads/L.jsonl.gz`, unscored.
- l7a cannot drive gex45 (its mesh key only allows `start`/`where`). Job `train-burst-5730-gpu` on main therefore queues
  gpu-queue task `62-greek-ms-lora-5730` (timeout 5 h). The task scores itself into
  `gex45:/root/jobs/greek-ms-lora-5730/results.txt` by the committed `score.mjs`.
- The score entry that follows supersedes this file.

**Limits fixed in advance.**
- References are edition text with edges fitted on the served read: agreement with an editor, not a diplomatic
  transcription. This is conservative against F.
- T2 has two scribes.
- The training text is one codex of one work.

*Spend so far:* flash-lite ≈ $0.60; Mongo reads; no GPU yet.

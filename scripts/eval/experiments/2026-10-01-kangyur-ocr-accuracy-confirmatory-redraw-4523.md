## 2026-10-01 · Kangyur OCR accuracy, confirmatory re-draw: does the 0.95 hold on fresh pages, and how often is a line dropped? (#4523)

**Question.** Derek, 2026-10-01: "confirm the error rate with another sampling experiment on the OCR." The 09-30 readiness draw put the served Yigdzin read at median 0.950 identity vs the Derge e-text on 65 Kangyur books; one draw is one point.

**Design.** Same instrument (`kanjur_align.py` on clawdbot, syllable alignment vs OpenPecha P000001; `nalanda-readiness/sample_tib_redraw.mjs`, `summ_redraw.py`), fresh seed 20261001, 100 Kangyur-titled BL books + 25 other BL + 15 prints, one interior served page per book, the 105 pages of the 09-30 draw excluded (41 books overlap, 0 pages). Controls re-run: +5% noise on e-text pages (n 50) and wrong-page shuffle over the sample. New field: the page's OCR line count against its book's median line count, a proxy for the dropped-line defect that order-free identity cannot see (09-25 by-eye finding).

**Controls first.** Noise control 0.968 (09-30: 0.968); chance 0.247 (0.252). Non-Kangyur BL 0.174 and prints 0.000, i.e. chance, as expected without a reference.

**Result.** Kangyur identity median **0.947** (IQR 0.904–0.972), 76/100 ≥ 0.9, 3/100 < 0.5 — against 0.950 (0.917–0.971), 53/65, 2/65 on 09-30. **Replicated.** Of the three < 0.5 pages, two have retrieval ≈ 0 (a Kālacakra commentary, a dkar-chag: texts the Kangyur e-text does not hold — off-index, not misread); one (0.44, normal retrieval) is a real low read. 99/100 pages are `bdrc-yigdzin-v1`; 42 carry `<leaf-break/>`.

**Dropped-line proxy.** 5/100 Kangyur pages have fewer OCR lines than their book's median (2 short by ≥ 2 lines). They score 0.888 median vs 0.949 for full-length pages — the identity number carries about half of that defect; the dropped-line rate itself is ~5% of pages, in line with 09-25's "first line of the lower leaf on some two-leaf pages".

*Replicated?* Yes — this IS the replication of 09-30 (n 65 → 100, no shared pages). *Artifacts:* `results/tibetan-ocr-redraw-2026-10-01/` (summary.json, scores, both controls, sample metadata without text); Hetzner `/root/tibetan-eval/redraw-2026-10-01/`. Spend €0 (CPU). Comment on #4523.

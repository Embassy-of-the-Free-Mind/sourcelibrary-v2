## 2026-10-06 · After gate 0: do Paddle (SKQS Chinese) and Yigdzin (Tibetan) invent text on the page TYPES a random gate under-samples, and can a $0 rule screen catch it? (#5660, job gpu-resume-5660)

PRIOR ART: gate 0 of the same job (`2026-10-06-gpu-ocr-backlog-engine-comparison-and-gate-0-5660.md`) is the run this continues. The write-time guards `scripts/lib/ocr-loop-guard.mjs` (#4850) and `scripts/lib/blank-page-guard.mjs` (#4149) are reused inside the new screen, `scripts/lib/first-ocr-guard.mjs`; the PRIOR ART line there explains why neither fits on its own.

**Question.** Derek, 2026-10-06, "do both recommendations" and "more tests". Gate 0 sampled random pages and found invention on both lanes: 1 Chinese page and 3 Tibetan pages. This run asks two things:
- Before the Chinese fleet scales, does Paddle invent text on blank, title, illustrated, table, damaged, seal, small-note or mixed-script pages?
- For Tibetan, which writes nothing, can a rules-only guard separate Yigdzin's inventions from genuine liturgical repetition?

Every quality number below is `measure: by-eye`: the page image was opened and read against the text, one page per book unless noted. Reference accuracy was not re-measured. The by-eye reads were done by Claude subagents, each given a batch of 10–20 pages with strict invented/not-invented rules. Verdicts with evidence are in `scripts/eval/results/gpu-resume-5660/`.

**Chinese (Paddle, fleet recipe on a Scaleway L4)**
- **Mixed-script exclusion.** 127 unread books / 19,038 pp are held. They were found by title, by Manchu/Mongol/Tibetan/Arabic characters in the stored preview OCR, and by series. `languages[]` gave no signal.
  - Of the books gate 0 already wrote, 3 are 清文鑑 volumes: 364 pages of Paddle text on Manchu–Chinese pages. Not reverted.
  - Lite's `<language>` tag invents "Manchu" on blank leaves, so a single tag is not evidence.
- **Stress canary**: 80 pages, 10 per type.
  - Invented in the raw read: blank 1/10 (a recited 卷一…卷十), tables 2/10 (loops), mixed-script control 6/10. Title, illustrated, damaged, seal and small-note pages: 0/10 each.
  - Small double-line notes (双行小注) stayed separate and in order on 10/10 pages.
- **Lane fix 1: `bodyHanCount`.** A read whose only Han text is margin marks is textless.
  - Re-test on 20 fresh blank leaves: 3 invented in the raw read, **0 written**. PASS.
- **Re-test on 16 fresh table pages: 4 invented, 2 refused by the loop guard, 2 would be written.**
  - A ○ ×1000s loop: ○ is a symbol, so the period guard cannot see it.
  - 16 calendar cells where 12 are printed.
- **Lane fix 2: refuse one-character runs over 40.**
  - 109 table-heavy works are held by title (16,643 pp).
  - Re-test 2 (tables inside prose books) could not run: no Scaleway GPU stock in any zone from 14:15Z.
  - **Chinese lane STOPPED for Derek**; the fleet was not resumed.
- **Already written by gate 0** (16,691 pages): 84 pages carry a strict loop flag. 5 of 14 checked by eye are invented, for example 之 on 43 lines in 佩文韻府, and the page header ×680 in place of a 康熙字典 page. That suggests ≈ 30 pages (≈ 0.2 %), concentrated in dictionaries. Reported on #5660, not reverted.

**Tibetan (Yigdzin shard 0, 3,634 reads the v4 judge would serve; nothing written)**
- **Guard rules:**
  - `punct_noise`, `dominant_unit` (≤ 150 syllables), `local_loop` (12 of any 30), `line_loop` (per line, with overrun);
  - `numeral_loop`, `repeated_line`, `exact_loop`;
  - `blank_leaf`: texture inside the detected leaf, not darkness of the frame.
- **Design steps that failed, kept as provenance:**
  - A page-level 3-gram rule flagged 20 %, mostly genuine Prajñāpāramitā lists.
  - Whole-frame ink: the measuring board counts as ink.
  - Darkness ink: red-on-grey woodblock reads as blank.
  - A connected-component leaf mask: it has holes exactly where the text is. This flagged 54/200 clean yigdzin-527 text pages until it was fixed to use the leaf's bounding box.
  - `sharp().blur()` on 1-channel input returns 3 channels.
- **Controls:**
  - positives 3/3 flagged;
  - 0 of 26 random by-eye-clean pages flagged;
  - 3 of all 99 clean labels flagged.
- **Fresh validation** (drawn after the rules froze):
  - flagged → invented **17/19 = 89 % [69–97 %]**;
  - unflagged → invented **2/21 = 10 % [3–29 %]**.
- **Random one-per-book draw:** invented and served, judge alone 10/36 = 28 % [16–44 %]; with the guard 1/36 = 3 % [0.5–14 %].
- **By page type** (judge alone → with the guard):
  - title 10/10 → 1/10
  - blank 6/6 → 2/6
  - illustrated 8/8 → 2/8
  - damaged 5/8 → 2/8
  - cursive 3/10 → 1/10
  - colophon 0/7 → 0/7
  - Yigdzin reads text leaves well. On a leaf with only a title or caption, it reads that line and then pads with filler or loops. It writes Tibetan for English front matter.
- **If adopted:** 3,434 of 3,634 pages written. Estimated residual ≈ 6.5 % carrying some invented text, mostly short tails, CI wide.
- **yigdzin-527's written output** (200 pages, one per book): 1 flagged, and that page is invented by eye: Mongolian lines in a glossary served as a loop.
- **Tibetan lane STOPPED for Derek** per the brief.

**Cost.**
- GPU **€0.60** (3 L4 runs; the out-of-stock creates never ran). Running total €12.31 of €260. Gemini $0.
- Every box was deleted and confirmed gone on Scaleway: no `*5660*` server or unattached volume in any zone. No RunPod pods.

**Held.**
- Chinese: 3,479 books (`gpu-backlog-5660`). Tibetan: 1,054 books.
- No translation was queued.

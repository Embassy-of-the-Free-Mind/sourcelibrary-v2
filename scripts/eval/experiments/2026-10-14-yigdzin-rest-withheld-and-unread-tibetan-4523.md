---
stage: ocr
measure: none
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 1296
n_pages: 82193
verdict: "Yigdzin read 82,193 withheld or unread pages on live Tibetan books; 76,197 passed v4 + first-ocr-guard + 150 syllables and are written, 0 invented in 15 opened against the image, €24.68 GPU."
status: adopted
decision: "Scope matcher takes the Gemini Flash family and the gate treats Indic letters as neutral (PR #6709); 76,197 pages served from Yigdzin (run yigdzin-leaf-2026-10-14-rest)"
superseded_by: null
issue: 4523
---
## 2026-10-14 · Yigdzin read of the Tibetan pages the earlier runs missed: 76,197 of 82,193 written (#4523, job yigdzin-rest-4523)
<!-- PRIOR ART: 2026-10-04-tibetan-lite-vs-yigdzin-4523.md (yig527): same worker, model, judge and apply. That run selected BOOKS with no Yigdzin page; this one selects PAGES, which is what it missed. The write rule is #5660 shard 0's (2026-10-10). -->

**Question.** Which pages on live Tibetan books still serve no Yigdzin read? Read them with the yig527 recipe,
and write only what passes the 2026-10-10 rule.

**Frame.** 1,697 live Tibetan books, 428,825 pages (`language: Tibetan`, visible, `pages_count > 0`), counted 2026-10-13/14.
- **(a)** 79,409 pages are withheld (`ocr.unreadable`) and carry a Gemini Flash-family read: 60,101 lite-preview,
  19,293 `gemini-3-flash-preview`, 15 `gemini-2.5-flash`.
- **(b)** 4,699 pages have no OCR.
  - The brief's "~142K with no OCR" counted pages with no `ocr.model`. 137,535 of those carry the **Esukhia Derge
    Tengyur/Kangyur typed e-text** (`ocr.source: esukhia-derge-*`), and 130,164 of them are translated. They are
    reference text, not unread pages, and stay out of scope.

**Why yig527 missed them.**
1. `scope.mjs` picked books held under the #4523 holds that had no Yigdzin page at all. A page in a book with some
   Yigdzin pages, or in a book under a later hold, never entered the todo.
2. Its matcher took one label. #6146 added the lite `-preview` stamp, but `gemini-3-flash-preview` stayed out.
3. Its page script gate left Indic letters out of the count. Lite's invented Devanagari (and Balinese, Khmer,
   Sinhala…) on BL cursive then disappeared, and the English commentary around it gated **3,083** pages as Latin.
   With Indic letters counted as neutral mass, 807 are gated.

Items 2 and 3 are fixed in PR #6709 (`isGeminiFlashModel`, `scriptGate`) with unit tests. `scope-rest.mjs` selects
pages directly.

**Skipped before any read** (a / b):
- Book not held: 486 / 219. A write would create an untranslated page in an unheld book, gap-fill would translate
  it, and that was not approved.
- Book held by another lane: 48 / 71 (`qa-enrich-1007`, `tengyur-import-5497`, `title-leaf-recitation-6297`, `kangyur-import`).
- Script gate: 807 / –. Book script gate: – / 75.
- yig527 exclude list: – / 35. Prior Yigdzin REJECT: – / 44.
- `blank` type: 99 / –. Non-positive page number: 27 / –.

**Recipe.** Unchanged from yig527:
- `yig_leaf_worker.py` per leaf, BDRC/tibetan-ocr `50506eb6`, vLLM 0.29.0;
- v4 judge against an empty reference;
- then `guard.mjs`: write only if `first-ocr-guard` does not flag the page **and** it has ≥ 150 syllables;
- `apply-reocr-verdicts --model=bdrc-yigdzin-v1 --read-mode=leaf --leaf-ledger`, which snapshots the old OCR to
  `page_revisions` before it overwrites.

The run used a 500-page pilot first, then 4 × L4-1-24G (fr-par-1, pl-waw-2). Each box was leased via
`gpu-lease-watchdog` (`idle-stop on mongo:bdrc`) and ran under `idle-poweroff.sh`. The tender cap was €63.

| | (a) withheld Gemini | (b) no OCR |
|---|---|---|
| read | 77,938 (4 skipped by the worker) | 4,255 |
| v4 reject | 1,678 (1,443 duplication, 184 validity drop, 51 loop) | 112 (67 / 37 / 8) |
| guard refuse | 1,567 (998 local_loop, 214 punct_noise, 193 line_loop, 122 dominant_unit, 30 repeated_line, 8 numeral_loop, 2 blank_leaf) | 78 |
| < 150 syllables | 2,467 | 94 |
| **written** | **72,226** | **3,971** |

**Checked in Mongo after the run**, over 1,296 books:
- 76,197 pages carry `ocr.engine.run = yigdzin-leaf-2026-10-14-rest`.
- 0 hold changes, 0 `visible` changes, 0 pages with a translation, 0 left `unreadable`.
- All 72,226 scope-(a) pages have their Gemini read in `page_revisions` (`reocr_bdrc_4523`).
- Refused pages stay as they were: withheld in (a), empty in (b).

**By eye**, 15 written pages (`read-from-image`): 10 in the pilot, including the 2 shortest at 152 and 154 syllables;
4 mid-run; 1 from the last batches.
- **0 invented, 0 wrong-leaf.**
- **11 clean or minor.** The minor ones have noisy interlinear glosses or a stray `I`.
- **2 drop a near-empty leaf.** In a three-leaf frame, a leaf that carries only a title line is skipped. That is an
  omission, not invention, and the guard cannot see it.
- The sample was drawn at random from written pages. n = 15 bounds the invented rate below about 20 % (95 %), no
  tighter. The #5660 guard measurement (unflagged long pages 5 % [2–13 %] invented) is the better rate estimate
  for this rule.

**Spend.**
- GPU **€24.68**: 31.33 L4-h at €0.7875, pilot 0.34 h + boxes 8.14 / 7.88 / 7.62 / 7.36 h. The estimate was €55
  and the cap €65. Gemini $0.
- Read rate 0.73–0.97 pages/s per L4, against 1.7 in yig527: these are mostly multi-leaf BL cursive frames.
- All 5 servers and their volumes are deleted (API GET 404). No unattached volume is left in any zone.

**Not run: hidden Tibetan books.** 638 books. After the same skips (19,835 pages sit in excluded books such as the
Taishō), 24,929 pages in 478 books are withheld-Gemini or empty. That is about €7–9 at this run's rate. Left for a decision.

Files: `scripts/eval/results/yigdzin-rest-4523/summary.json`, plus `page-outcomes.jsonl.gz`, one row per in-frame
page with its outcome. Tooling: `scripts/eval/tibetan-lite-vs-yigdzin/{scope-rest,guard}.mjs`, and
`judge.py` / `tend.py` / `box.sh` parametrised by `YIG_DIR` / `YIG_RUN` / `YIG_NAME` / `YIG_EUR_CAP` / `YIG_GUARD`.

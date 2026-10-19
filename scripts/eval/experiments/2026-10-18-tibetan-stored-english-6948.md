---
stage: translation
measure: judged_vs_source
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: 40
n_pages: 40
verdict: "pending"
status: undecided
decision: null
superseded_by: null
issue: [6948]
---
## 2026-10-19 · Is the Tibetan English already on the site good enough, or must it be re-translated first? (#6948)

PRIOR ART: `2026-10-18-tibetan-translator-85k-6948.md` (#6957: the 60-page blind test that chose Gemini 4 Argon low for
the untranslated pages; its harness `scripts/eval/tib-translator-6948/` is reused: `requests.mjs`, `run-agy.sh`,
`screen.mjs`, `judge-driver.sh` unchanged but for the job name and scratch path, `build-packet.py` and `score.py`
re-stated for these arms). #6957 judged only pages with NO English; this run judges the stored English that readers
are served now. Scripts: `scripts/eval/tib-stored-6948/`.

### Preregistration (committed and pushed before any arm runs)

**Frame** (`frame.mjs`, Mongo read 2026-10-19 05:36Z). Pages on public Tibetan books (`language` starts "Tibetan",
`visible: true`, `pages_count > 0`) that serve English: `translation.data` non-empty, `translation.model` one of the
two cohorts, `translation.updated_at` ≥ 2026-10-05. Out: `ocr.unreadable`, cover/blank pages, and pages withheld for
`ocr_unreadable` (33), `source_loop` (1,380) or `invented_by_eye` (4). A page with English and a withheld marker
still serves the English (`src/app/book/[id]/read/page.tsx`), so 9,752 such pages are in.

| cohort | frame pages | books | what it is |
|---|---|---|---|
| **S38** `gemini-3.8-flash-low` (agy, #6361, 2026-10-10..11) | 23,621 | 37 | Derge Tengyur typed text, Pramāṇa + Madhyamaka volumes |
| **S3P** `gemini-3-flash-preview` (paid batch, 2026-10-05..11) | 21,648 | 56 | 11,634 Derge Tengyur (28 vols: medicine, grammar, miscellanea, catalogue, tantra commentary) + 10,014 Yigdzin manuscript pages (28 books) |

That is 45,269 pages, against the brief's ~51K (counted at another hour, and before the out-reasons above).

**Sample** (`sample.py`, seed 6948). Per cohort: the frame pages sorted by page id, shuffled with `random.Random(6948)`,
walked; a page is taken if its book is not taken yet and its transcription has ≥ 150 Tibetan syllables (#6957's
`syls`). Stop at 20. Result: S38 20 Derge Tengyur pages from 20 volumes; S3P 10 Derge Tengyur + 10 Yigdzin pages.

**Arms** (one page each, the transcription in `ocr.data` as the source):
- **STORED**: the English in `pages.translation.data`, verbatim, as served. All 40 carry prompt v13. S38's were made
  one page per call with no context; 8 of S3P's 10 Yigdzin pages were made in 8-page batch blocks with neighbour
  context (recorded in `translation.engine.input.context`). The fresh arms get no context.
- **G4L**: `gemini-4-argon-low` via `agy -p`, #6957's request byte for byte (`requests.mjs`: live v13 prompt,
  `buildTranslationPrompt`, `PAGE_BREAK_SCOPED`, one page) and #6957's runner (`run-agy.sh`: plan mode, 300 s,
  2 attempts, screen and one re-read, ≤ 500 agy calls/day).
- **OP**: Opus via `claude -p --model opus` on the Claude subscription (`claude-arm.py --sealed`), the same request
  plus #6545's marker suffix, one page per call, as #6957. Never through agy.

**Judges.** Two blind Opus judges (`claude -p --model opus`, subscription), #5695's `JUDGE-PROMPT.md` unchanged
(the #6957 prompt). Candidates shuffled and labelled T1–Tn by seed. **No 84000 reference**: 84000 has published
little of the Tengyur, and #6957's cut was built for Kangyur pages; every item carries #6957's no-reference note and
the judge reads the Tibetan. The rubric is text-only, as in #6957 (no page image). J2 reads in another order and
partition. Controls: **8 PLANT** (STORED beside a copy with one planted reversal, `tengyur-characterize/plants.mjs`)
and **4 DUP** (STORED, an identical copy, and G4L).

**Judge gate** (`score-xl.judge_gate`, unchanged): plants caught ≥ 6 of 8, duplicates tied ≥ 3 of 4. Only passing
judges score; if neither passes, no verdict.

**Measures** (per cohort, on the pages all three arms have): mean fidelity 1–5 (mean of the scoring judges) with
by-book bootstrap 95% CI (2,000 draws, seed 6948); STORED − G4L and STORED − OP with CI and pages higher/lower;
reversal pages (either judge / both judges) with quoted spans; omission, invention, unreadable-fill and span-off
pages.

**Decision rule** (the brief's), per cohort:
- **RE-TRANSLATE** if STORED's mean fidelity is ≥ 0.30 below G4L's (STORED − G4L ≤ −0.30, point estimate), **or**
  STORED has reversal pages (either judge) on more than 10% of its scored pages (> 2 of 20) with at least one of
  them listed by both judges.
- Otherwise **KEEP**, and translate the untranslated pages first.

Budget: $0. agy (Google subscription) and the Claude subscription only. Nothing is written to `pages` or `books`.

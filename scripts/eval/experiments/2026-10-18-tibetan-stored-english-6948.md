---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: 40
n_pages: 40
verdict: "Stored 3.8 Flash English on the Tengyur Pramāṇa/Madhyamaka (23.6K pages) scores 4.30, 0.13 ABOVE Argon, 0 reversals: KEEP. Stored 3-flash-preview English (21.6K pages) scores 3.58, 0.88 below Argon [−1.15, −0.60]: RE-TRANSLATE. Argon reverses a negation on 4 of the 20 Pramāṇa/Madhyamaka pages."
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

### Result (scored 2026-10-19 06:05Z, `tib-stored-6948/score.py`)

**S38 (3.8 Flash, Tengyur Pramāṇa + Madhyamaka): KEEP. S3P (3-flash-preview, paid batch): RE-TRANSLATE.**

**Judge gate: PASS.** J1 caught 7 of 8 planted reversals and J2 caught 8 of 8. Both tied 4 of 4 duplicates. Both
judges score. Their fidelity scores agree within 1 point on 98.3% of page × arm pairs. Judging ran 05:47–06:01Z in
18 parts, with no failures and no limit waits.

**n = 40 pages, 40 books, one page per book, 2026-10-19.** Every arm has every page: G4L 40 of 40 (41 agy calls,
median 21 s), OP 40 of 40 (median 31 s), with no failed reads. Fidelity runs 1–5 and is the mean of both judges.
Intervals are by-book bootstrap 95%. "Reversal pages" counts pages where either judge listed a reversal; the
both-judges count is in brackets.

| cohort | n | STORED | G4L (Argon) | OP (Opus) | STORED − G4L | STORED − OP | reversal pages STORED / G4L / OP | rule |
|---|---|---|---|---|---|---|---|---|
| **S38** 3.8 Flash, 23,621 pages | 20 | **4.30** [4.05, 4.55] | 4.18 [3.88, 4.48] | 4.68 [4.50, 4.85] | **+0.13** [−0.18, +0.45] (6 higher, 4 lower) | −0.38 [−0.65, −0.13] | 0 (0) / **4 (3)** / 1 (0) | **KEEP** |
| **S3P** 3-flash-preview, 21,648 pages | 20 | **3.58** [3.35, 3.80] | 4.45 [4.25, 4.63] | 4.70 [4.48, 4.88] | **−0.88** [−1.15, −0.60] (0 higher, 15 lower) | −1.13 [−1.40, −0.85] | 1 (1) / 0 / 1 (0) | **RE-TRANSLATE** |
| S3P: Derge Tengyur pages | 10 | 3.85 [3.50, 4.10] | 4.40 [4.15, 4.65] | 4.75 [4.50, 4.95] | −0.55 [−0.85, −0.25] | −0.90 | 0 / 0 / 0 | (descriptive) |
| S3P: Yigdzin manuscript pages | 10 | 3.30 [3.05, 3.55] | 4.50 [4.20, 4.75] | 4.65 [4.30, 4.95] | −1.20 [−1.55, −0.85] | −1.35 | 1 (1) / 0 / 1 (0) | (descriptive) |

**What the rule says:**
- **S38:** STORED − G4L is +0.13, so the gap trigger does not fire. STORED has 0 reversal pages of 20, so the reversal
  trigger does not fire either. The verdict is **KEEP**.
- **S3P:** STORED − G4L is −0.88, which is ≤ −0.30, so the gap trigger fires. STORED has 1 reversal page of 20, which
  is below the reversal threshold. The verdict is **RE-TRANSLATE**.
- The S3P result does not rest on the manuscript pages alone. On S3P's 10 Tengyur pages, which had no batch context
  and no page-boundary problem, STORED − G4L is −0.55 [−0.85, −0.25]. That gap also crosses the −0.30 line.

**Why the stored S3P English is worse** (from the judges' defect lists; the boundary cases were checked by this job):
- **The Yigdzin pages are shifted by part of a page.** 9 of the 10 Yigdzin pages were translated in 8-page batch
  blocks with neighbour context. On 6 of them the judges mark the span off, and 8 S3P pages are marked for omission.
  This job read the neighbouring pages' stored English for five of them:
  - The "missing" openings are at the end of the previous page's English. On T001 that is the Avīci sentence, on T037
    the sun stanza, and on T038 "some flay-".
  - The "added" endings complete a sentence that runs onto the next page (T041, T032).
  - A reader going page by page loses nothing. A reader who quotes or cites one page gets English that does not match
    its Tibetan.
- **Mistranslation, grammar and names on the Tengyur pages.** In a grammar volume, the root ཁད is rendered as
  "khād", and its optional forms are garbled. In a ritual text, the placement of the left and right hands is merged.
  Names are misread, for example "Drakpa Dorje" for སྙན་གྲགས་རྡོ་རྗེ.
- **The one reversal page (T024, a maṇḍala, both judges).** Embracer and embraced are swapped. The Tibetan
  རེག་བྱ་རྡོ་རྗེ་མ་སྒྲིབ་པ་རྣམ་སེལ་གྱིས་འཁྱུད་པ is "Sparśavajrā embraced by Sarvanivaraṇaviṣkambhin". The stored English has
  "Sarvanivaranavishkambhin embraced by Sparshavajra". In the same way, གོས་དཀར་མོ་འོད་དཔག་མེད་ཀྱི་འཁྱུད་པ has become
  "Amitabha embraced by Pandaravasini". The same page also drops "Tārā embraced by Vairocana, in the southeast".

**Argon's reversals on the Pramāṇa/Madhyamaka pages** (S38, 4 pages, 3 of them listed by both judges). Each one
flips a negation in a logical argument. This job checked them against the quoted Tibetan:
- **T022:** དེའི་ཁྱད་པར་ནི་མི་འཁྲུལ་པའི་གོ་བར་བྱེད་པ་ཡིན ("its particular feature IS an unmistaken indicator") became "their
  particularity is NOT an unmistakable indicator". Confirmed.
- **T048:** རྣམ་པར་ཤེས་པ་རྟག་པའི་ཡུལ་སྒྲ་ཡང་ཡོད་པ་མ་ཡིན་པའི་ཕྱིར ("because even sound, the object of a permanent
  consciousness, does NOT exist") became "would not be nonexistent". Confirmed.
- **T012:** ཚངས་པར་སྤྱོད་པ་ལ་གནས་པ་མ་ཡིན་པ་ཡང་ཚངས་པར་སྤྱོད་པ་ལ་གནས་པའི་སྐྱོན་དུ་ཐལ་བར་འགྱུར ("the one NOT living the pure life
  would absurdly be [counted] as living it") became "not abiding … would absurdly fall upon one who actually abides".
  Subject and predicate are swapped. Confirmed.
- **T003:** one judge only (J2). Not checked.

The stored 3.8 Flash English has none of these on the same 20 pages. **Re-translating S38 with Argon would make it
worse.** Opus is 0.38 above the stored English there, but Opus is a check, not a lane.

**Pace for the RE-TRANSLATE cohort.** S3P is 21,648 pages. At #6957's measured 1.02 agy calls per page and 500 calls
a day, Argon takes about **44 days**. Those days come out of the same agy cap as the ~80K untranslated pages, about
162 days at that pace. 41 calls for 40 pages here confirms the 1.02.

**Limits:**
- The judges are AI (Opus), not readers of Tibetan, and there was no human reference. Nine passages were checked by
  this job against the Tibetan and the neighbouring pages: the three confirmed Argon reversals, the stored reversal,
  and the boundary cases.
- n = 20 per cohort. The S38 CI on STORED − G4L, [−0.18, +0.45], does not exclude a small Argon lead. It does exclude
  the 0.30 deficit the rule asks about.
- The judges are Opus, and so is one arm, so OP's lead may be partly same-family preference. That does not touch
  STORED vs G4L, which are both Gemini.
- S38 is only Pramāṇa and Madhyamaka. Argon's negation flips there say nothing about the Kangyur and manuscript pages
  #6957 measured, where it had 0 reversals in 59 pages. They do say Argon should not be put on the Tengyur logic
  volumes unchecked.
- The fresh arms got no neighbour context. 9 of S3P's stored pages had it. That favours the stored English on
  meaning, not on span.

Files:
- `scripts/eval/results/tib-stored-6948/{key.json,scores.json}`. These hold numbers and labels only, plus the plant
  sentences, which come from English already public on the site.
- `scripts/eval/tib-stored-6948/` holds the frame, sample, fetch, packet and score scripts.
- #6957's `run-agy.sh` and `judge-driver.sh` now take `JOB` and `W` from the environment, with the old defaults.
- The arm outputs and judge packets stay in `$JOB_SCRATCH` on the job box (`/data/scratch/sl/jobs/tib-stored-6948`).
- Nothing was written to `pages`, `books` or any production store. Cost: $0.

**DECISION per cohort:**
- S38 (gemini-3.8-flash-low, 23,621 pages): **KEEP**.
- S3P (gemini-3-flash-preview, 21,648 pages): **RE-TRANSLATE**.

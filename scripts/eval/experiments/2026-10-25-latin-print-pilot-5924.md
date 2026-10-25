---
stage: ocr
measure: accuracy
languages: [la]
scripts: [Latn]
canons: []
n_books: 150
n_pages: 300
verdict: "On the UNREAD Latin print backlog, flash-lite on the live production prompt (v19.1) reads roman, italic and mixed roman/italic type at a median 1.2–1.8% CER (view N) against a blind single Opus read, but gothic type at 12.2% (CI 9.2–14.6), with 45 of 49 gothic pages judged misleading and 8 of 100 gothic pages looping to the token cap. The long-s pass changes nothing measurable at the median under the production prompt (Δ 0.00, CI [0,0]): that prompt already writes 78% of ſ as plain s. Measured price is $3.07 per 1,000 pages synchronous, about 2× the figure the $5.4K estimate used."
status: undecided
decision: "Derek (#5924): the ~$5.4K lite lane. Gothic: do not buy lite. Roman/italic: lite is a usable first draft (about 30% of pages carry at least one meaning-changing error); re-cost the lane before deciding."
superseded_by: null
issue: [5924]
---
PRIOR ART: `2026-10-22-latin-longs-pass-5924.md` (the pass, measured on the 99 latin-refs-5924 pages, which hold only 4 gothic pages and read lite on the bake-off's GENERIC prompt); `scripts/eval/latin-bakeoff-5924/longs-prompt-arm.mjs` (arm L0, the live prompt, used UNCHANGED for the paid reads); `scripts/eval/latin-refs-5924.mjs` + `latin-refs-5924/prompt-transcribe.md` (the reference convention and crop rule, used for a single blind pass A); `scripts/eval/latin-bakeoff-5924/score.mjs` (run unchanged from a mirror directory); `scripts/eval/g4-reread-pilot-6769/judge.py` (the sealed `claude -p` call the Opus driver copies). Nothing in scripts/eval reads the UNREAD backlog, or sorts it by typeface from the page.

## 2026-10-25 · How well does the production lite lane read the unread Latin print backlog, by typeface, and does the long-s pass help? (#5924)

**Gothic: no. Roman and italic: it is a usable first draft, and the long-s pass adds nothing measurable at the median.**
On 150 never-read Latin books, flash-lite on the live prompt misreads gothic type at about 1 letter in 8.
Its gothic text changes the sense on almost every page.
On roman, italic and mixed type it is close to the 99-page reference set, about 1.2–1.8% median CER.
About 3 pages in 10 still carry at least one meaning-changing error.
The pass halves ſ written as f, but production's prompt already writes most ſ as s, so median page CER does not move.

### Design
- **Frame.** Books with `language` ~ Latin, `pages_count` ≥ 12, not `duplicate_of`, first year in `published` 1450–1800, `pages_ocr` 0.
  - That is 18,855 books: 883 / 5,686 / 8,036 / 4,250 in the 1400s / 1500s / 1600s / 1700s.
  - Each drawn book was re-checked: no page with `ocr.data`.
- **Draw** (`draw.mjs`, Mulberry32(1025), the latin-refs-5924 rules).
  - 420 books, seeded per century (90 / 150 / 120 / 60).
  - Per book, up to 4 seeded body leaves, from index [0.15n, 0.9n), with no split crop.
  - The image is `getPageSource`, the one the pipeline reads. Leaves only on a day-rationed host (BSB / Vatican) were skipped: 37 books.
  - e-rara and Gallica leaves with no R2 copy answer 403 to this box: 38 books dropped. The pipeline would not read them before archiving either.
- **Typeface, by eye.** The first leaf of each of 382 books was cropped and sheeted (32 contact sheets), and I sorted every crop by eye.
  - Result: roman 184, gothic 73, italic 58, mixed 27, manuscript 10, other 30.
  - **Confirmation.** The blind reference reader recorded each judged page's body type. Of the 49 pages screened gothic, it called all 49 gothic (one more was rejected as an index). It called one page screened roman gothic.
  - Italic and roman split more finely: 13 of 49 screened-italic and 21 of 50 screened-roman pages were mixed roman/italic. Tables below use the **observed** type.
- **Pilot.** 50 books per screened type. Gothic: 39 from the 1400s and 11 from the 1500s. Italic: 37 / 11 / 2 from the 1500s / 1600s / 1700s. Roman: 10 / 15 / 15 / 10 across the four centuries.
  - Two leaves per book: **300 pages**.
  - Pages read, by screened type and century:
    - gothic 78 (1400s) + 22 (1500s);
    - italic 74 (1500s) + 22 (1600s) + 4 (1700s);
    - roman 20 / 30 / 30 / 20 (1400s–1700s).
- **Reads.** `longs-prompt-arm.mjs --arm L0`, unchanged.
  - gemini-3.1-flash-lite, live prompt v19.1 (sha 34f12611…), temperature 0, thinking 0, 16,000-token cap.
  - Each image is fed exactly as the pipeline feeds it: fit to 1,500 px, JPEG q80 above 100 KB.
  - 299 of 300 pages read; 1 failed on a Gemini 503 and was not retried, to stay under the cap.
- **Long-s arms.** LP is `applyLongS` (scripts/lib/longs-orthography.mjs, the pass as wired for the sweep) on the raw tagged text. LPr is the raw #7174 pass.
  - The model was rebuilt from `corpus-books.txt`: 130,511 pages against 130,520 at #7174.
  - On the 99 bake-off L reads it reproduces #7174's LP output byte for byte on 90 pages, and differs by 11 characters on the other 9.
- **References.** One blind Opus 5.5 read per book, of the screened leaf only (one page per book).
  - It follows latin-refs-5924's pass-A prompt and convention@1: full view plus overlapping bands, from the original leaf. `claude -p` on the subscription: $0.
  - 148 of 150 were accepted. Two were rejected: a concordance index and a title page.
- **Scorer.** `latin-bakeoff-5924/score.mjs`, unchanged: view N (primary), view D, and ſ outcomes. **Measure: accuracy against a single model read.**
- **Judge.** A second, separate Opus call per page, with the image and the lite text. It counts words lost or invented by class and gives a verdict: misleading / flawed / sound.
  - The classes are omission, side-note loss, invention, column read-across and meaning-changing wrong word.
  - Orthography (ſ/f/s, u/v, abbreviations) is excluded, because CER covers it.
- **Calibration line.** The same scorer and judge were run on the 99 latin-refs-5924 pages, using the stored L0 reads (same model, same prompt sha), at $0.

### Calibration (99 reference pages, lite L0)
| reference | L median N % (CI) | LP | LPr |
|---|---|---|---|
| final (Opus ×3, adjudicated) | 1.78 (1.18–2.74) | 1.46 | 1.34 |
| pass A alone (one blind read) | 1.64 (1.17–2.74) | 1.39 | 1.33 |
| pass B alone | 1.78 (1.17–2.68) | 1.47 | 1.31 |

- **A single blind read moves the median by no more than 0.14 points**, so the pilot's single-read references are good enough for medians. They still measure accuracy against a model read, not against a human.
- **The judge's verdicts follow CER** (calibration median CER): sound 0.6%, flawed 1.4%, misleading 7.9%.
- The judge calls 30 of 99 calibration pages misleading (CI 22–40%). The judge and the reference reader are both Opus: single-family, with no human check.

### Results by observed typeface (one page per book)
| type | n | L median N % (CI) | LP | Δ LP−L (CI), W/L | ſ→f per 100 words L → LP | misleading (judge) | omission / invention / wrong word per 100 words | other |
|---|---|---|---|---|---|---|---|---|
| **gothic** | 50 | **12.2 (9.2–14.6)** | 12.2 | 0.00 (0, 0), 16/3 | 2.26 → 1.14 | **45/49 (81–97%)** | 7.5 / 17.2 / 2.4 | 3 catastrophic; 4 column read-across |
| italic | 36 | 1.54 (1.03–1.94) | 1.49 | 0.00 (0, 0), 7/0 | 0.58 → 0.49 | 10/36 (16–44%) | 0.4 / 0.9 / 0.6 | — |
| roman | 28 | 1.76 (1.28–3.87) | 1.75 | 0.00 (−0.08, 0), 12/0 | 0.89 → 0.49 | 9/28 (18–51%) | 5.5\* / 58\* / 0.8 | 1 loop page |
| mixed roman/italic | 34 | 1.24 (0.70–2.68) | 1.20 | 0.00 (0, 0), 8/0 | 1.81 → 0.69 | 10/33 (17–47%) | 0.2 / 1.1 / 0.5 | — |
| all | 148 | 3.23 (2.15–4.29) | 3.08 | 0.00 (0, 0), 43/3 | 1.69 → 0.85 | 74/146 (43–59%) | 4.7 / 18.3 / 1.5 | — |

\*Roman's pooled omission and invention rates are one page: a 1400s Cicero commentary that loops for thousands of words.
Its median page has none. 12 of 28 roman pages have any omission and 5 have any invention.

**By century** (median N %, then misleading pages):
- 1400s: 9.5%, 39/47 misleading. This century holds 39 gothic and 10 roman books.
- 1500s: 2.1%, 27/63.
- 1600s: 1.2%, 7/24.
- 1700s: 0.6%, 1/12.

**What goes wrong, by type**
- **Gothic.** Wrong words appear on almost every page (46 of 49), and they change the sense.
  - By eye, page `6ac51f1e…`, which sits at the median: the print *premeruit diuinitus* becomes *premeret duritias*. *Debet tñ mens sui* becomes *Debet enim mens sua*. *p simeonē* becomes *primum*.
  - Omissions: whole lines dropped on 31 of 49 pages.
  - Invention:
    - the edge of the facing leaf read in as a `<margin>` on 12 pages;
    - loops on 6 pages;
    - 8 of the 100 gothic reads ran to the 16,000-token cap, against 1 of 199 other reads.
  - Two-column leaves are read across on 4 pages.
  - The pass cannot help gothic. Lite writes 66% of gothic ſ as s, and 9% as f. The pass halves the f (596 → 300) and adds 13 false ſ, so the median does not move.
- **Roman, italic and mixed.** About 3 pages in 10 are misleading, the same rate as the 99-page calibration set. The causes:
  - a few meaning-changing misreads per page. Abbreviated case endings, numerals (CC read as C) and Greek words are the commonest;
  - the facing-page strip read in as side-notes (9 pages across the three types);
  - the occasional dropped line.
- **Production lite writes ſ as plain s, not f.** Of 12,584 reference ſ, it gives 78% as s and 7% as f; the generic prompt gave mostly f.
  - So view N barely sees ſ, and the pass, built against the generic prompt's f habit, has little left to fix here.
  - Most of its 43 wins are a few letters; the 3 losses are its 13 false ſ, all gothic.
- **lite `<script>` never says gothic.** The tag reads `printed` on 88 of 100 gothic pages.
  - The pass's `pageScriptVerdict` gate therefore cannot keep gothic out.
  - Only the sweep's pre-1501 year gate does, and it lets the 1500s gothic books through.

### Price, measured
- **Spend:** $0.9172 in total, from `gemini_usage` (Supabase): 337 rows, 1,286,938 input and 396,956 output tokens, endpoint `scripts/eval/latin-bakeoff-5924/longs-prompt-arm.mjs`, from 2026-10-25T18:40Z.
- **That is $3.07 per 1,000 pages synchronous.**
  - The prompt and a 1,500 px image are about 4,300 input tokens a page.
  - Output averages 631 tokens on italic, 917 on roman and 2,431 on gothic (loops).
  - The 9 capped pages are 24% of the spend.
- **The $5.4K lane estimate** used $0.71 per 1,000 pages on Batch, measured on the generic prompt.
  - At Batch's half price, the production prompt is about $1.0–1.2 per 1,000 roman or italic pages and about $2.4 per 1,000 gothic pages.
  - 1500s + 1600s (7.65M pages) therefore cost about **$8–9.5K**, not $5.4K.

### Not shown
- **The reference is a single blind Opus read, not ×3 or human.** The calibration says this costs ≤ 0.14 points at the median. The judge is Opus too.
- **Grades by books per type:**
  - gothic 50: decision grade;
  - italic 36, mixed 34, roman 28: directional or exploratory;
  - the non-gothic pool, 98 books, was not registered in advance as a pool.
- **One run, no A-vs-A arm.** Lite at temperature 0 is byte-stable (#5700).
- **Frame gaps:**
  - the 37 BSB/Vatican-only books and 38 unarchived e-rara/Gallica books;
  - the gothic share of the backlog's pages is not measured. Gothic was 73 of 382 screened books: 62/90 in the 1400s and 11/150 in the 1500s.
- **No preregistration.** This pilot was run as a default taken for Derek's decision.

*Artifacts* (job scratch `defaults-data-1025/latin-pilot/`):
- **Draw:** `draw.mjs`, `candidates.json`, the typeface screen (`sheets/`, `book-types.json`), `selection.json`.
- **Reads and arms:** `reads/L0.jsonl` with its run record, and the arms in `arms-pilot/`.
- **References:** `ref-A.jsonl` (raw), served from `mirror-pilot/benchmark/`.
- **Judge:** `judge.jsonl`, prompts `prompt-transcribe-single.md` and `prompt-judge.md`, driver `opus-run.mjs`.
- **Scoring:** `prep-score.mjs`, `analyze.mjs`, `report.json`, `results-*.json`.

No writes to `pages`, `books` or any production store.

## Design, fixed before any output is judged (job fable-frontier-93, l7a)

**Pages (103, one per book).** Drawn by `scripts/eval/fable-frontier-93/draw.mjs` (seeded, read-only): visible books with pages (`visible: true && pages_count > 0`), an interior page (10–90% of the book) that passes `isTranslatablePage`, has an image, at least 300 letters of OCR in the expected script (Chinese: 150 Han) making up at least 60% of its letters, and a stored English translation. The v2#6545 books and every book sharing a `work_id` with one are left out.

- **No known English translation.** A book is left out when our own stores say it has one: `prior_translation`, `translation_verification` (has_english_translation or a listed translation), or a `first_translation_attempts` row that found one (`found`, `not_first`, or any `priors[]`). Books with a "none found" search were drawn first; books with no evidence either way only if a language ran short. **All 103 drawn pages come from "none found" books; 0 are untold.** A "none found" search is not proof: some drawn books are editions of famous works (a Greek Gospels manuscript, Patrologia Graeca, Mikraot Gedolot, Hou Hanshu). I will mark those by eye and report the result with and without them.
- **Persian ran short.** Only 7 eligible Persian books hold a stored translation outside v2#6545 and the known-translated books, so the other four languages took 24 each: **Persian 7, Sanskrit 24, Classical Chinese 24, Greek 24, Hebrew 24.**
- What the pages are: mostly Siku quanshu volumes (Chinese), jyotiṣa manuals (Sanskrit), Hebrew manuscripts and Kabbalah, Greek papyri, patristics and lexica. The stored translations are Gemini (3 Flash 49, 3.1 Flash-Lite 34, 3.8 Flash 18) and 2 Opus.

**Arms.** Text only, on the production prompt each page gets today: `buildTranslationPrompt` with the page before's stored English, the neighbours' OCR and `PAGE_BREAK_SCOPED`, then `TRANSLATE_SUFFIX` (the marker suffix), built the way `cli-translate.mjs read` builds it (`requests.mjs`). All 103 pages got Standard Translation v21. The call is the live Claude lane's (`claude-translate.mjs`: `--restricted --tools "" --strict-mcp-config --no-session-persistence`) plus `--disable-slash-commands`, on the team@ subscription, one page per call. (The live Opus lane batches 10 pages a call; this test does not.)

| arm | what |
|---|---|
| LIVE | the stored translation (the baseline) |
| OPUS2 | `claude-opus-5-5 --effort medium` |
| OPUSX | `claude-opus-5-5 --effort xhigh` |
| FABLE | `claude-fable-5-2 --effort high` |

Each reply's `modelUsage` is checked against the model asked for. A declined, empty or failed page counts as an outcome for that arm (worst score on that page in the paired comparison), and is not dropped.

**Judges.** `judge.mjs`'s `judgePrompt`, unchanged (accept, fidelity 1–5, defects typed with the page-error taxonomy and a severity). Blind, one output per call, the page image attached, the transcription given. Two judges on every item: **Opus 5.5 and Fable 5.2.** Both are Claude-family, as are three of the four arms. I will report their agreement (Krippendorff's alpha on fidelity) and whether each judge scores its own model's text higher than the other judge does. No Gemini call.

**Controls (`paired-arm.mjs check` R1–R6 must pass before the first judge call).**
- Wrong-page: 2 per arm (this page's image with another book's translation).
- Repeats: 5 per arm (20) judged twice. These give the noise floor.
- Planted meaning errors: 16, 4 per fresh arm plus 4 in LIVE (negation, number, name, dropped clause), via `pro-translate-6545/plant.mjs`. A judge that finds fewer than 13 of the 16 does not decide anything.

**Measures.** The primary measure is severity-weighted defects per 1,000 English words, as the router's rule (#8283) has it: (misleads + 3 × wrong_text) ÷ words × 1,000, per page. Fidelity and accept come second. Each arm is compared with the others on the same pages, with 95% intervals from a bootstrap over pages (each page is its own book).

**Decision rule.**
- **"Fable is the better translator"** needs all three:
  1. FABLE has fewer severity-weighted defects per 1,000 words than OPUSX, with the interval clear of zero, under **each** judge.
  2. FABLE has higher fidelity than OPUSX, with the interval clear of zero, under each judge.
  3. Fable's correction precision is no worse than Opus's: the interval of FABLE minus OPUS (OPUS2 and OPUSX pooled) on "the image supports the correction" has an upper end at or above zero.
- **"It is effort, not the model"** needs both:
  1. OPUSX beats OPUS2 on the primary measure, with the interval clear of zero.
  2. The interval of FABLE − OPUSX lies inside the noise floor. The noise floor is the largest 95% interval end of the judge's score on a repeated text minus its first score, with at least ±0.10 fidelity.
- Anything else is reported as **not settled**, with the interval.
- **Smallest gap this can detect.** In #72 the paired SD of fidelity was about 0.7. At n = 103, 80% power and α = 0.05, the smallest detectable gap is 2.8 × 0.7 / √103 ≈ **0.19 fidelity points** (#72's FABLE − OPUSX was +0.17). The same figure for defects per 1,000 words is computed from this run's paired SD and reported beside the result.

**The correction check (question 3).**
- **Extraction.** Every `<note>` or `<meta>` in which an arm says the transcription reads X and it translated Y is extracted. An Opus text call sees only the note and the OCR, not the arm's name, and returns the two readings. Kept only when the transcription's reading is actually in the OCR. This covers all four arms here, plus the 86 notes of #72 stage 1 (OPUS2 38, FABLE 48), which use those pages' images from Mongo.
- **Reading.** A reader with the image (Opus and Fable, one note per call, blind to the arm) sees the two readings in random order. It answers: the leaf has A, has B, has neither, or cannot be read.
- **Control.** Planted false corrections: a clearly printed word from the OCR set against a one-letter change. The reader must say the leaf has the transcription's reading.
- **Reported per arm:** corrections made; the share where the image supports the arm's reading; the share where the image shows the transcription was right all along.

**Order, so a budget stop still leaves an answer:** arms, then the Opus judge, then the Fable judge, then the correction check. Stop at team@ week ≥ 85% or the Fable bar ≥ 70% (now 65% and 11%). By eye, with the image open: the five pages where FABLE and OPUSX differ most, each labelled with its evidence type. If a judge finds invented or wrong-leaf text in a LIVE translation, the containment rule applies. Nothing is written to production. Every read stays under `$JOB_SCRATCH` (`/data/scratch/sl/jobs/fable-frontier-93/w`).

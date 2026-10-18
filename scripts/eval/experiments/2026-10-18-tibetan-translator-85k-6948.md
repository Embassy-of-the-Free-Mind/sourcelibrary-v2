---
stage: translation
measure: judged_vs_reference
languages: [bo]
scripts: [Tibt]
canons: [derge-kangyur]
n_books: 60
n_pages: 60
verdict: "Preregistered; no arm has been read yet."
status: undecided
decision: null
superseded_by: null
issue: [6948, 6750]
---
## 2026-10-18 · Which translator for the ~85K public Tibetan pages that have a good transcription and no English? (#6948)

PRIOR ART: `2026-10-15-gemini-4-argon-xl-365-translation-6750.md` (the #6750 round: the CLI runner, the chatter screen,
the #5695 judge prompt, PLANT and DUP controls, the judge gate; Tibetan was not among its 14 languages). This run is
that design on Tibetan. `2026-10-01-tibetan-retranslation-batch-lane-lite-flash-claude-4742.md` (21 Kangyur pages
against 84000, Batch lite/flash and an Opus arm, but its own rubric and same-family judges only; no CLI arm).
`2026-10-03-tengyur-84000-reference-ab-5497.md` and `tengyur-ref/{fetch-84000.py,build-reference.py}` (how a Derge side
is cut against 84000's reader API; reused for the reference). `pro-translate-6545/claude-arm.py` (the sealed
`claude -p` arm runner, reused unchanged). `pareto-6182/score-xl.py` (`decode`, `norm`, `judge_gate`, imported
unchanged). Nothing in `scripts/eval/` holds a Tibetan judge prompt for the #5695 schema or a reference set for the
Yigdzin manuscript pages, so the #5695 prompt is used unchanged and the references are cut fresh (below).
Scripts: `scripts/eval/tib-translator-6948/`.

### Preregistration (committed and pushed before any arm's English is read)

**Frame** (`frame.mjs`, Mongo read 2026-10-18 20:51Z). Public Tibetan books: `language` starting "Tibetan",
`visible: true`, `pages_count > 0` (1,697 books, 428,825 pages). A frame page has no `translation.data` and either
- a Yigdzin transcription (`ocr.model: bdrc-yigdzin-v1`) with English withheld as `unverified_script_ocr` (67,490
  pages), withheld as `stale_after_reocr` (5,721), or never made (6,410); or
- the Derge Kangyur typed text (`ocr.pipeline: derge-kangyur-import-5665`, 7,331 pages, none withheld).

That is **86,952 pages on 1,424 books**, close to #6948's table (66,195 / 5,824 / 5,432 / 7,331; counted at another
hour). Pages withheld for `source_loop`, `ocr_unreadable` and other reasons are out, as #6948 says.

Found while building the frame, before any read: **7,114 of the 7,331 Derge pages carry
`ocr.text_edition.left_to_84000: true`.** The Kangyur import left those texts untranslated on purpose, because 84000
has published them or is translating them, and its hold releases only "a draft English … that skips the texts 84000
has published or has in progress" (`scripts/lib/derge-tengyur.mjs`, #5665). They stay in this sample, because they
are the pages with an exact human reference. The report says whether they belong in the 85K at all.

**Strata.** CANON: the book title names a Kangyur or Tengyur (`Kanjur`, `Kangyur`, `Tengyur`, `Tanjur`,
`bka' 'gyur`, `bstan 'gyur`, བཀའ་འགྱུར, བསྟན་འགྱུར, `Derge`), or is a Prajñāpāramitā sūtra volume (`'Bum <letter>`,
`Khri brgyad stong`, `Nyi khri`, `brGyad stong`). Every Derge page is CANON. OTHER: everything else, mostly Bhutanese
manuscripts, Thor bu miscellanies, collected works, the Nyingma Gyubum and gter ma cycles. Regex in `sample.py`.

**Sample** (`sample.py`, seed 6948). 30 pages per stratum, one page per book. The frame pages of a stratum are
sorted by page id and shuffled with `random.Random(6948)`. Walk the list and accept a page if (a) its book is not
taken yet and (b) its stored text has ≥ 150 Tibetan syllables (`tengyur-ref/build-reference.py`'s `syls`). The walk
stops at 30. Pooled numbers are given two ways: unweighted (60 pages) and weighted by the two strata's frame pages.

**Arms.** Each arm translates the page's stored transcription (`ocr.data`) with the production request: the live
default translation prompt (`prompts`, `type: translation`, v13, md5 `516510147237…`), the page's book record,
`buildTranslationPrompt` with `PAGE_BREAK_SCOPED`, one page, no neighbour context. This is #6182's `units.mjs`
recipe, so Yigdzin's `<leaf-break/>` markers bring the leaf rule with them.
- **G4L**: `gemini-4-argon-low` via `agy -p`. `run-cli-arm.py --kind translate --print-timeout 300 --attempts 2
  --parallel 2`, plan mode, the request byte for byte (no markers), as #6750 ran it.
- **F38**: `gemini-3.8-flash-low` via `agy -p`, the same.
- **PROD**: the withheld production English, where the page has some. The text is not in `translation_withheld`, but
  the withholder snapshotted it to `page_revisions` (`field: translation`, `reason: withhold-stale-translation-4523`;
  the latest such row is used). It was made from the OLD Gemini OCR, not the Yigdzin text. It is judged against the
  Yigdzin source like the others: it is what readers were served. It exists only on withheld pages, so it is
  compared on that subset only. Not a candidate lane.
- **OP**: Opus via `claude -p --model opus` on the Claude subscription (`claude-arm.py --sealed`, unchanged), the
  same request plus #6545's `TRANSLATE_SUFFIX` (markers), **one page per call** (the brief allows up to 10; #6690
  measured 10 per call 0.15–0.45 below 1 per call). This is the family-rotation check: the judges are Opus too. Never
  through agy.

**Failed reads** (#6750's rule): an agy reply that is empty, timed out, filter-blocked, or that the screen flags
(`cliChatterReason` plus #6750's `FILTER` pattern) is re-read once from scratch. If the second read also fails, the
page is a **failed read**: counted and reported, not scored. A quota stop is not a failure: wait for the reset and
resume (at most 3 times). At most 500 agy calls per UTC day for this job.

**References.** Given to the judge only where a page has 84000 English for the same passage:
- **Derge pages:** the page IS a Derge side (`ocr.text_edition.folio`, `texts`). For each Toh on the page that 84000
  lists as published, the work's passages are read from 84000's reader API (`work(toh:)`; `fetch-84000.py`'s query)
  and cut at the folio mentions by `build-reference.py`'s method. A side is kept only under that script's checks:
  84000's aligned Tibetan covers ≥ 70% of our page's syllables and ours covers ≥ 70% of theirs, and the English cut
  is 0.4–1.6 words per syllable.
- **CANON manuscript pages (Thadrak, Neyphug, etc.):** the page is located in the Derge Kangyur by syllable 4-gram
  overlap against all `derge-kangyur-import-5665` pages in Mongo. The best Derge side and its two neighbours form a
  window. If the window's Derge text covers ≥ 70% of our page's syllables (bag containment), the window's Toh(s) are
  looked up as above, and the reference is the 84000 English of the window's sides that 84000 published.
  `reference_note` says the manuscript is another edition and the cut is wider than the page.
- Elsewhere: no reference. The item carries `reference: null` and a `reference_note` saying the judge reads the
  Tibetan.
- 84000's English is CC BY-NC-ND. It is judge input only, it stays in `$JOB_SCRATCH` and is never committed or
  written to pages.

**Judges.** Two blind Opus judges, J1 and J2, `claude -p --model opus` on the subscription, with
`translation-vs-reference/JUDGE-PROMPT.md` unchanged (#5695's prompt, sha256 `b0b98c17…`, the one #6750 used). One
process per part, about 6 items per part. Items carry `lang: Tibetan`, the source, the reference fields where there
is a reference, and the candidates in a seeded random order (seed 6948), labelled T1–Tn only. J2 reads every item in
another order and partition. Controls, as #6750: **8 PLANT** (F38's English beside a copy with one planted reversal,
`tengyur-characterize/plants.mjs`; no-op plants dropped and redrawn) and **4 DUP** (F38, an identical copy, and
G4L), on pages drawn by seed.

**Judge gate** (`score-xl.judge_gate`, unchanged). A plant is caught if the judge lists a reversal on the planted
copy and not on its twin, or scores it lower: ≥ 6 of 8. Duplicates tie (same fidelity, same rank tier): ≥ 3 of 4.
Score only with the judge(s) that pass. If neither passes, the result is an instrument failure and no verdict is
given.

**Measures** (`score-xl.decode` / `norm`).
- Fidelity 1–5 per page per arm is the mean of the scoring judges.
- A reversal page is one where either judge lists a reversal; the both-judges count is reported beside it.
- Arms G4L, F38 and OP are compared on the pages all three have. PROD is compared on its own subset.
- By-book bootstrap 95% CI, 2,000 draws, seed 6948 (books, then pages within; here one page per book).
- Reported per stratum (CANON, OTHER), on the pages with a reference and those without, and pooled two ways.
- For each arm: mean fidelity with its CI, reversal pages (either judge / both), omission, invention and span-off
  pages, failed reads, and seconds per page (median, p90).
- Pairwise X − Y with CI, and pages higher / lower.

**The bar** (the brief's). "Best arm" is the candidate arm (G4L, F38 or OP) with the highest pooled unweighted mean
fidelity. Arm X **clears the bar** if both hold:
- its mean fidelity is no more than 0.20 below the best arm's on the shared pages (X − best ≥ −0.20, point estimate);
- its reversal pages, either judge, are ≤ 2% of its scored pages (≤ 1 of 60).

Reported beside the bar, not part of it: whether the CI's lower bound of X − best is also above −0.20, and the
both-judges reversal count.

**Decision rule.** The translator for the 85K is G4L if G4L clears the bar, otherwise F38 if F38 clears it. If
neither clears it, the DECISION line says so, names the closer agy arm and its gap, and does not recommend a run.
OP is a check on the judges, not a lane: 85K pages at one page per call is not a subscription job.

**Pace.** Pages per day = 500 agy calls/day × (pages per call = 1) ÷ (calls per page, measured: attempts and screen
re-reads). Calendar days for 85K pages follow from that. Hours of agy time per day = calls × median seconds ÷ 2 in
flight.

**Reported beside the rule:** the three pages where G4L and F38 differ most, read against the source and the
reference; and added-fact notes per arm (counted, not checked for truth; #6750's open risk).

Budget: $0. agy (Google subscription) and the Claude subscription only, no API key, no paid lane. Nothing is written
to `pages` or any production store.

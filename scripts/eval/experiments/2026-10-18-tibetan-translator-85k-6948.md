---
stage: translation
measure: judged_vs_reference
languages: [bo]
scripts: [Tibt]
canons: [derge-kangyur]
n_books: 60
n_pages: 60
verdict: "Gemini 4 Argon low (agy) clears the bar on 60 Tibetan pages: fidelity 4.31, 0.09 below Opus [−0.27, +0.11], 0 reversal pages of 59; 3.8 Flash is 0.40 below with 2 reversals and fails. The withheld production English scores 1.1 (another text). At 500 agy calls a day, 85K pages take about 173 days."
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

### Amendment 1 (2026-10-18 21:40Z, after the arms ran, before any arm's English was read or judged)

These are reference mechanics only. Arms, judges, measures and the bar are unchanged.
- **Toh 8 has no folio mentions.** 84000's English for Toh 8 (the Prajñāpāramitā in 100,000 lines) carries no
  folio mentions, so it cannot be cut at them. For such a text, a side's reference is the English of every passage
  whose aligned Tibetan touches that side. A passage that crosses a side break counts for both sides. The cut is
  therefore wider than the page, and `reference_note` says so. Texts that do have folio mentions are cut as
  preregistered. Each reference records which cut it got.
- **Sides are keyed by (volume, folio), not folio alone.** Toh 8 runs over twelve volumes and Toh 9 over three, and
  folio numbers restart in each volume. `build-reference.py` keys by folio only, which is right for the
  single-volume Tengyur texts it was written for.
- **Empty `texts` lists.** A Derge page inside a long text can carry an empty `texts` list. Such a page takes the
  last text named before it in the same volume order.
- **Status `1.a` counts as published.** 84000 marks published works `1` or `1.a`.

Result of the cut: 15 of the 30 CANON pages have a reference.
- 3 are Derge sides with an exact cut: Toh 381, 440 and 511.
- 12 are manuscript pages, each located in a three-side Derge window: Toh 8 (×4), 9 (×3), 12, 46, 266, 556 and 1-6.
- 15 have none: 84000 has not published the text (for example Toh 348, 422, 453, 469 and 833, "In Progress"), or
  the page was not located (1 page, 'Bum Pha, 54% cover).

The Prajñāpāramitā pages are repetitive. Their best Derge folio wins by a small margin over a far one (e.g. 89 vs 79
4-gram hits). The located side may therefore be a near-identical passage elsewhere in the sūtra. The judge's
`reference_fit` can say "wrong"; the report gives the 15 reference pages separately.

### Result (scored 2026-10-18 22:05Z, `tib-translator-6948/score.py`)

**Verdict: Gemini 4 Argon low through agy (G4L) clears the bar. 3.8 Flash (F38) does not.**
- G4L scores 4.31 on the 57 pages all three candidates share. Opus (OP), the best arm, scores 4.40, so G4L is
  0.09 below it (CI [−0.27, +0.11]). G4L has 0 reversal pages of 59 scored.
- F38 is 0.40 below Opus ([−0.56, −0.22]) and reverses a statement on 2 of 58 pages (3.4%). It fails both halves
  of the bar.
- G4L beats F38 by +0.31 [+0.12, +0.49] (26 pages higher, 10 lower). G4L and Opus are not separable: 13 pages
  higher, 19 lower.
- G4L clears the bar on the point estimate, as preregistered. The CI's lower bound (−0.27) does not clear −0.20:
  with n = 60, "within 0.2 of Opus" is not shown with confidence.

**The withheld production English scores 1.08 [1.00, 1.19] on its 47 pages.** It was made from the old Gemini
OCR. Both judges call it "an unrelated text" or "an unrelated sutra" on page after page: span off on 46 of 47,
unreadable fill on 42. It is not this page's text, which confirms #4523's withholding. It is not a fallback.

**Judge gate: PASS.**
- J1 caught 8 of 8 planted reversals, J2 6 of 8. Both tied 4 of 4 duplicates.
- The two judges' fidelity scores agree within 1 point on every page × arm pair.
- Judging ran 21:34–21:56Z: 24 parts, no failures, no limit waits, $0.

**n = 60 pages, 60 books, one page per book.**
- Failed reads: G4L 1 (Gemini's filter block, twice). F38 2 (one timed out at 300 s; one answered "I have
  prepared the implementation plan … in translation_plan.md", twice). OP 0.
- Fidelity 1–5 is the mean of both judges. Intervals are by-book bootstrap 95%. "Reversal pages" counts pages where
  either judge listed a reversal; the both-judges count is in brackets.

| block | n (shared) | G4L | F38 | OP | G4L − F38 | G4L − OP | F38 − OP | reversal pages G4L / F38 / OP |
|---|---|---|---|---|---|---|---|---|
| **All** | 57 | 4.31 [4.18, 4.44] | 4.00 [3.86, 4.14] | 4.40 [4.25, 4.54] | +0.31 [+0.12, +0.49] | −0.09 [−0.27, +0.11] | −0.40 [−0.56, −0.22] | 0 / 2 / 1 (0 / 2 / 1) |
| CANON (Kangyur, Tengyur, Prajñāpāramitā) | 30 | 4.48 [4.32, 4.65] | 4.25 [4.10, 4.40] | 4.55 [4.33, 4.75] | +0.23 [0.00, +0.47] | −0.07 [−0.35, +0.23] | −0.30 [−0.55, −0.03] | 0 / 0 / 1 |
| OTHER (Bhutanese mss., Thor bu, gter ma, collected works) | 27 | 4.11 [3.93, 4.28] | 3.72 [3.52, 3.93] | 4.22 [4.07, 4.39] | +0.39 [+0.11, +0.67] | −0.11 [−0.35, +0.11] | −0.50 [−0.74, −0.28] | 0 / 2 / 0 |
| with an 84000 reference | 15 | 4.57 [4.33, 4.80] | 4.27 [4.03, 4.50] | 4.43 [4.07, 4.73] | +0.30 [−0.03, +0.67] | +0.13 [−0.33, +0.67] | −0.17 [−0.53, +0.20] | 0 / 0 / 1 |
| source only | 42 | 4.21 [4.07, 4.36] | 3.90 [3.74, 4.07] | 4.38 [4.24, 4.54] | +0.31 [+0.10, +0.52] | −0.17 [−0.33, +0.01] | −0.48 [−0.67, −0.29] | 0 / 2 / 0 |

- **Weighted by frame pages** (CANON 17,058, OTHER 69,894): G4L 4.18, F38 3.83, OP 4.29. Reversal pages per 100:
  G4L 0, F38 6.0, OP 0.7.
- **Production English, on its 47 pages:** 1.08, against G4L 3.17, F38 2.86 and OP 3.30 on the same pages. These
  per-arm numbers are lower than in the table above because the judges scored each page beside an unrelated text.
  Levels are compared only inside one item set.
- **The bar** (preregistered): best arm = OP. G4L −0.09 and 0 of 59: clears. F38 −0.40 and 2 of 58: fails. OP: 1
  of 60 (1.7%): clears.
- **Decision rule:** G4L clears, so the translator for these pages is G4L.

**The reversals, checked against the Tibetan by this job:**
- **F38, a sādhana (T063):** ས་གསུམ་ཁུར་དུ་དཀའ་བ ("the burden of the three realms, hard to bear") becomes "finds
  even the burden of the three realms light to bear". Confirmed.
- **F38, a dying-instruction text (T052):** རིག་པ་འབད་ལ ("awareness, with effort") becomes "reveal awareness
  vividly without striving". Confirmed.
- **OP, the Vinaya's Sudhana story (Toh 1-6, T023):** the brahmin reads the dream as the prince's victory and
  resolves to tell it as something false (ལོག་པ་ཞིག་ཏུ་བསྟན་པར་བྱའོ). Opus has "that is how I will explain it",
  which loses the lie the plot turns on. Confirmed. G4L scored 5 on this page.

**The three pages where G4L and F38 differ most** (from the judges' reasons; the two F38 cases were checked by this job):
- **A Rāhula invocation (OTHER; G4L 5, F38 3, OP 4).** F38 reads the scribe's contraction སྤྱན (= ཅན) as "eyes"
  throughout. G4L resolves it, as it resolves the other abbreviations. Abbreviated manuscript orthography is where
  the arms separate most.
- **A Kagyé palace description (OTHER; G4L 5, F38 3).** Again a contracted script (bsdus yig). F38 turns palaces
  into deities and names a "Dregpa Heruka".
- **Śatasāhasrikā, feelings born of contact (CANON, 84000 reference; G4L 5, F38 3.5).** G4L keeps both halves of
  each converse pair, as the reference does. F38 and OP flatten them.

**Beside the rule:**
- **Omission pages (either judge):** G4L 8, F38 26, OP 11.
- **Unreadable fill:** a plausible phrase where the source is garbled. G4L 15 pages (8 by both judges), F38 11 (5),
  OP 0.
  - Each G4L case is one phrase on a page that still scores 4–5 (e.g. "Upon a corpse-seat", "thirty-two, the people
    dwelt"). No G4L page is invented whole.
  - Opus marks such spans `<unclear>`, as prompt v13 asks. G4L mostly does not.
  - This is G4L's main residual risk on these manuscripts.
- **Added facts** (editorial notes the page does not state; not checked for truth): G4L 152 entries, F38 19, OP 124.
  #6750 found the same pattern.
- **Length:** G4L's English is 1.52× F38's and 1.26× Opus's.
- **Reference fit, judge × page:** Derge sides exact 4, wider 2. Manuscript windows wider 22, offset 2. No
  reference 90 (`cant_tell`). No reference was judged "wrong", so the repetitive Prajñāpāramitā locations held up.

**Calls and pace:**
- **G4L:** 61 agy calls for 60 pages (1.02 per page). Median 23.8 s per page, p90 34.7 s. That is **≈ 492 pages per
  day at 500 calls**.
  - The #6948 frame (86,952 pages) takes **≈ 177 days**, and 85K pages about 173.
  - Without the 7,114 Derge pages the Kangyur hold leaves to 84000 (below), the remaining 79,838 take **≈ 162 days**.
  - 500 calls at 2 in flight use about 1.6 h of agy time a day. The cap is the binding constraint, not the model.
- **F38:** 77 calls for 60 pages (1.28 per page: 12 nudges after a denied tool, 3 plan-note re-reads). That is ≈ 390
  pages a day, or ≈ 218 days for 85K.
- **OP:** median 38 s per page, one page per call. It is a check, not a lane.

**The Derge pages do not belong in the 85K as it stands.** 7,114 of the 7,331 Derge Kangyur pages in the frame
carry `left_to_84000: true`. The Kangyur import's hold releases only a draft that skips texts 84000 has published or
has in progress (#5665). Translating them is a separate decision for Derek. Of the 8 Derge pages drawn here, 3 are
published by 84000 and 5 are "In Progress".

**Limits:**
- The judges are AI (Opus), not a reader of Tibetan. Five passages were checked by this job against the source: the
  three reversals and two of the largest gaps.
- **Same family.** The judges and one arm are Opus. G4L scoring 0.09 below Opus is the outcome the family check
  exists to bound. A same-family preference would only widen the gap, so G4L clearing the bar is not flattered by
  it. Opus's lead over G4L is not established either way.
- 45 of the 60 pages have no reference. On those the judge reads the Tibetan, and confidence is lower, especially on
  contracted manuscript script.
- One read per arm per page. There is no A-vs-A repeat for G4L on Tibetan.
- Unreadable fill and added facts were counted, not checked for truth.

Files:
- `scripts/eval/results/tib-translator-6948/{key.json,scores.json}` (numbers and labels only).
- `scripts/eval/tib-translator-6948/` (frame, sample, requests, agy runner and screen, 84000 cut, packet, judge
  driver, score).
- The arm outputs, the judge packets and the 84000 cuts quote CC BY-NC-ND text and the sources, so they stay in
  `$JOB_SCRATCH` on earthai-live (`/data/scratch/sl/jobs/tib-translator-6948`). Nothing was written to `pages` or any
  production store.

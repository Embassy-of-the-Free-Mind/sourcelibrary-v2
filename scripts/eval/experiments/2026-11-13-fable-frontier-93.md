---
stage: translation
measure: judged
languages: [fa, sa, lzh, grc, he]
scripts: [Arab, Deva, Hani, Grek, Hebr]
canons: []
n_books: 103
n_pages: 103
verdict: "On 103 frontier pages (one per book; Persian 7, Sanskrit, Classical Chinese, Greek, Hebrew 24 each), Fable 5.2 is not shown to translate better than Opus 5.5 at xhigh effort. Under the Opus judge FABLE - OPUSX is +0.15 fidelity [+0.05, +0.24] (20 pages better, 6 worse) and -0.57 severity-weighted defects per 1,000 words [-1.62, +0.48]; the fidelity gap is inside the judge's own repeat noise (0.4). The Fable judge, stopped by the weekly limit at 44 paired pages, gives -6.5 defects per 1,000 words [-10.6, -3.0], but on those same 44 pages the Opus judge sees -0.9: most of that gap is the Fable judge's reading, not the text."
status: undecided
decision: "No route change. The preregistered rule (interval clear of zero under EACH judge, and a correction precision no worse than Opus's) is not met: the Opus judge's defect interval spans zero, the Fable judge covered 44 of 103 pages, and the correction check has not run. The rest (Fable judge, OPUS2 arm, LIVE judging, correction check) is scheduled after the 2026-11-17 reset (#93)"
feeds: route
supersedes: []
superseded_by: null
issue: [93, 72]
router_evidence: "none — rules.json has no translation cell for Persian, Sanskrit, Chinese, Greek or Hebrew that a Claude route is rated in; the live route for these languages is gemini-3.8-flash+agy-cli (flash-measured-cli-agy) and LIVE, the stored text, was written by several earlier lanes"
defect_rates: "scripts/eval/route-judge-6740/results/fable-frontier-93/score.json"
---
## 2026-11-13 · Fable 5.2 against Opus 5.5 at xhigh on the frontier pages (#93)

PRIOR ART: `2026-11-12-fable-translation-hard-tail-72.md` (stage 1: the 40 pages where Opus scored lowest in
v2#6545, one Opus judge; Fable against Opus-xhigh +0.17 [-0.05, +0.40], not settled), the v2#6545 panels
(`2026-10-12-pro-opus-correction-hardest-languages-6545.md`; those books are left out of this draw), the judge
instrument `scripts/eval/route-judge-6740/` (judge.mjs prompt and parser, paired-arm.mjs check and score). Scripts:
`scripts/eval/fable-frontier-93/` (draw, requests, packet, judge-run, score; corr-extract and corr-read for the
correction check, not yet run). Arms through `scripts/eval/pro-translate-6545/claude-arm.py --lane`.

### Question

Readers: Derek, deciding whether a Fable translation route is worth registering beside the Opus route, and the router
table. Stage 1 left two things open: whether Fable's lead over Opus survives Opus at xhigh effort on ordinary hard
pages (not the 40 Opus did worst on), and whether a second judge agrees. The design and decision rule were posted on
#93 before any output was judged (issuecomment-6846942472; copy in the results directory, `design-posted-on-93.md`).

### Design

- **Pages.** 103 pages, one per book, from visible books with pages (`visible: true && pages_count > 0`), each with a
  real OCR text and a stored English translation, v2#6545 books excluded: Persian 7 (all the pool had), Sanskrit,
  Classical Chinese, Greek, Hebrew 24 each. All 103 have no first-translation evidence either way (`ft_class: none`),
  so 0 pages "could not be told". Separately, 14 pages were marked by eye as carrying a work with a known published
  English translation (`canonical.json`). They are kept in and flagged, not dropped.
- **Arms**, all on the production translation prompt as the live lane builds it (Standard Translation v21, text only),
  through subscription `claude -p`, model confirmed from every reply's `modelUsage`:
  LIVE (the stored translation), OPUS2 (`claude-opus-5-5 --effort medium`), OPUSX (`claude-opus-5-5 --effort xhigh`),
  FABLE (`claude-fable-5-2 --effort high`).
- **Judges.** Blind, one output per call, the page image attached (judge.mjs prompt). Two judges, both Claude-family:
  Opus 5.5 and Fable 5.2. No Gemini judge in this job.
- **Controls** (paired-arm.mjs check R1–R5 passed, exit 0): 2 wrong-page controls per arm, 5 repeats per arm (the noise
  floor), 4 planted meaning errors per arm.
- **Smallest gap 103 pages can detect** (80% power, two-sided 5%, from the observed paired SD under the Opus judge):
  0.14 fidelity points, 1.5 severity-weighted defects per 1,000 words.

### Results

Every arm returned text on every page it ran: OPUSX 103/103, FABLE 103/103, OPUS2 29/29 run. No declines, no failures.
Mean list cost per page (the CLI's own figure): OPUSX $0.196, FABLE $0.168, OPUS2 $0.106. Median output tokens:
6,856, 5,176 and 2,569.

**Opus judge, all 103 pages** (SW = (misleads + 3 × wrong-text) per 1,000 words):

| arm | fidelity | accept | SW / 1,000 words | pages with wrong text | wrong-page control | planted |
|---|---|---|---|---|---|---|
| OPUSX | 3.39 | 52/103 | 8.02 | 40 | 2/2 | 7/8 pooled |
| FABLE | 3.53 | 54/103 | 7.46 | 42 | 2/2 | |

FABLE − OPUSX, paired by page (bootstrap over pages): fidelity **+0.146 [+0.049, +0.243]**, 20 better / 6 worse;
SW **−0.57 [−1.62, +0.48]**. Noise floor from 10 repeats: fidelity ±0.4, SW ±2.2. By language (Opus judge, FABLE − OPUSX):
Greek +0.25 fidelity, −1.7 SW; Persian (n = 7) −5.6 SW; Sanskrit, Chinese and Hebrew within ±0.9 SW.
Pooled over all words (`study_cells` in score.json): OPUSX 2.91 misleading and 1.55 wrong-text defects per 1,000 words,
FABLE 2.68 and 1.69. Fable has slightly fewer misleading passages and slightly more wrong text.

**Fable judge, 44 paired pages** (stopped by the brief's 85% weekly limit; the 44 are the first in a fixed page order
with both arms, not chosen by result):

| arm | fidelity | accept | SW / 1,000 words | pages with wrong text | wrong-page control | planted |
|---|---|---|---|---|---|---|
| OPUSX | 2.80 | 8/44 | 23.2 | 36 | 2/2 | 7/7 pooled |
| FABLE | 2.96 | 11/45 | 16.6 | 35 | 2/2 | |

FABLE − OPUSX: fidelity +0.16 [0.00, +0.32] (8/2); SW **−6.5 [−10.6, −3.0]**.

**The two judges.** Krippendorff's alpha on fidelity 0.86 (89 items judged by both; 64 identical, all 89 within one
point; accept agrees on 74/89). The Fable judge is far stricter: it counts about three times the defects and flags
wrong text on four pages in five. **Own-family lean:** on fidelity, none (the Fable judge's FABLE − OPUSX gap minus the
Opus judge's on the same pages, +0.02 [−0.14, +0.18]). On defects, yes: on the same 44 pages the Opus judge sees
FABLE − OPUSX = −0.9 per 1,000 words and the Fable judge −6.5. The Fable judge finds more wrong in Opus's text than
in Fable's. Whether that is a family lean or the stricter judge seeing real defects the Opus judge misses cannot be
told without a judge outside the family.

**By eye, the five pages where FABLE and OPUSX differ most** (word-level dissimilarity; an Opus reader with the image,
blind to arm; `byeye.jsonl`): FABLE better on 2, OPUSX on 1, equivalent on 2, no invented or wrong-leaf text in either.
- Sanskrit (69907e09…): the leaf reads अश्विन्यादि लिखेत्क्रमात् where the OCR is corrupt (रेखामात्र). FABLE reads it as the
  image has it ("write the lunar mansions in order from Aśvinī"). OPUSX translates the corrupt OCR. Evidence type: a
  different reading, which the image supports.
- Sanskrit (69906d53…): the leaf clearly reads मनुदिनांतरिता ("at intervals of fourteen days"), as OPUSX has. FABLE
  emends it to *anudināntaritā* against the image, twice. Evidence type: a false correction of a right transcription.
- Sanskrit (69907c49…): FABLE recovers names the image shows (Argalāpura, Amarāvatī, Shah Jahan) and flags them as
  uncertain. OPUSX leaves those stretches untranslated. Evidence type: coverage.
- Greek (6a085a78…, a Latin grammar with Greek examples) and Greek (6a3eb56f…, Herculaneum fragments): the same sense.
  Each is right in one place; the rest is style and notes.

The two Sanskrit pages are the question the correction check asks: Fable departs from the transcription more often,
sometimes rightly and sometimes not.

### What is not done (scheduled after the 2026-11-17 reset)

- The Fable judge on the other 59 paired pages, and both judges on LIVE and OPUS2.
- The OPUS2 arm on 74 more pages (paused at 29/103 to give FABLE the account's two slots: question 2, effort against
  model, has no answer yet).
- The correction check (#93 question 3): the notes in which an arm says the transcription reads one thing and it
  translated another, read blind against the image by two readers, with planted false corrections, on these pages
  and on the stage-1 notes.

### Operations

- The box's pace guard ran at 2 slots for the whole run (the account burned about 3%/h against a budget of 0.2–0.3%/h).
  A fresh caller's call takes a freed slot before a waiting one polls, so the first FABLE translation waited 40 minutes.
  The runners' kill timers also counted the queue wait (claude-arm `--timeout`, judge-run now 2 h).
- The week went from 69% to 85% over the run, shared with the fable-ocr-mss-92 job on the same account.

### Replicated?

Partly: stage 1 (#72), on a different 40 pages, put FABLE − OPUSX at +0.17 [−0.05, +0.40] under the Opus judge;
here, on 103 pages, +0.15 [+0.05, +0.24]. The two agree, and both are small. A judge outside the Claude family is
still owed. Gemini 3.1 Pro on stage 1 runs from the fable72-pro-judge timer on 2026-11-15.

Results: `scripts/eval/route-judge-6740/results/fable-frontier-93/` (key, recipe, score.json, paired-score.json,
verdicts, the arms' outputs gzipped, the by-eye rows). Scratch: `/data/scratch/sl/jobs/fable-frontier-93/w/`.

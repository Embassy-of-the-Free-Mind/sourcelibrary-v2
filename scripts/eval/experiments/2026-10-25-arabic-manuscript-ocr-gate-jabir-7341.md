---
stage: ocr
measure: [judged, agreement]
languages: [ar]
scripts: [Arab]
canons: []
n_books: 14
n_pages: 30
verdict: "On 26 pages from 13 Arabic alchemical manuscripts (14th–20th c.), Opus 5.5 via claude -p is the only reader that gives a usable page most of the time: 22 of 26 usable under the stricter of two judges (85% [65, 100] by book), 0 failed. Flash-Lite (production prompt) reads every page but 15 of 26 are misleading (58% [35, 81]), with wrong words throughout. Gemini 3.8 Flash low on the agy CLI is cut by Gemini's safety filter mid-page on 16 of 26 (62% [35, 85]), across 9 of the 13 books; 8 of its 10 finished reads are usable. On the Kraus 1935 print edition (4 pages, 1 book), all three readers are usable on every page."
status: undecided
decision: "Route the 13 Jābir manuscripts (2,252 pages) to Opus 5.5 via claude -p, one read per page. Estimated cost: 6–31 weekly points of one Claude account, about 6 h of wall time at 2 calls in parallel, with a by-eye sample of BnF Arabe 4709 (its hand is where every reader failed most). Do not send them to Flash-Lite (58% misleading) or to agy Gemini (62% filter-cut on alchemical content). Route Kraus 1935 (582 pages) to agy Gemini 3.8 Flash low, falling back to production Flash-Lite on a filter cut. The cut is detectable by its message, it has not hit Kraus yet, and both readers are usable there. Releasing the hold is Derek's call."
superseded_by: null
issue: [7341, 6740, 6544]
---
## 2026-10-25 · Arabic manuscript OCR gate: which reader gives the Jābir books a usable page at the lowest cost? (#7341)

PRIOR ART: #6544 (`scripts/eval/mss-thinking-6544/`: the one diplomatic READ prompt, the Flash-Lite-as-production runner
`run-lite.mjs`, the failed-read rules in `score.py`, and the rotated referee keys in `build-keys.py`, all run unchanged
or imported); `scripts/eval/replicate-6547/run-claude-arm.py` (the sealed `claude -p` reader); `scripts/eval/run-cli-arm.py`
with `scripts/lib/agy-tool-gate.py` (the agy reader, now on main); `scripts/eval/estimator/ocr/` (`route-costs.json`
quota shares; the gate rows are written in `build-ocr-table.py`'s long-table row shape). New glue in
`scripts/eval/arabic-mss-gate-7341/`; results in `scripts/eval/results/arabic-mss-gate-7341/`.

**Decision this changes.** Which route reads the 2,834 held pages of the 14 Jābir ibn Ḥayyān books (#7341): 13
manuscripts and Kraus's 1935 print edition. More generally, which route serves the router's empty cell "Arabic,
manuscript". OCR estimator v1 has no Arabic chart. The routing table's `manuscripts` row (Opus, "not in use yet")
rested on 6 Arabic pages under model keys (#6544 Set B).

### Draw
- **Frame.** The 14 books held with reason `jabir-ocr-gate-7341`. Two pages per manuscript, four for Kraus.
- **Seeded shuffle (7341).** For each book, the inner pages were shuffled (the first and last 5% skipped). The first
  candidates in that order were screened by eye from contact sheets.
- **Skipped by the screen:**
  - BnF Arabe 5099 p.107: a letter-combination table facing a blank leaf.
  - Kitāb al-ʿAhd p.18: the binding.
  - Kraus p.106: blank.
- **Splitting the BnF frames.** All five BnF codices are photographed as two-leaf openings, so those 10 frames were
  split at the gutter.
  - A book's first pick takes the right leaf and its second the left, so both leaf positions are in the set.
  - The gutter was read by eye against a ruler overlay. The darkest-column search missed by up to 12%: it locked onto
    ink and cut the facing leaf's line ends into the crop.
- **Recorded in** `draw.mjs`, `finalize-draw.mjs` and `results/…/draw.json`.

| cell | books | pages | hands / dates |
|---|---|---|---|
| ar-ms | 13 | 26 | BnF Arabe 2605 (1337), 2606 (16th c.), 2607 (17th c.), 5099 (16th c.), 4709 (1818–19); SBB Ms. or. oct. 2250; Gotha A 1295; six HU Berlin hand copies 1924–29 (Ruska's institute, with scholars' pencil notes) |
| ar-print | 1 | 4 | Kraus, *Mukhtār rasāʾil Jābir ibn Ḥayyān*, Cairo 1935 (vocalised in places, with footnote apparatus) |

### Arms (all read the R2 archived image)
- **a. Flash-Lite as production runs it.**
  - Production OCR prompt, `gemini-3.1-flash-lite`, temperature 0.1, no thinking, paid API.
  - **$0.0556 for 30 pages** (realtime $1.85/1K; Batch list price $1.48/1K).
  - Production's metadata tags are stripped before scoring.
- **b. Gemini 3.8 Flash low via `agy -p`.**
  - Subscription, `--retry-refusal`; `AGY_ALLOW_HEAVY` was not set.
  - It took 1.53 calls per page, because each filter cut is retried once.
- **c. Opus 5.5 via `claude -p --restricted`.**
  - Read only, in a sealed one-image folder.
  - $0.070 list-price equivalent per page, not billed.
- **Prompt.** b and c share #6544's diplomatic READ prompt. On Kraus the word "handwritten" becomes "printed, footnotes
  included".
- **d. Gemini 3 Flash on Kraus: not run.** `agy models` offers Gemini 4 Argon, 3.8 Flash, Claude and GPT-OSS, but no
  Gemini 3 Flash. The paid API is closed to it (#6331).

### Key (model-adjudicated; DIRECTIONAL)
- **Spans.** #6544's `build-keys.py`, unchanged. The words the two readers agree on stand; each disputed span goes to
  two referees with the image, the candidates in seeded order and no model names.
  - **KEY-O:** Opus is the referee, and per the brief the final arbiter.
  - **KEY-G:** Gemini 3.8 Flash low gives a second opinion, which never blocks.
  - **No Fable step.** The brief makes Opus final.
- **The Gemini slot was empty on 16 pages.** Gemini's read failed there, and the builder would otherwise key those
  pages on a second Opus read. So the Flash-Lite read stands in on those 16 pages (`key-reads.py`); the other 14 use
  the agy read.
- **657 disputed spans, plus 24 planted one-letter controls:**
  - KEY-O caught all 24 controls;
  - KEY-G caught 22, missed 1, and gave 1 a third reading.
- **The two keys agree on 375 of 681 spans (55%).**
- **Each referee leans toward its own family's reading.** On the 16 pages keyed with Flash-Lite:

  | key | Flash-Lite | Opus |
  |---|---|---|
  | KEY-O | 7.9 | 2.3 |
  | KEY-G | 4.9 | 7.0 |

  On the 10 pages where no Flash-Lite read entered the key, Flash-Lite is last under both keys (10.7 and 10.0). The
  CER table is therefore secondary to the usability judgement below.

### Usability judgement (the deciding measure)
- **Who judged.** Every read of every arm went to two judges from different families, with the image and no arm name:
  Opus (`claude -p`) and Gemini 3.8 Flash low (`agy -p`).
- **What they did.** Each judge listed the errors a reader would care about, ignoring vowel marks, hamza and alef
  spelling, and line breaks. Then it gave one verdict:
  - **USABLE**;
  - **NOTICEABLE**: usable, with errors a reader would notice;
  - **MISLEADING**: wrong words in many places, or any invented text, or any line left out;
  - **FAILED**.
- **Failed reads are graded FAILED without a call** (#6523 rules).
- **"Usable" = USABLE or NOTICEABLE under the stricter of the two judges.** Intervals are 95%, resampled by book.
- **Controls: 6 reads (3 Opus, 3 Gemini, six books) were copied with 3 plants each:**
  - a word swapped for another word of the same page;
  - an invented 4-word clause from another book's read;
  - one dropped line.

  The Opus judge caught **18 of 18** plants and the Gemini judge **16 of 18** (it missed one swap and one clause).
  Both graded all six planted copies MISLEADING.
- **Judge agreement:** 44 of 73 exact, 53 of 73 on usable or not.

| cell | arm | usable (stricter judge) | USABLE only | misleading | failed | Opus judge: usable | Gemini judge: usable |
|---|---|---|---|---|---|---|---|
| ar-ms (26 pp, 13 bks) | Flash-Lite | **42%** [19, 65] | 0% | **58%** [35, 81] | 0% | 65% | 46% |
| | Gemini 3.8 Flash low (agy) | **31%** [12, 50] | 8% | 8% | **62%** [35, 85] | 31% | 35% |
| | Opus 5.5 (claude -p) | **85%** [65, 100] | 38% | 15% [0, 35] | 0% | 100% | 81% |
| ar-print (4 pp, 1 bk) | Flash-Lite | 4/4 | 0/4 | 0 | 0 | 4/4 | 4/4 |
| | Gemini 3.8 Flash low | 4/4 | 2/4 | 0 | 0 | 4/4 | 4/4 |
| | Opus 5.5 | 4/4 | 4/4 | 0 | 0 | 4/4 | 4/4 |

- **The Gemini judge grades 4 Opus reads MISLEADING. Two of those are rubric errors:**
  - Muṣaḥḥaḥāt p.132 and Sabʿīn p.155: it calls Opus's `[?]` for an illegible Latin pencil note "invented".
  - Not counting those two, Opus is usable on 24 of 26 pages.
- **The other two are real:** BnF Arabe 4709 pp.17r and 39l, a dense 1818 hand.
  - The Gemini judge lists a dozen misreadings (e.g. "كنز زنج" for "كنز شيخ") and the Opus judge half a dozen.
  - Flash-Lite is MISLEADING on both pages and Gemini is filter-cut on both, so this book needs a by-eye sample
    whatever reads it.
- **The Opus judge never grades a Flash-Lite manuscript read USABLE (0 of 26).** Typical Flash-Lite errors:
  - "والباطن" for "والباطل", and البرانية and الجوانية swapped (5099 p.196);
  - "النوناد سيبك الطلاق" for "النوشادر يسبك الطلق": sal ammoniac turned into "divorce" (2606 p.17);
  - "في العلم والاداب" for "في الحل والعقد والاذابة" (Gotha p.169).

### Gemini's filter on alchemy
On 16 of 26 manuscript pages, Gemini 3.8 Flash low stops mid-transcription. Each time it ends with "This request was
blocked by Gemini's filters. They can occasionally trigger by mistake on safe coding, security, or biology-related
queries". The retry is cut too.
- **Where it cuts.** It hits 9 of the 13 manuscript books, including four of the five BnF codices (not Arabe 5099).
- **It is the content, not the page.** On Sabʿīn p.70 it starts the recipe text ("رصاصا رخوا ثم اخرج زيب…") and
  stops.
- **It is the CLI reader only.**
  - Production Flash-Lite on the API read all 26.
  - The same model as referee and as judge was not cut once (110 calls), because those prompts carry the text rather
    than ask for it.
  - None of Kraus's 4 pages was cut.
- **How it can fail.** A cut is easy to detect: the message is fixed, and `run-cli-arm.py` marks it `safety_filter`.
  But a cut read that keeps its partial text and drops the message would be a silent truncation. Any lane that routes
  Arabic alchemy to the CLI needs that check.

### CER against the keys (secondary; letters only, mean page CER %, 95% interval by book)
- **marks:** ḥarakāt, shadda and hamza seats kept.
- **skel:** marks dropped; alef, hamza, yāʾ and tāʾ marbūṭa folded.
- **Failed reads are counted, not scored.** The "fail=1" column counts each failed read as 100%.

| cell | arm | read | KEY-O skel | KEY-O marks | KEY-G skel | fail=1, KEY-O skel |
|---|---|---|---|---|---|---|
| ar-ms | Flash-Lite | 26/26 | 9.0 [4.8, 14.3] | 10.5 | 6.9 | 9.0 |
| | Gemini 3.8 Flash low | 10/26 | 7.4 [1.7, 17.0] | 8.7 | 3.9 | 64.4 [41.9, 85.1] |
| | Opus 5.5 | 26/26 | 2.2 [1.5, 3.0] | 2.8 | 6.3 | 2.2 |
| ar-print | Flash-Lite | 4/4 | 1.1 | 4.8 | 0.9 | 1.1 |
| | Gemini 3.8 Flash low | 4/4 | 0.5 | 1.2 | 0.2 | 0.5 |
| | Opus 5.5 | 4/4 | 0.2 | 1.1 | 0.3 | 0.2 |

- **Flash-Lite drops vowel marks.** Its marks-minus-skel gap on Kraus (3.7 points) is what production's prompt does
  to a vocalised edition.
- **The two Khawāṣṣ pages (HU VI.17) are the worst pages for every reader under the key.** Flash-Lite and Gemini sit
  at 25–34%; Opus at 0.7% and 11%. Most of the gap is the dense pencil marginalia, which each reader places
  differently: a page-layout question as much as a reading one.

### External anchor (non-model key, one page)
- **The match.** Ikhrāj, Berlin hand copy of 1928 (HU VI.18), p.34 is the passage Kraus prints at pp. 20.8–22.7
  ("فى الكمية والكيفية" … "فينقدح بعضها ببعض"; 978 skeleton letters). Kraus's main text was read by Opus. His
  apparatus, line numbers and the words he adds in ⟨ ⟩ were dropped. Kraus edits from two copies and emends, so the
  anchor has an edition-variance floor and is not a diplomatic reference.
- **Skeleton CER against Kraus:**
  - Opus 1.5, Gemini 3.8 Flash 2.1, Flash-Lite 3.7;
  - KEY-O 1.7, KEY-G 2.1.

  With marks: 10.4 / 11.0 / 13.1, since Kraus vocalises.
- **Same order as the judges.** On the cleanest hand in the set the keys are within the edition floor of the print.

### Cost per usable page, and the full read
- **Prices.**
  - **Flash-Lite:** Batch list price.
  - **agy:** the share of the month's agy allowance (`route-costs.json`, 4.36e-6 a call × 1.53 calls a page).
  - **Claude:** weekly points of one account. The Opus calls' list-price equivalent ($0.070 a page) is multiplied by
    a points-per-list-dollar range:
    - 0.04, the shelf-overview measurement (#6174);
    - 0.2, this run's bound: the team@ weekly meter moved 86 → 87 while about $10 of Opus calls ran, alongside other
      jobs and this session.
- **Next route.** Opus, per the brief's formula: call ÷ P(usable) + P(not) × next route.

| cell | route | P(usable) | per usable page | all pages of the cell |
|---|---|---|---|---|
| ar-ms (2,252 pp) | Opus alone | 0.85 | 0.003–0.017 weekly points | **6–31 weekly points** of one account; ≈ 6 h at 2 parallel calls (20 s/page) |
| | Flash-Lite → Opus | 0.42 | $0.0035 + 0.0016–0.008 points | not realisable: Flash-Lite's misleading reads look fluent; finding them takes an Opus-sized judge call |
| | agy → Opus | 0.31 | 2.2e-5 agy-month + 0.002–0.010 points | the cut is free to detect, but only 31% of pages finish usable and 2 of the 10 finished reads were still misleading |
| ar-print (582 pp) | agy 3.8 Flash low | 1.0 (4/4) | 6.7e-6 agy-month | 0.4% of a month's agy allowance, ≈ 2 h at 2 parallel calls (19 s/page) |
| | Flash-Lite (Batch) | 1.0 (4/4) | $0.0015 | $0.86 |
| | Opus | 1.0 (4/4) | 0.003–0.014 points | 1.6–8 weekly points |

- **Pages per week.** Giving the Opus lane 10 weekly points of one account reads about 700–3,500 manuscript pages a
  week. The 2,252 pages fit in one to three weeks of a 10-point allotment, or in under a week on one account's spare
  capacity.
- **Where it is uncertain.** The Claude point price is the largest uncertainty. Metering the first full-read batch on
  an otherwise idle account would pin it down.

### What this does not show
- **Few books.** 13 manuscripts and 1 print book; pages within a book are not independent.
- **The keys and judges are models.** The keys favour each referee's own family. Both judges are in the families
  being judged, so a judge leaning toward its own family is the expected direction:
  - the Opus judge grades Opus 100% usable;
  - the Gemini judge grades Gemini 35% and Opus 81%.

  The plants show that both judges catch word, clause and line errors. They do not show the judges are calibrated on
  borderline misreadings.
- **Kraus is 4 pages from 1 book.** The print row (Gemini 3 Flash) was not testable, and the agy filter could still
  cut Kraus's later alchemical extracts (al-Khawāṣṣ, al-Sabʿīn).
- **No human read.** A by-eye sample on the first batch of the full read is the next check, BnF Arabe 4709 first.
- **One run per arm.** There is no repeat-stability measure.

### Calls and spend
| route | calls |
|---|---|
| paid API (Flash-Lite) | 30 pages, $0.0556 |
| agy (subscription) | 46 reads incl. retries, 30 referee calls, 80 judge calls |
| `claude -p` (subscription) | 146 Opus calls: 30 reads, 30 referee, 80 judge, 6 Kraus anchor pages; $9.98 list-price equivalent, not billed |

Nothing was written to `pages`; the hold was not released.

### Files
- **Runner glue:** `scripts/eval/arabic-mss-gate-7341/`, with `draw.mjs` and `finalize-draw.mjs` (the draw), `prep.py` (requests),
  `key-reads.py` (the Gemini/Flash-Lite slot for `build-keys.py`), `score.py` (Arabic CER, two normalisations),
  `judge.py` (the two-family usability judge and plants), `anchor.py` (the Kraus anchor) and `summarize.py` (rates,
  costs, gate rows).
- **Results:** `scripts/eval/results/arabic-mss-gate-7341/`.
  - `gate-rows.jsonl` holds 90 rows in the estimator's long-table shape: charts `arabic-manuscript` and
    `arabic-print`; engines `gemini-3.1-flash-lite`, `gemini-3.8-flash+antigravity-cli` and `claude-opus-5-5`; KEY-O
    skeleton CER plus usability columns.
  - The other files: `summary.json`, `cer-scores.json`, `judge-scores.json`, `keys-report.json`, `anchor-score.json`,
    `draw.json`.
  - No page text is committed. Reads, keys and judge replies stay in the job scratch.

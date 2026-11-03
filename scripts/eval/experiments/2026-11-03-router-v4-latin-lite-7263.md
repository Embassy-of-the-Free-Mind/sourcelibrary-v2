---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "V4 PASS for both arms on latin-lite/print, and the re-read is clearly better. On 30 fresh Latin print books (one body page each, none in the cell's evidence), the Opus judge, blind and with the image open, accepted the stored Flash-Lite text on 9/30 pages. It accepted lite>agy-flash-low on 14/30 (d = +0.17, 95% CI +0.03 to +0.30; 5 pages gained, 0 lost) and agy-flash-low@4-read on 20/30 (d = +0.37, CI +0.17 to +0.57; 12 gained, 1 lost). Wrong-text pages: 15, 12 and 6. Severe defects per 1,000 words: 12.2, 9.4 and 4.1. The apply guards refused 14/30 corrections and 4/30 re-reads. Read@4 against the correction, paired: +0.20 (CI 0 to +0.40), 8 gained and 2 lost. English end to end (a major English defect, or the judge saw a misread), with the lane's agy Flash block translator, judged against the image: stored English 15/26 pages wrong, translate-only 18/30, correct + translate 14/30, re-read + translate 7/30 (paired against the stored English: 8 pages fixed, 0 broken, p = 0.008). Controls gate 15/15/15."
status: adopted
decision: "Adopted 2026-11-03 (Derek, 'defaults'): latin-lite/print → agy-flash-low@4-read (cli-ocr-lane.mjs correct --reread-per-call=4), then re-translate the pages it writes on latin-cli-agy4. current.json moves this one cell to build 2026-11-03-latin-v4-7263. The row is rules.json script_split.planned with a decision label: the rule alone names agy-flash-low-read, because read@4's only evidence is this hard frame and read@1's is all from other frames (row field rule_alone)."
superseded_by: null
issue: [7263]
router_evidence: "scripts/eval/estimator/router-table/evidence/router-v4-latin-lite-7263.score.json (derive_v4_latin_7263.py): pooled into latin-lite on the brief of the ship job, unlike the French V4. The English arms are not pooled: latin-tr-first is first English, and these re-translate."
defect_rates: "scripts/eval/results/router-v4-latin-lite/latin-lite-print-2026-11-03.json"
---
## 2026-11-03 · V4 for latin-lite/print: correction or re-read, on fresh books, transcription and English (#7263)

PRIOR ART:
- `scripts/eval/router-confirm/confirm.mjs` and its record `2026-11-01-router-binding-v4-7263.md` (french-lite/print):
  the frame, the exclusions, the seeded book-uniform draw, the paired blind Opus judge, the wrong-page controls and the
  bar. Extended here, not rebuilt: a Latin frame, `--routes=` (three arms, the first is the comparator, for a decision
  taken outside current.json), `--min-words` / `--page-type`, a `drop` stage for pages seen to be outside the cell, and
  the re-read arm run on the lane's own argv (`rereadReadArgs` / `rereadApplyArgs`: `--print-only --only --lane`).
  The French run's read arm had no `--print-only`.
- `scripts/eval/translation-corpus-audit/` JUDGE-PROMPT.md + IMAGE-ADDENDUM.md (verbatim), draw.mjs's controls and
  score.mjs's gate, for the English stage (`scripts/eval/router-confirm/english.mjs`, new: no existing harness
  translates candidate transcriptions and judges the English against the image).
- `2026-10-23-flash-reread-lite-latin-books-5924.md` (a Flash re-read of lite Latin cut misleading pages from 41% to 8%)
  and the brief's queue test (lite>agy-flash-low+diffqa 10/30, worse than plain lite>agy-flash-low because the guards
  refused 19/30 corrections). Both point the same way as this run.

### Design (set before the data)

- **Cell.** latin-lite/print: 835,238 pages waiting. current.json says "keep lite>opus", and no lane serves the cell.
  Derek's 2026-11-01 row says ship lite>agy-flash-low after a V4 run. So the comparator is the stored text (`lite`),
  the text the cell serves today.
- **Arms on the same pages.** A `lite`, served. B `lite>agy-flash-low`: the #7558 lane's correction read and its dry
  apply with every guard. C `agy-flash-low@4-read`: the #7853 re-read of the page's 4-page block and its dry apply.
  A refused correction or re-read serves the stored text, as the lane would.
- **Frame.** 15,553 visible Latin books with an idle pipeline and no hold. Excluded: 131 books named anywhere in the
  cell's evidence (933 ids across 26 files), plus every book in `lane_judge_verdicts`. Seed 20261103, books in a
  seeded order. In each book, one interior page holding Flash-Lite text that is not human-edited, is tagged
  `<page-type>text`, has 150 or more words and at least 300 characters, and is of the print script class. Of 134 books
  tried, 98 had no such page (90 with no Flash-Lite page waiting), 2 were mixed script and 2 had no page of 150 words.
- **Handwriting (#7947).** 36 pages were drawn and their images checked by eye on contact sheets. **0 showed
  handwriting**, so 0 were dropped. The first 30 in draw order were kept; the other 6 are recorded as surplus in
  `plan.json`. Two of the 30 are Greek pages of Latin-labelled editions (Acta Apostolorum Apocrypha, Athenaeus), and
  one is an English commentary page of a Terence. They are in the cell as labelled and were kept.
- **Judge.** Opus via `claude -p --model opus` on this box's subscription: the route judge `judgeAbsolute`, with the
  image, blind to arm. Identical texts were judged once. There were 2 wrong-page controls, and 74 calls in all, all
  parsed.
- **Bar (rules.json `switch`).** PASS when d = acc(arm) − acc(served) ≥ −0.08 and wrong-text rate(arm) ≤
  rate(served) + 0.04. VOID when a wrong-page control is accepted or more than 10% of pairs lack two verdicts.

### Transcription

| | A served (lite) | B lite>agy-flash-low | C agy-flash-low@4-read |
|---|---|---|---|
| table k/n (evidence) | 528/849 | 540/646 | not in the cell's table |
| fresh accepted | **9/30** (90% Wilson 0.18–0.45) | **14/30** (0.33–0.61) | **20/30** (0.52–0.79) |
| wrong-text pages | 15 | 12 | 6 |
| severe defects / 1,000 words (95% CI over books) | 12.2 (8.5–16.7) | 9.4 (5.6–14.0) | 4.1 (2.1–6.6) |
| wrong-text defects / 1,000 words | 4.7 (2.8–7.2) | 3.9 (1.9–6.5) | 1.3 (0.3–2.5) |
| apply wrote a new text | — | 16 | 26 |
| refused → stored text served | — | 14 (8 change-share guard, 4 UNCHANGED, 1 CONTAIN, 1 scripts) | 4 (2 shared-words guard, 1 scripts, 1 restarted read) |
| **V4 vs served** | | **PASS**: d = +0.167 [+0.033, +0.300]; 5 gained, 0 lost; p = 0.06 | **PASS**: d = +0.367 [+0.167, +0.567]; 12 gained, 1 lost; p = 0.003 |

- **C against B, paired:** d = +0.200 [0.000, +0.400], 8 gained and 2 lost, p = 0.11. Wrong text: 6 against 12.
- **Wrong-page controls:** 0 of 2 accepted (fidelity 1 and 1). Not VOID.
- **The comparator runs low.** The stored text's 9/30 (0.30) is half the table's 0.62. This draw is book-uniform, takes
  body pages of 150 or more words only, and covers 15,553 books, where the table's evidence comes from 10 books.
  Every arm is lower than the table, B by the most (0.47 against 0.84). V1 territory, as in the French run.
- **The guards decide B.** In 14 of 30 pages the correction was refused, and in 8 of those 14 it was the change-share
  guard (corrections that rewrite 26% to 94% of the draft). C was refused on 4 pages. The queue test's diffqa
  variant failed for the same reason.

**Wrong leaf, by eye, image open:** `69bd9e496120d54bd037c4c1` (Mylius, *Opus medico-chymicum*, 1618), page 429. The
image is printed p.384 ("BASILICAE MEDICAE … sordes educit"), and the stored text is printed p.385 ("LIBER TERTIVS.
385 … addunt rubrificantia"). C's fresh read had the right leaf (`<page-num>384`, "fordes educit"), but the
shared-words guard (only 14% of its words in the stored read) refused it and kept the wrong-leaf text live. This is
the French run's Duhem pattern again: the guard that protects against a wrong read also protects a wrong stored
text. **Not contained:** this job was briefed "no production writes". It is raised on #7263.
`69b631541c1c21a37380686e` (*Biblia latina*, 1477) p.742 drops the foot of the left column and repeats the right
column (judge, fidelity 2 in all three arms). That is a quality defect, not another leaf.

### English (Derek's inbox note, 2026-11-03)

- **Translator:** the Latin lane's route today, `latin-cli-agy4` in translation-routing-table.json: gemini-3.8-flash-low
  through agy, the block reader (`claude-translate.mjs read --cli=agy --per-call=4`, the live translation prompt,
  seeded with the stored English of the page before). Each page was translated in its 4-page block. E3 overrides the
  page with B's text. E4 overrides every block page C wrote with C's text. Runs used `--fresh` and
  `CANDIDATE_READS=off`, under the read-only preload, so nothing was written or kept. Where B or C served the stored
  text, the page gets E2's English (same source, no second call). E1 is the stored English: Flash-Lite on 24 pages,
  3 Flash on 2, none on 4 (those 4 pages drop out of the E1 pairs).
- **Judge:** Opus, JUDGE-PROMPT.md + IMAGE-ADDENDUM.md verbatim, 15 packets of up to 10 items, each with its image
  (≤ 1800 px), blind. 98 distinct (transcription, English) items plus 45 controls, all 143 parsed. **Gate PASS:** swap
  15/15 rated ≤ 2, drop 15/15 flagged omission, repeat 15/15 within one.
- **Wrong end to end** = a major English defect, OR the judge saw a misread or wrong leaf in the transcription.

| | E1 stored English | E2 translate-only | E3 correct + translate | E4 re-read + translate |
|---|---|---|---|---|
| pages | 26 | 30 | 30 | 30 |
| wrong end to end | 15 (0.58 [0.38, 0.77]) | 18 (0.60 [0.43, 0.77]) | 14 (0.47 [0.30, 0.63]) | **7 (0.23 [0.10, 0.40])** |
| pages with a major English defect | 6 | 1 | 0 | 0 |
| judge saw a misread / wrong leaf | 14 | 18 | 14 | 7 |
| major English defects / 1,000 English words | 0.58 [0.18, 1.00] | 0.07 [0, 0.23] | 0 | 0 |
| fidelity ≥ 4 | 20/26 | 29/30 | 30/30 | 30/30 |
| **paired vs E1** (n = 26; wrong pages fixed / broken) | | 2 / 3, d = −0.04 [−0.19, +0.12] | 6 / 3, d = +0.12 [−0.12, +0.35] | **8 / 0, d = +0.31 [+0.15, +0.50], p = 0.008** |

- E4 against E3: 7 fixed, 0 broken (p = 0.016). E4 against E2: 11 fixed, 0 broken (p = 0.001).
- **The translator is not the bottleneck; the transcription is.** Re-translating the stored text cuts major English
  defects from 0.58 to 0.07 per 1,000 words, but the page stays wrong wherever the transcription is, and end to end it
  does no better than the stored English. The misread flag is a noisy floor: on the same Flash-Lite text the judge saw
  14 misreads with E1's English and 18 with E2's (#7968 found the same).

### Which option, for the quota

agy calls per page in lane terms. Measured here: C used 31 calls for 120 block pages (0.26), and the translator used
86 calls for 72 four-page blocks (0.30 a page). The rules.json pooled figure for read@4 is 0.72 a page, filter-cut
re-reads included.

| option | readers get (wrong end to end) | agy calls a page | 835K pages, at 39,058 agy calls a free week |
|---|---|---|---|
| translate-only (E2) | 0.60, no better than today | 0.30 | 6.4 weeks |
| correct + translate (B → E3) | 0.47 | 1 + 0.30 = 1.30 | 28 weeks |
| **re-read + translate (C → E4)** | **0.23** | 0.26–0.72 + 0.30 = **0.56–1.02** | **12–22 weeks** |

The re-read gives readers the most, and for less quota than the correction: one call reads 4 pages, against one call a
page for the correction. If only the pages a route writes are re-translated, the translation share falls by the
refusal rate (13% for C, 47% for B).

### Files

- `scripts/eval/router-confirm/confirm.mjs`: `plan --routes= --min-words= --page-type=`, `drop`, three-arm `arms` /
  `judge` / `analyze --results=`. `english.mjs`: `translate`, `judge`, `analyze`.
- `scripts/eval/results/router-v4-latin-lite/latin-lite-print-2026-11-03.json`: per-page verdicts for all three
  arms, defect rates and paired verdicts (ids only, no text).
- `scripts/eval/results/router-v4-latin-lite/english-2026-11-03.json`: the gate, per-arm English rates and pairs.
- The texts, images, raw reads, packets and raw verdicts are in
  `$JOB_SCRATCH/router-confirm/latin-lite-print` on l7a, archived to R2 by the scratch reaper. The OCR arms' reads
  went through cli-ocr.mjs `read`, which keeps a usable read in R2 candidate-reads (#7469), as the French run's did.
  Those are real reads of these pages by the lane's model on the lane's prompt; a later lane run may reuse them.

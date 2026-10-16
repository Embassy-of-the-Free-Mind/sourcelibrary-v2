# Needs map: Readable

**Purpose:** a reader can read the book in English, and read its original legibly.
Derek, 2026-10-16: every page a reader opens reads right, hardest books first, paid for with
subscription capacity that would otherwise go unused. Measure = verified pages per week,
weighted by difficulty and readership, not jobs finished.
**Built:** 2026-10-11 by job `needs-readable-6359`; **refreshed 2026-10-16** by job `needs-refresh-readable-6359`
(#6359). Read-only, $0. Counts are live books (`visible: true && pages_count > 0`, n = 42,357) on `bookstore`,
queried 2026-10-16 16:32 UTC unless a line says otherwise. Ranked queue: `readable.json` next to this file.

## 1. The number

**`readable_in_english` = 20,277 live books (2026-10-16), 47.9% of 42,357.** On 2026-10-11 it was 20,220.

- **How measured:** the named view in `.claude/docs/translation-state.md` (`READABLE_IN_ENGLISH_FILTER`):
  rung `readable`/`complete`, plus English originals at `transcribed`/`translating`. 17,636 are translated
  from other languages and 2,641 are English originals. `homepage_stats.readableInEnglish` read 20,266 at 05:15 UTC.
- **Trend: +57 in 5 days**, after +5,368 in the 11 days before. The translate quality gate's brake has been
  live since PR #6422 merged on 10-12 (`lane_budgets.translate.enrol_paused` is set from the 10-10 NO-GO, and no GO
  is recorded), so new paid translation enrolment is paused. Over the same 5 days the `translating` rung
  grew from 1,274 to 1,994 (+720) and `transcribing` fell by 717: preview stubs finish OCR and then wait.
  This week's gains came from the $0 CLI lanes (Yucatec, cookbooks, stale Siku), which do not read the brake.
- **Ladder (live):** complete 11,837 · readable 7,721 · translating 1,994 · transcribed 9,613 ·
  transcribing 11,001 · no_text 95 · no_pages 96.
- **Derek's measure has no instrument yet.** This week's $0 lanes wrote, each with a sampled check:
  stale Siku English 30,544 pages (#6567, Opus review at 30K: 14 better / 4 same / 2 worse of 20, controls 2/2),
  Yucatec 1,341 retranslated pages plus 4 Princeton manuscripts (#6559), 559 cookbook pages (#6780),
  354 Greek re-reads on Grec 1841 (#6769, 3 of 3 sampled old pages were not this leaf), and 348 seam-repaired
  pages (#6742, 0 of 304 judged worse). A script that turns these into verified pages per week, weighted by lane
  difficulty and `human_read_count`, is queue item 13 (no issue).
- **How to catch it being gamed:**
  1. *Denominator.* The reconciling audit now exists (`translation-state-audit.mjs`, PR #6638). Its first run on
     2026-10-12 PASSED: 0/300 rungs disagree and every headline read 20,189. Its weekly cron line is not
     installed yet (hold list, #5290). The audit also showed that the "38 half-translated readable books" on the
     10-11 map were facsimiles with blank versos, not a fault.
  2. *Bad text counted as readable.* **2,408 readable books are under a pipeline hold** (1,869 on 10-11). Of these,
     1,511 are Paddle-lane Chinese with stale English (#6388/#6567), 297 are `title-leaf-recitation-6297`
     (new since 10-11), 235 are Tibetan `tibetan-retranslation-awaits-derek` (#4523), and 150 are `ia-wrong-leaf-4790`.
     The view still counts all of them.
  3. *Outside check:* the #5826 gate's fabricated-page rate is still the 10-10 NO-GO: 4 of 30 pages carried
     text not on the leaf. It is the only gate row (`quality_gates` n = 1). No gate has run on the CLI lanes that
     moved the number this week.

**Difficult books, ranked by the quality pages** (`src/data/translation-pareto.json`, the data behind
`/quality/pareto`, #6789; reads = `books.human_read_count`, the human-only counter from 07-29, #6809, on 5,428 live books):

| language | in-use fidelity (1–5, date) | paired gain of the best measured engine | readable books | human reads on them | worst × read ((5 − fid) × reads) |
|---|---|---|---|---|---|
| Latin | 4.16 (10-15, n 69) | +0.47 [0.32, 0.62], 3.8 Flash CLI | 8,232 | 7,376 | 6,196 |
| Greek | 3.80 (10-15, n 62) | +0.36 [0.21, 0.51], 3.8 Flash | 945 | 1,059 | 1,271 |
| Arabic | 3.93 (10-15, n 21) | +0.46 [0.23, 0.68], 3.8 Flash | 248 | 998 | 1,068 |
| German | 4.64 (10-15, n 22) | +0.48 [0.21, 0.73], 3.1 Pro | 1,947 | 2,700 | 983 |
| Sanskrit | 3.74 (10-15, n 27) | +0.44 [0.11, 0.78], 3.1 Pro | 332 | 651 | 820 |
| Chinese | 4.00 (10-15, n 21) | +0.24 [−0.10, 0.61], 3.8 Flash CLI | 1,681 | 751 | 751 |
| Hebrew | 4.25 (10-15, n 28) | +0.32 [0.11, 0.56], 3.8 Flash | 196 | 508 | 381 |
| Italian | 4.05 (10-08, n 10) | +0.65 [0.20, 1.15], 3.1 Pro | 459 | 357 | 339 |
| Persian | 3.75 (10-15, n 22) | +0.46 [0.21, 0.68], 3.8 Flash | 41 | 89 | 111 |
| Syriac (print) | 2.98 (10-08, n 20, not fit) | none paired | 4 | 8 | 16 |

Fidelity is model-judged against a published translation, not accuracy. #6545 found Opus beats 3.8 Flash in
Persian, Sanskrit, Chinese, Greek and Hebrew, and #6729 kept Opus over Gemini 4 Argon in all five.
The most-read hard-language books are Picatrix (Arabic, 187 reads), Paramesvaratantra (Sanskrit, 128, held `broken-text-6056`),
the 8th–9th c. Greek Tetraevangelium (127), Kitab al-Bulhan (100), Nuzhat al-Albāb (79; a 10-10 gate page),
*Sepher Maphteah Shelomo* (77, held `ocr-unsettled-6420`) and the Mantua Zohar (54, held). No issue owns
retranslating them on the measured-better $0 route (queue item 3).

## 2. Asked

- **Derek, 2026-10-16:** hard-book translation is the priority: stale Siku English (#6567/#6561), the Kurrent cookbooks (#6780),
  Yucatec Maya (#6559), Greek (#5813), and seams between pages (#6742). He approved the nightly seam runner,
  the Kurrent run of Cpg 555, 293 and 594 (627 stays held), and the G4L re-reads of Rashi and Greek manuscripts (#6769).
- **Reader translation requests ("Translation requested for …"):** 134 rows on 87 books (2 new since 10-11:
  Barocci 233, Greek, 10-14; a Siku *Sishu* volume, 10-13). **72 of the 87 are readable, 15 are not.** 4 of the 15 are Greek
  (Barocci 233 0/776, *Historiae* 0/292, the Poimandres 1/246, an Onomastikon 19/462). Others: Plotinus *Enneaden* 0/396,
  Soarez 0/140, Leowitz 108/174, *Characteres Aegyptii* 1/138, *Triomphe hermétique* 16/174. #3087 is a spare-skip item
  (a standing queue with no code fix; it needs a lane go-ahead, and marking a row `addressed` emails the submitter).
- **Footer reports on seams:** the Chrysoloras letters (10-13) and the Arrian Periplus (09-27) started #6742.
- **Canon gaps:** no recount this week. CBETA Chan has 16 books parked mid-translation (#5566, last activity 10-08).

## 3. In motion

Finishing these comes before starting anything new.

- **Translate brake (#5826).** PR #6422 merged on 10-12, so the 10-10 NO-GO now pauses paid translation enrolment.
  Resuming needs a GO that names the fix (gate handwriting in `OCR_TRUST_TABLE`, #5700; refuse English-declared OCR, T12).
- **Stale Siku English (#6567, #6561).** The 50,387-page run (3.8 Flash CLI, $0) stood at 30,544 written on 10-16, about 60%.
  Reviews at 10K/20K/30K stayed under the stop rule (> 3 of 20 worse). Both "worse" pages at 30K follow a Paddle misread
  (重斤, 尾徑三寸): the reading is the limit, not the translator. The Opus-correct pilot was NO-GO at the over-correction gate (PR #6749).
  PRs #6598 and #6748 (`tier:hold`) are open.
- **Seams (#6742).** 31.4% (24.7–38.4) of 4.40M prose joins are defective and 10.9% are major (Opus reference, n = 300).
  The nightly lean runner (`30 1 * * *`, 2,500 joins, agy 3.8 Flash, 7% Opus sample ≥ 90% or no write) was installed at 07:03 on 10-16,
  so its first night is 10-17. The pilot wrote 227 joins on 348 pages. #6816 merged (write guard `SEAM_GUARD`, off; `--all-joins --top-books`).
  #6802 (cron record) is `tier:hold`. The top-20-books every-join pass (~15K joins, about 3,300 to write, 6 nights) is proposed, not installed.
- **Greek and Rashi manuscripts (#6769).** Grec 1841: 354 of 355 pages re-read with G4L and written. English is being rewritten on the CLI,
  and the book stays held until it is done. Row 2 (87 Greek MS books) follows. **Rashi + mixed (38 books) is blocked:** the
  right-column-first instruction made column order worse (left first on 15/23 pages, up from 6/23).
- **Greek flash re-read (#5813).** The retranslation of the 11,152 changed pages, decided 10-10 at ≈ $13, **has still not run**.
  Those pages serve English made from the old lite reading.
- **Kurrent cookbooks (#6780).** Taillevent 1487 and Ryff 1608 are live and readable. The two-read Opus writer merged (#6804),
  with a 10-page Cpg 555 pilot. The approved run (Cpg 555, 293, 594: ~1,210 pages, ≈ 10–11 h, $0) is not dispatched.
- **Yucatec Maya (#6559).** 15 Yucatec books were retranslated with Gemini 4 Argon Low plus a style line (1,341 pages, 5 refused; PRs #6795, #6801).
  The 4 Princeton manuscripts are live (Ritual of the Bacabs 235/239). Live Maya-language books: 33 (19 readable, 13 complete, 1 translating).
  Enrichment waits for the 00:00 dial. *Silabario* (hidden, 85%) and *U molcabthanil* 1905 are still open. PR #6577 (45 books) is open.
- **Tibetan (#4523).** Yigdzin wrote 81,342 OCR pages (10-14, live and hidden). The 235 readable books held `tibetan-retranslation-awaits-derek`
  still serve English from the invented OCR.
- **Preview stubs (#4719).** 7,041 live books fit the stub shape (7,213 on 10-11); Latin `transcribing` is 7,316.
  Books that finish OCR now pile up at `translating` behind the brake.
- **Merged since 10-11:** #6638 (translation-state audit, #5290), #6644 + the 10-15 backfill (#5292 inputs done: 8 → 0 missing,
  `content_type` 19,862 → 0), #6493 (truncated-ingest detector, #4442: 59 live flagged), #6551 (phone pane picker, #5219),
  #6486 (#4584 featured-quote guard), #6809 (human-only read counter), #6789 (quality/pareto).

## 4. Found, not fixed

- **9,011 live Chinese books are OCR'd with no English** (9,101 non-English `transcribed` in all). They are held behind #6388 on purpose;
  the stale-English run decides how the Paddle reading is trusted.
- **720 non-English books are at ≥ 75% translated with 26,293 pages left** (651 / 24,553 on 10-11). These are the cheapest readable gains,
  and the $0 CLI route used by #6780 and #6559 could finish them without the paid lane (#4685).
- **Newly CLI-translated books look untranslated on every grid until sync-worker restamps them (#6824).** `cli-translate.mjs apply`
  recounts but does not restamp `translation_state`.
- **Books OCR'd out of band never enter the translate lane (#4691).** Spare-skip: the fix changes the paid Phase 4 cron selection (hold list).
- **Carry-over and drift across page breaks (#5026, #5021).** Spare-skip: the code guards shipped. The corpus repair (~2,313 pairs in 1,240 books;
  77,775 drift flags at ~45% precision) needs a reviewed list. The $0 seam runner (#6742) now overlaps both.
- **LaTeX served for Greek (#4580).** Spare-skip: the repair sweep needs a human-approved resume. The code gap (`\aleph` missing from the decoder's GLYPHS) is small and open.
- **Gesner III Russian OCR on Latin (#5215).** Spare-skip: it waits on the #3391 poisoned-cohort re-OCR.
- **Truncated ingests wear a 100% badge (#4442):** the detector flags 59 live books, 50 of them at 100%. Hiding or re-ingesting them is left to a human.
- **Kraken on the 715 Gemini-refused English pages (#4686).** Spare-skip: decided 10-10, but every placement so far was an ARM box, and PR #5969 is `blocked`.
- **Translation fabricates where OCR declined (#4584).** The featured-quote guard merged; the served pages are not repaired.
- **Browse "has translation" still means one page translated, not readable (#5288).** No activity since 10-01; below the queue cut.
- **The original is not legible:** loop OCR on 841 books (#3878), black scans beside English in 10 public Siku books (#6305),
  and IA wrong-page delivery (#4790, 150 readable books held).
- **Dropped from this map since 10-11:** #4937 (closed 10-12, the guard and weekly audit merged), #5292 (done 10-15, open only for closing),
  #5219 (PR #6551 merged, the issue awaits a by-eye close),
  #5274 (superseded in practice by the served-text audit #6691 and the convergent review #6420, Trustworthy map).

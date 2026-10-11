# Needs map: Trustworthy

**Purpose:** the text we serve says what the page says, and we tell readers how good it is.
**Built:** 2026-10-11 by job `needs-trustworthy-6359`, part of #6359 step 2. Read-only, $0.
Mongo figures are from `bookstore`, queried 2026-10-11; "live" means `visible: true && pages_count > 0`.
Every issue number below was checked open on 2026-10-11 unless it is marked as a merged PR.
Ranked queue: `trustworthy.json` next to this file.

## 1. The number

**Share of served pages with a serious error, read against the page image, by shelf.**
A serious error is one that misleads a reader about what the page says (`scripts/eval/spot-check/REVIEWER.md`).

**Now: 23% (21 of 91 pages, 30 books; 95% CI 12–35 by book), canon shelves, drawn 2026-10-06.**
Source: `scripts/eval/experiments/_series-fortnightly-spot-check.md` (#5914). Next draw is due 2026-10-19.

By shelf (shelf overviews, 2026-10-07, 4 random books × 4 pages per shelf, Opus reviewers with the image open;
`scripts/eval/results/spot-check/overview-2026-10-07*/report.md`). Each row is 16 pages, so the intervals are wide:

| shelf | books in frame | serious pages (95% CI by book) | show / caveat / don't |
|---|---:|---|---|
| Japanese | 136 | 88% (63–100) | 0 / 0 / 4 |
| Korean | 246 | 75% (50–100) | 0 / 3 / 1 |
| Chinese | 153 | 50% (13–88) | 0 / 2 / 2 |
| Arabic and Persian | 28 | 47% (25–77), 15 pages | 0 / 3 / 1 |
| Hebrew | 15 | 45% (13–100), 11 pages | 0 / 1 / 3 |
| Latin Kabbalah | 114 | 44% (0–88); 25% of pages a wrong leaf | 1 / 1 / 2 |
| Hindu Sanskrit | 65 | 44% (13–81) | 0 / 3 / 1 |
| Greek and Latin classics | 1,078 | 38% (13–63) | 1 / 1 / 2 |
| Javanese, Old Javanese | 149 | 25% each | 1 / 6 / 1 |
| Chan and Zen, Nalanda Sanskrit, Indian Buddhist | 62 | 19% each | 0 / 11 / 1 |
| Pali, Vajrayana, Tengyur (Nalanda draw), Bhutan Tibetan | 744 | 13% each | 4 / 12 / 0 |
| Tengyur by section (6 sections) | 184 | 0–13% | 6 / 18 / 0 |
| Derge Kangyur | 13 | 0% (0–0) | 0 / 4 / 0 |

Three other instruments exist. They agree in direction and measure different things, so they are not summed:
- **Translation corpus audit** (Opus judge, one page per book, no image): 14.3% of pages carry a major defect
  (CI 7.4–22.3, n = 103, drawn 2026-09-30); baseline 11.4% (7.6–15.6, n = 311, 2026-09-29).
  Invention 15.7%, omission 12.7%, garbled source rendered as prose 9.3%, sense inverted 4.6%.
  The October draw is waiting unjudged on branch `eval/tca-2026-10`. Source: https://sourcelibrary.org/admin/quality
- **Served-text panel** (#6388, mean capped CER of the stored OCR, 30 pages per stratum, 2026-10-10):
  Latin print 3.9%, Chinese manuscript 9.3%, English print 13.4%. The key is an AI consensus, not a human one.
- **Translate quality gate** (#5826, 10 books × 3 pages by eye): first run 2026-10-10 was NO-GO,
  4 of 30 pages carried text not on the leaf.

**Why this one:** it is the only measure that opens the image, so it sees invented and wrong-leaf text.
The corpus audit judges English against our own OCR and scores an invented page as faithful.

**How it could be gamed, and the outside check for each:**
1. *Withholding or hiding lowers the rate without repairing anything.* Report the rate next to the containment
   debt: **about 1,740 live books sit under a text-trust hold today** (1,441 Tibetan under #4523, 150 wrong-leaf
   Internet Archive books under #4790, 81 Syriac under #4883, 37 poisoned reads under #3391, about 30 single-book
   by-eye holds). The number is better only if the rate falls and the debt does not rise.
2. *The same model family draws, reads and judges.* Outside check: Cloudflare Clef's "does this text transcribe
   this image" screen on a fresh random draw (#5803: 36 of 1,497 books flagged, filed 2026-10-04, $0.59). It is a
   different vendor, it is not a judge of English, and it can be re-run for under a dollar.
   Second check: the Gemini second reader on the same pages (#6338).
3. *The draw avoids hard pages.* The fortnightly draw can pick pages no reader sees (`page_number <= 0`,
   5.3% of public books, #5914) and the shelf overviews leave out held books. Fix the frame before 10-19.
4. *Readers disagree with us.* Reader page reports are the last check: 3 in 30 days (all `missing_text` or
   unclassified, since the button shipped 2026-09-30). That is too few to be a rate; count them, do not trend them.

## 2. Asked

- **Derek, 2026-10-10 (#6420):** no human review of non-English text for about a month; make it as good as
  possible with two model families and the image. Added 2026-10-11: every review should also turn error
  clusters into fixes (a cluster at 3× the lane's rate, n ≥ 20 pages from ≥ 5 books, becomes one issue).
- **Derek, 2026-10-08 (PR #6301, `.claude/docs/invariants/containment-on-finding.md`):** invented or wrong-leaf
  text found by eye comes off the page in the same run, with no ask. Why: five invented pages on a funder-facing
  shelf stayed public for two days (#6048).
- **Derek, 2026-10-07 (#6199, #6120, `.claude/docs/quality-statements.md`):** warn with a link to the evidence,
  do not hide; say the measured value and the measured errors, with n and date. 25 books were republished with
  warnings on 2026-10-08; 10 with no recorded check are still hidden.
- **Derek, 2026-10-10 (#5826):** a standing by-eye gate every 300 books or 7 days; NO-GO pauses enrolment.
- **Readers and research agents (feedback, last 90 days: 258 rows, 61 mention text quality by regex):**
  - Wrong English on one page of Llull's *Ars brevis* (1578) and two gaps in Capellanus *De amore*
    (MCP, 2026-10-09, unread, no issue).
  - Plato 1550 p.527, the wax-tablet passage of the *Theaetetus* (MCP, 2026-09-30, unread, no issue).
  - Translation errors in Augustine *Confessiones* VI.3 (MCP, 2026-09-28, #5221).
  - Three `missing_text` page reports in 14 days on three books: Weishaupt p.3, *Histoire de la magie* p.86,
    Plotinus *Enneaden* p.5 (#6490, #6402). None is resolved.
  - "IA put Russian characters, it should be Latin": Gesner III, 341 of 825 pages (2026-09-27, #5215).
  - Untranslated words on a Paracelsus page (2026-09-18); a Tibetan sādhana whose English reads as nonsense (#5004);
    a Balinese lontar whose OCR loops in Thai script on 73 of 423 pages (#4850).
- **Partners:** Eternity (Francis) is the reader for the canon shelves; the spot check before his look found
  5 invented pages in 84 (#6048). The Tengyur draft is published with per-section measured shortcomings (#6120);
  a scholar review has not happened.

## 3. In motion

Finishing these ranks above starting anything new.

- **#6420 convergent AI review** (updated 2026-10-11). Lane A (Tengyur, #6361): 6,492 pages re-read and applied,
  2 of 40 checked pages restored. Lane B (top-read books): 50 books checked 2026-10-10, 8 `fix`, 37 `caveat`,
  5 `show`; 8 live books held `ocr-unsettled-6420`.
- **#6388 OCR routing prereg** (updated 2026-10-11). Job `english-eval-6388` is judging whether the stale English
  on 751 Paddle-read Siku books (75,701 pages) should be retranslated. Job `table-detect-6388` follows the finding
  (noted on #6420, 2026-10-11) that invented text sits on 37% of table and diagram pages against 3.6% of prose. PR #6440 (model-adjudicated
  key) is open, `tier:hold`, and needs a rebase.
- **#5826 quality gate.** PR #6422 is open, `tier:hold`. Until it merges, the NO-GO of 2026-10-10 sets a flag
  nothing reads, and translation keeps enrolling.
- **#5803 page shift.** 151 clean shifts repaired (PR #6369, merged); 13 held books released 2026-10-10.
  Four e-rara books (*Troumbüchlin*, *Pymander*, *De re metallica*, Agrippa) still serve shifted text: the
  override Derek approved is not built into `repair-bulk-jp2-offset.mjs`, and it must run on the main box.
- **#5782 Schutzschrift:** text and image differ on 366 of 367 leaves. The move was decided 2026-10-09; no
  comment says it ran.
- **#4523 Tibetan:** decided 2026-10-10 to translate the 26,440 readable held pages ($40–55) and apply 738
  Yigdzin reads after a by-eye check of 3. Neither ran; both need a main-box job. 1,433 live books are held.
- **#6305 Siku black pages:** 1,657 images repaired 2026-10-10. The check after found most of the stored text
  was read from the black copy; 563 pages of English are withheld and need a re-read.
- **#6048 Eternity spot check:** six pages stay withheld, waiting on #5056 (duplicate leaf) and #6297.
- **#6117 reasoning stored as translation:** write guard merged 2026-10-08 (PR #6158); 550 pages are withheld
  with no English, and re-translating them is unapproved paid work.
- **#6338 second reader:** preregistered, amended 2026-10-09, not yet drawn.
- **#5700 text quality redesign (tracking):** read-time markup repair written to 72,880 stored pages on 2026-10-10.
- **#6367 Aldine Iamblichus:** 313 re-read pages still show English made from the old transcription.
- **#5699 reversed page order:** decided 2026-10-10 (renumber 32 books, then 17, then re-translate 12,218 pages);
  not started, and it is a migration across eight stores.
- **Translation corpus audit, October draw:** branch `eval/tca-2026-10` is drawn and not judged.

## 4. Found, not fixed

No issue below has an assignee; "no owner" here means no job or session has claimed it this week.

- **34 live books whose latest recorded check is `fix` are neither held nor repaired.** `book_checks` holds 385
  rows on 298 books (2026-10-06 to 10-10): latest verdict `fix` 76, `caveat` 161, `show` 61. Of the 76, 73 are
  live, 39 held, 34 not. Nothing checks that each of the 34 carries the reader warning of #6199. No issue.
- **Japanese and Korean shelves:** 88% and 75% of sampled pages serious (16 pages each, 2026-10-07), 382 books in
  the two frames. #6115 names the Japanese lane (English is not a translation of the page on Noh utaibon and
  the Genji Ekotoba); it has no comment since it was filed. Korean has no issue.
- **Wrong-leaf Internet Archive text:** 8,599 stranded pages in 283 books after the 2026-10-02 repair (#5309);
  197 books held `ia-wrong-leaf-4790`, 150 of them live (#4790).
- **Script-recitation candidates:** the #5650 audit ran over 69,882 books; 225 have exotic-script pages and 455 a
  recitation hit. They are ranked on the issue and have not been read by eye.
- **Detectors with no repair:** truncated translations, 66,525 pages in 6,994 live books, 10 of 20 real (#5055);
  echoed source, 4,598 pages, 12 of 20 real (#5058); one page repeated through 198 books, 121 live (#5057);
  duplicate captures, 30,186 pages in 4,249 books (#5056); wrong years in 2–7% of accepted IA English books (#5186).
- **Error classes with no working detector:** dropped lines, class O5, seen in 15 of 78 books by eye (#6326, #5136);
  a dropped negation that reverses the English, 6 books in 3 scripts (#6184); a recited chapter on a title leaf,
  14 Tengyur pages to open (#6297); confabulation on a damaged leaf (#3591).
- **Contained, awaiting a re-read:** Samaritan Pentateuch, 457 pages withheld, no engine reads the script (#5645);
  Ludus Scacchiae, 23 pages (#4808); 81 live Syriac books (#4883); 37 live poisoned-read books including Gesner III
  (#3391, #5215); the derived lane over the 196 withheld Tibetan books (#4757).
- **Single books reported and still wrong:** Idrisi 1619, text one page after its image near pp.268–282 (#5095);
  Bodhicaryāvatāra p.4 is a Latin page from another book (#5848); three Avesta editions serve Buddhist text (#4775).
- **Fabricated text on pages queued for permanent DOIs** (#4960): `quality_score` does not see it.
- **Unread wrong-text feedback:** the Llull and Plato reports above have no issue and are marked unread.

## Surprises

- The number most people quote (the corpus audit's 85.6% of pages rated 4 or 5) cannot see an invented page.
  The image-grounded rate on canon shelves is 23% serious.
- Containment is working and repair is not keeping up: about 1,740 live books are held for text trust, and the
  two largest decided repairs (#4523, #5803) did not run because the deciding job was on a box that cannot reach
  the main box's files.
- A NO-GO quality gate exists that pauses nothing until PR #6422 merges.
- The reader "report a problem" button has produced 3 reports in 30 days. Reader reports cannot be this area's
  number.

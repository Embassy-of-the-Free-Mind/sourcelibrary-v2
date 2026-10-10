---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 107
n_pages: 214
verdict: "Of 107 hand-picked books across nine traditions, two pages each: 43 show, 30 show with care, 34 fix first; a curation worklist, not a rate."
status: informational
decision: "3 books hidden, 4 records relabelled, translationReasoningLeak detector added (#6056)"
superseded_by: null
issue: [5918, 6056]
---
## 2026-10-06 · Which books in Eternity's traditions can we show a scholar today? A hand-picked curation check, not a rate (#5918, #6056)
<!-- PRIOR ART: 2026-10-06-random-book-spot-check-canon-shelves-5914.md (30 books drawn at random from the canon shelves) and the shelf overviews in scripts/eval/results/spot-check/overview-2026-10-07*/ (PR #6079, #6090: stratified random draws with rates) answer "how often is a page wrong". This entry is the hand-picked complement: a worklist of named books, which those draws cannot give and which cannot give their rates. -->

**Question.** A partner judges the library by opening the famous books of the traditions it cares about. Which of those books can be put in front of a scholar now, which need a warning, and which must be fixed first?

**This is a curation check. It is not a rate.** The books were chosen because they are interesting: candidates were listed per language by `read_count`, or looked up by title. Two pages were read in each. The tier shares below describe this list and nothing else: they must not be quoted as the quality of a tradition, a shelf or the corpus. For a rate use the random instruments: the fortnightly spot check (#5914) and the stratified shelf overviews (`overview-2026-10-07`: a frame-weighted serious-page rate with intervals by book).

**Design.**
- **Books.** 107, picked by hand across nine traditions, mostly from public books at least 80% translated. 17 were hidden at the snapshot: some were chosen before publication, some have been hidden since. They sit in the private collection `eternity-spot-check`.
- **Pages.** Two consecutive translated pages from the middle of each book (the page 45% of the way through its translated pages, and the next).
- **Reading.** The transcription and the English were read against the page image. Each book got a tier (1 show, 2 show with care, 3 fix first or do not show), a note with the page to open, and a line on why a reader would open it.
- **Who read.** Three passes, kept apart in every table below because they are not equally strong:
  - *reviewer by eye*: 68 books, read by 7 Opus subagents, one per tradition, each told to open the image;
  - *read from image*: 15 books, read by the session itself with the image open;
  - *earlier session*: 24 books carried over from earlier sessions. Their notes say the page was checked, but how was not recorded. Treat these as the weakest.
- **Cost.** No paid API calls.
- **Data.** `scripts/eval/results/spot-check/curation-2026-10-06-eternity/shelf.json` (one row per book: tier, tradition, who read it, note, page) and `summary.json`. Rights wording is left out; it is in the private ops repo.

**Result.** 43 show, 30 show with care, 34 fix first or do not show.

| tradition | books | show | with care | fix / don't |
|---|---:|---:|---:|---:|
| Sanskrit (Nālandā, Prajñāpāramitā) | 6 | 4 | 0 | 2 |
| Tibetan | 16 | 6 | 5 | 5 |
| Pali | 10 | 5 | 4 | 1 |
| Chinese | 18 | 8 | 5 | 5 |
| Korean | 9 | 4 | 3 | 2 |
| Japanese | 9 | 1 | 3 | 5 |
| Hebrew and Aramaic | 15 | 3 | 4 | 8 |
| Arabic | 13 | 6 | 4 | 3 |
| Persian | 11 | 6 | 2 | 3 |
| **all** | **107** | **43** | **30** | **34** |

| who read | books | show | with care | fix / don't |
|---|---:|---:|---:|---:|
| reviewer by eye | 68 | 26 | 24 | 18 |
| read from image | 15 | 7 | 3 | 5 |
| earlier session | 24 | 10 | 3 | 11 |

The tradition is the book's catalogued language on 2026-10-06, before the label fixes below. One English edition of a Korean author is counted under Korean.

**Defect classes.** Each was seen on the pages named; the label says who saw it. None is a count.

| class | what a reader meets | examples | seen by |
|---|---|---|---|
| Leaked model reasoning as the English | "Wait, the prompt says: Style: warm museum label" where the translation should be | `69e7484085f786e884a4c10f` p.20 (Life of Tsangpa Gyare) | reviewer by eye |
| Repetition loop | one phrase or word repeated to the end of the page, sometimes translated as such | `69dfebad090ad7d5c33b1903` p.32 (Kojiki vol. 1); `69e76134cc48e59ad74ee309` p.143 (gold-ink Aṣṭasāhasrikā) | reviewer by eye |
| | | `69c7a0a892b884e4f8173817` p.57 (Zohar Ḥadash 1702) | read from image |
| Verse half-lines or columns out of order | half-lines paired wrongly; a whole column missing | `69e74eeb5cf1eaf3ad80ddc1` p.190 (Ḥāfiẓ 1957); `6976db51097b3607ee4be2f9` p.133 (Avodat ha-Kodesh 1578) | reviewer by eye |
| | | `69e7299ba409200ea79f0b56` p.150 (Masnavī, Bulaq 1851: the Turkish columns unread) | read from image |
| Rabbinic type garbled under good square type | the main text is right and the commentary below it is guesswork | `6990633def12272ffdc907b0` p.277 (Zohar, Mantua 1558); `699ef9f2c2bcb75dbdbaad92` p.101 (Sha'arei Orah 1715) | reviewer by eye |
| Cursive Japanese: the English is not a translation | the kuzushiji reading is good or near, and the English is nonsense or a summary | `69dfedec8d34461cbe7f4fc2` p.45 (Tsurezuregusa); `69dfeded8d34461cbe7f5026` p.12 (Hōjōki) | reviewer by eye |
| Negative page numbers | the pages drawn are numbered below 1 and show a blank or the title page | `699243fabc722ec0ee80b251` (Prague Haggadah 1526); `69b6363a8ab57a1de53a75c8` (Ikhwān al-Ṣafāʾ, Bombay 1887) | reviewer by eye |
| Wrong title or language on the record | the book is not what its label says | `69e8b27a2ff2a8dc09e77e4c`, `69e748aa85f786e884a4ca1f`, `69e9617a2beefe2f6f72ba14`, `69920ba8e0a548a13d8846fe` | reviewer by eye; then each title page and the page-language tags of every page read for the fix |

Pages numbered below 1 are soft-hidden records and are not rendered (`scripts/lib/page-counts.mjs`), so the two "negative page number" books are a finding about what the check drew, and their body text was not read.

**What it changed.**
- **Hidden** (`broken_text_6056`, reversible): Zohar Ḥadash 1702, Kojiki vol. 1, Life of Tsangpa Gyare.
- **Labels corrected** (`scripts/maintenance/fix-6056-eternity-shelf-labels.mjs`, applied 2026-10-06, a `sweep_log` row each):
  - `69e8b27a2ff2a8dc09e77e4c`: title 傳習錄 (Chuanxilu) → 陽明先生集要 經濟編 卷四. It is the statecraft part of the 1787 *Yangming xiansheng jiyao*, volume 7.
  - `69e748aa85f786e884a4ca1f`: Persian → English-French-German, with the title-page title. It is Dole's 1896 variorum of translations around FitzGerald; `original_language` Persian, `text_role` modern-translation.
  - `69e9617a2beefe2f6f72ba14`: Hebrew → Hebrew-English. Asher's 1840 volume holds the Hebrew text (156 of 319 pages) and his translation (175). The reviewer's "it is English" came from one page.
  - `69920ba8e0a548a13d8846fe`: Persian → Middle Persian-English (Pahlavi text on 193 of 428 pages, English on 210).
- **A detector for the first class**: `translationReasoningLeak()` and `scripts/audit/translation-reasoning-leak.mjs`. Its corpus count is its own entry (`2026-10-06-translation-reasoning-leak-6056.md`): at least 549 pages in 269 public books. One of them is a tier-1 book on this shelf: the Bardo Thödol cycle `69dfee83ce6bb8619e07f177` has seven such pages, none of them the two that were read.
- **The method** is now a variant of the `shelf-overview` skill: `overview-draw.mjs --picked`, `CURATION-ADDENDUM.md`, `curation-shelf.mjs`. `overview-score.mjs` refuses a picked run, so no rate can be formed from one by accident.

**Limits.**
- Chosen books, two pages each: a tier-1 book can hold bad pages elsewhere, and a tier-3 book may be bad only where it was opened.
- The readers are AI. Their confidence on cursive Japanese, rabbinic type and Tibetan manuscript hands was low at the stored image size, and those are the scripts where most tier-3 verdicts fall.
- One reviewer per tradition and no second read, so there is no agreement figure.
- 24 of the 107 verdicts have no record of how the page was read.

*Replicated?* No. The stratified random overviews of the same traditions (PR #6079, #6090) are the independent look; they share no books by design and measure a different thing.

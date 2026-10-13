---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 40
n_pages: 40
verdict: "Invented text is not the dominant failure: 0 of 40 uniformly drawn served pages were invented (Wilson 0-8.8%); misread or mistranslated words in fluent English were on 12 of 40."
status: informational
decision: "29 pages in 8 books withheld by eye (#6420); measure notes posted to #6203"
superseded_by: null
issue: 6420
---
## 2026-10-11 · Is invented text the dominant failure a reader meets? A by-eye re-check of the cited pages and a uniform 40-book draw (#6420)
<!-- PRIOR ART: 2026-10-06-random-book-spot-check-canon-shelves-5914.md (30 canon-shelf books, six Opus readers, "invented" on 5 books); 2026-10-10-paddle-zh-random-qa-6388.md (60 random Paddle pages, 0 invented); _series-monthly-translation-corpus-audit.md (text-only judge, no image). None re-types the pages earlier runs called invented, and none draws uniformly from served translated books with the image open. -->

**Question.** Derek, 2026-10-11: "I don't believe the invented text is as big of a problem as you think — look into it qualitatively." The claim under test: invented text (text not on the leaf, rendered as fluent English) is the dominant failure across canons.

**Design.**
- **Reader.** One reader (the session, Opus 5.5), every page with its image open. No second read, no paid call. $0.
- **Part 1, the cited pages.** Every page I could locate that #5826, #5929 (per-book notes in the ops repo), #6388 and #4149 called invented: 16 typed, 13 with the image and 3 from the stored text only (marked). For #6388's 70 unconfirmed pages I took a seeded 12 (sha256 of `6420` + the line), checked what each serves, and read 2 against the image.
- **Part 2, the uniform draw.** Frame: `visible: true, pages_count > 0, pages_translated > 0` = 23,258 books, sorted by `id`. Seed 6420 (mulberry32), 40 distinct random skips, then one random page among that book's pages with non-empty `translation.data`. No `$sample`.
- **Typing.** One primary kind per defect: invented content (no basis on the leaf) · show-through or blank-leaf fill · page-boundary or facing-page import · illegible-fill guess · misread (real text, wrong words) · translation error or structure error · omission · gloss in a marked note (counted only when wrong). Severity: clean, minor, material (three or more meaning-changing errors, or a quarter of the page lost).
- **How much of each page I compared.** Short pages in full. On long pages the opening and closing passages of both layers, plus whatever the image made doubtful. A defect in the unread middle of a long clean-looking page would be missed.

**Result 1: what the cited "invented" pages are.**

| source | page | what is on the leaf, and what was stored | kind | served on 10-11? |
|---|---|---|---|---|
| #5826 | Meʾirat ʿEnayim `69c1bb13…ca86` pp197–199 | 27 lines of Sephardic cursive; the OCR has 27 lines, almost every word wrong. The English is word salad ("That the printing shall be established, and everything was called and copied…") under a fluent invented `<summary>`. | illegible-fill guess ×3 | No: withheld 10-10 after six days served |
| #5826 | Paganus `6a4e3834…129b` p28 | Blank verso showing the recto in mirror image. OCR opens with a warning, wraps every word in `<unclear>`, and several words match the mirror text. English keeps both. | show-through fill, self-flagged | No: withheld 10-10 |
| #5826 | Nösselt `69b51e5b…1b4e` p779 | Kurrent flyleaf, a numbered list of 15 titles. The OCR has the 15 items and real anchors (Pestalozzi, Basedow, Rochow, Niemeyer, the dates); words between are guessed and marked. English drops the marks. | illegible-fill guess, partly right | Yes |
| #5929 | Shi Hu scroll `69f1344a` p1 | A 2000×121 px strip; no character is legible. The OCR recites *Avataṃsaka* fascicle 41 with a dated colophon; the book is another sutra. 4,624 characters of fluent English. | **invented content** | Yes, until this run withheld it |
| #5929 | Shi Hu p3 (text only) | A readable leaf; one 5-character gloss is wrong. | misread | Yes |
| #5929 | Bencao gangmu `69e787fd` p78 | The leaf prints one column. The English adds a second colophon and a preface paragraph: both are p77's text (Wu Zhe's preface), repeated. #5929 called it "in neither OCR nor image". | page-boundary import | Yes |
| #5929 | Bencao gangmu p80 | The OCR drops the opening clause on the Chong vessel and writes a stock phrase about the Dai vessel instead (9 characters of about 750), and renames two vessels. The other nine-tenths is faithful. | misread, one clause supplied from memory | Yes |
| #5929 | Strījātaka `69906559` p11 | A clear Devanagari manuscript. Verse numbers and many words are right, word division and about one akṣara in four are not. English is fluent astrological rules hung on the planet names it could read. | misread, smoothed into a gist | Yes |
| #5929 | Huangji jingshi `6a0a4f16` p103 | A rime chart. The "invented margin note" is the leaf number misread; one extra character. | misread on a table | Yes |
| #5929 | Aitareya Āraṇyaka `69dea5f2` p138 (text only) | The cited items are a wrong term and `original:` notes in the English. | translation error | Yes |
| #6388 | 三才圖會(七十七) `6992ce24` p9 | Formation diagram: 8 軍 printed per row, Paddle wrote 10 and 9. Every other label is right. The served English says "Troops" eight times. | misread (repeat count) | Chinese only; the English predates it |
| #6388 | 洪範皇極內篇 vol 4 `6a3cbf00…49e6` p25 | Counting-rod chart; the rods are dropped and the omen words run on. | misread of a chart | No English exists |
| #6388 | 三才圖會(六十五) `6992cdf6` p46 (text only) | Qin tablature read as runs of 苫/筍 between correctly read lyrics. | illegible-fill on notation | English predates it |
| #4149 | Spanda-Kārikās `69e13a7c` p1 | A blank white page. Its fabricated OCR was quarantined on 08-21; the English made from it (a Latin Catholic treatise) stayed. | **invented content** | Yes, until this run withheld it |

- **Count.** Of 16 pages labelled invented, **2 are invented content**, 5 are illegible-fill guesses, 1 is show-through, 1 is a page-boundary import, 6 are misreads and 1 is a translation error.
- **#6388's 37%.** Of the seeded 12 unconfirmed pages, 5 have no English at all and 7 serve English made from the earlier Gemini reading, and all 12 books are held. A Paddle overrun reaches a reader as surplus glyphs in the Chinese transcription, never as English. The 10 confirmed pages are no longer served in the Paddle reading.
- **Two lookups in the brief were wrong, not the data.** `6a4e3834` matches 8 books and `69b51e5b` matches 5; the first match was a different book each time. And Meʾirat's English is empty because the gate withheld it, not because none was served.

**Result 2: the uniform draw (n = 40 books, one page each).**

| measure | pages | rate | Wilson 95% |
|---|---:|---:|---|
| invented content (page level) | 0 / 40 | 0% | 0–8.8% |
| blank-leaf, show-through or illegible fill, any span | 1 / 40 | 2.5% | 0.4–12.9% |
| any words with no basis on the leaf (adds neighbour-page junk and one added heading) | 4 / 40 | 10% | 4.0–23.1% |
| misread words carried into the English | 6 / 40 | 15% | 7.1–29.1% |
| translation error or structure error | 7 / 40 | 17.5% | 8.7–32.0% |
| misread or translation error | 12 / 40 | 30% | 18.1–45.4% |
| page-boundary or facing-page import | 5 / 40 | 12.5% | 5.5–26.1% |
| omission | 2 / 40 | 5% | 1.4–16.5% |
| English older than the current transcription | 4 / 40 | 10% | 4.0–23.1% |
| **clean** | 24 / 40 | 60% | 44.6–73.7% |
| **minor** | 11 / 40 | 27.5% | 16.1–42.8% |
| **material** | 5 / 40 | 12.5% | 5.5–26.1% |

By script family (drawn uniformly, so the cells are small): Latin 12 (8 clean, 3 minor, 1 material) · Greek 5 (1, 1, 3) · Chinese 5 (1, 3, 1) · Tibetan 5 (4, 1, 0) · German 4 (3, 1, 0) · English originals 4 (4, 0, 0) · French 2 (1, 1, 0) · Dutch 2 (2, 0, 0) · Arabic-catalogued 1 (0, 1, 0).

The five material pages:
- **Plotinus, Greek minuscule MS** `69a5e5d9` p58. About one word in five misread on the lines checked (τοῦ σοφοῦ γειτνιάσεως → τοῦ σωφρονεῖν ἐπιτάσεως). The English is fluent and wrong where the reading is wrong.
- **Nonnus, editio princeps** `69938d5f` p337. Five misread words in 25 verses, each carried into the English ("sweet-voiced singer" for "unarmed").
- **Matron's parody, Greek print** `69b2f430` p138. The OCR is close; the translation fails on the hard lines and covers the guesses with "likely referring to" notes.
- **Peiwen yunfu** `6a3c64b2` p74. The dictionary's ditto strokes are translated as a headword "One-One".
- **Astronomical miscellany, Latin cursive MS** `69f333b2` p18. A quarter of the page is dropped at a column change, and misread words are stated flat ("a bastard, and [subject to] coitus").

The one fill: `69e78adf` p2, a Tibetan frame whose lower leaf is blank. The OCR emits rows of shad marks and a phantom phrase; the English gives one sentence ("Impurities and those remaining in me…") and then says the rest is incoherent. Leaf 1 is right, so the page is not withheld.

Things the draw shows working: a 1640 folio with mirrored show-through between every line read without any fill (`6a08fd01` p113); four of five Tibetan pecha pages matching the image syllable for syllable on the lines checked; Fraktur, blackletter Dutch, incunable type and two-leaf Chinese spreads read faithfully.

**Conclusion.** The claim is overstated.
- **How often.** On a page drawn uniformly from served translated books, invented content was 0 of 40, so at most about 9% and probably far lower: #4149 estimated about 678 blank-leaf pages in 21,481 books. Text with no basis on the leaf, counted generously, was 4 of 40, and three of those four are one word or one heading.
- **What "invented" covered.** Earlier runs used the word for six different things. Only two of the 16 cited pages are text with no basis rendered as fluent English.
- **The dominant reader-facing failure is a misread or mistranslated word inside fluent, confident English**: 12 of 40 pages, material on 5 of 40, and 3 of the 5 Greek pages. The reader cannot see it, because nothing marks the wrong word.
- **Where invention is real.** It needs an input the model cannot read: a blank leaf, an unreadable image, a cursive manuscript. There it is the worst failure we have, because the whole page is false. It is rare and it is detectable from the image; it is a containment problem, not the general quality problem.
- **English is rarely fluent on a failed read.** On Meʾirat and Paganus the English was salad or hedged word by word. The fluent part was the `<summary>`.

**Contained in this run** (`containment-on-finding.md`): 29 pages in 8 books, each seen by eye.
- Looking for Spanda's siblings: 591 pages carry a `#4149` quarantine revision; 43 of them have empty OCR and still serve the English made from the quarantined text, in 8 visible books.
- Withheld: Zuni Fetiches `69a565b9` 16 pages, Spanda-Kārikās `69e13a7c` p1 and p4, Comenius `69ef3e58` p4 and p8, De Animalibus `69aea7c2` p809 (blank leaves, pure white or empty); Henry More `695259b3` p300, 302, 380, 680 and Winckelmann `69ef3da0` p18 (blank versos with show-through); *Lo rgyus rin po che'i phreng ba* `69e782f2` p8 and p35 (real leaves, English from the quarantined Sanskrit reading); Shi Hu `69f1344a` p1.
- Holds: `blank-leaf-english-orphan-6420` on six books, `unreadable-strip-invented-5929` on the scroll; the Tibetan book was already held.
- **Not contained:** 14 pages of Sushruta Samhita vol. 3 `6958ea82` with negative page numbers (−521 to −534). The withhold tool refuses page numbers below 1. The book route serves `page_number ≥ 0`, so a reader does not open them there; whether search or embeddings still carry their English I did not check.

**Which measures produced the inflated picture** (posted to #6203):
1. One label for six kinds. "Invented" covered a repeat count off by one, a neighbour page's text, a misread and a gloss.
2. Flagged-page sampling. #6388's 37% is a rate among the 0.3% of pages a loop screen flagged.
3. Pages in one book counted as independent. Three of #5826's "4 of 30" are consecutive pages of one manuscript.
4. Stratifying by script family, or hand-picking (#6048), then quoting the result without the stratum weights.
5. Counting pages no reader is served: Paddle pages with no English, a hidden book, pages already withheld.
6. One model counting cells in a dense grid, unconfirmed (70 of #6388's 80).
7. In the other direction: a quarantine that checked the OCR and left its English. 43 served pages sat outside every count.

**Replicated?** No. One reader, one draw.

**Limits.**
- n = 40, one page per book: the intervals are wide and the per-script cells are anecdotes.
- The draw is uniform per book, not per page and not weighted by readers; the most-read books (#6420 lane B: 43% serious on 283 pages) are harder than this.
- The reader is an AI. Tibetan and Chinese translation nuance is medium confidence; the transcriptions I checked against the image directly.
- Long pages were compared at the head and tail, not line by line.
- "Material" here is three or more meaning-changing errors; lane B's "serious" is a lower bar, so the two rates are not comparable.

**Artifact.** Draw, per-page verdicts, images and notes: `/data/scratch/sl/jobs/invented-qual-6420/` (`draw.json`, `verdicts.jsonl`, `notes.md`, `eye/`). Draw script: `tool/draw.mjs` there.

<details><summary>The 40 pages</summary>

| # | book | page | language | verdict | kinds |
|---|---|---|---|---|---|
| 1 | `6a26c3fdaad44c98627cc83c` | 15 | German | minor | misread (gestäupt → geköpfft) |
| 2 | `69c82cf56c6f3cc53c84d07c` | 182 | French | minor | facing-page sliver, one word |
| 3 | `69b51e3247b06ecd5818bd55` | 21 | Latin | clean | |
| 4 | `69c85f436c6f3cc53c8554a8` | 8 | Dutch (catalogued German) | clean | |
| 5 | `69a5e5d91d73f9668388ef2b` | 58 | Greek MS | material | misread, smoothed gist |
| 6 | `6a1d81ba5afc14a085e6dbe2` | 88 | Chinese | minor | translation error |
| 7 | `69c80b306c6f3cc53c846684` | 15 | German | clean | |
| 8 | `69d5ac2ed0bd3547a565582f` | 66 | German notes (catalogued Arabic) | minor | misread |
| 9 | `69b2f4300e2f024dfbfbbc64` | 138 | Greek | material | translation error |
| 10 | `6a4e40de7eab4a625dd056af` | 15 | Latin (music) | clean | |
| 11 | `69af48af2a821385be062832` | 99 | Latin | minor | translation error, page boundary |
| 12 | `6992c91569b777d72c7633f7` | 92 | Chinese | minor | added heading; notes correct |
| 13 | `69b65d6fb3f4fc0441517c21` | 4 | Latin | clean | |
| 14 | `69e7ab9b5f1a22ab19a9ad39` | 6 | Tibetan | clean | |
| 15 | `69e7ab465f1a22ab19a95c5b` | 229 | Tibetan | clean | |
| 16 | `69e7ab735f1a22ab19a98cbe` | 80 | Tibetan | clean | |
| 17 | `69a5ed7196d6dd816a56a9be` | 262 | English | clean | |
| 18 | `69b2f3e9a9a500a45e5e8fd3` | 122 | Latin | clean | page boundary (sentence completed) |
| 19 | `6953e59077f38f6761bf0dc6` | 83 | Latin | clean | |
| 20 | `6a08fd0125e3a402b23b3365` | 113 | English | clean | |
| 21 | `69dbcc830f8c5edf20f4c80e` | 7 | Latin | minor | omission, translation error |
| 22 | `69b525bd6be6046083031b13` | 101 | Dutch | clean | |
| 23 | `6992cf2070ab373755545a39` | 74 | Chinese | minor | translation error; English older than OCR |
| 24 | `69b51d07261c58d6366488c5` | 23 | Latin | clean | |
| 25 | `69e78adf4a6785cfd60d4d40` | 2 | Tibetan | minor | blank-leaf fill, one sentence |
| 26 | `69b2f45d5ef23d31023f6138` | 215 | Latin | minor | translation error |
| 27 | `69938d5f5d28b693146cede1` | 337 | Greek | material | misread |
| 28 | `6a3c64b239b4508b04e29445` | 74 | Chinese | material | structure error, misread; English older than OCR |
| 29 | `69e7abd45f1a22ab19a9ef57` | 376 | Tibetan | clean | |
| 30 | `6992cf69f5b4f75c1a4c8d6d` | 41 | Chinese | clean | English older than OCR |
| 31 | `69ef3d3272c1376fdf2afdec` | 90 | Latin (Greek–Latin edition) | minor | facing-page sliver; English older than OCR |
| 32 | `6ab77b716b38d27997d19ff9` | 277 | Dutch | clean | |
| 33 | `697e23c98953b9fd64fe75f5` | 136 | Latin | clean | |
| 34 | `69a684dfb3d8052782b3d10d` | 94 | French | clean | |
| 35 | `69b4c0a386a5921d5bc44f2f` | 53 | Greek MS | clean | |
| 36 | `6991bd3e70254d38471e34ce` | 24 | English | clean | |
| 37 | `69c7391b6a0f3d112faf78ab` | 15 | German | clean | |
| 38 | `69dbc84b1040d1d5e2098256` | 15 | Latin | clean | |
| 39 | `69f333b2876dd827cbc4bc69` | 18 | Latin MS | material | misread, omission, smoothed gist |
| 40 | `69a5534a627bcf18a5c33b4e` | 342 | English | clean | page boundary (five words) |

</details>

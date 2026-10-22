---
stage: ocr
measure: judged
languages: [ja]
scripts: [Jpan]
canons: []
n_books: 10
n_pages: 10
verdict: "The 2026-10-01 NDL古典籍OCR v3 full run (96 books, 6,148 pages written) gives the right text of the page on 10/10 pages read against the image, 0 invented. Errors are kanji substitutions (0–7 a page), lines read off seals or the neighbouring leaf, and furigana promoted to a line."
status: informational
decision: "The NDL readings stay. The 116 books stay HELD (ndl-koten-lane-4925) until re-translation of the stale pages is approved as a separate priced go; this check clears the 'by-eye check before any hold is released' step from #4925"
superseded_by: null
issue: [5100, 4745, 4925]
---
## 2026-10-22 · Is the NDL full run's text the page? A by-eye check of 10 written pages (#5100)
<!-- PRIOR ART: scripts/eval/results/ndl-koten-pilot/eye-read.md (the pilot's 10-page check, same lane, 20 other books); the #4925 comment of 2026-10-01 (the full run's counts). -->

**Situation.** The brief for job `ndl-lane-5100` asked for the full run on the ~96 cursive books outside the pilot.
Mongo says it already happened: the run of 2026-09-30/10-01 on a leased L4 (`sl-ndl-koten-full`, commit `939cbfa`,
1.4 s/page) wrote **6,148 pages across all 96 books** (`ocr.engine.run = ndl-koten-2026-09/2026-10-01`), and all 96
are held `ndl-koten-lane-4925`; the counts were posted on #4925 but not on #5100. A re-run would rewrite the same
pages with the same engine, so this job did not re-run it. What #4925 left open was a by-eye check of the full run
before any hold is released. This is that check.

**Draw.** 10 of the 96 books (seed 5100), one page each with > 150 characters of NDL text, drawn at random from the
book's pages written by the full run. Opened at full resolution against `ocr.engine.input.image_url`.

| book | p. | right text? | errors seen |
|---|---|---|---|
| Ise monogatari (伊勢物語) | 23 | yes, dan 87 (the Nunobiki falls) | none noticed |
| Kanze utaibon 14 (Hanagatami) | 42 | yes | 甘泉殿→処, ふるき→ぶるき; two margin glyphs read as 一十 / 元禄 |
| Kanze utaibon 16 (Ashikari) | 12 | yes | one □□□ line, a few kana |
| Kanze utaibon 18 (Seiganji) | 33 | yes | 和泉式部→式ア, a few kana |
| Kanze utaibon 19 (Morihisa) | 14 | yes | none noticed |
| Niwa no ki (庭之記, MS) | 2 | yes | the ownership seals read as 田畑 + two □□□ lines |
| Nihon saijiki 1–2 | 15 | yes | 十五日→十九日, 三元→三才, 閩俗→国俗, 入液/出液→入瀬/出夜 (≈ 6) |
| Nihon saijiki 6–7 | 72 | yes | first line read off the neighbouring leaf; 爆杖→杖, 焦氏筆乗→鳥業 (≈ 6) |
| Shōni hitsuyō sodategusa 1 | 33 | yes | 巳亥→己亥, 午未→午来; furigana むまひつじ as its own line |
| Imo hyakuchin (甘藷百珍) | 75 | yes | heading 叙→親方; 救荒→救道, 日用→御用 (≈ 7) |

**Result.** 10/10 pages are the text of the page, in reading order, 0 invented (no containment needed). Running kana
and hentaigana (Ise, the utaibon) read cleanest; the errors concentrate in kanji in the dense kanbun-mixed prose of
the encyclopaedic books, where one in a few dozen kanji is a near-shape substitute — including a date (十五日→十九日),
which matters to a translator. Seals and the neighbouring leaf's edge produce short spurious lines. These match the
convention note carried on every page (`ocr.engine.conventions`).

**What it does not show.** Character accuracy: no reference transcription exists for these books, so this is a
judged right-page/wrong-page verdict with the slips noticed, not a CER. 10 pages, one per book.

**What is held, and what translation would cost.** 116 books (96 full run + 20 pilot; 77 visible) held `ndl-koten-lane-4925`;
7,133 pages carry the NDL reading; 3,573 of them (re-measured 2026-10-22) carry a translation marked `translation_stale` (made from text that
is gone); 0 jobs queued for these books since 10-01. Re-translation is NOT in this job. #6056 found the English lane, not the OCR, failed on these books, so the
re-translation needs its own lane decision before it is priced.

**Also in this job.** The Meiji modern-print question (does NDLOCR beat lite on typeset Meiji pages?) is
preregistered in `scripts/eval/ndl-meiji-5100/PREREGISTRATION.md`, 20 frozen pages; its read runs on the GEX45.

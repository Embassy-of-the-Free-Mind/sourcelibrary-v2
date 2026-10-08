# #5762 track 2 — two human transcriptions of one page, Chinese

**Result: 54 pairs, 54 distinct works, one page each, all from one source pairing — CBETA against SAT, both
transcribing the Taishō (大正新脩大藏經).** Three of the pages are in a book we hold (Taishō vol. 8,
`69b99f786ed9e0490990abcf`), so `ours` is filled on 3 rows and null on 51. Every other pairing the brief named was
ruled out as one e-text on both sides (`rejected.jsonl`, 8 entries).

Both texts are restricted: CBETA is non-commercial (CC BY-NC-SA), SAT's terms allow academic/non-profit use and
prohibit redistribution. Both are marked in `licence`; neither text should go into the repo.

## What was searched, and what each turned out to be

| Pairing | Verdict | Why |
|---|---|---|
| Kanripo KR6 vs CBETA (the issue's suggestion) | rejected | Kanripo's Readme names CBETA as its base; 10,991 of 11,000 Han characters identical on 長阿含經 卷一 |
| Kanripo WYG vs zh.wikisource `(四庫全書本)` | rejected | 10,166 of 10,178 Han characters identical, zero substitutions, on 孟子注疏 卷十二上; Wikisource is a 2016 bot import, unproofread |
| Kanripo WYG vs zh.wikisource `Page:文淵閣四庫全書 …` | rejected | 83 proofread pages in the whole wiki, 71 of them reprint front matter; the page text is generated from the Wenyuange electronic edition |
| Kanripo WYG vs ctext.org | rejected, not measured | could not show the ctext text is human-made (OCR-based, no proofread status; site refused the fetch) |
| Kanripo SBCK vs zh.wikisource `(四部叢刊本)` | rejected | 5,289 of 5,326 Han characters identical on 新語 卷上; all pages bot-imported and 未校对 |
| CBETA vs SAT, the 98 CBETA files naming SAT as a source | rejected | CBETA's header says SAT's text was an input |
| CBETA/SAT (Taishō) vs Kanripo WYG, same Buddhist work | rejected | different editions |
| **CBETA vs SAT, files not naming SAT** | **collected** | below |

So none of the 36 Siku Quanshu pages in `align.json` has a second human transcription: every freely available
WYG text found (Kanripo, Wikisource main namespace, Wikisource Page namespace) goes back to the same Wenyuange
electronic edition. Kanripo's WYG Readme does not name its source; the identity was established by comparison, and
the Wikisource Page history names the electronic edition (`.xdf`) outright.

## CBETA vs SAT: how independent

- **Separate projects, separate texts.** CBETA (Taipei) built its Taishō from electronic versions supplied by
  named contributors, collated against each other and the print; each file's header lists them. SAT (Tokyo) keyed
  its own. The two are visibly not one e-text: CBETA normalises to standard traditional forms (為 說 眾 緣 德),
  SAT keeps the printed forms (爲 説 衆 縁 徳), and by the page images SAT's forms are the print's.
- **Not untouched by each other.** CBETA's headers name SAT as a source for 98 of 2,459 files — those are
  excluded. The reverse direction (SAT proofreading against CBETA) is not documented on SAT's site; I could not
  confirm or rule it out. Wittern's account of CBETA (JoDI) says only that the two "cooperat[e] closely" on rare
  characters. Treat the measured floor as a **lower bound**: errors both projects caught by comparing with the
  other are gone.
- **Some CBETA inputs were OCR** (`CBETA 自行掃瞄辨識`, `佛教藏 OCR 小組輸入` appear in headers), later
  proofread by people against other inputs. It counts as human-proofread, but it is not pure double-keying.
- **The 98 SAT-named files look the same as the rest** on a sanity check (residual differences 0.11% on 13 pages
  against 0.17% on the 54 collected), so the header is the only thing separating them; the exclusion is on
  CBETA's word, not on a measurable signature.

## What the sanity check showed (the scorer owns the real numbers)

Over the 54 pages, 72,549 Han characters, punctuation ignored:

- Raw character differences: 2,737 (3.8%).
- Of those, 2,614 are 54 recurring glyph-convention pairs (為/爲 690, 說/説 329, 眾/衆 311, 緣/縁 219, 德/徳 155 …).
  **Whether the scorer folds these decides the headline**: unfolded, the "human floor" is ~3.8%; folded, it is
  roughly 0.1–0.2%.
- The remaining ~120 are 91 rare pairs plus 12 insertions/deletions. Many of the rare pairs are also glyph
  variants (凉/涼, 腳/脚, 峯/峰); the genuine disagreements are look-alike readings such as 使/便, 住/往, 已/己,
  仁/人, 傅/傳, 因/固, 四/匹, 昧/味, and a few dropped or doubled characters (SAT 嫉妒妬心, SAT missing 瓔).
- Not checked: which side is right in each genuine disagreement. That needs the page image per case.

## Cut method

Both sources carry Taishō page/column/line numbers, so each page is cut to lines `a01–c29` (87 lines) by each
source's own markers — no anchor matching. Apparatus, footnote callers and editorial notes are dropped on both
sides. CBETA's `<app>` is resolved to the 【大】 reading, which undoes CBETA's own corrections of the print, so both
sides are transcriptions of what is printed. Inline small-type notes, heads and juan lines are kept. Punctuation
is left as each source has it (CBETA's is modern and added; SAT's is the print's).

One boundary artefact found and fixed: CBETA puts 世, the last character of T04 p.554, at the head of p.555
(confirmed on the page image); trimmed and recorded in that row's `cut_method`. Headings sometimes sit one line
later in SAT than in CBETA inside a page; that does not change the page's text.

Scripts (all in this directory): `taisho_lib.py` (parse/fetch), `select_pages.py` (draw), `build_pairs.py`,
`match_ours.py`, `sanity.py`, `sat_named.py`, `evidence.py`, `ws.sh`. Downloads and intermediate files in `src/`.

## Selection

Seed 5762. One work per Taishō volume for vols 1–55 and 85, three works for vol. 8 (the volume we hold). Eligible
works: CBETA header has a source statement that does not name SAT, plain four-digit number, file ≥150 KB. Within
a work, a seeded draw among interior pages; a page was redrawn if either side had a character with no Unicode
code point, Siddham or other foreign-script cells, a figure, under 600 Han characters, or missing lines. Redraws
are logged per row (`selection.redraws`). Volumes 5, 6, 7 (大般若經, SAT-named) and 29 (no eligible file) gave
nothing. This favours clean prose pages: dhāraṇī, Siddham and rare-character pages are under-represented, so the
floor on hard pages is not measured.

## Edition check

By eye on 5 rows (first and last line read off the page image, both transcriptions give them): our pages 586,
540 and 824 (Taishō vol. 8 pp. 570, 524, 808) and SAT's scans of T04 p.555 and T30 p.34. The other 49 are
`metadata`: both sources declare the Taishō and share its line numbering, and 87 of 87 lines match in length on
nearly every row. Our vol. 8 is a later photographic reprint of the Taishō (Internet Archive `008_20220309`):
same pages and lines, slightly heavier type.

## How many pages exist in principle

CBETA holds Taishō vols 1–55 and 85 (2,459 files); SAT holds all 85. Setting aside the 98 SAT-named files and the
122 with no source statement leaves about 2,240 files, on the order of 50,000 printed pages (rough: ~56 volumes ×
~900 pages; not counted). Pages where we also hold the scan: only vol. 8 (about 915 text pages, 39 eligible
works).

## What blocked more

- More pairs with `ours`: we hold one Taishō volume. More than 3 pages from it would break the 3-per-book cap.
- A second source pairing: none exists that passed. A Chinese pair outside Buddhist texts needs a genuinely
  separate keying of a WYG or SBCK page, and I found none that is open.
- Independence proof for SAT's side: no written account located of SAT's input method or of any SAT-side use of
  CBETA's text.

---
stage: ocr
measure: [judged, agreement]
languages: [la, en, de, fr, it]
scripts: [Latn]
canons: []
n_books: 100
n_pages: 2500
verdict: "On 2,500 of our own European print pages (20 books × 25 per language, 1470–1800, stored Flash-Lite drafts), arm c (the per-language GPU draft corrected by agy Gemini 3.8 Flash low with the image) leaves 15 of 790 judged pages misleading against 44 for arm a (the same correction of the Flash-Lite draft), and has fewer judged faults than a on 369 pages against 94. By the rule fixed before arm c ran, it passes Latin and Italian and fails English, German and French by 1–2 pages of 'worse than what readers have now' (en 10 vs 9, de 11 vs 9) or misleading (fr 2 vs 1). E3: on the pages written, the image check gave the stored reading back on 78 of 198 changed numbers and 28 of 171 changed negations. 557 library pages were rewritten with the best judged read; two pages with an invented facing-page column were contained."
status: undecided
decision: "Recommended default: switch the correction lane (cli-ocr-lane.mjs correct) to arm c for Latin and Italian, with the E3 diff guard on and its flags image-checked before the write. English, German and French stay on lite→Flash until the E3 guard has run on the lane's own output, because the rule failed there by 1–2 pages, all on number or one-word changes the guard targets. Not adopted here: the lane is unchanged."
superseded_by: null
issue: [7567, 7558, 6142, 5924]
---
## 2026-10-28 · E3 guards and the E5 scale test: GPU draft → agy Flash correction against lite → Flash on 2,500 library pages (#7567)
<!-- PRIOR ART: 2026-10-28-euro-print-gpu-draft-flash-correct-7567.md (E0–E2: arm c chosen on 209 reference pages; this is its scale test on our own pages, and E2's tools reused unchanged where possible); 2026-10-27-agy-ocr-pace-read-file-correct-lane-7558.md (the live lite→Flash correction lane arm a stands for). -->

**Arm c is less often misleading than lite→Flash in every language but French. By the rule fixed in advance it passes Latin and Italian only.** The fails are narrow, and they are the number and one-word changes the E3 guard exists to catch.

### Panel (`e5-draw.mjs`, `results-e5/panel.json.gz`)
- **Frame.** Visible, idle, unheld books dated 1470–1800 (`year`). Each has 25+ interior pages whose stored OCR is a Flash-Lite draft of 300+ characters, not handwritten and not edited (the correction lane's own page frame).
- **Draw.** Books in a seeded order (7567, E2 panel books excluded). 25 pages per book, spread evenly; 20 books per language.
- **Colophons were read for every drawn book** (`results-e5/colophon2.txt`). 7 books were rejected:
  - 2 German books catalogued as Latin (*Chymische Hochzeit*, Paracelsus *Opera*);
  - 2 Russian books catalogued as English;
  - a Manly P. Hall manuscript box;
  - Galileo's *Dialogo* in its 1874 Livorno edition;
  - Piranesi's *Carceri* (plates, no text).
- **2 pages served no image** (BSB served a tiny file) and are out of every count.
- **The lite read fr/it lacked in E2 is the stored Flash-Lite draft:** no paid read was needed.

### Arms (agy Gemini 3.8 Flash low, main pool, one page a call, E2's template `0601ef30`, `e2-correct.mjs --panel`)
- **a:** stored Flash-Lite draft → Flash. **a2:** the same again, on 2 pages a book (200).
- **c:** the language's best E2 draft → Flash. The drafts were read on gex45 through the GPU queue, one engine at a time:

  | lang | engine | pages read |
  |---|---|---|
  | la | PERO-OCR on the GPU | 499 (6.5 min) |
  | en, it | LightOnOCR-3-1B | 991 at 3,578 pages/h |
  | de | CHURRO-3B fp8 | 500 at 1,871 pages/h |
  | fr | Surya 2 | 495 |

- **Delivered:** a 2,498, c 2,478. c had no draft on 22 pages (an empty or too-short GPU read).
- **Quota:** 5,176 agy calls. The Gemini weekly bucket went 0.409 → 0.300, other pool traffic included (≈2e-5 a call).

### Agreement (`e5-table.py`; no typed references on library pages, so this is agreement, not accuracy)
- **Measure.** d(x) is the folded letter distance from x to a. a2 is a's own repeat, on 199 pages.
- **Result.** c differs from a by more than a differs from itself in every language. The CI of d(c) − d(a2) is above 0 everywhere; all languages: 2.04% vs 1.03%, CI [+0.66, +1.41].
- Agreement cannot say which text is right. The judge does.

### Judge (blind Opus, `claude -p`, #7522's `judge.mjs`, neighbouring leaves attached; 790 pages, 8 a book)
**Decision table** (the rule was committed in `e5-table.py` before arm c had results):
- **pass** = misleading(c) ≤ misleading(a), AND worse-than-stored(c) ≤ worse-than-stored(a).
- Misleading = not usable. L = the stored lite text; X = the bare GPU draft.

| lang | judged | misleading L / X / a / c | worse than stored a / c | better than stored a / c | c fewer / more faults than a | verdict |
|---|---|---|---|---|---|---|
| la | 160 | 68 / 82 / 23 / **4** | 6 / 2 | 132 / 144 | 101 / 13 | **pass** |
| en | 157 | 17 / 37 / 1 / **0** | 9 / **10** | 76 / 83 | 47 / 18 | fail |
| de | 160 | 52 / 52 / 11 / **7** | 9 / **11** | 112 / 130 | 83 / 20 | fail |
| fr | 159 | 14 / 13 / 1 / **2** | 8 / 8 | 63 / 95 | 50 / 14 | fail |
| it | 154 | 46 / 40 / 8 / **2** | 4 / 4 | 129 / 137 | 88 / 29 | **pass** |
| all | 790 | 197 / 224 / 44 / **15** | 36 / 35 | 512 / 589 | 369 / 94 | pass |

- **What c's worse-than-stored pages are.** Of the 29 in en/de/fr, 25 are one extra minor misread on a page both arms keep usable.
- **Four change the sense:**
  - a quantity read 30 for 10 (de);
  - an editorial *den* inserted (de);
  - cropped line ends filled with guessed text (de);
  - *plus* dropped, so "more or less deeply striate" becomes "less deeply striate" (fr).
- **One finding applies to every arm:** no engine alone serves readers. The stored lite text is misleading on 197/790 pages and the bare GPU draft on 224/790.

### E3 · guards (`scripts/lib/correction-diff-guard.mjs`, `tests/unit/correction-diff-guard.test.ts`)
- **Long-s pass.** It repairs f-for-ſ forms that are never words in the language (eft, ift, fhall, quefto). It folds ſ to s when the library's text for the page has none.
  - On arm c: tells on 60 pages (359 forms); ſ folded on 766 pages, mostly German (430).
  - The #5924 lexicon pass (`longs-orthography.mjs`) needs a model file that is not on gex45, so it was not used.
- **Diff guard.** It flags a local change (≤ 3 tokens a side) when the page's count of a negation, or of a number value, changes, or when an abbreviation is expanded into a word that does not contain it.
  - It does not flag: page numbers moved into `<page-num>`; spacing fixes; nõ→non and nec→neque; a Tironian 7; 3m/q2 glyphs.
  - The first version flagged 486/499 Latin pages; the rules above came from reading those flags.
  - On all arm-c output against its own draft: 658/2,475 pages flagged. Against the stored text: 824.
- **Image check.** On the 600 pages chosen to write, 175 carried flags. Opus checked each flag against the image, shown blind as "reading 1 / 2" (`e5-write.mjs confirm`):

  | change | the pick confirmed | the stored reading was right | undecided |
  |---|---|---|---|
  | number | 108 | **78** | 12 |
  | negation | 136 | **28** | 7 |
  | expansion | 22 | 1 | 0 |

  - A confirmed change stays. A change given to the stored reading is put back (92 put back).
  - A page with an undecided change is held (17 pages).
  - **Numbers are where the corrector is least safe:** French 19 of 23 number changes went back to the stored reading.

### Useful output
- **557 library pages rewritten** with the best judged read. Run `cli-ocr-20261028140539-1746942`; undo with `revert-run.mjs --run-id`.
  - **Pick rule (#7522's):** clean (usable, no omission, addition, bleed or order error), fewest misreads, and it must beat the stored OCR inside the same judge call.
  - **By arm:** c 472, a 75, a2 10.
  - **By language:** it 135, la 119, de 118, fr 97, en 88.
- **Refused:**
  - 17 held by the image check;
  - 2 with flags that were never checked;
  - at apply: 20 by the foreign-script guard (Greek in Latin and vernacular books), 3 under the 40% shared-words floor, and 1 rewritten by the correction lane meanwhile.
- **No `--mark-stale`.**
- **Contained (by eye).** On two pages the stored Flash-Lite OCR, and the English made from it, invent a whole second column from the sliver of the facing page at the scan's edge:
  - Saint-Martin, *Le nouvel homme*, p.118 ("loin de nous, et l'impression de l'infinité…");
  - *La Magie Naturelle*, p.512 / printed 494 ("aduertir, non sans quelque diligence…").
  - The OCR is now the judged-clean read. Both books are held as `invented-facing-column-7567`, and those pages' English is withheld until re-translated.
  - The judge flagged the same shape on three more pages of *La Magie Naturelle* (fragments, not invented text). They were not contained.

### What this does not show
- **Agreement is not accuracy.** E5 has no typed references; E2 measured CER on 209 reference pages.
- **The judge is one Opus pass.** a's own repeat (a2) is judged on 199 pages only. Differences of 1–2 pages per language are inside what one judge call can flip.
- **The image check reads only the flagged stretches.** Its 39% of numbers given back to the stored text is measured on picks, not on the whole lane.
- **Arm c's drafting cost is the GPU queue on gex45:** about 1 h for 2,500 pages. Arm a's draft is already paid for.
- **SigLIP stays paused.** Derek, inbox 09:39Z: the GPU stays on OCR, so the brief's resume step was skipped.

Files: `scripts/eval/euro-gpu-correct-7567/` (`e5-*.mjs|py`, `results-e5/`).

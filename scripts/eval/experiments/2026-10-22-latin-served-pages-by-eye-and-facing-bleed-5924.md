---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 12
n_pages: 135
verdict: "By eye, 5 of 36 served Latin pages (14%, Wilson 6–29%) would mislead a reader. The cause is OCR on all 5: an abbreviation expanded wrongly, a passage omitted, a misread variant, facing-leaf fragments served as a side-note. On 2 of them the translation then made the error worse. Facing-page bleed reached the text on 1 of the 36 pages, although a strip of the facing leaf was visible on 18. Flash left the strip out on all 11 of its pages that showed one, and lite read it into the text on 1 of 7. On the 99 references, bleed is in 12 of lite's reads. Neither preregistered fix passes. (a) The text-only deletion fixes 4 of 12 pages and harms 1 by eye. (b) Cropping to the leaf and re-reading fixes 11 of 12 but crops 25 clean pages and harms 4 of them, plus 2 of the fixed ones."
status: informational
decision: "Apply neither fix as built. The next test is a gated re-read: crop only when the edge detector fires AND lite's read shows a bleed shape (a column-break tail, or ≥ 3 margin tags), with the cut kept ≥ 2% clear of the text block. Post hoc, gating alone gives 8/12 fixed with 1/87 clean pages worse. Re-reading those pages with a stronger engine on the uncropped image is the alternative to test against it (stored 3.8-flash reads: 11/12 S pages better, no crop). Either one has to pass a fresh prereg on new pages."
superseded_by: null
issue: [5924]
---
## 2026-10-22 · What do readers see on Latin print pages, and can we remove facing-page bleed cheaply? (#5924)
<!-- PRIOR ART: 2026-10-22-latin-ocr-repair-census-5924.md (PR #7173: 60-book draw + format labels reused as the frame; marginStrip reused in fix (a)); 2026-10-22-can-a-prompt-make-flash-lite-read-long-s-on-latin-5924.md (PR #7171: the 99 references, the L0 live-prompt reads and the blind note that bleed beats long s). -->

**Question.** Derek, 2026-10-22: "more spot checking and improvement." Two parts. First, what does a reader see on a
served Latin print page, judged by eye? Second, can the defect PR #7171's blind read ranked above long s be removed
cheaply? That defect is text from the facing page's edge strip.

### 1. Thirty-six served pages, by eye (`draw.mjs`, `results/spotcheck-*.json`)

**Frame.** The census draw (PR #7173, Mulberry32(5924) over Latin books with ≥ 100 OCR'd pages), restricted to books
that are visible, first-dated 1500–1800, and printed according to its Opus format labels: 41 books. Three books were
drawn per cell, typeface × columns: roman-1, roman-2, italic-1, gothic-1, in Mulberry32(1022) order. Each book gives
one run of 3 consecutive body pages, starting at a seeded point 20–80% into the book. Every page in a run has ≥ 400
OCR letters and a stored English translation, and none was a census by-eye page.

**Method.** Three Opus readers each took 4 books. For every page they had the R2 source image, the `display_photo`,
the stored OCR, the stored English, and the OCR of both neighbouring pages. They labelled each defect with its
`page-error-taxonomy.md` class, its cause lane, and the evidence they looked at (image or text). They then gave each
page a verdict:
- **misleading:** the reader is misled about what the page says.
- **flawed:** the gist is right.
- **sound.**

| cell | year | book | OCR / English model | pages | verdict | classes seen | strip visible / in OCR |
|---|---|---|---|---|---|---|---|
| roman-1 | 1624 | Italia Antiqua (`69b21c3c`) | 3-flash / 3.1-flash-lite | 336–338 | f f f | O3 O5 O6 O7 O8 O9 O11 T6 T13 | 3/0 |
| roman-1 | 1697 | Schediasmatum apocalypticorum (`69c83570`) | 3.1-flash-lite / 3-flash | 147–149 | f **M** f | I4 O6 O7 O8 O9 O11 O12 T7 | 1/1 |
| roman-1 | 1701 | De Statica Medicina (`69af106e`) | 3-flash / 3.1-flash-lite | 202–204 | f f ok | O6 O11 T8 T10 | 3/0 |
| roman-2 | 1767 | De Abstinentia ab Esu Animalium (`6990616c`) | 3-flash / 3-flash | 231–233 | f f **M** | O6 O9 O11 T7 T11 | 0/0 |
| roman-2 | 1578 | Speculum orbis terrae (`69b4cd08`) | 3-flash / 3.1-flash-lite | 107–109 | f **M** f | O5 O6 O7 O8 O9 O12 T8 | 2/0 |
| roman-2 | 1728 | Specimen philologicum (`69c82de6`) | 3.1-flash-lite / 3-flash | 9–11 | f f f | I3 O6 O9 O15 | 3/0 |
| italic-1 | 1585 | Somniorum Synesiorum Libri IV (`69906327`) | 3-flash / 3.1-flash-lite | 596–598 | f f f | O6 O11 O12 T6 T8 | 0/0 |
| italic-1 | 1534 | Valerius Maximus, index (`6a06d3b7`) | 3-flash / 3.1-flash-lite | 294–296 | f f f | D1 O8 O9 O11 O12 T5 | 3/0 |
| italic-1 | 1589 | Astronomica Veterum Scripta Isagogica (`69af0f77`) | 3-flash / 3.1-flash-lite | 170–172 | f ok f | O6 O9 O11 T8 | 0/0 |
| gothic-1 | 1719 | Opus mago-cabalisticum (`6984e84f`) | 3-flash / 3-flash | 106–108 | f f f | O6 O8 O9 O12 O13 T10 | 0/0 |
| gothic-1 | 1670 | Thesaurus et armamentarium medico-chymicum (`69c82e67`) | 3.1-flash-lite / 3-flash | 85–87 | ok ok f | I7 O5 O6 | 3/0 |
| gothic-1 | 1505 | Speculum sapientiae (`69dbc9b1`) | 3.1-flash-lite / 3.1-flash-lite | 86–88 | **M M** f | O6 O7 O8 O11 O14 T7 | 0/0 |

**Results.**
- **Misleading: 5 of 36 pages (14%, Wilson 95% 6–29%), in 4 of 12 books. Flawed: 27. Sound: 4.**
- OCR is a cause on every misleading page. The translation then made it worse on 3 of them (T7, T8, T11).
  - `69dbc9b1` p86–87, gothic 1505, lite for both lanes. The abbreviation for *aurum* is expanded as *autem* throughout,
    and *Macilenta vulpes* is read as *Mustela vulpes*. The English inverts the moral claims: the zealots of virtue
    hold gold "a good", where the print says "more evil than good".
  - `69b4cd08` p108. About 4 printed lines of a quotation are silently omitted (O5), and *genus aduentitium* becomes
    *genus ἀδελφῶν*, "a type of brothers".
  - `6990616c` p233. A Greek variant in the apparatus is misread, and the English invents a relation from it.
  - `69c83570` p148, lite OCR. 29 line-ends of the facing verso are filed as one `<margin>` block (I4/O12). The English
    serves them as a side-note: "ary. goal. apostle. thus. …".
- **Causes over all 36 pages:**

  | cause | pages with a defect from it |
  |---|---|
  | OCR | 33 |
  | translation | 18 |
  | seam | 5 |
  | label | 3 |
  | image | 2 |

  The commonest classes are O6 (meaning-changing misread, 19 pages) and O9 (convention flips, 13), then O11 (10), T8
  (8), O8 (7) and T7 (7).
  Translation defects: lite translations 13 of 21 pages, Flash translations 5 of 15. Only 12 books, so this is
  confounded by book.
- **Long s:** 8 pages have ≥ 3 ſ read as f. Four flash-read books are among them, up to about 120 on one page of
  `69b21c3c`, so this is not only a lite problem.
- **Labels (I7):** 2 of the 3 "gothic" books are German Fraktur, not Latin. `6984e84f` (Welling's *Opus
  mago-cabalisticum*) is German throughout. On `69c82e67` the leaves are German chiliast theology, not the catalogued
  title. Gothic Latin is therefore 1 book here.
- **Facing-page bleed:**
  - A strip of the facing leaf is visible on 18 of 36 pages, and reaches the text on only 1 of them.
  - Flash-read OCR left the strip out on all 11 of its pages that showed one.
  - Lite read it into the text on 1 of 7.
  - On these served pages, bleed is a lite problem, and a smaller one than O6 misreads.

**Containment.** Nothing was withheld. On p148 (`69c83570`) another leaf's text appears as a side-note. The page's own
body and its English are correct, so the containment bar ("the text is not this leaf's text") is not met for the page.
The other misleading pages are misreads, which `containment-on-finding.md` classes as a finding, not a containment.

### 2. Facing-page bleed: two fixes against a preregistered bar (`PREREGISTRATION-facing-bleed-5924.md`)

**Ground truth, labelled before any fix was built.** Two Opus readers labelled all 99 #7171 reference images, with the
L0 read (flash-lite, live prompt 19.1) and the reference text alongside.
- A strip of the facing leaf with printed text is visible on 25 of the 99.
- On 12 of those, the L0 read carries text from it: **S = 12 pages; C = the other 87.**
- The bleed takes two shapes:
  - a **left** strip becomes `<margin>` tags of line-ends at the top of the read (6 pages);
  - a **right** strip becomes a fake second column after `<column-break/>`, or a loop seeded by it (6 pages).
- Every bleed page has a strip with text. No blank strip produced bleed. 8 of the 10 strips ≥ 8% of the width bled,
  against 4 of the 15 narrower ones.

**Edge detector.** `bleed-fix.mjs edgeStrip` is the `gutter-detect.mjs` transitions profile, applied to the outer 22%.
It has two routes:
- a text strip, then a gap, then the main block;
- a page-edge shadow with faint text beyond it. This route was added for p30's sparse side-note fragments, which never
  reach the text threshold.

Its first version (gap route only) found 7 of the 12 S pages. After the shadow route was added, it fired on 36 pages:
22 of the 25 text strips and 11 of the 12 S pages, plus 14 pages without one. The shadow route was tuned on these 99,
so it is not validated.

**Results, deciding CER (view N, `score.mjs` unchanged; L0 is deterministic, noise floor 0):**

| fix | S improved ≥ 0.01 | median Δ on S | C worse > 0.01 | fired on C | by eye (10, prereg) | bar |
|---|---|---|---|---|---|---|
| (a) text-only deletion, $0 | 4/12 | 0.000 | 0/87 | 1 | 4 fixed · 5 unchanged · **1 harmed** | **fails** 1, 4 |
| (b) crop to the leaf + lite re-read, $0.08 | **11/12** | **−0.136** | **4/87** | **25** | 8 fixed · **2 fixed+harmed** | **fails** 2, 3, 4 |

- **(a)** fixes the pages it fires on: p158 0.22 → 0.05, p237 0.16 → 0.01, p715 0.12 → 0.01, p328 0.08 → 0.00. It
  misses everything that is not a fragment or a short-line tail:
  - p30's 27 whole-word invented side-notes;
  - the p8 and p288 tails, which lite stitched into full-length prose or a loop;
  - p368's empty "obscured text" margin.

  Its rule (iii), a margin note matching the neighbour page, could not be tested: only 14 of the 99 references have
  neighbour OCR stored. By eye it deleted one real printed side-note (p149).
- **(b)** removes the bleed on 11 of 12 pages, including p8 (0.71 → 0.01), p288 (0.73 → 0.01) and p30 (0.37 → 0.02).
  The harm comes from where the crop line falls:
  - On p158 the crop took the "1" of the page number 120.
  - On p29 it shaved a letter off several line-starts.
  - On 3 of the 4 harmed C pages it cut the leaf's own line-starts or side-notes ("Additio.", "HVBER.").
  - Re-read variation added only small errors.

  The 99-page median falls 0.0283 → 0.0208. That is context only: most of it is these 11 pages.

**Post hoc (not a verdict; tuned on these pages).**
- **Gate (b):** crop only when the detector fires AND the L0 read shows a bleed shape (a `<column-break/>`, or ≥ 3
  `<margin>` tags). That gives 8/12 S fixed and 2 C pages cropped, 1 of them worse (+0.02).
- **No crop, stronger engine:** the stored bake-off read from a stronger engine (`F`, 3.8-flash-low via CLI, uncropped)
  is better on 11/12 S pages, median −0.16. That fits section 1: Flash leaves the strip out.

### What this changes
- On served pages, the main misleading defect is the **meaning-changing misread** (O6), especially lite on gothic and
  abbreviated print. Bleed is real but narrow: lite-read pages with a facing strip, about 12% of lite reads on the
  references and 1 in 12 lite pages here. The census text detector puts it at ≥ 3% of lite pages.
- A crop has to keep a margin from the text block. Crop only when the read itself shows bleed.
- The Paddle split-leaf eye check (#6101) was delegated to the main box, which holds those files. It is posted on #6101.

Files: `scripts/eval/spotcheck-latin-5924/`
- `draw.mjs`
- `bleed-fix.mjs`: `detect`, `fix` and `crop`. `fix` imports the census detectors from PR #7173.
- `results/`: verdicts, ground truth, per-page CER, by-eye verdicts and detector output.

Cost: $0.0805 flash-lite (36 cropped re-reads, metered through `gemini-script-client.mjs`). No writes to `pages`,
`books` or prompts.

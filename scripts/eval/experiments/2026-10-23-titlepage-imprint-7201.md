---
stage: metadata
measure: accuracy
languages: [la, de, zh, sa, el, en, bo]
scripts: []
canons: []
n_books: 200
n_pages: 1018
verdict: "flash-lite reading the imprint off the opening leaves FAILS the 95% gate. Date precision is 85.8% (91/106, 95% CI lower bound 78.0) and author precision is 79.4% (123/155; 28 of the 32 misses are role errors, and only 4 names are not on the page). Where the date would CHANGE the catalogue, it was right 9 times in 15."
status: rejected
decision: "No full run that writes imprint fields. A full read (~$85 at Batch rates, not ~$600) is only worth running as a review queue: the ~8% of books whose read date differs from the catalogue, each checked by eye before setCatalogueFields(). Guard v3 (reject bracketed, handwritten and day-and-month dates; flag show-through leaves) needs a FRESH draw before any claim."
superseded_by: null
issue: 7201
---
## 2026-10-23 · Can flash-lite read a book's imprint off its opening leaves well enough to catalogue it? (#7201)
<!-- PRIOR ART: scripts/audit/titlepage-model-pilot-v2.mjs header (#3949: authors only, text only, 87–90% on a 100-book control); scripts/maintenance/fill-published-from-title-page-6056.mjs (dates from the #6721 dating run, with its exclusion classes). -->

**Who this is for.** Readers searching by author, date or place, and rights decisions that rely on our dates. About
45.8K books (pages ≥ 4, not artwork) have scans and no transcription, so their imprint came from import metadata.

**Design.**
- **Script.** `scripts/audit/titlepage-model-pilot-v2.mjs --imprint`, which extends the v2 pilot rather than forking it.
  Guards and prompt are in `scripts/lib/titlepage-imprint.mjs`, with tests in `tests/unit/titlepage-imprint.test.ts`.
- **Fields.** Title, every name with its role, date (CE year plus the as-printed form), place (as printed plus the
  modern name), printer/publisher and edition statement. Each field carries a page number and a `quoted_line`.
- **Two modes.**
  - **Image** (no OCR): up to 8 opening leaves, fetched at ≤1400 px. The prompt tells the model to skip covers and
    blanks, because scans-only pages carry no page type.
  - **Text**: the v2 typed attribution window (≤5 pages).
- **Model.** `gemini-3.1-flash-lite` only, through the Batch API, at temperature 0 with thinking off.
- **Draw** (seed 7201). Stratified by language × century, in proportion to each pool:
  - 40 books from the #7176 published scans-only set (pool 16,286);
  - 60 other scans-only books (pool 29,474);
  - 100 transcribed live books (pool 42,291).
  - 3 unfetchable books were replaced from their own stratum.
- **Guards.**
  - Both modes: the cited page must be one the model was shown, and the quoted line must carry the value (the year
    in Arabic or Roman figures, the name, the place).
  - Text mode only: the quote must also appear in the cited page's OCR.
- **Guard v2.** Guard v1 dropped correct readings set in early-modern type, so v2 accepts these forms. It was re-run
  over the same stored replies (`--recheck`, no new model calls, 33 replies changed):
  - letter-spaced capitals (`B A S I L E A E`);
  - apostrophic numerals (`clɔ Iɔ CXIV` = 1614);
  - spaced or I-for-1 digits (`I 5 7 9`);
  - first-line title quotes.
- **Labelling.** Every proposal, kept or dropped, was labelled right / wrong / missed / absent against the page
  IMAGES by 8 Opus reviewers, with a written rubric and 25 books each. I re-checked 14 of their labels on the images
  myself: 13 agree and 1 is arguable (al-Ḥarīrī named in the preface of what may be a commentary).
- **Caveat.** Several reviewers had images withheld by a request limit partway through and re-opened them before
  confirming. Packets 1, 7 and 8 say so explicitly.

**Result** (guard v2; precision = right / (right + wrong); recall = right / (right + missed + wrong where the page states it); `imprint-score.json`)

| field | image (scans-only) precision | text precision | all: precision [95% lower] | all: recall |
|---|---|---|---|---|
| **date** | 85.0% (51/60) | 87.0% (40/46) | **85.8%** (91/106) [78.0] | 84.3% (91/108) |
| **author** | 75.0% (57/76) | 83.5% (66/79) | **79.4%** (123/155) [72.3] | 72.4% (123/170) |
| title | 97.1% (67/69) | 79.3% (69/87) | 87.2% (136/156) | 84.5% |
| place | 84.6% (44/52) | 91.3% (42/46) | 87.8% (86/98) | 93.5% |
| printer / publisher | 95.7% (45/47) | 91.5% (43/47) | 93.6% (88/94) | 94.6% |
| edition statement | 3/3 | 8/8 | 11/11 | 78.6% (11/14) |
| other roles (editor, translator, printer…) | 96.1% | 94.3% | 95.2% (238/250) | — |

- **The gate (≥95% on date and on author) fails** in both modes, and in both arms of the image mode: the #7176 set
  scored 31/33 on dates and 35/46 on authors; the other scans-only books scored 20/27 and 22/30.
- **Author errors are ROLE errors, as in #3949.** Of the 155 authors kept:
  - 28 are a real person on the page given the wrong role. The commonest is a disputation **respondent** (6). The
    rest are translators, writers of dedicatory letters, compilers, editors, contributors of verses and the subject
    of a biography.
  - Only 4 are not on the page: "Volck" is a Fraktur misread of *Boltz* (twice), and one is a Kangxi Emperor
    inferred from 欽定.
  - Name identity alone is 97.4% (151/155). The role is what the model cannot do.
- **Date errors, 15, all by eye:**
  - **4: date inside the title of an occasional print** (a conferral, an entry into Halle, the year urns were found).
    These usually ARE the printing year. Counted right, together with one pencil `[1728]` that matches the
    chronogram, precision is 90.6% (96/106), still under the gate.
  - **4: marks that are not the imprint**: a pencil `(1499)` in an Aldine, a `[1554]` on e-rara's digitisation cover
    sheet, a handwritten library card (`[Genève] … 1507`), and a stamped label.
  - **3: misread numerals**: saṃvat १८५७ read as १५५७ and १६८६ as १६५६; *M.cccc.lxxxiii* read as 1484.
  - **2: invented OCR on SHOW-THROUGH leaves** (text mode). The stored transcription of a mirror-image verso invents a
    different imprint, and the quote guard passes it because the invented text IS in the OCR. See below.
  - **1: a bound-with**: the 1689 dissertation bound in at p9, not the book's own 1591.
- **What a full run would change.** Of the 106 kept dates:
  - 82 right and 9 wrong already AGREE with the catalogue, so writing them changes nothing.
  - **Where the date would change the catalogue (it differs, or fills an empty field), it was right 9 times and
    wrong 6 (60%).**
  - The 9 right ones are real finds, for example the *Oracula Sibyllina* (`M DCCC LXIX.`, catalogued 1856), a
    1931 printing catalogued 1917, and 5 books catalogued "Unknown".
  - At 60%, an unreviewed write would damage about as many dates as it fixes.
- **Titles.** 13 of the 20 wrong titles are Siku Quanshu volumes: the model gave the cover's series label
  (四庫全書 子部), not the work title on the next leaf. Leaving out the Siku volumes, text-mode title precision is about 93%.
- **Manuscripts.** The model abstains, which is correct, and misses titles written in colophons and incipits. Recall
  is low there, and no wrong data results.

**Found by eye: invented OCR on show-through leaves (contained).** Three live books store a transcription and English
on a mirror-image show-through verso that invents an imprint the leaf does not carry:
- Heron, *Spiritalium liber*, p6: `PARISIIS M.D.LXXXIII`, `ET EDITUS`; the book is Urbino 1575.
- Della Porta, *Lo Astrologo*, p2: `Appresso Gio. Battista Ciotti`; the leaf shows Pietro Ciera.
- Hauboldt, *De stipendiis literariis*, p2: a whole Stemmler/Gotha 1748 title.

Per `containment-on-finding.md`, all three books are held (`showthrough-invented-ocr-7201`) and the three pages
withheld (`withhold-stale-translations.mjs --by-eye-pages`, snapshots in `page_revisions`). The OCR prompt invents
on show-through, and the class is not measured corpus-wide here.

**Cost.** Estimated $0.21, actual **$0.189** (1,059,338 in / 75,224 out at Batch rates). Per book: image $0.00139,
text $0.00050.
- **Full-run projection:** 45,760 scans-only × $0.00139 + 42,291 transcribed × $0.00050 ≈ **$85**. The issue's
  ~$600 assumed more.

**Recommendation.**
1. Do **not** run a full read that writes imprint fields.
2. If the catalogue-correction value is wanted, run the read as a **proposal queue**: only books whose read date or
   place differs from the catalogue, about 8% of books (~7K), each opened by eye and written through
   `correct-imprint-from-titlepage.mjs` / `setCatalogueFields()`. The #4043 review queue already has this shape.
3. Before that, guard v3 should reject:
   - bracketed or parenthesised years;
   - day-and-month dates inside a title;
   - quotes from a page the model itself calls a cover, label or card.

   Text mode should also flag a window page whose OCR is a near-duplicate title of a neighbour (show-through).
   Measure v3 on a **fresh** seeded draw, because tuning on these 200 would be overfitting.
4. Authors from this read must never be written as `author` without a role check: the role, not the name, is the error.

**Artifacts** (Hetzner l7a, `/data/scratch/sl/jobs/titlepage-7201/out/`): `imprint-sample.json`,
`imprint-manifest.json`, `imprint-evidence.jsonl` (plus the `guard-v1` copy), `labels-1..8.jsonl`, `RUBRIC.md`,
`packet-*.md`, `imprint-score.json`, and the page images under `img/`.

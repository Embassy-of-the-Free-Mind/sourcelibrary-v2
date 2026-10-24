---
stage: metadata
measure: judged
languages: [la, de, fr, it, nl, en, es]
scripts: [Latn]
canons: []
n_books: 20
n_pages: null
verdict: "Function-word share on stored OCR, gated on agreement with the OCR <language> tags, relabels books catalogued Latin right on 20 of 20 by eye; 254 written (110 flips, 144 mixed)."
status: adopted
decision: "254 books relabelled in production (sweep relabel-latin-5924, undoable); 709 review rows and 48 manuscript-filed-as-print rows reported, not written"
superseded_by: null
issue: 5924
---
## 2026-10-23 · Books catalogued Latin whose pages are another language, text-only (#5924)
<!-- PRIOR ART: 2026-10-04-relabel-4884.md (the writer shape: sweep_log row, field_provenance.language, live-job skip, --undo); scripts/audit/detect-book-languages.mjs and scripts/audit/language-vs-ocr.mjs (#4117, #4654: per-page <language> tag aggregation, used here as the second instrument); scripts/lib/language-content-classify.mjs (#2534: stopword density, not used because its lists share words across languages). -->

**Question.** The #5924 spot check found 2 of 3 "gothic Latin" books were German Fraktur. Across every book catalogued `Latin` with ≥ 20 OCR pages, which are really another language, and can `language` / `languages[]` be corrected from stored OCR alone at ≥ 90% precision by eye?

**Design.** `scripts/maintenance/relabel-latin-function-words-5924.mjs`, $0, no model call.

1. **Frame.** `language: 'Latin'`, `pages_ocr ≥ 20`: **27,487 books** (the brief's ~3,923 was the census sub-frame).
2. **Sample.** 6 spread pairs of consecutive OCR'd interior leaves per book (up to 12 leaves with ≥ 60 words).
3. **Instrument 1.** Counts of function words *exclusive* to one of Latin, German, French, Italian, Spanish, Dutch, English. Shared words (et, est, de, in, la, non, per, qui, die, den, des, als, en) are left out. Model-authored blocks (`<image-desc>`, `<detected-images>`, `<meta>`, `<warning>`, `<vocab>`) are stripped. A page counts for a language when that language holds ≥ 60% of its function words.
4. **Instrument 2.** The OCR model's own per-page `<language>` / `<lang>` tag on the same leaves.
5. **Flag.** Latin < 50% of the sample's function words.
6. **Decision.**
   - **flip:** Latin ≤ 15%, ≤ 1 Latin page, ≥ 70% of judged pages in the other language, and ≥ 70% of tagged pages tagged it.
   - **mixed:** ≥ 2 Latin pages, ≥ 2 other-language pages, and both languages present in the tags. `language` stays Latin, `languages[]` becomes `[Latin, X]` and `language_multi` is set to true (language-fields.md rule 4; the catalogued language stays first).
   - **review:** everything else, including any sample spanning < 30% of the book.
7. **Gate.** 20 flags drawn with seed 5924 (9 flip, 11 mixed). For each book, the page image(s) were read by eye against the OCR.

**Three instrument faults found before writing:**
- **Positional sampling.** Spreading samples over `pages_count` landed on unread leaves for 11,197 books, because OCR covers only part of them. Fix: spread over the leaves that have OCR.
- **One-parity sampling.** Evenly stepped samples on Loebs hit only English rectos and proposed Latin → English flips. Fix: sample consecutive pairs.
- **Partial OCR.** A Loeb with OCR on leaves 1–25 is its English introduction. Fix: the span gate (< 30% of the book → review).

Separately, Bodleian Latin MSS scored "English" because of the English in `<detected-images>`. The tag instrument had already held them in review; stripping those blocks moved 33 rows and changed no gate verdict.

**Result.**

| | books |
|---|---:|
| scanned | 27,487 |
| Latin ≥ 50% | 22,654 |
| thin (< 4 leaves or < 150 function words) | 3,870 |
| flagged | 963 |
| → flip (written) | 110 (German 62, English 21, French 12, Italian 8, Dutch 6, Spanish 1) |
| → mixed (written) | 144 (+German 62, +English 49, +French 22, +Italian 9, +Dutch 1, +Spanish 1) |
| → review (not written) | 709 (503 partial-OCR span, 206 instruments disagree) |
| by-eye gate | **20 / 20 correct** |

- **Written:** 254 books (183 visible, 71 hidden), with no live-job skips.
- **Review queue:** 49 flips landed on the language that the #3958 `language_review` queue had already detected, and that flag was cleared. This includes Welling's *Opus mago-cabalisticum* (`6991d64e`) and the *Thesaurus … medico-chymicum* (`69c82e67`).
- **Routing:** unchanged for every target language (flash-lite for OCR and translation).
- **One by-eye caveat:** *Storia Letteraria d'Italia* (`69b51e8d`) is an Italian journal that quotes Latin documents. The mixed rule keeps Latin first. Which language such an edition principally is remains a curatorial call (language-fields.md).

**Manuscripts catalogued as print (report only).**
- 48 books have `book_class.class: printed` while ≥ 60% of their sampled leaves are `handwritten`, by `pages.script_type` or the OCR `<script>` tag.
- In 9 of them, every sampled leaf is handwritten: the Vatican *Corpus Hermeticum*, BPH PH337 and PH164, Harvard *Flores temporum*, *Antidoti in Pogium*, and others. Listed in `manuscript-filed-as-print.jsonl`.
- The other 39 are mostly SBB occasional prints, where the leaf-level tag mixes printed and handwritten. They are not verified.

**Out of scope.**
- `original_language` is not set on any book; no translation-role book needed it.
- `Law French` / `Anglo-Norman` refinement: the Harvard Law MSS are written as `French`, matching their catalogued siblings.
- The 709 review rows. The 503 partial-OCR rows need OCR before this instrument can judge them.
- Books with compound Latin labels (`Latin-German` etc.).

**Files.** `scripts/eval/results/relabel-5924/`: gate, eye sample, `proposals.jsonl.gz`, `written.jsonl`, `manuscript-filed-as-print.jsonl`, `longs-skip-5924.tsv` (the skip list given to the long-s apply job). Undo: `node --env-file=… scripts/maintenance/relabel-latin-function-words-5924.mjs --undo --commit` with `RELABEL_5924_DIR` pointing at a directory (it reads only `sweep_log`).

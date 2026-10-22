---
stage: metadata
measure: judged
languages: []
scripts: [Latn]
canons: []
n_books: 24426
n_pages: null
verdict: "8 of 13 suspects are real record/scan mismatches (6 hold a wholly different book); extrapolated about 14 (95% 6–27) across the 42,291 live books with OCR, a FLOOR since recall is not measured."
status: informational
decision: "scan-title-mismatch.mjs repaired (PR for #7146); the 8 records are listed, not fixed"
superseded_by: null
issue: [7146]
---
PRIOR ART: `scripts/audit/scan-title-mismatch.mjs` (this run repairs it); #7144 holds the cases it cannot see.

## 2026-10-22 · How many live books hold a scan of a different book than their record says?

**Design.** `scripts/audit/scan-title-mismatch.mjs` over every live book with OCR (`visible`, `pages_count > 0`,
`pages_ocr > 0`: 42,291, plus the hidden Byron/Hypatia control). A book is a suspect when no distinctive title token
(6-char prefix, folded) and no author surname appears in its first 60 OCR'd pages, its page text is Latin-script, and the
OCR envelope says `printed` on most sampled pages. Read-only, about 2 min on Hetzner. Each suspect checked by eye
against its page images (title page plus one text page, more when unclear).

**Why the 2026-10-22 first run judged 282 books.** The cause was not the `<script>` tag. Every Gemini OCR model and
PaddleOCR-VL still emit it, measured on a 6,000-page sample. Only imported text lacks it: `bdrc-yigdzin-v1`, `ia-ocr`, and a
March 2026 flash cohort. The cause was keyset pagination on `_id`. 282 live books (all BDRC Tibetan) have a string
`_id`, and BSON sorts strings before ObjectIds, so `{_id: {$gt: <string>}}` matched nothing after them. The run ended
there, and those 282 were Tibetan text that the hand-listed "non-Latin" ranges did not cover. They fell through to the
printed gate, which also counted "no tag at all" as a manuscript.

**Fixes.**
- Pagination now runs on the `id` string.
- The script share uses Unicode `\p{Script=Latin}` and ignores the envelope's own English commentary (`<meta>`, `<image-desc>`, …).
- A CJK title with "(vol 3)" is counted as cross-script, where it used to fall under "no distinctive token" (12K books).
- Title and text are both folded the same way: diacritics, æ/œ/ſ, u/v and i/j.
- A book with no `<script>` tag is now `no_script_tag`, not a manuscript.
- A full run that misses the control exits 2.

Stripping the commentary from the *match* text as well was tried and rejected. `<vocab>` holds real page words, so
45 suspects came back and the control dropped under the text minimum.

**Result.** Eligible 42,292 → judged 24,427 (24,413 cleared + 14 suspects). The rest are skipped, not judged:
non-Latin title 12,220, non-Latin text 4,464, too little OCR 619, no distinctive token 305, degenerate OCR 124,
no script tag 102, manuscript 31. The control was caught.

| suspect (record says) | scan actually is | verdict |
|---|---|---|
| The Path, 1904 (Judge ed.) `6a3e76a228fae891bf27db63` | Mabel Collins, *Light on the Path* | different book |
| The Path, 1910 `6a3e76bdc7e5622c3d0bc3ca` | Annie Besant, *The Path of Discipleship* | different book |
| The Path, 1897 `6a3e776328fae891bf27f053` | *The Jivanmuktiviveka, or the Path to Liberation* | different book |
| The Path, 1922 `6a3e775428fae891bf27ee6a` | Tingley, *Theosophy: the Path of the Mystic* (IA `theosophypathmy00tinggoog`) | different book |
| Breasted, *Ancient Records of Egypt* IV `6a98ba2bec48f9ad103e2820` | Caroline Pichler, *Sämmtliche Werke* Bd. 4 (German, Wien) | different book |
| Mynsicht, *Thesaurus et armamentarium medico-chymicum* (BPH) `69c82e676c6f3cc53c84d61e` | German devotional tract "Das von Jesu Christo … Ewige Evangelium"; no Thesaurus in all 152 pages | different book |
| Papadopoulos-Kerameus, *Analekta* **Vol. I** (1891) `69aea3113d57a11fc021c0eb` | Tomos **Δ′** (1897) | wrong volume |
| Rösslin, *Der swangern Frawen … rosegarten* `6a4921d61bbf4176e1e850be` | English translation *The byrth of mankynde* | wrong edition (translation) |
| Faṣl al-Maqāl `69e8b2ac2ff2a8dc09e7883c` | Müller 1859 edition of that text | false: transliterated title |
| Hanshan, *Jin gang jue yi jie* `69f13460365e3fcae574e33e` | the Diamond Sutra commentary, Chinese | false: transliterated title |
| Stanbridge, *Accedence* `6a42cc5597284560a2b148d3` | "Accidentia ex Stanbrigiana editione" (dark scan) | false: variant title, poor OCR |
| Bertelli, *Diversarum nationum habitus* `6a4a493d60cc4860acc54901` | costume plates, as catalogued | false: plates, little text |
| Matthiae programme 1698 `6a4c01ed4f392afd49e4323a` | as catalogued (heavy show-through, 5 OCR'd pages) | false: unreadable OCR |

**Precision** on all 13 live suspects (no sampling: fewer than 20 exist): 8/13 = 62% any mismatch (Wilson 95%
36–82%); 6/13 = 46% wholly different book (23–71%).

**Corpus estimate.** 8 confirmed in 24,426 judged live books = 0.033%. Scaled to the 42,291 live books with OCR, that is
**about 14 (exact Poisson 95% 6–27)**; for wholly different books, about 10 (4–23). This is a **floor**:
- recall is unmeasured beyond the one control;
- a wrong scan that shares a title word or the author's surname passes (another volume of the same set, a sibling work by one author);
- the 17,865 cross-script, thin-OCR and manuscript books are not judged at all, and #7144's three cases sit there.

Four of the six wholly-different books come from a single import: "The Path, <year> (<IA suffix>)" records that mapped
IA search hits onto the Judge magazine. **That cluster has 9 live records, and the detector skipped the other 5**, because
"The Path, 1928" has no token of 5 or more letters (`no_distinctive_title_token`). Going by IA identifier (not checked by eye),
they are the same failure:
- `6a3e763e28fae891bf27ce0e` → `firststepsonpath0000geof`
- `6a3e767e28fae891bf27d607` → `lightonpathandk00collgoog`
- `6a3e769928fae891bf27d866` → `jivanmuktiviveka00madhiala`
- `6a3e76af28fae891bf27ddbc` → `theosophypathofm00ting`
- `6a3e76b228fae891bf27dea1` → `pathofdisciplesh00besa`

That is a measured recall miss of at least 5 against 8 caught, which is why the estimate above is a floor.

*Replicated?* No. *Artifact:* `/root/audit-out/scan-title-mismatch-2026-10-22-fixed.{json,log}` on Hetzner. Records are listed, not fixed.

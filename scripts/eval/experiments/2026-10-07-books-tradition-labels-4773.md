---
stage: metadata
measure: judged
languages: []
scripts: []
canons: []
n_books: 30
n_pages: null
verdict: "Flash-lite labelled the tradition of all 109,006 books for $2.74; 27/30 right by eye, 3 arguable, 0 wrong; same family as the pilot's by-eye labels on every non-European shelf."
status: adopted
decision: "books.tradition stored on 109,006 books and used by the search tradition re-rank (#4773)"
superseded_by: null
issue: 4773
---
## 2026-10-07 · Can flash-lite label every book's tradition from its catalogue record? (#4773)
<!-- PRIOR ART: scripts/eval/embed-granularity/label-books.mjs (#6173; by-eye shelf labels for 304 pool books, eight families) and books.faceted_tags.tradition (scripts/maintenance/faceted-tagger.mjs; a 20-value school vocabulary on 23.7K books). Neither labels the corpus with the 31 map labels. -->

- **Question.** #4773 proposed a per-book `tradition[]` from a closed list (the 31 labels the theme maps use), judged by `gemini-3.1-flash-lite` from the catalogue record, for about $3. Does it label the corpus well enough to rank search results by?
- **Answer: yes.** 109,006 books (every book with pages) carry `books.tradition` since 2026-10-07, for **$2.74**.
  - A seeded read of 30 labelled books by eye: **27 right, 3 arguable at a boundary, 0 wrong.**
  - Against the #6173 pilot's by-eye shelf labels, the label lands in the same family for **every book of the five non-European shelves** (Islamic 26 of 26, Indic 39 of 39, Chinese 39 of 39, Buddhist 37 of 37, Jewish 23 of 23) and 21 of 24 Greek and Roman.
  - The European shelves do not map one to one, by design: the map labels split Europe by period, so the pilot's "Hermetic and esoteric" and "Christian" shelves are mostly `Renaissance & Early Modern Europe` here (27 of 49 and 20 of 51 with that label alone).
- **measure:** accuracy by eye on a seeded sample of 30; agreement in family with 304 by-eye labels. Neither is a second-rater study.

### Method

- **Evidence per book:** title, English display title, author, year, edition language, original language, place, up to six collection and category tags, the first 160 characters of the summary. No page text.
- **Prompt:** `SYSTEM_PROMPT` in `scripts/maintenance/tradition-4773.mjs` (version `tradition-4773-v1`). One or two labels; a translation takes its source's tradition; a study takes the tradition it studies; European works with no older source go by when they were written; an empty list when the record does not say.
- **Run:** 4,361 Batch requests of 25 books, temperature 0, thinking off. All 4,361 succeeded on the first submit. 2 labels outside the list were dropped. 11.6M input and 1.9M output tokens.
- **Stored:** `books.tradition: string[]`; one `sweep_log` row per book (sweep `tradition-4773`, action `set-tradition`) with the labels, model, prompt version and Batch job. An empty list is stored for the 793 books the model could not place.

### Distribution (labels, a book may carry two)

| label | books | label | books |
|---|---|---|---|
| Renaissance & Early Modern Europe | 60,877 | Persian | 902 |
| Chinese | 13,844 | Byzantine & Orthodox | 830 |
| Modern European | 7,515 | Zoroastrian | 780 |
| Greek | 4,872 | Syriac & Armenian | 766 |
| Roman | 3,146 | Kabbalistic & Hasidic | 694 |
| Medieval Latin | 3,034 | Japanese | 500 |
| Indian | 2,727 | Southeast Asian | 471 |
| Tibetan | 2,452 | Turkic | 465 |
| Buddhist | 2,195 | Mesopotamian | 433 |
| Hermetic & Gnostic | 1,991 | Korean & Vietnamese | 347 |
| Hebrew & Jewish | 1,865 | Slavic & Finnic | 330 |
| Arabic | 1,365 | Egyptian | 316 |
| Theosophical & Modern Esoteric | 1,357 | Native American & Mesoamerican | 241 |
| Early Christian & Monastic | 1,262 | African | 161 |
| Hellenistic & Late Antique | 1,177 | Norse & Celtic | 76 |
| (none) | 793 | Oceanian | 30 |

More than half the corpus is one label. That is the corpus (early modern Latin and German print), and it is why a per-tradition cap matters more at full scale than it did in the pilot's balanced pool.

### The 30 books read (seed 4773)

- **Right (27):** König's 1731 *Oratio inauguralis* and eleven other early modern Latin, German and Dutch prints → Renaissance & Early Modern Europe; Derge Tengyur vol. 105 and two Bhutanese monastery volumes → Tibetan; Fechner 1876, Bolingbroke 1754, Steinmayer 1763 → Modern European; a Sumerian royal letter → Mesopotamian; 武備志 and 詩經疏義會通 → Chinese; Plutarch *De liberis educandis* (1568) → Greek; a kohl tube of Amenhotep III → Egyptian; Besant's 1908 lectures → Theosophical & Modern Esoteric; Aphthonius *Progymnasmata* (1580) → Greek + Renaissance; a Latin catena on Job from Greek fathers (1586) → Byzantine & Orthodox + Renaissance.
- **Arguable (3):**
  - M 624, a Middle Persian Manichaean fragment → `Hermetic & Gnostic`. Defensible (Manichaeism is filed with the Gnostic religions), but `Persian` would serve a reader looking for Iranian material.
  - Sibly, *A key to physic, and the occult sciences* (1810 printing of a 1790s work) → `Renaissance & Early Modern Europe`. By the prompt's own date rule it is `Modern European`.
  - Heidelberg Cod. Pal. germ. 151, *Spiegel menschlicher Behaltnis* (mid-15th century) → `Renaissance & Early Modern Europe`. A German version of a 14th-century Latin work; `Medieval Latin` is at least as good.
- **Positive controls from #4773:** *Kashf al-Maḥjūb* → Persian (both editions); Neyphug Kanjur → Tibetan (one volume also Buddhist); *Theatrum chemicum* → Renaissance & Early Modern Europe + Hermetic & Gnostic. Zohar → Kabbalistic & Hasidic; Bhagavad Gita translations → Indian; *Tao Te Ching* translations → Chinese.

### Caveats

- **Metadata only.** A book with a wrong or empty record gets a wrong or empty label; 793 got none.
- **The 31 labels mix civilisation, language and period.** Buddhist texts in Tibetan are mostly `Tibetan` alone (11 of 21 pilot books), so "Buddhist" as a filter undercounts. The search re-rank counts by a coarser family for that reason (`family` in `src/lib/taxonomy/traditions.json`).
- **The boundary between the three European period labels is soft** (two of the three arguable books).
- **One model, one run, one reader.** No second rater; the 200-book disagreement read #4773 planned against the old keyword heuristic was not done, because that heuristic lives in another repository.
- *Replicated?* No. Temperature 0, single run.

### Spend

**$2.74** billed of the $5 approved (Batch, `gemini-3.1-flash-lite`), logged to `gemini_usage` as `maintenance/tradition-4773`, plus one 25-book realtime smoke test (under $0.01). Envelope `tradition-4773`.

### Artifacts

`scripts/maintenance/tradition-4773.mjs` (pick, submit, collect, sample, apply; `--pick --only-missing` labels new books), `src/lib/taxonomy/traditions.json`. Raw answers: `/data/scratch/sl/claude-jobs/cross-tradition-fix-work/tradition/raw.jsonl` on the job box; the stored values and their `sweep_log` rows are the record.

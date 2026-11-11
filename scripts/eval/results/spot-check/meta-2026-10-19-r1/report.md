# Metadata spot check, round 1 (#6056, metadata frame), 2026-10-19

**Draw.** 40 live books (`visible && pages_count > 0`, frame 42,391), seed `2026101901`, 8 per provider group
(Internet Archive, MDZ/BSB, Ritman/Allard Pierson, other European IIIF, everything else), spread over the
century of `source_work_dates_meta.edition`. Cell sizes are in `draw-log.json`. `meta-draw.mjs`.

**Review.** 8 Opus reviewers, 5 books each, brief `scripts/eval/spot-check/META-REVIEWER.md`. Each opened the
title page (or first leaf) and the last leaf as images and gave a verdict on 20 catalogue fields. Verdicts in
`reviews/`, unedited. Every value written to the database was then checked again by eye on the image.
`packets/` (the sample dealt into 8 files) is not committed; `meta-draw.mjs` regenerates it.

## Defect rate per field

Rate = (wrong + missing) / books where the field could be judged. 95% Wilson interval, by book (n = 40).
"Frame-weighted" re-weights the five provider groups by their share of the live frame.

| field | defects / judged | rate | 95% CI | serious | frame-weighted |
|---|---|---|---|---|---|
| work_id | 14/40 | 35% | 22–51% | 7 | 29% |
| author_id | 9/36 | 25% | 14–41% | 4 | 19% |
| author | 6/38 | 16% | 7–30% | 3 | 16% |
| title | 9/39 | 23% | 13–38% | 1 | 28% |
| display_title | 8/32 | 25% | 13–42% | 0 | 28% |
| year | 5/24 | 21% | 9–41% | 4 | 25% |
| published | 3/23 | 13% | 5–32% | 3 | 19% |
| edition date | 2/24 | 8% | 2–26% | 2 | 15% |
| work date | 2/23 | 9% | 2–27% | 1 | 10% |
| language | 5/40 | 13% | 6–26% | 4 | 4% |
| languages[] | 8/38 | 21% | 11–36% | 4 | 23% |
| original_language | 7/12 | 58% | 32–81% | 3 | 90% |
| text_role | 6/40 | 15% | 7–29% | 3 | 18% |
| edition_key | 7/39 | 18% | 9–33% | 0 | 20% |
| categories | 17/39 | 44% | 29–59% | 0 | 53% |
| place_published | 18/24 | 75% | 55–88% | 1 | 94% |
| publisher | 13/24 | 54% | 35–72% | 0 | 41% |
| pages_count | 0/40 | 0% | 0–9% | 0 | 0% |

Editor and translator were judged only where the book names one (5 and 3 books): all were empty.

21 of 40 books (53%, CI 38–67%) have at least one **serious** field error: the record names the wrong
person, date, language or work. 147 findings in `findings.json`.

## Classes (≥3 instances in ≥2 books), sized corpus-wide

Sized with `scripts/audit/catalogue-field-contradictions.mjs` (model-free, Mongo read-only, live frame).

| class | in sample | corpus-wide (live) | where it lives |
|---|---|---|---|
| work_id split from other editions of the same work | 11 books | not sized model-free; 1 of 13 sample cases is in `work_merge_queue` | #3759 / #6060 |
| `published: Unknown` while the title page is dated (and the dating run read it) | 2 | **3,984** (MDZ 3,033, SBB 421, Göttingen 269, IA 199) | #4572 / #6721 |
| `year` outside the dated edition window | 4 | **3,306** (1700 placeholder 997 → #3307; ETCSL −2000 372; SAT 2018 35) | #3307 |
| translation edition stored as `text_role: original` (title says *interprete*, *übersetzt*, *vertaalt* …) | 4 | **289** by title marker | #3261 / #3957 |
| `original_language` differs from `language` on an "original" | 3 | **255** | #4441 |
| `language` stamp disagrees with the value it describes | 2 | **521** | #4781 |
| `display_title` with HTML whitespace or a cut "…" | 3 | **803** (Allard Pierson 354, MDZ 289) | #4572 |
| author_id on a library / collection doc | 3 | **1,078** (1,005 Bhutanese collections, deliberate per `author-identity.md`; 73 others) | — |
| imprint (place, publisher) empty though printed | 18 / 13 | not sized | — |
| categories empty or unrelated ("lullism" on an opera, "alchemy" on a mill book) | 17 | not sized | — |

Also found: 112 of the 116 books whose byline #3894 corrected today still carry a `work_id` (and 111 an
`edition_key`) keyed to the printer, e.g. `local:n:aldo-manuzio:…` on Cicero's letters.

## Applied

All with `field_provenance` (embedded stamp + collection row), a `sweep_log` row before the write, the
`books_catalog` mirror and a revalidate. Backups in `backups/`.

- **10 books, by eye** (`fixes-books.json`, run `meta-round-6056-r1-books`): Christmann *Alphabetum arabicum*
  French → Latin; Zeising *Theatri machinarum* III English/modern-translation → German/original (the page had
  been showing a "historical English translation" notice); *Fo shuo gao wang Guanshiyin jing* Latin → Chinese,
  year 2018 removed; Saikaku *Bunshū* 1913 → 1914 (Taishō 3, colophon); Brogiollo 1648 and Vienna (was
  Unknown, Berlin); Gockel *De Ira* 1668 (was Unknown); original_language on *Jean de Paris* (French), Maier
  *Verum inventum* (Latin), Alexander *Problemata* and Aristotle *De caelo* (Greek); translators Beatus and Périon.
- **38 books, class fix** (`fixes-sat-year.json`, run `meta-round-6056-r1-sat-year`): SAT Daizokyo / BSB
  Chinese prints with `year: 2018`, the digitisation year. `year` set to the dated edition year where the
  catalogue `published` names one exact year (25), else removed (13). 20 rows checked by eye: all 20 are
  pre-modern prints or scrolls, 0 wrong.

Revert: `node --env-file=.env.production.local scripts/maintenance/apply-meta-round-6056.mjs --fixes=<fixes file> --revert --apply`

## Not applied

- `published: Unknown` on 3,984 title-page-dated books: dry run checked on 20 rows by eye, 20/20 years
  right. Over 500 books, and #6721 says the dating run never writes `published`, so this waits for Derek.
- text_role on non-English translations: `OriginalEditionNotice` says "a historical **English** translation"
  for every `period-translation`/`modern-translation`, so setting it on a Latin or German translation would
  publish a false sentence. 154 live non-English books already carry one of the two roles.
- work_id splits and over-merges, author_id wrong person (Ruland Elder/Younger, a generic `heinrich` doc), the
  praeses-vs-respondent author on the Struve dissertation, monastery bylines on Kanjur volumes: identity
  writes, left for their issues.

## Next round's stratum

Hidden-backlog imports (where #3769 says identity was never linked) and the MDZ dissertations, which carry
both the Unknown-date and missing-imprint classes; and a work_id-only draw to size the split rate.

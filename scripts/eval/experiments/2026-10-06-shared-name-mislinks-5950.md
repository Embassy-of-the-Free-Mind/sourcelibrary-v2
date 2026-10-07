## 2026-10-06 · When several people share a surname, how many mentions sit on the wrong person? (#5950)
<!-- PRIOR ART: scripts/audit/person-entity-name-collisions.mjs counts person records whose NAMES collide (#5888) and opens no page; 2026-07-26 #3361 measured whether a cited page prints the name at all (22%), not whose name it is. No earlier entry reads mentions to say which bearer of a name is meant. -->

- **Question.** `entities` keeps one person record per bare surname ("Bacon", "Scaliger") next to the full-name records of the people who bear it. Most of these bare records carry one person's Wikidata id, dates and description. How often does a mention on such a record belong to someone else?
- **Answer.** **56 of 120 sampled mentions (47%) are on the wrong person** (Wilson 95% 38–56%; resampling whole surnames 28–67%). The rate is a property of the record, not of the corpus: it runs from 0 of 10 (Gesner, Helmont) to 10 of 10 (Montanus). The bad records are the ones whose id names a minor bearer of the name. Four of the sixteen records carry no id and so claim nobody; their mentions are not wrong, only unassigned, and 32 of those 40 belong to one person per surname.
- **measure:** accuracy of the person a record's Wikidata id names, judged by one reader (the model that ran the job) from the page text. Not agreement between engines, not stability. One judge, no second reading.

### Design

- **Surnames (16, chosen, not drawn).** The seven named on #5950 that have ten readable books (Bacon, Scaliger, Valentinus, Agrippa, Huygens, Bauhin, Bruno; "Dee" has three), plus nine picked by eye from the larger bare records that are a medieval-or-later family name or byname with two or more other person records under distinct Wikidata ids (Fabricius, Scotus, Agricola, Montanus, Gesner, Helmont, Vossius, Hartmann, Philalethes). Records of similar size that fit the rule and were not taken: Levi, Arnold, Columbus, Darwin. Candidates came from `book_count ≥ 30` single-word person records and an Atlas `entities_search` lookup per name; Roman cognomina, forenames, saints and rulers (Caesar, John, Bernard, Augustus) were set aside by eye. That class is larger and probably worse, and is not measured here.
- **Sample.** `draw-sample.mjs`, seed 5950: per record, ten books drawn from the entries with a verified page (`page_precision: 'page'`) in a live book, one page each, with the passage around the name. Frame: 3,030 live books across the 16 records (77–93% of each record's books). Six draws were replaced because the name was not found on the page by the script's needles (Agricola 3, Bacon 1, Bauhin 1, Bruno 1).
- **Reading.** All 160 passages read; the next page or the full page text where the passage did not settle it; one page image opened (Scotus-07). A mention is **wrong** when the record carries an id and the page means another person or no person. The translation's own editorial notes name a person on many pages; the verdict was taken from the printed text wherever that decided it, but the notes were visible while reading.
- **Scoring.** `score.mjs`. Wilson interval on the pooled count; a bootstrap that resamples surnames, because ten mentions of one record are not independent.

### Result

| Surname | Record's id says | Live books in frame | Wrong / 10 | Who the ten were |
|---|---|---|---|---|
| Montanus | G. B. da Monte, physician (Q1697209) | 185 | **10** | Montanus the 2nd-century heresiarch 8 · Cicero's friend 1 · "montana uxor" 1 |
| Bruno | Giordano Bruno (Q36330) | 70 | **9** | founder of the Carthusians 3 · Bruno of Segni 2 · four other medieval Brunos 4 · Giordano 1 |
| Fabricius | David Fabricius, astronomer (Q60204) | 278 | **9** | the Roman consul 8 · Peiresc 1 · David 1 |
| Agrippa | Cornelius Agrippa (Q76568) | 495 | **8** | Marcus Vipsanius Agrippa 5 · King Agrippa 1 · a persecutor in a saint's life 1 · an ointment 1 · Cornelius 2 |
| Scaliger | Julius Caesar Scaliger (Q441066) | 420 | **6** | Joseph 6 · Julius Caesar 4 |
| Agricola | Georgius Agricola (Q76579) | 181 | **4** | Georgius 6 · Rodolphus 1 · Johann 1 · St Agricola 1 · "agricolis" (farmers) 1 |
| Bacon | Francis Bacon (Q37388) | 188 | **3** | Francis 7 · Roger 3 |
| Philalethes | Eirenaeus Philalethes (Q3801927) | 88 | **3** | Eirenaeus 7 · Eugenius 1 · two dialogue speakers 2 |
| Valentinus | Valentinus the Gnostic (Q309864) | 308 | **2** | the Gnostic 8 · Basilius 1 · a Lutheran disputant 1 |
| Scotus | Duns Scotus (Q190089) | 237 | **2** | Duns 8 · "Scotus the magician" 1 · OCR misread 1 |
| Gesner | Conrad Gessner (Q60116) | 134 | **0** | Conrad 10 |
| Helmont | J. B. van Helmont (Q294169) | 133 | **0** | Jan Baptist 10 |
| **12 records with an id** | | 2,717 | **56 / 120 = 47%** | |
| Huygens | no id | 68 | n/a | Christiaan 10 |
| Bauhin | no id | 37 | n/a | Caspar 8 · Johann 1 · both 1 |
| Vossius | no id | 124 | n/a | Gerardus 7 · Isaac 1 · Matthaeus 1 · undetermined 1 |
| Hartmann | no id | 84 | n/a | Johann (chymist) 7 · Eduard 2 · a revolutionary 1 |

- Weighted by each record's books the rate is 52% (31–69%), about 1,400 of the 2,717 books on these twelve records.
- 3 of the 56 name nobody: the OCR wrote "Scotus" where the page prints "Scdm" (Secundum), confirmed on the image; "agricolis"; "montana uxor". The page check of #3361 passes all three, because the string is on the page (or in the OCR).
- Confidence of the 160 verdicts: 144 high, 15 medium, 1 undetermined. Nine of the medium verdicts are on records with an id.

### What the issue text had differently

- **Bacon** carries Q37388, which is Francis Bacon, not Roger. 7 of 10 are Francis.
- **Valentinus** is the Gnostic's record and 8 of 10 mentions are the Gnostic. It is not absorbing Basilius Valentinus.
- **Agrippa** does hold Marcus Agrippa, and he is the majority: 5 of 10 against Cornelius's 2.
- The no-id records are not a blend in practice: one person holds 7–10 of 10 in each.

### Limits

- Ten per record: each per-record figure is ±30 points. Only the pooled rate and the ordering of the extremes are safe to quote.
- The 16 surnames were chosen. The figure describes these records, not the 2,672 single-word names among the 4,000 largest person records.
- One reader, who could see the translator's notes. No second judge.
- A page was drawn only if it prints the name; mentions cited to a section (1–13% of a record's entries) were not read.

### Follow-ups in the same job

- **Search chooser** ("Which Bacon?"): built from the full-name records only, because of this result. `src/lib/search/name-chooser.ts`.
- **Repair dry-run for Bacon** (`scripts/audit/shared-surname-reattribution-plan.mjs`, read-only): 504 mentions in 211 books; 351 get a proposed person from printed cues (122), the same book naming one of them in full (166) or the translator's note (63); 30 are decided by the book's date alone and are held for a reader; 123 stay. Against by-eye verdicts: the ten sampled mentions 8 agree / 0 wrong / 2 left; twenty more proposals (five per tier) 18 right, and both errors were date-only rows (a serjeant named Bacon in two 14th-century year books), which is why that tier is not a proposed move. Nothing was written.

- **Replicated?** No. One draw, one reader. The Bacon dry-run is an independent method on one surname and agrees with the reading where it decides (26 of 28; 22 of 22 without the date tier).
- **Artifact.** `scripts/eval/shared-name-mislinks/`: `draw-sample.mjs`, `sample.jsonl` (160 mentions with passages and page URLs), `frame.json`, `verdicts.tsv`, `score.mjs`, `bacon-reattribution-plan.json`, `bacon-plan-check.tsv`. Issue #5950.

---
stage: translation
measure: none
languages: []
scripts: []
canons: []
n_books: 1000
n_pages: 1000
verdict: "The notes-layer storage holds on a 1,000-page pilot, one page per book. The accessor served the stored text on 1,000 of 1,000 pages. Per the character ledger, 0 characters of book text were lost and 0 note characters leaked, on 996 comparable pages. 9,479 anchors all slice back to their phrase, including 2,628 repeated phrases. 0 lanes picked the pages up. Two parser defects (1 page each) were found and fixed (annotation-layer/2). Cost: ~5.2 KB logical, ~2.5 KB on disk per page."
status: undecided
decision: "Full backfill awaits Derek's go on #5942; first strip translation.text from the reader payload (PR #7652 notes)"
superseded_by: null
issue: 5942
---
## 2026-10-28 · Notes-layer storage: does a 1,000-page backfill pilot store the book's words and the notes apart without losing, leaking or actuating anything? (#5942)
<!-- PRIOR ART: 2026-10-24-notes-as-anchored-layer-5942.md (the parser, annotation-layer.mjs, measured from files on 3,000 pages; anchors re-found across revisions). This entry measures what the storage build of PR #7652 WROTE to production: translation.text + text_from on pages, page_annotations docs, page_revisions rows. Then it tries each failure mode Derek listed (inbox, 2026-10-28). -->

**Who this is for.** Anyone who will read `translation.text` once surfaces switch to it, and Derek, deciding the full run.

**Design.**
- The draw is seed 5942, one translated page per book, 1,000 of the 26,899 books with `pages_translated > 0`.
- The writer is `scripts/maintenance/notes-layer-backfill-5942/backfill.mjs`. It is $0 and calls no model.
  - run `notes-layer-backfill-5942-pilot-1` (parser /1), 20:14 UTC;
  - run `pilot-2` (parser /2, after the two fixes below), 20:27 UTC.
- The live checks are `scripts/eval/notes-layer-5942/pilot-checks.mts`. The lane check is `verify-untouched.mjs`. The tests are `tests/unit/notes-layer-failure-modes.test.ts`, `tests/unit/translation-text.test.ts` and `tests/integration/notes-layer-backfill.test.ts`.

### Numbers (pilot-2, parser annotation-layer/2)

| | value |
|---|---|
| pages written / conflicts / skipped | 1,000 / 0 / 0 |
| `getTranslationText` served the stored text (hash current) | 1,000 of 1,000 |
| markup rebuilt byte for byte from text + layout (`renderInline`) | 996 (4 = term definitions lifted, as every reader does) |
| stored annotations re-render the same markup as the parser's own | 1,000 of 1,000; 0 orphans |
| malformed tags | 24 pages: 3 unclosed, 36 stray close tags |
| character ledger: book characters lost / note characters leaked | **0 / 0** on 996 comparable pages |
| word ledger uneven | 3 pages, all a tag inside one word (`<unclear>ek</unclear>tinō`); characters equal |
| anchors: slice back to `exact` / re-resolve | 9,479 / 9,479 |
| `text` vs today's notes-off reader | 968 identical, 32 differ (extremes in the sheet; the text is right in the ones read by eye) |
| bytes per page, logical (BSON) | text + text_from 2,068 · page_annotations 2,698 (876 docs, 3,080 each) · revision row 413 = **~5.2 KB** |
| bytes per page, on disk (pages compress 0.42, page_annotations 0.46 on first insert) | ~870 + ~1,240 + ~190 + indexes ~250 = **~2.5 KB** |

**Full-run estimate.** The brief said ~4.9M pages. The books' `pages_translated` counters sum to **5.72M** today.
- **Bytes:** ~25–30 GB logical, **~12.5–14.6 GB on disk**. The `pages` collection is 35.4 GB on disk today; it gains ~4.3–5 GB of that, and `page_annotations` takes ~6–7 GB plus indexes.
- **Time:** at the pilot's throttle (batch 50, 300 ms pause) the backfill wrote ~10 pages/s, which is **~6–7 days**. With batch 200 and the same pause, about 2–3 days. Each page costs 3 writes (one revision insert, one page update, one annotations upsert).

### Failure modes: what was tried, and what happened

| # | failure mode | what was tried | n | result | example |
|---|---|---|---:|---|---|
| 1 | a writer updates `data` but not `text` | unit tests (both twins) and an integration test: rewrite `data` after the backfill, then read through the accessor | 5 tests | **pass**: falls back to a live parse of the new data | — |
| 2 | page edited between read and write | integration test: `data` changed in the gap between read and CAS write | 1 test; live 0 of 2,000 writes raced | **pass**: skipped, nothing written, revision row `aborted: 'conflict'` | — |
| 3 | malformed / unclosed / nested / overlapping tags | 6 fixtures; character ledger over the pilot | 6 + 996 pages | **pass**: 0 characters lost, 0 leaked; the markup rebuilds byte for byte. Caveat: an unclosed `<gloss>` keeps its two words in the text, by design (unclosed means the words stay). Today's reader drops the whole sentence after it instead. | [sheet #22](https://sourcelibrary.org/book/tractatus-novus-de-magnetica-vulnerum-curatione-citra-ullum-goclenius/page/69b680c270c69d645a71ccfc) |
| 4 | a note nested in a margin or an insert | fixture; pilot pages | 1 + 1 | **pass**: the note leaves the text. **Today's notes-off reader shows 5 model notes on this page as the book's words.** | [sheet #27](https://sourcelibrary.org/book/royal-ms-12-e-xx-various-hippocrates/page/6991bf73734f402cad48a1fb) |
| 5 | `<term>X<gloss>definition</gloss></term>` (gloss inside the term) | **found in pilot-1** by the word ledger ("KabbalahThe Jewish mystical tradition") | 1 of 1,000 pages, 5 definitions | **failed under /1** (the model's definition stayed in the text as a page mark). **Fixed in annotation-layer/2**, test added, page rewritten | [Sefer matzat shimurim p.57](https://sourcelibrary.org/book/book-of-the-unleavened-bread-of-watchfulness-sefer-matzat-spira/page/6988b2a7dfcf56881b1eaba8) |
| 6 | a book line that starts with a number plus term + note | **found in pilot-1**: "164 `<term>folios</term>` `<note>…</note>`" was read as a numbered glossary line | 1 of 1,000 | **failed under /1** ("164 folios" lost from the text; today's reader loses it too). **Fixed in /2**: a number counts as list numbering only before `.` or `)` | [sheet #27](https://sourcelibrary.org/book/royal-ms-12-e-xx-various-hippocrates/page/6991bf73734f402cad48a1fb) |
| 7 | non-Latin scripts, RTL, combining marks, astral characters | 6 fixtures (Arabic, Hebrew with points, Chinese, Tibetan, combining, surrogate pairs); live anchors by script | pages/anchors: Greek 52/853 · Han 38/685 · Hebrew 8/95 · combining 10/91 · Devanagari 5/28 · Tibetan 2/20 · Arabic 1/14 · Cyrillic 1/4 · astral 1/75 | **pass**: 0 slice mismatches, 0 unresolved, no anchor ends before a combining mark. Offsets are UTF-16 code units, not code points (documented in the parser) | sheet #29 (Arabic), #32 (Tibetan), #37 (astral) |
| 8 | empty, placeholder and withheld translations | 4 placeholder fixtures; integration test with withheld, empty and no-translation pages; pilot pages | 4 + 3 + 11 placeholder pages | **pass**: placeholders give text = the placeholder and no annotations. Pages without `data` are skipped, and `translation_withheld` is deep-equal after. 44 pilot pages carry `translation_withheld` beside a live `data`; it was untouched (lane check) | — |
| 9 | very long pages | fixture: 330 KB, 3,000 notes; the longest pilot page | 1 + 1 | **pass**: the 3,000-note fixture splits, rebuilds and balances its ledger; the longest pilot page (15,293 chars) splits in 2 ms | sheet #38 |
| 10 | the same phrase twice on a page | fixture; every pilot annotation whose `exact` occurs ≥2× | 1 + 2,628 | **pass**: 2,628 of 2,628 resolve to their own occurrence, 0 elsewhere | sheet #15 (one heading phrase per bird) |
| 11 | undo restores byte for byte | integration test (BSON hex compare, plus a page another writer moved on); **live on 20 pilot pages**: undo, compare, re-apply, compare | 1 test + 20 pages | **pass**: unset path 20/20 byte-exact, re-apply 20/20 byte-exact, restore path 20/20 with all other bytes identical. Caveat: undoing a RE-run puts back the earlier text but not the earlier run's `page_annotations` doc, which the re-run replaced. Reads then parse live. On the full run (a first write) undo is exact. | — |
| 12 | a lane picks the pilot pages up (embeddings, gap-fill, showcase, sync, pipeline status) | snapshot of every lane key (page and book `updated_at`, `translation.updated_at`, data hash, stale/withheld, `pipeline_auto.status`, `pages_translated`, `translation_state.rung`, new `page_revisions`, Supabase `page_translations`) taken after the write; compared 7 min and 30+ min later | 1,000 pages, 1,000 books, 948 Supabase rows | **pass**: 0 changed (results below) | — |
| 13 | the reader ships `translation` whole in its RSC payload | read `READER_PAGE_PROJECTION` and `/api/pages/*` | — | **finding, not a test.** A backfilled page sends `text` + `text_from` to the client too (~2 KB per page). Harmless at 1,000 pages. **Strip them before the full run** | — |
| 14 | an inferred anchor names the wrong phrase | read by eye | — | **known, unchanged.** #7319 measured 14% of inferred anchors on the wrong words. Here `original: "MS."` is anchored to "12 F XX", the phrase before it. These are stored as `anchor_kind: 'inferred'` | sheet #27, row 7 |

**Lane check:**
- 7 min after the write: 0 pages, 0 books, 0 revisions and 0 Supabase rows changed.
- 30+ min after (LANECHECK30): see the line added at the end of this entry.

### Read by eye (10 pages of the sheet)
Entries #1, #12, #15, #21, #22, #23, #27, #29, #32 and #37, plus the two pilot-1 defects above.
- **#22 (unclosed gloss).** The model's "mixing bowls" stays in the text, as designed. Today's reader instead drops the next sentence, and with notes off it shows "kerasai", "Greek historian" and other glosses as the author's words. The new text removes those.
- **#27 (insert holding notes).** The text is right; today's reader is wrong (row 4).
- **#23 (nested `<unclear>`).** Every word is kept. The model's spaces inside the tags leave double spaces, which is cosmetic.
- **#15 (Chinese, `<header>`).** The running heads become page annotations (bodies kept) and leave the flow.
- **#12, #29, #21, #1.** Clean.
- **#32 (Tibetan).** The term repeats the title ("*Bodhisattva Pratimokṣa* bodhisattva pratimokṣa"), as it does in today's reader. That is in the model's output, not added by the parser.
- **#37 (hieratic papyrus).** The storage is right. The translation itself looks suspect: six identical columns of "The name is Itf-Amen, Imy-ra Per. The name is Senty." The image was not opened here, so it is flagged for a check, not contained.

### Artifacts
- Run ids: `notes-layer-backfill-5942-pilot-1`, `-pilot-2`, `-pilot-2b`, `-pilot-2c` (the live undo test). Undo any of them with `undo.mjs --run-id <id> --apply`.
- The numbers, the per-page records and the lane snapshot are in the job scratch (`/root/jobs/notes-storage-5942/` on gex45). They are not committed: they quote page text.

### Spot-check sheet
- 20 random pilot pages (seed 5942), then the extremes: most annotations, every unclosed tag, stray close tags, the largest diffs against today's notes-off reader, one page per non-Latin script, the longest page, and the pages whose word ledger is uneven.
- There were no orphaned anchors.
- Raw and clean text are capped at 2,500 characters each, and the annotation lists at 40 rows.

### 1. Carmen genethliacon. In natalem filii, illustrissimi principis ac domini, domini Joachimi  — p. 5 (random (seed 5942))

https://sourcelibrary.org/book/carmen-genethliacon-in-natalem-filii-illustrissimi-frenzel/page/6a4ad699f624d013ada60468 · language Latin · prompt v13 · 697 chars stored, 314 in text · 1 annotations · scripts: Latin only

**Raw `translation.data`**

````text
# BIRTH POEM.

## ON THE BIRTH OF THE SON OF THE MOST
## ILLUSTRIOUS PRINCE AND LORD,
## Lord JOACHIM ERNEST,
### Prince of Anhalt, Count of Ascania, Lord in Bernburg, Zerbst, et cetera.

-> * * <-
-> * <-

->Author<-

## BARTHOLOMÄUS FRENCELIUS.

<note>A woodcut depicts the coat of arms for the House of Anhalt. The escutcheon is divided into multiple quarterings: the top-left quartering shows a bear walking on a crenellated city wall; other sections feature horizontal bars, a crancelin (a diagonal rue-crown), and checkered patterns. The design is rendered with fine line-work and cross-hatching for heraldic detail.</note>

# WITTENBERG

## PRINTED BY LAURENTIUS
### SCHVENCK.

### 1 5 6 7.
````

**Clean `translation.text`**

````text
# BIRTH POEM.

## ON THE BIRTH OF THE SON OF THE MOST
## ILLUSTRIOUS PRINCE AND LORD,
## Lord JOACHIM ERNEST,
### Prince of Anhalt, Count of Ascania, Lord in Bernburg, Zerbst, et cetera.

-> * * <-
-> * <-

->Author<-

## BARTHOLOMÄUS FRENCELIUS.

# WITTENBERG

## PRINTED BY LAURENTIUS
### SCHVENCK.

### 1 5 6 7.
````

**Annotations** (1)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | note | commentary | “” | A woodcut depicts the coat of arms for the House of Anhalt. The escutcheon is divided into multiple quarterings: the top-left quartering sho |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 2. Opus insigne cypriani leovitii à leouicia, mathematici excellentissimi, de magnis superior — p. 67 (random (seed 5942))

https://sourcelibrary.org/book/opus-insigne-cypriani-leovitii-a-leouicia-mathematici-leowitz/page/6a4acba6eecacd70e4717c2e · language Latin · prompt v13 · 1118 chars stored, 1079 in text · 2 annotations · scripts: Latin only

**Raw `translation.data`**

````text
more. Cattle and herds wasted away in many places. The imperial cities encamped at the Lech river and forced the Duke of Bavaria to restore Regensburg completely. Alfonso, King of Portugal, fell with his horse and died. Furthermore, a third

<margin>Opposition in Aquarius and Leo, then in Pisces and Virgo.</margin>

great opposition of the superior planets occurred under Emperor Frederick III in the extremity of Aquarius and Leo in the month of August in the year of our Lord 1493. At that time, the powers of the previous eclipse had not yet subsided. In such a configuration of the stars, the French disease <note>syphilis</note> arose in the Neapolitan kingdom. Emperor Frederick, a most praiseworthy prince, also died then; no one had ruled the empire longer since Augustus Caesar, for he reigned for 53 years and 5 months. He was succeeded by his son Maximilian, who had already been elected King of the Romans by the princes of the empire in the year of our Lord 1486. In the following year of our Lord 1494, in the months of January and February, the great opposition of the superior planets occurred again.
````

**Clean `translation.text`**

````text
more. Cattle and herds wasted away in many places. The imperial cities encamped at the Lech river and forced the Duke of Bavaria to restore Regensburg completely. Alfonso, King of Portugal, fell with his horse and died. Furthermore, a third

Opposition in Aquarius and Leo, then in Pisces and Virgo.

great opposition of the superior planets occurred under Emperor Frederick III in the extremity of Aquarius and Leo in the month of August in the year of our Lord 1493. At that time, the powers of the previous eclipse had not yet subsided. In such a configuration of the stars, the French disease arose in the Neapolitan kingdom. Emperor Frederick, a most praiseworthy prince, also died then; no one had ruled the empire longer since Augustus Caesar, for he reigned for 53 years and 5 months. He was succeeded by his son Maximilian, who had already been elected King of the Romans by the princes of the empire in the year of our Lord 1486. In the following year of our Lord 1494, in the months of January and February, the great opposition of the superior planets occurred again.
````

**Annotations** (2)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | margin | mark | “Opposition in Aquarius and Leo, then in Pisces and Virgo.” |  |
| 2 | note | commentary | “the French disease” | syphilis |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 3. Martial: Epigrams II (Loeb Classical Library, Vol. 95) — p. 25 (random (seed 5942))

https://sourcelibrary.org/book/martial-epigrams-ii-loeb-classical-library-vol-95-martial/page/6a08979aced7f688b87f0671 · language Latin · prompt v11 · 2326 chars stored, 2082 in text · 2 annotations · scripts: Latin only

**Raw `translation.data`**

````text
### BIBLIOGRAPHY

2. The Delphin Edition by Vinc. Colleſſo, with a paraphrase and variorum notes, Paris, 1680, 1823. Published by command of Louis XIV.
3. An edition, containing old and new notes and occasional Greek versions, by five Professors of the French Academy, Lemaire, Paris, 1825.
4. An edition by F. G. Schneidewin, Grimae, 1842.
5. *Select Epigrams of Martial*, with English notes by F. A. Paley and W. H. Stone ("Grammar School Classics”), Whittaker & Co. and George Bell, 1868. A useful and handy edition.
6. The *Epigrams of Martial*, with explanatory notes by L. Friedlander, Leips. 1886, 2 vols. A standard edition.
7. *Selected Epigrams of Martial*, edited, with introduction, notes, and appendices, by Rev. H. M Stephenson, Macmillan, 1880-1895.
8. *Select Epigrams of Martial*, edited according to the text of Prof. Lindsay, by R. T Bridge and E. D. C. Lake, Oxford, Clarendon Press, 1908, 2 vols.
There is a good introduction by Prof. Sellar in *Extracts from Martial*, Edinburgh, 1884 ; and a valuable discussion of the epigrams in Lessing’s Prose Works.

### TRANSLATIONS

An English prose translation (the obscene epigrams being, however, in Graglia’s Italian) is published in Bohn’s “Classical Library.” The versions are not unsatisfactory as regards correctness, but the style in the case of the more serious epigrams often falls below the dignity of the subject. A selection of 150 epigrams has also been translated, with an introduction and notes, by Alfred S. West (*Wit and Wisdom from Martial*, Hampstead Priory Press, 1912).
Among verse translations are: a MS. of the age of Elizabeth; Thomas May, poet and playwright, 1629; R. Fletcher, 1656; Anon. 1695; J. Hughes, 1737; William Hay, M.P. for Seaford, 1755; Wright, 1763; E. B. Greene, 1774. Specimens of the preceding and of many others will be found in the Bohn Martial. Other translators are W. F. Shaw (Juvenal, Persius, Martial and Catullus, an experiment in translation, 1882), forty-three epigrams in unrhymed trochaics, a close rendering, the metre being, however, sometimes rugged; Goldwin

<summary>Continuation of the bibliography including prominent scholarly editions and a historical summary of English verse and prose translations of Martial.</summary>
<keywords>bibliography, Martial, translations, editions, poetry</keywords>
````

**Clean `translation.text`**

````text
### BIBLIOGRAPHY

2. The Delphin Edition by Vinc. Colleſſo, with a paraphrase and variorum notes, Paris, 1680, 1823. Published by command of Louis XIV.
3. An edition, containing old and new notes and occasional Greek versions, by five Professors of the French Academy, Lemaire, Paris, 1825.
4. An edition by F. G. Schneidewin, Grimae, 1842.
5. *Select Epigrams of Martial*, with English notes by F. A. Paley and W. H. Stone ("Grammar School Classics”), Whittaker & Co. and George Bell, 1868. A useful and handy edition.
6. The *Epigrams of Martial*, with explanatory notes by L. Friedlander, Leips. 1886, 2 vols. A standard edition.
7. *Selected Epigrams of Martial*, edited, with introduction, notes, and appendices, by Rev. H. M Stephenson, Macmillan, 1880-1895.
8. *Select Epigrams of Martial*, edited according to the text of Prof. Lindsay, by R. T Bridge and E. D. C. Lake, Oxford, Clarendon Press, 1908, 2 vols.
There is a good introduction by Prof. Sellar in *Extracts from Martial*, Edinburgh, 1884 ; and a valuable discussion of the epigrams in Lessing’s Prose Works.

### TRANSLATIONS

An English prose translation (the obscene epigrams being, however, in Graglia’s Italian) is published in Bohn’s “Classical Library.” The versions are not unsatisfactory as regards correctness, but the style in the case of the more serious epigrams often falls below the dignity of the subject. A selection of 150 epigrams has also been translated, with an introduction and notes, by Alfred S. West (*Wit and Wisdom from Martial*, Hampstead Priory Press, 1912).
Among verse translations are: a MS. of the age of Elizabeth; Thomas May, poet and playwright, 1629; R. Fletcher, 1656; Anon. 1695; J. Hughes, 1737; William Hay, M.P. for Seaford, 1755; Wright, 1763; E. B. Greene, 1774. Specimens of the preceding and of many others will be found in the Bohn Martial. Other translators are W. F. Shaw (Juvenal, Persius, Martial and Catullus, an experiment in translation, 1882), forty-three epigrams in unrhymed trochaics, a close rendering, the metre being, however, sometimes rugged; Goldwin
````

**Annotations** (2)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | summary | page | *page* | Continuation of the bibliography including prominent scholarly editions and a historical summary of English verse and prose translations of  |
| 2 | keywords | page | *page* | bibliography, Martial, translations, editions, poetry |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 4. Theatrum anatomicum — p. 705 (random (seed 5942))

https://sourcelibrary.org/book/theatrum-anatomicum-bauhin-2/page/69b51db3f23ccdcced3090e6 · language Latin · prompt v13 · 421 chars stored, 44 in text · 2 annotations · scripts: Latin only

**Raw `translation.data`**

````text
### LIB. III. TAB. XVIII.

FIG. I.

<note>An anatomical engraving shows the human brain viewed from the underside, displaying the cranial nerves, the brainstem, and optic nerves with identifying letters and numbers.</note>

FIG. II.

<note>An anatomical engraving depicts the human brain viewed from above, revealing the cerebral hemispheres, corpus callosum, and internal structures, marked with labels for study.</note>
````

**Clean `translation.text`**

````text
### LIB. III. TAB. XVIII.

FIG. I.

FIG. II.
````

**Annotations** (2)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | note | commentary | “” | An anatomical engraving shows the human brain viewed from the underside, displaying the cranial nerves, the brainstem, and optic nerves with |
| 2 | note | commentary | “FIG. II” | An anatomical engraving depicts the human brain viewed from above, revealing the cerebral hemispheres, corpus callosum, and internal structu |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 5. Cosmographia — p. 25 (random (seed 5942))

https://sourcelibrary.org/book/cosmographia-aethicus/page/6a26bcecd6b178e5aad86ca3 · language Latin · prompt v11 · 1157 chars stored, 1144 in text · 1 annotations · scripts: Latin only

**Raw `translation.data`**

````text
# DEDICATORIA.
)( 2

composed his learned and laborious Geographical work from the distances of places and the observation of things appearing from the heavens. For I do not believe anyone to be so ignorant as to think that the longitudes and latitudes of all places were observed from the heavens by <term>Ptolemy</term> himself or others. But when the longitude and latitude of the principal and more famous places were established, the rest were discovered and added from the accurate observation and measurement of the routes. Knowledge of routes also brings much light to the reading of histories. For often the various marches of armies by land and sea are described by historians, and sometimes the scatterings of fleets caused by storms; all these things are better understood if you know the distances and intervals of places. Furthermore, the method of routes should be known to leaders and commanders, and for that reason, great emperors once spent both effort and expense on this matter, so that they might have all routes known and diligently described. The management of the routes was prescribed by these same soldiers; regarding which matter
````

**Clean `translation.text`**

````text
# DEDICATORIA.
)( 2

composed his learned and laborious Geographical work from the distances of places and the observation of things appearing from the heavens. For I do not believe anyone to be so ignorant as to think that the longitudes and latitudes of all places were observed from the heavens by Ptolemy himself or others. But when the longitude and latitude of the principal and more famous places were established, the rest were discovered and added from the accurate observation and measurement of the routes. Knowledge of routes also brings much light to the reading of histories. For often the various marches of armies by land and sea are described by historians, and sometimes the scatterings of fleets caused by storms; all these things are better understood if you know the distances and intervals of places. Furthermore, the method of routes should be known to leaders and commanders, and for that reason, great emperors once spent both effort and expense on this matter, so that they might have all routes known and diligently described. The management of the routes was prescribed by these same soldiers; regarding which matter
````

**Annotations** (1)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | term | mark | “Ptolemy” |  |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 6. Sophoclis quae extant omnia — p. 191 (random (seed 5942))

https://sourcelibrary.org/book/sophoclis-quae-extant-omnia-estienne/page/69b2f4250e2f024dfbfbb77a · language Latin · prompt v10 · 3633 chars stored, 2053 in text · 70 annotations · scripts: Greek

**Raw `translation.data`**

````text
<meta>Continuity: Continues the philological analysis of Greek plays, specifically focusing on textual emendations from old codices.</meta>

<header>HENR. STEPHANI</header>

examples rather than that it would be necessary to adduce them; but since examples of this usage of the verb <term>perainō</term> <gloss>to finish/bring to an end</gloss> are likewise obvious, I will bring forward a single one, which is found in the same poet, namely in the *Medea*, page 24, "finish the speech for me" <note>original: "πέραίνέ μοι λόγον"</note>.

**V. <term>ex aseb.</term> <gloss>from impiety</gloss>:** This passage is most beautifully restored from the old codices, which have the contrary for <term>asebeias</term> <gloss>of impiety</gloss>, namely <term>dysebeias</term> <gloss>of ungodliness</gloss>, and <term>nin</term> <gloss>him</gloss> for <term>nun</term> <gloss>now</gloss>. However, <term>ex asebeias</term> <gloss>from impiety</gloss> has a certain novelty <note>original: "καινοπρέπειαν"</note> instead of <term>ex asebous</term> <gloss>from the impious one</gloss>, in this way: "if I punished him as holy," that is, impious, from ungodly; that is, making him who was formerly ungodly into a holy one. Unless someone interprets <term>ek dysebeias</term> <gloss>from ungodliness</gloss> (while the sense otherwise remains the same) as "after the ungodliness which he practiced."

->P A G E XXXVIII.<-

**V. <term>rhipaisin</term> <gloss>with gusts/dashing</gloss>:** For <term>melean</term> <gloss>miserable</gloss>, the old codices have <term>meleon</term> <gloss>miserable</gloss>; concerning this reading, Brodæus had also given notice. But another reading is also noted in the old [codices], namely <term>meleōn</term> <gloss>of the miserable</gloss>.

->P A G E XXXIX.<-

**V. <term>alidra</term>:** Replace with <term>oi’ oiea melea</term> <gloss>such miserable things</gloss>.
**V. <term>hote sy to</term> <gloss>when you the</gloss>:** For <term>sy</term> <gloss>you</gloss>, Brodæus suspected that <term>se</term> <gloss>you (accusative)</gloss> should be put in its place, though I do not know what sense he derives from this passage thus emended. We learn from the old codices that this verse certainly suffers from a different disease, in which there is indeed the syllable <term>sy</term> <gloss>you</gloss>, but joined with <term>to</term> <gloss>the</gloss>; for there it is written <term>syto</term> <gloss>he rushed</gloss>: which I accept for <term>esyto</term> <gloss>he ru
… [1133 more characters]
````

**Clean `translation.text`**

````text
examples rather than that it would be necessary to adduce them; but since examples of this usage of the verb perainō are likewise obvious, I will bring forward a single one, which is found in the same poet, namely in the *Medea*, page 24, "finish the speech for me".

**V. ex aseb.:** This passage is most beautifully restored from the old codices, which have the contrary for asebeias, namely dysebeias, and nin for nun. However, ex asebeias has a certain novelty instead of ex asebous, in this way: "if I punished him as holy," that is, impious, from ungodly; that is, making him who was formerly ungodly into a holy one. Unless someone interprets ek dysebeias (while the sense otherwise remains the same) as "after the ungodliness which he practiced."

->P A G E XXXVIII.<-

**V. rhipaisin:** For melean, the old codices have meleon; concerning this reading, Brodæus had also given notice. But another reading is also noted in the old [codices], namely meleōn.

->P A G E XXXIX.<-

**V. alidra:** Replace with oi’ oiea melea.
**V. hote sy to:** For sy, Brodæus suspected that se should be put in its place, though I do not know what sense he derives from this passage thus emended. We learn from the old codices that this verse certainly suffers from a different disease, in which there is indeed the syllable sy, but joined with to; for there it is written syto: which I accept for esyto. No one, I think, will deny that this is most fitting for this passage. From the same [source] is epesyto, on the page immediately following, "the flame of Zeus rushed upon". But at the end of the verse, write apopro from the same codices.
**V. hoti:** Write ho, ti instead, just as the old codices have it, so that it might be a pronoun.
**V. ti phēs:** In the same [codices] is written ti phaiē.

->P A G E XL.<-

**V. pycha:** For phlogeros, phlochmos is found in the old [codices].
**V. hopi pathea:** For the verb pherein, it is necessary to replace it with pherousa, so that it may be "the flame rushed upon, bearing." But Brodæus, when he noticed that...
````

**Annotations** (70)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | Continuity: Continues the philological analysis of Greek plays, specifically focusing on textual emendations from old codices. |
| 2 | pagedata | page | *page* | HENR. STEPHANI |
| 3 | term | mark | “perainō” |  |
| 4 | definition | commentary | “perainō” | to finish/bring to an end |
| 5 | original | commentary | “speech for me” | original: "πέραίνέ μοι λόγον" |
| 6 | term | mark | “ex aseb.” |  |
| 7 | definition | commentary | “ex aseb.” | from impiety |
| 8 | term | mark | “asebeias” |  |
| 9 | definition | commentary | “asebeias” | of impiety |
| 10 | term | mark | “dysebeias” |  |
| 11 | definition | commentary | “dysebeias” | of ungodliness |
| 12 | term | mark | “nin” |  |
| 13 | definition | commentary | “nin” | him |
| 14 | term | mark | “nun” |  |
| 15 | definition | commentary | “nun” | now |
| 16 | term | mark | “ex asebeias” |  |
| 17 | definition | commentary | “ex asebeias” | from impiety |
| 18 | original | commentary | “a certain novelty” | original: "καινοπρέπειαν" |
| 19 | term | mark | “ex asebous” |  |
| 20 | definition | commentary | “ex asebous” | from the impious one |
| 21 | term | mark | “ek dysebeias” |  |
| 22 | definition | commentary | “ek dysebeias” | from ungodliness |
| 23 | term | mark | “rhipaisin” |  |
| 24 | definition | commentary | “rhipaisin” | with gusts/dashing |
| 25 | term | mark | “melean” |  |
| 26 | definition | commentary | “melean” | miserable |
| 27 | term | mark | “meleon” |  |
| 28 | definition | commentary | “meleon” | miserable |
| 29 | term | mark | “meleōn” |  |
| 30 | definition | commentary | “meleōn” | of the miserable |
| 31 | term | mark | “alidra” |  |
| 32 | term | mark | “oi’ oiea melea” |  |
| 33 | definition | commentary | “oi’ oiea melea” | such miserable things |
| 34 | term | mark | “hote sy to” |  |
| 35 | definition | commentary | “hote sy to” | when you the |
| 36 | term | mark | “sy” |  |
| 37 | definition | commentary | “sy” | you |
| 38 | term | mark | “se” |  |
| 39 | definition | commentary | “se” | you (accusative) |
| 40 | term | mark | “sy” |  |

… 30 more

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 7. Canon medicinae [Latin] (Lib. I-V) (Tr: Gerardus Cremonensis). Ed: Petrus Rochabonella. Co — p. 151 (random (seed 5942))

https://sourcelibrary.org/book/canon-medicinae-latin-lib-i-v-tr-gerardus-cremonensis-ed-pet-avicenna-2/page/69dbc85c1040d1d5e2098920 · language Latin · prompt v11 · 8356 chars stored, 7482 in text · 23 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<header>Book 1, Fen 3</header>

<column-break/>
they provide for a good scent, and they favor the principal members.
Chapter 19: On <term>embrocations</term> <gloss>medicinal liquids applied to the body</gloss>.
There are still medicines for the heaviness that comes from the head, or to resolve such a state when it is necessary to change the complexion <note>the humoral balance of the body</note>. As for members that are to be embrocated, if they are from heat and cold, and if fluids do not flow within them and descend, let the embrocation be made of a heated substance. Afterward, let it be made of cold water so that they may constrict. But if the matter is different, let it begin from the cold. Chapter 20: On <term>phlebotomy</term> <gloss>bloodletting</gloss>.

Phlebotomy is a practice whose use and frequency are beneficial. However, excess is the increase of this beyond its equity, since everyone is prone to those illnesses that occur when their blood has become excessive. Such is the danger in them. Every one of them has a need for phlebotomy due to a multitude of blood, or its corruption, or both. And the illnesses to which one is prone are these: sciatic <note>hip pain</note> and gout, and the <term>fombr</term> <gloss>perhaps an ancient term for joint inflammation</term> and the arthritic pain of blood, or that person to whom blood spitting occurs from a fissure in the vein of the lung, and it comes out thin and solidified, since when blood has multiplied for him, it is to be believed. And they are apt for epilepsy and melancholy, when there is a multitude of blood, and for trembling and for the beginning of ophthalmia <note>eye inflammation</note>. And for those to whom blood from hemorrhoids used to flow and was retained, and for women to whom menstrual blood is restricted; these people show in their color and appearance that they need to be phlebotomized because of the obscurity, or whiteness, or greenness of the skin. And those who suffer in the internal members due to a weakness in heat. But it is also necessary for them to be aware of the manual procedures if these illnesses occur. And to those to whom a blow occurs, or a cause by which blood is diminished, so that an <term>apoplexy</term> <gloss>stroke</gloss> does not occur to them, because this helps to diminish it; one must fear that an apoplexy might ripen, and if he had need, and there was no multitude there. And you must know that when these illnesses are feared and have not yet fallen 
… [5856 more characters]
````

**Clean `translation.text`**

````text
<column-break/>
they provide for a good scent, and they favor the principal members.
Chapter 19: On embrocations.
There are still medicines for the heaviness that comes from the head, or to resolve such a state when it is necessary to change the complexion. As for members that are to be embrocated, if they are from heat and cold, and if fluids do not flow within them and descend, let the embrocation be made of a heated substance. Afterward, let it be made of cold water so that they may constrict. But if the matter is different, let it begin from the cold. Chapter 20: On phlebotomy.

Phlebotomy is a practice whose use and frequency are beneficial. However, excess is the increase of this beyond its equity, since everyone is prone to those illnesses that occur when their blood has become excessive. Such is the danger in them. Every one of them has a need for phlebotomy due to a multitude of blood, or its corruption, or both. And the illnesses to which one is prone are these: sciatic and gout, and the fombr perhaps an ancient term for joint inflammation and the arthritic pain of blood, or that person to whom blood spitting occurs from a fissure in the vein of the lung, and it comes out thin and solidified, since when blood has multiplied for him, it is to be believed. And they are apt for epilepsy and melancholy, when there is a multitude of blood, and for trembling and for the beginning of ophthalmia. And for those to whom blood from hemorrhoids used to flow and was retained, and for women to whom menstrual blood is restricted; these people show in their color and appearance that they need to be phlebotomized because of the obscurity, or whiteness, or greenness of the skin. And those who suffer in the internal members due to a weakness in heat. But it is also necessary for them to be aware of the manual procedures if these illnesses occur. And to those to whom a blow occurs, or a cause by which blood is diminished, so that an apoplexy does not occur to them, because this helps to diminish it; one must fear that an apoplexy might ripen, and if he had need, and there was no multitude there. And you must know that when these illnesses are feared and have not yet fallen upon them, the evacuation proceeds to cure them; but when they have fallen into the beginning of them, let phlebotomy be omitted because it stirs the humors and they flow through the body and mix with the healthy blood. And when nothing helps from that which is necessary to be a medicinal sedative
… [4982 more characters]
````

**Annotations** (23)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | page | *page* | Book 1, Fen 3 |
| 2 | term | mark | “embrocations” |  |
| 3 | definition | commentary | “embrocations” | medicinal liquids applied to the body |
| 4 | note | commentary | “change the complexion” | the humoral balance of the body |
| 5 | term | mark | “phlebotomy” |  |
| 6 | definition | commentary | “phlebotomy” | bloodletting |
| 7 | note | commentary | “are these: sciatic” | hip pain |
| 8 | term | mark | “fombr” |  |
| 9 | definition (unclosed) | commentary | “” |  |
| 10 | term (stray-close) | mark | — |  |
| 11 | note | commentary | “beginning of ophthalmia” | eye inflammation |
| 12 | term | mark | “apoplexy” |  |
| 13 | definition | commentary | “apoplexy” | stroke |
| 14 | term | mark | “crisis” |  |
| 15 | definition | commentary | “crisis” | a turning point in the disease |
| 16 | note | commentary | “will generate. Syncope” | fainting |
| 17 | note | commentary | “with the colicky” | severe abdominal pain |
| 18 | note | commentary | “if bad choleric” | bile-related |
| 19 | term | mark | “julep” |  |
| 20 | definition | commentary | “julep” | a sweet, syrupy drink |
| 21 | note | commentary | “has been tonal” | perhaps referring to a specific pallor or tension |
| 22 | summary | page | *page* | This page discusses the medical necessity, procedures, and risks of phlebotomy (bloodletting), emphasizing the importance of timing, patient |
| 23 | keywords | page | *page* | phlebotomy, bloodletting, humors, crisis, fevers, syncope, medicine, patient care |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): 

````text
{+perhaps an ancient term for joint inflammation and the arthritic pain of blood, or that person to whom blood spitting occurs from a fissure in the vein of the lung, and it comes out thin and solidified, since when blood has multiplied for him, it is to be believed. And they are apt for epilepsy and melancholy, when there is a multitude of blood, and for trembling and for the beginning of ophthalmia. And for those to whom blood from hemorrhoids used to flow and was retained, and for women to whom menstrual blood is restricted; these people show in their color and appearance that they need to be phlebotomized because of the obscurity, or whiteness, or greenness of the skin. And those who suffer in the internal members due to a weakness in heat. But it is also necessary for them to be aware of the manual procedures if these illnesses occur. And to those to whom a blow occurs, or a cause by which blood is diminished, so that an apoplexy does not occur to them, because this helps to diminish it; one must fear that an apoplexy might ripen, and if he had need, and there was no multitude there. And you must know that when these illnesses are feared and have not yet fallen upon them, the evacuation proceeds to cure them; but when they have fallen into the beginning of them, let phlebotomy be omitted because it stirs the humors and they flow through the body and mix with the healthy blood. And when nothing helps from that which is necessary to be a medicinal sedative. If maturation has appeared and the illness is at the beginning or has passed immediately, and if it is fitting that an evacuation be made, if there is nothing that prohibits it, let phlebotomy be performed. Also, the evacuation of the belly is to be done on the day of the intensity of the illness, because it is the day of cooling and entering into sleep, and the day of the boiling of the illness. And if the illness has a crisis at that time, and it is a long one, in no way should blood be diminished if it can be avoided. But if it is necessary to resist in the crises, since if the time of the crisis passes, from which a person might be relieved, let it be diminished and let the blood be stored as if in a treasury. Furthermore, because phlebotomy draws to different parts, many humors will generate. Syncope also occurs in the first evacuation when it happens suddenly to someone who was not accustomed to it, and the same occurs in vomiting. One must also be careful in an evacuation where disturbance occ
… [286 more characters]
````

### 8. Разрушающий и созидающий миры — p. 2 (random (seed 5942))

https://sourcelibrary.org/book/destroying-and-creating-worlds/page/69aff43745364012cf421cb3 · language Russian · prompt v10 · 3017 chars stored, 2958 in text · 2 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<page-num>26</page-num>
<header>Russian Thought.</header>

on earth; now the whole world hears him. But even now his loud protest, like his silent indignation then, has no effect. They hear him, but they do not take him into account and they continue to execute. Tolstoy does not yield and will not yield; the world also does not yield and will not yield, it will never yield: everyone knows this, and Tolstoy himself knows it.

This incident is unusually characteristic of Tolstoy. His whole life is a continuous struggle. He wants to overcome and reshape reality, which he sincerely, with all his soul, hates, and in his struggle with it, he develops extraordinary, titanic power and strength.

People admire Tolstoy, they bow down before him, but reality does not yield, remaining the same as before. It even seems to triumph doubly: after all, Tolstoy, the huge, colossal Tolstoy, is also its child, flesh of its flesh, blood of its blood. He belongs to it, he, who protests against and curses it. It will not give up its great Tolstoy to anyone...

At that same time, while abroad, Tolstoy happened to witness a second death, though not at the hands of man. His older brother died—a kind, intelligent, good man. Suddenly, for no known reason, he fell ill and, after a year of heavy suffering, passed away. Again, horror; again, Tolstoy could have repeated that if all people existing and all who had existed from the creation of the world were to try to convince him that this was necessary, that this was good, he knows that it is evil, absolutely unnecessary, that it should not be. But he does not even say this anymore, and now, fifty years later, he does not appeal to nature as he appealed to men with his passionate call: "I cannot remain silent."

It seems possible to struggle with men; it is madness to feel indignation against nature.

Everyone knows how and with what Tolstoy answered these two deaths. He returned to Russia, at first busying himself with literature and literary-pedagogical activity, but soon he married and dedicated himself exclusively to his family life, personal affairs, and artistic creation. And if at that time, that is, in the sixties and seventies, someone had tried to tell Tolstoy that his answer was no answer, that he had no right to family happiness, nor to business joys, nor to artistic creation, he would have known how to repel anyone and defend his rights from uninvited teachers. "I am standing by my house with a dagger and a revolver; let any
… [517 more characters]
````

**Clean `translation.text`**

````text
on earth; now the whole world hears him. But even now his loud protest, like his silent indignation then, has no effect. They hear him, but they do not take him into account and they continue to execute. Tolstoy does not yield and will not yield; the world also does not yield and will not yield, it will never yield: everyone knows this, and Tolstoy himself knows it.

This incident is unusually characteristic of Tolstoy. His whole life is a continuous struggle. He wants to overcome and reshape reality, which he sincerely, with all his soul, hates, and in his struggle with it, he develops extraordinary, titanic power and strength.

People admire Tolstoy, they bow down before him, but reality does not yield, remaining the same as before. It even seems to triumph doubly: after all, Tolstoy, the huge, colossal Tolstoy, is also its child, flesh of its flesh, blood of its blood. He belongs to it, he, who protests against and curses it. It will not give up its great Tolstoy to anyone...

At that same time, while abroad, Tolstoy happened to witness a second death, though not at the hands of man. His older brother died—a kind, intelligent, good man. Suddenly, for no known reason, he fell ill and, after a year of heavy suffering, passed away. Again, horror; again, Tolstoy could have repeated that if all people existing and all who had existed from the creation of the world were to try to convince him that this was necessary, that this was good, he knows that it is evil, absolutely unnecessary, that it should not be. But he does not even say this anymore, and now, fifty years later, he does not appeal to nature as he appealed to men with his passionate call: "I cannot remain silent."

It seems possible to struggle with men; it is madness to feel indignation against nature.

Everyone knows how and with what Tolstoy answered these two deaths. He returned to Russia, at first busying himself with literature and literary-pedagogical activity, but soon he married and dedicated himself exclusively to his family life, personal affairs, and artistic creation. And if at that time, that is, in the sixties and seventies, someone had tried to tell Tolstoy that his answer was no answer, that he had no right to family happiness, nor to business joys, nor to artistic creation, he would have known how to repel anyone and defend his rights from uninvited teachers. "I am standing by my house with a dagger and a revolver; let anyone dare to enter it." And his voice sounds with such decis
… [458 more characters]
````

**Annotations** (2)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | page | *page* | 26 |
| 2 | pagedata | page | *page* | Russian Thought. |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 9. Theophrasti Characteres ethici — p. 158 (random (seed 5942))

https://sourcelibrary.org/book/theophrasti-characteres-ethici-theophrastus/page/6a21985ef11c08f10b202b72 · language Latin · prompt v11 · 4490 chars stored, 3468 in text · 46 annotations · scripts: Greek

**Raw `translation.data`**

````text
<header>Is. Casaub. ad Theophr. Cap. 2.</header>

...often profited them by catering for his king. In *Adelphi*, however, Act V, verse 7, he indicates that for Demea to do the catering himself, just as to bring in a prostitute, is the duty of a person of no consequence. Hence he had his name among Apollodorus, from whom Terence translated his *Phormio*, namely the parasite Phormio: for the poet attributes this name to the parasite in the prologue, alluding to <term>phormida</term> <gloss>basket</gloss>. Now, a <term>phormis</term> <gloss>wicker basket</gloss> was like a small shopping bag, which they carried with them when they went to the market and the forum. Such is what the French call a *cabas*; whence we have <term>phormis karyōn</term> <gloss>basket of nuts</gloss> and <term>phormis sykōn</term> <gloss>basket of figs</gloss> in Athenaeus. Cicero, in *Pro Flacco* chapter 17, called it a *fiscinam ficorum* <gloss>basket of figs</gloss>; Plutarch, in *On the Love of Wealth*, calls it an <term>arrichēn ichthyōn</term> <gloss>fish-basket</gloss>. Xiphilinus, from Dio, calls it an <term>arrichon</term> (for it is also spelled that way) <term>epōrean echousan</term> <gloss>having a handle</gloss>. Aristotle, in *Rhetoric* III, chapter 11, § 41, calls it a <term>talaron sykophantēn</term> <gloss>sycophant's basket</gloss>. We can prove, even by the testimony of Pollux himself, that not only vessels but almost every kind of provision was sold in the <term>Gynaikēiā agorā</term> <gloss>women's market</gloss>; he seems to take the <term>Kyklon</term> <gloss>Circle</gloss> and the <term>gynaikeian agoran</term> as the same thing. In the <term>Cyclos</term>, moreover, all things of this kind, except for meat, were on sale. The Scholiast of Aristophanes, on *Knights*, Act I, Scene 1, says: The <term>Cyclos</term> in Athens is like a meat market, taking its name from its construction; there indeed other wares are sold, apart from meat; especially fish. That he says this forum obtained the name "Circle" from its shape, since it was round, is true; for it is established that most ancient forums were of that shape. For that reason Homer, as the Ancients note, calls the forum a <term>hieron kyklon</term> <gloss>sacred circle</gloss> (*Iliad* Σ, verse 514), and Sophocles called it <term>kyklōenta topon agoras</term> <gloss>the circular place of the market</gloss> (in printed books today, <term>thronon</term> <gloss>throne/seat</gloss>). Euripides also writes, <term>ago
… [1990 more characters]
````

**Clean `translation.text`**

````text
...often profited them by catering for his king. In *Adelphi*, however, Act V, verse 7, he indicates that for Demea to do the catering himself, just as to bring in a prostitute, is the duty of a person of no consequence. Hence he had his name among Apollodorus, from whom Terence translated his *Phormio*, namely the parasite Phormio: for the poet attributes this name to the parasite in the prologue, alluding to phormida. Now, a phormis was like a small shopping bag, which they carried with them when they went to the market and the forum. Such is what the French call a *cabas*; whence we have phormis karyōn and phormis sykōn in Athenaeus. Cicero, in *Pro Flacco* chapter 17, called it a *fiscinam ficorum* basket of figs; Plutarch, in *On the Love of Wealth*, calls it an arrichēn ichthyōn. Xiphilinus, from Dio, calls it an arrichon (for it is also spelled that way) epōrean echousan. Aristotle, in *Rhetoric* III, chapter 11, § 41, calls it a talaron sykophantēn. We can prove, even by the testimony of Pollux himself, that not only vessels but almost every kind of provision was sold in the Gynaikēiā agorā; he seems to take the Kyklon and the gynaikeian agoran as the same thing. In the Cyclos, moreover, all things of this kind, except for meat, were on sale. The Scholiast of Aristophanes, on *Knights*, Act I, Scene 1, says: The Cyclos in Athens is like a meat market, taking its name from its construction; there indeed other wares are sold, apart from meat; especially fish. That he says this forum obtained the name "Circle" from its shape, since it was round, is true; for it is established that most ancient forums were of that shape. For that reason Homer, as the Ancients note, calls the forum a hieron kyklon (*Iliad* Σ, verse 514), and Sophocles called it kyklōenta topon agoras (in printed books today, thronon). Euripides also writes, agoras chrainōn kyklon. Thus, in Dio Chrysostom, you may read tēs Euboikēs agoras kyklon.

Hōs malakōs esthieis.] These are very similar to the words of the flatterers of Dionysius the tyrant, which Diogenes the Cynic reports in a letter to him. He says: "You, like children, have brought in I know not what 'little fathers' and nurses, who say to you, 'Take this, child. Pour in a little more if you love me. Just eat this much more.'" But it might not be displeasing if hestiās were written instead of esthieis, which we find annotated based on the conjecture of a certain learned man. The sense will be: "How gently you receive your guest
… [968 more characters]
````

**Annotations** (46)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | page | *page* | Is. Casaub. ad Theophr. Cap. 2. |
| 2 | term | mark | “phormida” |  |
| 3 | definition | commentary | “phormida” | basket |
| 4 | term | mark | “phormis” |  |
| 5 | definition | commentary | “phormis” | wicker basket |
| 6 | term | mark | “phormis karyōn” |  |
| 7 | definition | commentary | “phormis karyōn” | basket of nuts |
| 8 | term | mark | “phormis sykōn” |  |
| 9 | definition | commentary | “phormis sykōn” | basket of figs |
| 10 | gloss | mark | “basket of figs” |  |
| 11 | term | mark | “arrichēn ichthyōn” |  |
| 12 | definition | commentary | “arrichēn ichthyōn” | fish-basket |
| 13 | term | mark | “arrichon” |  |
| 14 | term | mark | “epōrean echousan” |  |
| 15 | definition | commentary | “epōrean echousan” | having a handle |
| 16 | term | mark | “talaron sykophantēn” |  |
| 17 | definition | commentary | “talaron sykophantēn” | sycophant's basket |
| 18 | term | mark | “Gynaikēiā agorā” |  |
| 19 | definition | commentary | “Gynaikēiā agorā” | women's market |
| 20 | term | mark | “Kyklon” |  |
| 21 | definition | commentary | “Kyklon” | Circle |
| 22 | term | mark | “gynaikeian agoran” |  |
| 23 | term | mark | “Cyclos” |  |
| 24 | term | mark | “Cyclos” |  |
| 25 | term | mark | “hieron kyklon” |  |
| 26 | definition | commentary | “hieron kyklon” | sacred circle |
| 27 | term | mark | “kyklōenta topon agoras” |  |
| 28 | definition | commentary | “kyklōenta topon agoras” | the circular place of the market |
| 29 | term | mark | “thronon” |  |
| 30 | definition | commentary | “thronon” | throne/seat |
| 31 | term | mark | “agoras chrainōn kyklon” |  |
| 32 | definition | commentary | “agoras chrainōn kyklon” | polluting the circle of the market |
| 33 | term | mark | “tēs Euboikēs agoras kyklon” |  |
| 34 | definition | commentary | “tēs Euboikēs agoras kyklon” | the circle of the Euboean market |
| 35 | term | mark | “Hōs malakōs esthieis” |  |
| 36 | definition | commentary | “Hōs malakōs esthieis” | How softly you eat |
| 37 | term | mark | “hestiās” |  |
| 38 | definition | commentary | “hestiās” | you entertain |
| 39 | term | mark | “esthieis” |  |
| 40 | definition | commentary | “esthieis” | you eat |

… 6 more

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 10. De Iure Singulorum Circa Res Hostiles Mobiles In Bello A Se Captas, Ex §. XVII. Institut.  — p. 35 (random (seed 5942))

https://sourcelibrary.org/book/de-iure-singulorum-circa-res-hostiles-mobiles-in-bello-a-se-nerger/page/6a43a05dc3ccb765a9842c65 · language Latin · prompt v13 · 1621 chars stored, 1587 in text · 2 annotations · scripts: Latin only

**Raw `translation.data`**

````text
But since by the Constitution of Antoninus all who were in the Roman world were made Roman citizens, it follows that all Christians TODAY are the Roman people. Those who do not acknowledge the seat of CHRIST in Asia, Africa, and other provinces have fallen from this right; for these are enemies of the Roman people and have lost the right of the Roman City. Hence it is that war is declared on us with the Turks and Saracens, and in turn, the Laws of Postliminy apply, and those captured in War become the property of the captors. But among Christians it is different, for since all are brothers by the Law of CHRIST, the arms that are moved between them are MORE THAN CIVIL, whence the Right of Postliminy does not exist among them.

<margin>And here to Tr. Vol. 1. Disput. 2. bk. 2. lit. f. there, either because there is no just war among them: which he repeats in Disput. 24. bk. XII. f.</margin>

In this, however, I cannot help but praise Alciatus for writing, now that the Roman Empire is extinct, <margin>(The Empire fights bitterly for the existence of the Roman Empire today. Jacob Gothofredus, in his treatise on the Dominion of the Sea, ch. VII, quibbles that it still exists today.)</margin> (concerning the provinces that were of the Roman Empire), that they have departed or arisen into their own kingdoms and dominions.

Since the divine oracles promised this Empire happiness that would last through the ages, and that as long as the Sun exists, it will endure: and let it be granted that the most powerful limbs were once torn away, for it is not circumscribed by a place, but wanders through the world
````

**Clean `translation.text`**

````text
But since by the Constitution of Antoninus all who were in the Roman world were made Roman citizens, it follows that all Christians TODAY are the Roman people. Those who do not acknowledge the seat of CHRIST in Asia, Africa, and other provinces have fallen from this right; for these are enemies of the Roman people and have lost the right of the Roman City. Hence it is that war is declared on us with the Turks and Saracens, and in turn, the Laws of Postliminy apply, and those captured in War become the property of the captors. But among Christians it is different, for since all are brothers by the Law of CHRIST, the arms that are moved between them are MORE THAN CIVIL, whence the Right of Postliminy does not exist among them.

And here to Tr. Vol. 1. Disput. 2. bk. 2. lit. f. there, either because there is no just war among them: which he repeats in Disput. 24. bk. XII. f.

In this, however, I cannot help but praise Alciatus for writing, now that the Roman Empire is extinct, (The Empire fights bitterly for the existence of the Roman Empire today. Jacob Gothofredus, in his treatise on the Dominion of the Sea, ch. VII, quibbles that it still exists today.) (concerning the provinces that were of the Roman Empire), that they have departed or arisen into their own kingdoms and dominions.

Since the divine oracles promised this Empire happiness that would last through the ages, and that as long as the Sun exists, it will endure: and let it be granted that the most powerful limbs were once torn away, for it is not circumscribed by a place, but wanders through the world
````

**Annotations** (2)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | margin | mark | “And here to Tr. Vol. 1. Disput. 2. bk. 2. lit. f. there, either because there is” |  |
| 2 | margin | mark | “(The Empire fights bitterly for the existence of the Roman Empire today. Jacob G” |  |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 11. Genji Monogatari: Miotsukushi (源氏物語 澪標) — p. 7 (random (seed 5942))

https://sourcelibrary.org/book/genji-monogatari-miotsukushi/page/69dfede98d34461cbe7f4ed6 · language Japanese · prompt v10 · 718 chars stored, 718 in text · 0 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<column-break/>
In the distance, the people who gathered speak of the path taken by Genji. They look on with envy toward the gardens of the Imperial Palace, where the light seems to bathe the very air. They speak of the path that opens before him, though it is a road that remains hidden and difficult to tread. The Prince, who pulls at the strings of fate, moves forward, while those who wait behind are left with only the falling leaves. As the people of the Second Ward speak of these events, they pause, caught by the weight of their own memories. The letter from the mountains is dropped, and the moon sets over the veranda of the Second Ward. In every corner of the world, the story scatters like dust on a path.
````

**Clean `translation.text`**

````text
<column-break/>
In the distance, the people who gathered speak of the path taken by Genji. They look on with envy toward the gardens of the Imperial Palace, where the light seems to bathe the very air. They speak of the path that opens before him, though it is a road that remains hidden and difficult to tread. The Prince, who pulls at the strings of fate, moves forward, while those who wait behind are left with only the falling leaves. As the people of the Second Ward speak of these events, they pause, caught by the weight of their own memories. The letter from the mountains is dropped, and the moon sets over the veranda of the Second Ward. In every corner of the world, the story scatters like dust on a path.
````

**Annotations:** none

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 12. Who are the Rosicrucians? — p. 1 (random (seed 5942))

https://sourcelibrary.org/book/who-are-the-rosicrucians-hamilton-jones/page/69d36bfbbd7c5e689c08af62 · language English · prompt v10 · 856 chars stored, 270 in text · 5 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>This is the title page of a pamphlet concerning the Rosicrucian Order, specifically the S.R.I.A. (Societas Rosicruciana in Anglia). It introduces Colonel F. M. Rickard and the author, J. W. Hamilton-Jones.</meta>

# S.R.I.A. <note>Societas Rosicruciana in Anglia; the Rosicrucian Society in England</note>

### Colonel F. M. RICKARD
->Most Worthy Supreme Magus, IX°<-

# Who are the Rosicrucians?

->by<-

### Brother <note>original: "Frater"</note> J. W. Hamilton-Jones, II°

<image-desc size="small" type="symbol" significance="low">A small horizontal divider featuring a six-pointed star (hexagram) in the center of a line.</image-desc>

*Read at the Metropolitan Study Group, S.R.I.A. on April 9th, 1953, and reprinted by the kind permission of the Author.*

<vocab>S.R.I.A., Rosicrucians, Supreme Magus, Brother, Metropolitan Study Group</vocab>
````

**Clean `translation.text`**

````text
# S.R.I.A.

### Colonel F. M. RICKARD
->Most Worthy Supreme Magus, IX°<-

# Who are the Rosicrucians?

->by<-

### Brother J. W. Hamilton-Jones, II°

*Read at the Metropolitan Study Group, S.R.I.A. on April 9th, 1953, and reprinted by the kind permission of the Author.*
````

**Annotations** (5)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This is the title page of a pamphlet concerning the Rosicrucian Order, specifically the S.R.I.A. (Societas Rosicruciana in Anglia). It intro |
| 2 | note | commentary | “S.R.I.A” | Societas Rosicruciana in Anglia; the Rosicrucian Society in England |
| 3 | original | commentary | “Brother” | original: "Frater" |
| 4 | image | commentary | “” | A small horizontal divider featuring a six-pointed star (hexagram) in the center of a line. |
| 5 | vocab | page | *page* | S.R.I.A., Rosicrucians, Supreme Magus, Brother, Metropolitan Study Group |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 13. Marsilii Ficini Florentini medici atq[ue] philosophi celeberrimi, de vita libri tres, rece — p. 305 (random (seed 5942))

https://sourcelibrary.org/book/three-books-on-life-ficino/page/699259218812793469fe2b75 · language Latin · prompt v2 · 2329 chars stored, 1472 in text · 6 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>This page continues the discussion on the nature of pestilential infection, specifically addressing the speed of transmission and the power of the causal agent.</meta>

# THE ANTIDOTE

On the contrary: Whatever cause is most powerful will act even upon matter that is not predisposed to it. Although sulfur receives the action of fire more quickly than wood—and dry wood, cut into small pieces, more easily than other types of wood—nevertheless, a burning furnace immediately seizes even large and green logs into a flame, because the supreme power of the active agent quickly prepares and shapes them. And many times, a pestilential vapor of this kind becomes most powerful by the force of its own causes, and you cannot know exactly when this happens. Even if such a predisposition is not present at one time, it may yet be present in another.

->In what manner, and which temperaments, the plague<-
->strikes most swiftly through contagion.<-

### CHAPTER III.

This poisonous vapor <note>original: "Venenosus iste uapor"</note> is often so subtle that it cannot be discerned by sight. Sometimes it is dissipated, but it is easily regenerated from that point as long as the predisposing celestial influence <note>original: "influentia"; referring to the astrological belief that planetary alignments "flowed" into the body to cause disease</note> remains. And now, even if it were tiny at the beginning, it nevertheless expands from place to place with a much faster course than sulfur when it is ignited. It is far more opposed to the vital spirit <note>a refined vapor produced from the blood in the heart, believed in Galenic medicine to sustain life and heat</note> of the heart than sulfur is to the nose. A vapor of this kind is ignited by the infected air only in bodies predisposed to it; but after it has been ignited in those bodies, it spreads everywhere with wonderful speed and ease, just like ignited sulfur, even more than before.

<summary>This page explains that while some people are more naturally susceptible to plague, a powerful enough "poisonous vapor" can infect anyone regardless of their constitution, comparing the spread of disease to the rapid ignition of sulfur.</summary>
<keywords>plague, contagion, vital spirit, poisonous vapor, predisposition, medical theory, sulfur analogy</keywords>
````

**Clean `translation.text`**

````text
# THE ANTIDOTE

On the contrary: Whatever cause is most powerful will act even upon matter that is not predisposed to it. Although sulfur receives the action of fire more quickly than wood—and dry wood, cut into small pieces, more easily than other types of wood—nevertheless, a burning furnace immediately seizes even large and green logs into a flame, because the supreme power of the active agent quickly prepares and shapes them. And many times, a pestilential vapor of this kind becomes most powerful by the force of its own causes, and you cannot know exactly when this happens. Even if such a predisposition is not present at one time, it may yet be present in another.

->In what manner, and which temperaments, the plague<-
->strikes most swiftly through contagion.<-

### CHAPTER III.

This poisonous vapor is often so subtle that it cannot be discerned by sight. Sometimes it is dissipated, but it is easily regenerated from that point as long as the predisposing celestial influence remains. And now, even if it were tiny at the beginning, it nevertheless expands from place to place with a much faster course than sulfur when it is ignited. It is far more opposed to the vital spirit of the heart than sulfur is to the nose. A vapor of this kind is ignited by the infected air only in bodies predisposed to it; but after it has been ignited in those bodies, it spreads everywhere with wonderful speed and ease, just like ignited sulfur, even more than before.
````

**Annotations** (6)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the discussion on the nature of pestilential infection, specifically addressing the speed of transmission and the power  |
| 2 | original | commentary | “This poisonous vapor” | original: "Venenosus iste uapor" |
| 3 | original | commentary | “predisposing celestial influence” | original: "influentia"; referring to the astrological belief that planetary alignments "flowed" into the body to cause disease |
| 4 | note | commentary | “the vital spirit” | a refined vapor produced from the blood in the heart, believed in Galenic medicine to sustain life and heat |
| 5 | summary | page | *page* | This page explains that while some people are more naturally susceptible to plague, a powerful enough "poisonous vapor" can infect anyone re |
| 6 | keywords | page | *page* | plague, contagion, vital spirit, poisonous vapor, predisposition, medical theory, sulfur analogy |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 14. Dogme et rituel de la haute magie — p. 51 (random (seed 5942))

https://sourcelibrary.org/book/dogme-et-rituel-de-la-haute-magie-levi/page/6a21981d5ce215cb9ac7120c · language French · prompt v11 · 1144 chars stored, 1144 in text · 0 annotations · scripts: Latin only

**Raw `translation.data`**

````text
# PRELIMINARY DISCOURSE.

most advanced of the tendencies of human intelligence at the time in which we live, these doctrines, sensed for several years by a small number of elite minds, can be issued today with the hope of seeing them welcomed; but, barely a few months ago, they would have found neither a sympathetic attention, nor a platform, nor an echo anywhere.

This is because, at that time, the extreme parties had not yet been compelled to abdicate their pretensions before the omnipotence of providential events, and one could with difficulty remain neutral in the midst of their fierce war; any concession from one to the other was then considered a true betrayal, and men who never abandon justice, being compelled to seek it separately and successively in the two separate causes, became suspects to everyone, like renegades or deserters. To have convictions energetic enough to prefer one's conscientious independence to the encouragements of cliques was to condemn oneself to a solitude that was not without apprehensions and anguishes. To remain isolated between two armies that attack each other, is one not exposed to all the
````

**Clean `translation.text`**

````text
# PRELIMINARY DISCOURSE.

most advanced of the tendencies of human intelligence at the time in which we live, these doctrines, sensed for several years by a small number of elite minds, can be issued today with the hope of seeing them welcomed; but, barely a few months ago, they would have found neither a sympathetic attention, nor a platform, nor an echo anywhere.

This is because, at that time, the extreme parties had not yet been compelled to abdicate their pretensions before the omnipotence of providential events, and one could with difficulty remain neutral in the midst of their fierce war; any concession from one to the other was then considered a true betrayal, and men who never abandon justice, being compelled to seek it separately and successively in the two separate causes, became suspects to everyone, like renegades or deserters. To have convictions energetic enough to prefer one's conscientious independence to the encouragements of cliques was to condemn oneself to a solitude that was not without apprehensions and anguishes. To remain isolated between two armies that attack each other, is one not exposed to all the
````

**Annotations:** none

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 15. 御定佩文韻府·卷七十七之四 (vol 591) — p. 62 (random (seed 5942))

https://sourcelibrary.org/book/vol-591/page/6a3c649f39b4508b04e2898f · language Chinese · prompt v13 · 4860 chars stored, 3437 in text · 37 annotations · scripts: Han

**Raw `translation.data`**

````text
<header>Imperial Sanctioned Complete Library of the Four Treasuries</header>
<header>Volume 77, Part 4</header>

<note>original: "欽定四庫全書" referring to the Qianlong Emperor's massive collection of Chinese literature.</note>

One thousand five hundred. Haladai and Wang Shiqiang jointly led them to attack the Song dynasty. Also, in the *Book of Northern Qi*, in the Biography of Gao Qian: When Erzhu Zhao entered Luoyang, he sent his army supervisor Sun <unclear>blank</unclear> with over one hundred cavalry to Ji Province. He falsely claimed to be requisitioning horses from the people, but his true intention was to wait for Gao Qian and his brothers to deliver the horses so he could arrest them. Gao Qian already had intentions of retaliation, and when Sun <unclear>blank</unclear> arrived, Gao knew he was being plotted against. Thus, he acted first and devised a plan, secretly leading brave warriors to seize the provincial capital. They killed Sun <unclear>blank</unclear> and captured the regional governor.

### Red Sparrow-Hawk <note>original: "赤鷂" (Chi Yao)</note>

In the *Forest of Changes* <note>original: "Yi Lin", a Han dynasty work on divination</note> it says:
Two <term>red sparrow-hawks</term> <gloss>a type of bird of prey</gloss> followed five falcons. They chirped and held arrows in their beaks. Without the lash of a whip, you were released from your duty; do not shoot.

### Fierce Sparrow-Hawk <note>original: "鷙鷂" (Zhi Yao)</note>

In the *Forest of Changes*: Amidst the hard ice, the yellow bird cries in sorrow. Gripped by many fears and worries, the <term>fierce sparrow-hawk</term> <gloss>a predatory hawk</gloss> soars, becoming a source of grief for me.

### Sea Sparrow-Hawk <note>original: "海鷂" (Hai Yao)</note>

In the *Records of the Chamber of Prophecies* <note>original: "Xuan Shi Zhi"</note>: When Xue Song governed Wei, there was a man from Ye Prefecture who enjoyed raising hawks and falcons. Someone brought a hawk to the market to sell; the hawk was exceptionally spirited and handsome. A person from the Eastern Barbarian tribes saw it and said, "This is a <term>sea sparrow-hawk</term>. It is skilled at warding off the disasters caused by <term>jiaochi</term> <gloss>flood dragons or water monsters</gloss>." Previously, a dragon in the southern marsh of Ye City had frequently caused trouble. The person from Ye then took the hawk there. The <term>sea sparrow-hawk</term> suddenly dived into the marsh water. After a while, it emerged having caught a
… [2360 more characters]
````

**Clean `translation.text`**

````text
One thousand five hundred. Haladai and Wang Shiqiang jointly led them to attack the Song dynasty. Also, in the *Book of Northern Qi*, in the Biography of Gao Qian: When Erzhu Zhao entered Luoyang, he sent his army supervisor Sun blank with over one hundred cavalry to Ji Province. He falsely claimed to be requisitioning horses from the people, but his true intention was to wait for Gao Qian and his brothers to deliver the horses so he could arrest them. Gao Qian already had intentions of retaliation, and when Sun blank arrived, Gao knew he was being plotted against. Thus, he acted first and devised a plan, secretly leading brave warriors to seize the provincial capital. They killed Sun blank and captured the regional governor.

### Red Sparrow-Hawk

In the *Forest of Changes* it says:
Two red sparrow-hawks followed five falcons. They chirped and held arrows in their beaks. Without the lash of a whip, you were released from your duty; do not shoot.

### Fierce Sparrow-Hawk

In the *Forest of Changes*: Amidst the hard ice, the yellow bird cries in sorrow. Gripped by many fears and worries, the fierce sparrow-hawk soars, becoming a source of grief for me.

### Sea Sparrow-Hawk

In the *Records of the Chamber of Prophecies*: When Xue Song governed Wei, there was a man from Ye Prefecture who enjoyed raising hawks and falcons. Someone brought a hawk to the market to sell; the hawk was exceptionally spirited and handsome. A person from the Eastern Barbarian tribes saw it and said, "This is a sea sparrow-hawk. It is skilled at warding off the disasters caused by jiaochi." Previously, a dragon in the southern marsh of Ye City had frequently caused trouble. The person from Ye then took the hawk there. The sea sparrow-hawk suddenly dived into the marsh water. After a while, it emerged having caught a small dragon, which it ate almost entirely. Because of this, the people of Ye were freed from the disaster. Xue Song ordered the man from Ye to be questioned about the matter, and the man subsequently presented the sea sparrow-hawk as a gift. Also, in the *Compendium of Materia Medica*: The sea sparrow-hawk fish is also called the Shaoyang fish. Its name comes from the sea sparrow-hawk because its shape resembles it.

### Rival Sparrow-Hawk

In Su Ting's *Preface to the Eulogy of the Pair of White Hawks*: Observing how they act according to the seasons and follow the autumnal spirit of killing, their maneuvers are swift. Looking around at other powerful birds, they deserv
… [937 more characters]
````

**Annotations** (37)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | page | *page* | Imperial Sanctioned Complete Library of the Four Treasuries |
| 2 | pagedata | page | *page* | Volume 77, Part 4 |
| 3 | original | commentary | “” | original: "欽定四庫全書" referring to the Qianlong Emperor's massive collection of Chinese literature. |
| 4 | unclear | mark | “blank” |  |
| 5 | unclear | mark | “blank” |  |
| 6 | unclear | mark | “blank” |  |
| 7 | original | commentary | “Red Sparrow-Hawk” | original: "赤鷂" (Chi Yao) |
| 8 | original | commentary | “In the *Forest of Changes” | original: "Yi Lin", a Han dynasty work on divination |
| 9 | term | mark | “red sparrow-hawks” |  |
| 10 | definition | commentary | “red sparrow-hawks” | a type of bird of prey |
| 11 | original | commentary | “Fierce Sparrow-Hawk” | original: "鷙鷂" (Zhi Yao) |
| 12 | term | mark | “fierce sparrow-hawk” |  |
| 13 | definition | commentary | “fierce sparrow-hawk” | a predatory hawk |
| 14 | original | commentary | “Sea Sparrow-Hawk” | original: "海鷂" (Hai Yao) |
| 15 | original | commentary | “Chamber of Prophecies” | original: "Xuan Shi Zhi" |
| 16 | term | mark | “sea sparrow-hawk” |  |
| 17 | term | mark | “jiaochi” |  |
| 18 | definition | commentary | “jiaochi” | flood dragons or water monsters |
| 19 | term | mark | “sea sparrow-hawk” |  |
| 20 | term | mark | “sea sparrow-hawk” |  |
| 21 | term | mark | “sea sparrow-hawk fish” |  |
| 22 | definition | commentary | “sea sparrow-hawk fish” | likely a stingray or manta ray |
| 23 | term | mark | “sea sparrow-hawk” |  |
| 24 | original | commentary | “Rival Sparrow-Hawk” | original: "仇鷂" (Chou Yao) |
| 25 | term | mark | “rival sparrow-hawk” |  |
| 26 | original | commentary | “Wild Sparrow-Hawk” | original: "野鷂" (Ye Yao) |
| 27 | term | mark | “wild sparrow-hawk” |  |
| 28 | original | commentary | “Yellow Sparrow-Hawk” | original: "黃鷂" (Huang Yao) |
| 29 | term | mark | “yellow sparrow-hawk” |  |
| 30 | term | mark | “yellow sparrow-hawk” |  |
| 31 | term | mark | “zouyu” |  |
| 32 | definition | commentary | “zouyu” | a mythical righteous beast |
| 33 | original | commentary | “Brushing Sparrow-Hawk” | original: "拂鷂" (Fu Yao) |
| 34 | term | mark | “brushing sparrow-hawk” |  |
| 35 | original | commentary | “Sparrow-Hawk” | original: "雀鷂" (Que Yao) |
| 36 | summary | page | *page* | This page lists various literary and historical references to different species of sparrow-hawks, including their roles in divination, local |
| 37 | keywords | page | *page* | sparrow-hawk, Northern Qi, Forest of Changes, Sea Sparrow-Hawk, dragons, Chinese poetry, Han Yu, Yuan Zhen, falconry |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 16. བསྟན་འགྱུར། སྡེ་དགེ། རྒྱུད་འགྲེལ། ཁི (Derge Tengyur, vol. 33) — p. 105 (random (seed 5942))

https://sourcelibrary.org/book/derge-tengyur-vol-33/page/6abe932d6a920ffd924d741b · language Tibetan · prompt v13 · 2600 chars stored, 2252 in text · 6 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>continues from previous page: through the generation stage, the Great Vajra-Holder</meta>
Having taught the generation of the body of the <note>Great Vajra-Holder</note>, it will now be taught by means of the completion stage. Through phrases such as "The Subsequent Tantra of the Secret Assembly" <note>original: Guhyasamaja-uttaratantra</note> and so forth, the distinction between the two stages is shown. The phrase "by the distinction of the common and the supreme" refers to two types of service <note>term: sevā; spiritual practice to approach a deity</note>: common service and supreme service. 

Regarding these, common service consists of the four vajras previously explained. Supreme service is characterized by the six branches <note>the six-fold yoga of the completion stage</note>, because by relying on the six branches, one perfectly becomes the Great Vajra-Holder. The phrase "desiring liberation through service" means that because one desires the liberation characterized by the perfection of the Great Vajra-Holder, one trains in it; hence it is called "service." 

The "completely pure deity's body" refers to the body of the Great Vajra-Holder, which is the wisdom body or the vajra body. Wisdom is the completion stage. That itself is the nectar; one should take it as nourishment <note>term: rasāyana; alchemy or rejuvenation</note> and make it the cause of the yoga of the six branches. "The nature of all aspects" refers to the body, speech, and mind. "At all times" refers to all sessions, as well as day and night. "In all postures" refers to the four: rising, sitting, lying down, and walking. As it is said:

->Whether naked or not naked,<-
->In whatever way and wherever one is,<-
->Having visualized one's own superior deity,<-
->One should meditate on that reality alone.<-

This is shown by phrases such as "this is," stating that one should perform service through those very six yogas. "Snake" and so forth refers to terms like "snake," "headless," "endless," "summarized," and so forth; these names are shown. "The reality of the deity" refers to the deities who are the objects expressed by the mantra; that is the meaning. Therefore, it is called the "yoga of six branches." Because its nature is the reality of the mantra and the deity, one should perform service by the sequence of the yoga of the six branches; this means one should meditate on the supreme service. Through "its" and so forth, the Subsequent Tantra is shown to be an authoritative sour
… [100 more characters]
````

**Clean `translation.text`**

````text
Having taught the generation of the body of the, it will now be taught by means of the completion stage. Through phrases such as "The Subsequent Tantra of the Secret Assembly" and so forth, the distinction between the two stages is shown. The phrase "by the distinction of the common and the supreme" refers to two types of service: common service and supreme service. 

Regarding these, common service consists of the four vajras previously explained. Supreme service is characterized by the six branches, because by relying on the six branches, one perfectly becomes the Great Vajra-Holder. The phrase "desiring liberation through service" means that because one desires the liberation characterized by the perfection of the Great Vajra-Holder, one trains in it; hence it is called "service." 

The "completely pure deity's body" refers to the body of the Great Vajra-Holder, which is the wisdom body or the vajra body. Wisdom is the completion stage. That itself is the nectar; one should take it as nourishment and make it the cause of the yoga of the six branches. "The nature of all aspects" refers to the body, speech, and mind. "At all times" refers to all sessions, as well as day and night. "In all postures" refers to the four: rising, sitting, lying down, and walking. As it is said:

->Whether naked or not naked,<-
->In whatever way and wherever one is,<-
->Having visualized one's own superior deity,<-
->One should meditate on that reality alone.<-

This is shown by phrases such as "this is," stating that one should perform service through those very six yogas. "Snake" and so forth refers to terms like "snake," "headless," "endless," "summarized," and so forth; these names are shown. "The reality of the deity" refers to the deities who are the objects expressed by the mantra; that is the meaning. Therefore, it is called the "yoga of six branches." Because its nature is the reality of the mantra and the deity, one should perform service by the sequence of the yoga of the six branches; this means one should meditate on the supreme service. Through "its" and so forth, the Subsequent Tantra is shown to be an authoritative source. The six branches are as previously explained. Service is the meditation on the completion stage.
````

**Annotations** (6)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | continues from previous page: through the generation stage, the Great Vajra-Holder |
| 2 | note | commentary | “of the body of the” | Great Vajra-Holder |
| 3 | original | commentary | “the Secret Assembly” | original: Guhyasamaja-uttaratantra |
| 4 | note | commentary | “types of service” | term: sevā; spiritual practice to approach a deity |
| 5 | note | commentary | “by the six branches” | the six-fold yoga of the completion stage |
| 6 | note | commentary | “it as nourishment” | term: rasāyana; alchemy or rejuvenation |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 17. De Natura Rerum, IX Bücher. Ph. Theophrasti von Hohenheim, genant Paracelsi — p. 25 (random (seed 5942))

https://sourcelibrary.org/book/de-natura-rerum-ix-bucher-ph-theophrasti-von-hohenheim-paracelsus/page/6a26bd615189f4e1b4475991 · language German · prompt v11 · 1307 chars stored, 703 in text · 13 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>continues from previous page</meta>

know what is prepared in a good way, how they are transformed, what the separator in the human stomach is, with which outer fire the <term>Calor Ventriculi</term> <gloss>heat of the stomach</gloss> and the heat of all limbs should be compared, and finally what signs are present by which all completed things may be recognized, not only in natural growths, medicines, etc. But I speak of the signs concerning the human body: whether the limbs have completed all their natural functions, whether that which has died, that is, has become food, has been <term>Resuscititert</term> <gloss>resuscitated</gloss>, <term>Transmutiert</term> <gloss>transmuted</gloss>, and properly separated, whether every <term>membrum</term> <gloss>organ/limb</gloss> has received its <term>nutrimentum</term> <gloss>nourishment</gloss>, or whether it has brought a foreign guest with it, etc.

->For this purpose such books serve.<-

<summary>This page explains that the nine books serve as a guide for understanding the transformation of food into nourishment within the human body and the signs that reveal whether the organs have properly processed these substances.</summary>
<keywords>human digestion, transmutation, stomach heat, signs of health, nourishment, separator</keywords>
````

**Clean `translation.text`**

````text
know what is prepared in a good way, how they are transformed, what the separator in the human stomach is, with which outer fire the Calor Ventriculi and the heat of all limbs should be compared, and finally what signs are present by which all completed things may be recognized, not only in natural growths, medicines, etc. But I speak of the signs concerning the human body: whether the limbs have completed all their natural functions, whether that which has died, that is, has become food, has been Resuscititert, Transmutiert, and properly separated, whether every membrum has received its nutrimentum, or whether it has brought a foreign guest with it, etc.

->For this purpose such books serve.<-
````

**Annotations** (13)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | continues from previous page |
| 2 | term | mark | “Calor Ventriculi” |  |
| 3 | definition | commentary | “Calor Ventriculi” | heat of the stomach |
| 4 | term | mark | “Resuscititert” |  |
| 5 | definition | commentary | “Resuscititert” | resuscitated |
| 6 | term | mark | “Transmutiert” |  |
| 7 | definition | commentary | “Transmutiert” | transmuted |
| 8 | term | mark | “membrum” |  |
| 9 | definition | commentary | “membrum” | organ/limb |
| 10 | term | mark | “nutrimentum” |  |
| 11 | definition | commentary | “nutrimentum” | nourishment |
| 12 | summary | page | *page* | This page explains that the nine books serve as a guide for understanding the transformation of food into nourishment within the human body  |
| 13 | keywords | page | *page* | human digestion, transmutation, stomach heat, signs of health, nourishment, separator |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 18. 新編纂圖增類羣書類要事林廣記 — p. 61 (random (seed 5942))

https://sourcelibrary.org/book/forest-of-affairs-shilin-guangji/page/6992ce273ea667fbac82853a · language Chinese · prompt v2 · 4705 chars stored, 2711 in text · 16 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>The transcription transitions from the previous discussion of the Earth God festivals into the specific rituals of the lunar calendar. Note that while the heading indicates the First Month, the astronomical positions in the gloss—the Big Dipper pointing to the Dragon (Chen) and the sun's position in the Bond (Lou) constellation—traditionally align with the third lunar month. This may reflect a regional variation or a historical shift in the calendar used by the original author. The focus of this page is the Cold Food Festival, a precursor to the Tomb Sweeping Festival (Qingming).</meta>

# The First Month
<gloss>The Auspicious Month, the New Moon. The handle of the Big Dipper points to the Chen [Dragon] direction; the Sun is in the Lou [Bond] constellation.</gloss>

On the fifteenth day of the month, the legal statutes mandate that local governing officials, in order to exert a transformative moral influence, shall go out to the suburbs at sunrise to encourage the people in their farming duties.

---

The Cold Food Festival <note>original: "Hanshi Jie," a festival where lighting fires was forbidden</note> has no fixed date; it occurs sometimes in the third month and sometimes in the second month. The *Record of the Seasons of the Jing and Chu Regions* <note>original: "Jingchu Suishi Ji," a 6th-century text on southern customs</note> states that one hundred and five days after the Winter Solstice, there will be strong winds and heavy rains; this is called the Cold Food Festival. It is also known as the "One Hundred and Five Festival." The people of Qin <note>referring to the region of Shaanxi</note> call Cold Food "Cooked Food Day," meaning that no fires are lit and people prepare cooked food in advance to last through the festival. The people of Qi <note>referring to the region of Shandong</note> call it the "Singing Smoke Festival" or the "Forbidden Smoke Festival." 

The *New Preface* <note>original: "Xin Xu," an anecdotal collection from the 1st century BCE</note> says: When Duke Wen of the Jin state returned to his kingdom, his loyal follower Jie Zitui left with his mother to live in seclusion on Mount Mian. The Duke sought him but could not find him; he then set fire to the mountain to force him out. Jie Zitui was burned to death. Consequently, the Duke forbade the lighting of fires to honor him. However, upon consulting the *Commentary of Zuo* <note>original: "Zuo Zhuan," one of the earliest Chinese historical works</note> and the *Records of t
… [2205 more characters]
````

**Clean `translation.text`**

````text
# The First Month
The Auspicious Month, the New Moon. The handle of the Big Dipper points to the Chen [Dragon] direction; the Sun is in the Lou [Bond] constellation.

On the fifteenth day of the month, the legal statutes mandate that local governing officials, in order to exert a transformative moral influence, shall go out to the suburbs at sunrise to encourage the people in their farming duties.

---

The Cold Food Festival has no fixed date; it occurs sometimes in the third month and sometimes in the second month. The *Record of the Seasons of the Jing and Chu Regions* states that one hundred and five days after the Winter Solstice, there will be strong winds and heavy rains; this is called the Cold Food Festival. It is also known as the "One Hundred and Five Festival." The people of Qin call Cold Food "Cooked Food Day," meaning that no fires are lit and people prepare cooked food in advance to last through the festival. The people of Qi call it the "Singing Smoke Festival" or the "Forbidden Smoke Festival." 

The *New Preface* says: When Duke Wen of the Jin state returned to his kingdom, his loyal follower Jie Zitui left with his mother to live in seclusion on Mount Mian. The Duke sought him but could not find him; he then set fire to the mountain to force him out. Jie Zitui was burned to death. Consequently, the Duke forbade the lighting of fires to honor him. However, upon consulting the *Commentary of Zuo* and the *Records of the Grand Historian*, neither contains any mention of Jie Zitui being burned by fire. 

According to the *Rites of Zhou*, the Master of Fire Rituals used a wooden-clapper bell in mid-spring to announce a prohibition on fire throughout the capital. The commentary explains this was because "fire was about to be brought out" in late spring. Thus, the prohibition of fire was an ancient system of the Zhou Dynasty and not originally created for Jie Zitui. 

*The Eastern Capital: A Record of the Dream of Splendor* says: Usually, in the capital, the 105th day after the Winter Solstice is observed as the Great Cold Food. The day before is called "Cooking to Ripeness." People use flour and dates to make "Flying Swallows," which they thread onto willow branches and stick above their doorframes; these are called "Jie Zitui Swallows." An edict from Emperor Minghuang of the Tang Dynasty stated: "The practice of visiting ancestral graves during Cold Food is not found in the classic texts of ritual, but as modern generations have followed this
… [211 more characters]
````

**Annotations** (16)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | The transcription transitions from the previous discussion of the Earth God festivals into the specific rituals of the lunar calendar. Note  |
| 2 | gloss | mark | “The Auspicious Month, the New Moon. The handle of the Big Dipper points to the C” |  |
| 3 | original | commentary | “The Cold Food Festival” | original: "Hanshi Jie," a festival where lighting fires was forbidden |
| 4 | original | commentary | “and Chu Regions” | original: "Jingchu Suishi Ji," a 6th-century text on southern customs |
| 5 | note | commentary | “people of Qin” | referring to the region of Shaanxi |
| 6 | note | commentary | “festival. The people of Qi” | referring to the region of Shandong |
| 7 | original | commentary | “The *New Preface” | original: "Xin Xu," an anecdotal collection from the 1st century BCE |
| 8 | original | commentary | “*Commentary of Zuo” | original: "Zuo Zhuan," one of the earliest Chinese historical works |
| 9 | original | commentary | “the Grand Historian” | original: "Shi Ji," the definitive history of early China |
| 10 | original | commentary | “of Fire Rituals” | original: "Si Xuan Shi," an official responsible for managing seasonal fires |
| 11 | note | commentary | “be brought out” | this refers to the ritual of "renewing the fire," where old winter fires were extinguished and new spring fires were kindled |
| 12 | original | commentary | “Dream of Splendor” | original: "Dongjing Meng Hua Lu," a memoir of the Northern Song capital Kaifeng |
| 13 | original | commentary | “*Record of Sundries” | original: "Suisui Lu" |
| 14 | note | commentary | “people of Shu” | modern-day Sichuan |
| 15 | summary | page | *page* | This page discusses the origins and customs of the Cold Food Festival, debating whether its fire prohibition stems from the legend of Jie Zi |
| 16 | keywords | page | *page* | Cold Food Festival, Jie Zitui, agricultural rituals, fire prohibition, Tang Emperor Minghuang, Rites of Zhou, local officials |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 19. A key to physic, and the occult sciences — p. 107 (random (seed 5942))

https://sourcelibrary.org/book/a-key-to-physic-and-the-occult-sciences-sibly/page/6980eeb6a4813df78d8bcd46 · language English · prompt v2 · 4126 chars stored, 3016 in text · 12 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>This page continues the detailed description of microscopic life forms, specifically the "Proteus" animalcule and the "Wheel-animal" (now known as a rotifer).</meta>

->AND OCCULT SCIENCE.<-

...represented at No. 7, the motions of which draw a current of water toward it from a considerable distance. After repeatedly pulling in and thrusting out this short head—sometimes with and sometimes without using its internal "wheel-work"—the creature will remain motionless for a while as if weary. Then its head and long neck will be very slowly stretched out <note>original: "protruded"</note>, as shown in No. 8, and it soon resumes its former agility. Sometimes it positions its neck and head as represented in the plate at No. 9.

4. ***The Wheel-animal, or Vorticella.*** <note>original: "Vorticella" is Latin for "little whirlpool." This organism is now known to modern science as a rotifer.</note> This wonderful microscopic organism <note>original: "animalcule"</note> is found in rainwater that has stood for some days in lead gutters, or in hollows of lead on the tops of houses, or in the slime or sediment left by such water; it may perhaps also be found in other places. However, if the water standing in lead gutters, or the sediment left behind, has any reddish color in it, one may be almost certain of finding them there. Although it shows no signs of life except when in water, it is capable of remaining alive for many months after it is taken out of the water and kept in a state as dry as dust. 

In this dry state, it is globular in shape and no larger than a grain of sand, showing no signs of life. But when put into water, within half an hour a slow <note>original: "languid"</note> motion begins; the globule turns itself about, lengthens itself by slow degrees, and takes on the form of a lively maggot <note>The author uses "maggot" to describe the larva-like, elongated body of the rotifer.</note>. Most commonly, a few minutes later, it puts out its "wheels" and swims vigorously through the water as if in search of food; otherwise, fixing itself by the tail, it works the wheels in such a manner as to draw food toward itself. Numbers 10, 11, 12, and 13 show the different appearances of its wheels, and Numbers 14 and 15 show its globular form. 

The most remarkable part of this organism is its wheel-work. This consists of a couple of semicircular instruments around the edges of which many little fibers <note>original: "fibrillæ"; these are cilia, hair-like str
… [1626 more characters]
````

**Clean `translation.text`**

````text
->AND OCCULT SCIENCE.<-

...represented at No. 7, the motions of which draw a current of water toward it from a considerable distance. After repeatedly pulling in and thrusting out this short head—sometimes with and sometimes without using its internal "wheel-work"—the creature will remain motionless for a while as if weary. Then its head and long neck will be very slowly stretched out, as shown in No. 8, and it soon resumes its former agility. Sometimes it positions its neck and head as represented in the plate at No. 9.

4. ***The Wheel-animal, or Vorticella.*** This wonderful microscopic organism is found in rainwater that has stood for some days in lead gutters, or in hollows of lead on the tops of houses, or in the slime or sediment left by such water; it may perhaps also be found in other places. However, if the water standing in lead gutters, or the sediment left behind, has any reddish color in it, one may be almost certain of finding them there. Although it shows no signs of life except when in water, it is capable of remaining alive for many months after it is taken out of the water and kept in a state as dry as dust. 

In this dry state, it is globular in shape and no larger than a grain of sand, showing no signs of life. But when put into water, within half an hour a slow motion begins; the globule turns itself about, lengthens itself by slow degrees, and takes on the form of a lively maggot. Most commonly, a few minutes later, it puts out its "wheels" and swims vigorously through the water as if in search of food; otherwise, fixing itself by the tail, it works the wheels in such a manner as to draw food toward itself. Numbers 10, 11, 12, and 13 show the different appearances of its wheels, and Numbers 14 and 15 show its globular form. 

The most remarkable part of this organism is its wheel-work. This consists of a couple of semicircular instruments around the edges of which many little fibers move themselves very briskly, sometimes with a kind of rotation and sometimes in a trembling or vibrating manner. When in this state, it sometimes unfastens its tail and swims along with great swiftness, seemingly in pursuit of its prey. Sometimes the wheels seem to be entire circles armed with small teeth, like those of the balance-wheel of a watch, appearing projected forward beyond the head and extending sideways somewhat wider than its diameter. The teeth or cogs of these wheels seem to stand very regularly at equal distances, but their shape varies 
… [516 more characters]
````

**Annotations** (12)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the detailed description of microscopic life forms, specifically the "Proteus" animalcule and the "Wheel-animal" (now kn |
| 2 | original | commentary | “slowly stretched out” | original: "protruded" |
| 3 | original | commentary | “Wheel-animal, or Vorticella” | original: "Vorticella" is Latin for "little whirlpool." This organism is now known to modern science as a rotifer. |
| 4 | original | commentary | “wonderful microscopic organism” | original: "animalcule" |
| 5 | original | commentary | “hour a slow” | original: "languid" |
| 6 | note | commentary | “a lively maggot” | The author uses "maggot" to describe the larva-like, elongated body of the rotifer. |
| 7 | original | commentary | “many little fibers” | original: "fibrillæ"; these are cilia, hair-like structures used for swimming and feeding |
| 8 | original | commentary | “to imply intelligence” | original: "sagacity" |
| 9 | pagedata | page | *page* | S |
| 10 | meta | page | *page* | catchword: Besides |
| 11 | summary | page | *page* | This page describes the physical characteristics and behaviors of two microscopic organisms: the shape-shifting Proteus and the "Wheel-anima |
| 12 | keywords | page | *page* | microscopy, animalcule, Proteus, Wheel-animal, Vorticella, rotifer, anhydrobiosis, cilia, biological observation |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 20. Histoire de ma fuite des prisons de la République de Venise — p. 124 (random (seed 5942))

https://sourcelibrary.org/book/histoire-de-ma-fuite-des-prisons-de-la-republique-de-venise-/page/6a08a2c343d85a6ece189614 · language French · prompt v11 · 1170 chars stored, 1170 in text · 0 annotations · scripts: Latin only

**Raw `translation.data`**

````text
the circumspect P. B., secretary of the Council of Ten, had to say to me. Astonished by this order, which is always an ill omen, and very angry at having to obey it, I went at the prescribed hour into the presence of the minister, who, without saying a single word, ordered that I be deposited here. That is all.

Nothing was as innocent as this fault, but there are laws in the world that one can violate innocently, and the transgressors are nonetheless guilty. I complimented him on the fact that he knew his crime, and on the form of his detention; and as his fault was very light, I told him that he would only remain with me for eight days, and that after a small reprimand he would be told to go spend six months at his home in Brescia. The abbé told me sincerely that he did not believe they would leave him there for eight days. And that is the man who, not feeling guilty, cannot conceive that one could punish him. I let him flatter himself, but what I told him came to pass to the letter. I became determined to keep him good company to relieve with all my power the great sensitivity that his detention caused him. I appropriated his misfortune to the point
````

**Clean `translation.text`**

````text
the circumspect P. B., secretary of the Council of Ten, had to say to me. Astonished by this order, which is always an ill omen, and very angry at having to obey it, I went at the prescribed hour into the presence of the minister, who, without saying a single word, ordered that I be deposited here. That is all.

Nothing was as innocent as this fault, but there are laws in the world that one can violate innocently, and the transgressors are nonetheless guilty. I complimented him on the fact that he knew his crime, and on the form of his detention; and as his fault was very light, I told him that he would only remain with me for eight days, and that after a small reprimand he would be told to go spend six months at his home in Brescia. The abbé told me sincerely that he did not believe they would leave him there for eight days. And that is the man who, not feeling guilty, cannot conceive that one could punish him. I let him flatter himself, but what I told him came to pass to the letter. I became determined to keep him good company to relieve with all my power the great sensitivity that his detention caused him. I appropriated his misfortune to the point
````

**Annotations:** none

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 21. Kitab obat-obatan - Or. 3198 — p. 24 (most annotations)

https://sourcelibrary.org/book/kitab-obat-obatan-or-3198/page/6a20327818654bf8e1902e37 · language Malay · prompt v13 · 12997 chars stored, 7197 in text · 286 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<unclear>dekat</unclear> with <unclear>makendi</unclear> that is <unclear>berchent</unclear> from <unclear>dekat</unclear> with snake, then <unclear>detarak matan</unclear> and when <unclear>makendi</unclear> inside <unclear>chengkan asmi</unclear> three from the <unclear>tampukan</unclear> proven more than sprinkling in this property and when placed <unclear>alendi</unclear> inside hair <unclear>wumpuan</unclear> certainly <unclear>seker berbua</unclear> and cancels the strength and <unclear>jaug</unclear> devil <unclear>lesbet</unclear> inside the throat when <unclear>bersem sama mitqali</unclear> it is thrown away <unclear>fermat</unclear> inside <unclear>chengchen</unclear> weight two <term>mitqal</term> <gloss>a unit of weight</gloss> mixed with gold and <unclear>firadengan berseman</unclear> and must be <unclear>ta'ali mizan</unclear> and the sun inside <unclear>al-bruj</unclear> that is <unclear>huwa huamu</unclear> <unclear>shekkan kah</unclear> and acceptance and awe in the state not walking that <unclear>menangkelndi</unclear> to need unless two <unclear>ulu</unclear> that is, and when drunk from <unclear>bua dufen kak</unclear> <unclear>santosakan</unclear> from <unclear>matan</unclear> poison. **Theriac** <unclear>stur</unclear> antidote, hot dry, the <unclear>alkmd</unclear> and when it is <unclear>dikusakkan</unclear> <unclear>bilang</unclear> and <unclear>fanu</unclear> eliminated and when it is <unclear>detangkelr</unclear> on top of <unclear>tengklu</unclear> <unclear>dengkskan rejki</unclear> from <unclear>juda u</unclear> that is that <unclear>dekefta tawn kemb</unclear> from <unclear>feruman kak tangan</unclear> and <unclear>kejua ulung fermul</unclear> given at this amount from poison and <unclear>fefis</unclear> spinach leaves that are said by Chinese people, <unclear>daun sunghiu</unclear> then <unclear>chepwa</unclear> on top of <unclear>tengker zenbur</unclear> that is divine benefit, and <unclear>asupa</unclear> that is white and <unclear>belir ag</unclear> that is fine <unclear>alkendi</unclear>. **Verdigris** <unclear>rusi</unclear> hot dry, inside inside <unclear>meprada</unclear> poison that kills, no medicine, it is very <unclear>esate</unclear> at <unclear>sen tahim</unclear> eating, and very beneficial, like <unclear>kung</unclear> and <unclear>fanu</unclear> and leaves <unclear>salam</unclear> to improve, becoming it <unclear>wakbar</unclear> drying <unclear>mefai</unclear> beneficial to prevent boils that are large and to
… [10497 more characters]
````

**Clean `translation.text`**

````text
dekat with makendi that is berchent from dekat with snake, then detarak matan and when makendi inside chengkan asmi three from the tampukan proven more than sprinkling in this property and when placed alendi inside hair wumpuan certainly seker berbua and cancels the strength and jaug devil lesbet inside the throat when bersem sama mitqali it is thrown away fermat inside chengchen weight two mitqal mixed with gold and firadengan berseman and must be ta'ali mizan and the sun inside al-bruj that is huwa huamu shekkan kah and acceptance and awe in the state not walking that menangkelndi to need unless two ulu that is, and when drunk from bua dufen kak santosakan from matan poison. **Theriac** stur antidote, hot dry, the alkmd and when it is dikusakkan bilang and fanu eliminated and when it is detangkelr on top of tengklu dengkskan rejki from juda u that is that dekefta tawn kemb from feruman kak tangan and kejua ulung fermul given at this amount from poison and fefis spinach leaves that are said by Chinese people, daun sunghiu then chepwa on top of tengker zenbur that is divine benefit, and asupa that is white and belir ag that is fine alkendi. **Verdigris** rusi hot dry, inside inside meprada poison that kills, no medicine, it is very esate at sen tahim eating, and very beneficial, like kung and fanu and leaves salam to improve, becoming it wakbar drying mefai beneficial to prevent boils that are large and to cleanse chemer at fer buru and desufu and one hemorrhoid that is better than ten very green if cooked that medicine, beneficial from thick kolfu t matan and itching and ringworm matan and mahkamah matan. **Ginger** helbi hot, beneficial wet, opens the throat, hot, gives benefit that is phlegm mucus and wet that is bad which happens inside the stomach afma samfeker al-ruah and if damilq it becomes it becomes it becomes al-manan faha and balayang and open from that tawn lendir and helba that is hot dry, three to reject mucus from the throat and beneficial kal-zaman of the past to it and to deminir and cold stomach and large liver and it is compatible alkendi and strengthens the heart and holds lengker weight inside the stomach, eliminates wind and cold the soul lengker and titik sini and mixes it nature and improves semen and fights poison inside hebsi at mengilkan cold bakan matan and menjaya white of the eye and thick, and it is beneficial from the property when eating it lengker prevents thirst and improves this kejak kelendir inside the stomach, and wh
… [4697 more characters]
````

**Annotations** (286)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | unclear | mark | “dekat” |  |
| 2 | unclear | mark | “makendi” |  |
| 3 | unclear | mark | “berchent” |  |
| 4 | unclear | mark | “dekat” |  |
| 5 | unclear | mark | “detarak matan” |  |
| 6 | unclear | mark | “makendi” |  |
| 7 | unclear | mark | “chengkan asmi” |  |
| 8 | unclear | mark | “tampukan” |  |
| 9 | unclear | mark | “alendi” |  |
| 10 | unclear | mark | “wumpuan” |  |
| 11 | unclear | mark | “seker berbua” |  |
| 12 | unclear | mark | “jaug” |  |
| 13 | unclear | mark | “lesbet” |  |
| 14 | unclear | mark | “bersem sama mitqali” |  |
| 15 | unclear | mark | “fermat” |  |
| 16 | unclear | mark | “chengchen” |  |
| 17 | term | mark | “mitqal” |  |
| 18 | definition | commentary | “mitqal” | a unit of weight |
| 19 | unclear | mark | “firadengan berseman” |  |
| 20 | unclear | mark | “ta'ali mizan” |  |
| 21 | unclear | mark | “al-bruj” |  |
| 22 | unclear | mark | “huwa huamu” |  |
| 23 | unclear | mark | “shekkan kah” |  |
| 24 | unclear | mark | “menangkelndi” |  |
| 25 | unclear | mark | “ulu” |  |
| 26 | unclear | mark | “bua dufen kak” |  |
| 27 | unclear | mark | “santosakan” |  |
| 28 | unclear | mark | “matan” |  |
| 29 | unclear | mark | “stur” |  |
| 30 | unclear | mark | “alkmd” |  |
| 31 | unclear | mark | “dikusakkan” |  |
| 32 | unclear | mark | “bilang” |  |
| 33 | unclear | mark | “fanu” |  |
| 34 | unclear | mark | “detangkelr” |  |
| 35 | unclear | mark | “tengklu” |  |
| 36 | unclear | mark | “dengkskan rejki” |  |
| 37 | unclear | mark | “juda u” |  |
| 38 | unclear | mark | “dekefta tawn kemb” |  |
| 39 | unclear | mark | “feruman kak tangan” |  |
| 40 | unclear | mark | “kejua ulung fermul” |  |

… 246 more

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 22. Tractatus novus de magnetica vulnerum curatione, citra ullum et dolorem, et remedii applic — p. 167 (unclosed tag)

https://sourcelibrary.org/book/tractatus-novus-de-magnetica-vulnerum-curatione-citra-ullum-goclenius/page/69b680c270c69d645a71ccfc · language Latin · prompt v10 · 1519 chars stored, 962 in text · 29 annotations · scripts: Greek

**Raw `translation.data`**

````text
# TREATISE ON

Furthermore, there is no doubt that their shapes and carvings were various, for some were pot-bellied and wide, others narrower and tighter. I find <term>crateres</term> <gloss>mixing bowls</term>, <term>paterae</term> <gloss>libation bowls</gloss>, <term>calices</term> <gloss>drinking cups</gloss>, <term>cyathi</term> <gloss>ladles</gloss>, <term>scyphi</term> <gloss>cups</gloss>, and <term>carchesia</term> <gloss>tall cups</gloss> in more frequent use among the Latins. In the triumph of <term>Paulus Aemilius</term> <gloss>Roman general</gloss>, silver mixing bowls, horns, phials, and very large cups, skillfully made and beautifully decorated, were carried.

The <term>crater</term> <gloss>mixing bowl</gloss>, as the Greeks think, is named from <term>κεράσαι</term> <gloss>kerasai</gloss>, that is, to mix and temper water with wine, or from <term>ἀπὸ τοῦ κέρατος</term> <gloss>apo tou keratos</gloss>, that is, <term>κερατὴς</term> <gloss>kerates</gloss>, because wine was once poured into a horn. For it was the custom for the ancients to drink from horns first, and <term>Xenophon</term> <gloss>Greek historian</gloss> taught that the Thracians did this; indeed, they even say that <term>Philip of Macedon</term> <gloss>King of Macedon</gloss> served wine to the Athenians in a horn. They say that the Paeonians raise oxen that bear horns of such great size that they can hold three or four <term>choas</term> <gloss>a unit of liquid measure</gloss>, which is why they make cups out of them,
````

**Clean `translation.text`**

````text
# TREATISE ON

Furthermore, there is no doubt that their shapes and carvings were various, for some were pot-bellied and wide, others narrower and tighter. I find crateres mixing bowls, paterae, calices, cyathi, scyphi, and carchesia in more frequent use among the Latins. In the triumph of Paulus Aemilius, silver mixing bowls, horns, phials, and very large cups, skillfully made and beautifully decorated, were carried.

The crater, as the Greeks think, is named from κεράσαι, that is, to mix and temper water with wine, or from ἀπὸ τοῦ κέρατος, that is, κερατὴς, because wine was once poured into a horn. For it was the custom for the ancients to drink from horns first, and Xenophon taught that the Thracians did this; indeed, they even say that Philip of Macedon served wine to the Athenians in a horn. They say that the Paeonians raise oxen that bear horns of such great size that they can hold three or four choas, which is why they make cups out of them,
````

**Annotations** (29)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | term | mark | “crateres” |  |
| 2 | definition (unclosed) | commentary | “” |  |
| 3 | term (stray-close) | mark | — |  |
| 4 | term | mark | “paterae” |  |
| 5 | definition | commentary | “paterae” | libation bowls |
| 6 | term | mark | “calices” |  |
| 7 | definition | commentary | “calices” | drinking cups |
| 8 | term | mark | “cyathi” |  |
| 9 | definition | commentary | “cyathi” | ladles |
| 10 | term | mark | “scyphi” |  |
| 11 | definition | commentary | “scyphi” | cups |
| 12 | term | mark | “carchesia” |  |
| 13 | definition | commentary | “carchesia” | tall cups |
| 14 | term | mark | “Paulus Aemilius” |  |
| 15 | definition | commentary | “Paulus Aemilius” | Roman general |
| 16 | term | mark | “crater” |  |
| 17 | definition | commentary | “crater” | mixing bowl |
| 18 | term | mark | “κεράσαι” |  |
| 19 | definition | commentary | “κεράσαι” | kerasai |
| 20 | term | mark | “ἀπὸ τοῦ κέρατος” |  |
| 21 | definition | commentary | “ἀπὸ τοῦ κέρατος” | apo tou keratos |
| 22 | term | mark | “κερατὴς” |  |
| 23 | definition | commentary | “κερατὴς” | kerates |
| 24 | term | mark | “Xenophon” |  |
| 25 | definition | commentary | “Xenophon” | Greek historian |
| 26 | term | mark | “Philip of Macedon” |  |
| 27 | definition | commentary | “Philip of Macedon” | King of Macedon |
| 28 | term | mark | “choas” |  |
| 29 | definition | commentary | “choas” | a unit of liquid measure |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): 

````text
[-The-]
{+mixing+}
[-crater-]
{+bowls,+}
{+paterae, calices, cyathi, scyphi, and carchesia in more frequent use among the Latins. In the triumph of Paulus Aemilius, silver+}
[-bowl-]
{+bowls+}
{+horns, phials, and very large cups, skillfully made and beautifully decorated, were carried. The crater,+}
[-κεράσαι-]
{+κεράσαι,+}
[-kerasai,-]
[-κέρατος-]
{+κέρατος,+}
[-apo tou keratos,-]
[-κερατὴς-]
{+κερατὴς,+}
[-kerates,-]
[-Greek historian-]
[-King of Macedon-]
[-a unit of liquid measure-]
````

### 23. Motuum Monasteriensium Novissimique Belli & Pacis Synoptica Enarratio, Nec Non Celsissimi, — p. 8 (unclosed tag)

https://sourcelibrary.org/book/motuum-monasteriensium-novissimique-belli-pacis-synoptica-jordanaeus/page/6a4f3c1172a0f5a8d380a737 · language Latin · prompt v13 · 886 chars stored, 559 in text · 8 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<warning>Extremely heavy bleed-through from the reverse side obscures much of the primary text. Ghost text from the verso is visible in mirror image; only the upright text has been transcribed.</warning>
Your kingdom <unclear> spirit </unclear>
prayers 

by which <unclear> abundantly and to be explained the divinity <unclear> I do not doubt </unclear>


distinguished by your Virtue. Yours in God 
only by your most clement 


Light shines, to the ruler, with brightness 
ancient <unclear> at this time undoubtedly </unclear>
family <unclear> proper </unclear>
and 
prince <unclear> this labor </unclear>



<unclear> and the honor to complete it.</unclear>

-> Nothing would please more <-
-> than if it were to prove itself to you alone <-
-> Which the mind owes <-

## Most Reverend & Most Illustrious
### Of Your Lordship
-> Most devoted in spirit & study <-
### JOANNES IORDANEUS
````

**Clean `translation.text`**

````text
Your kingdom  spirit 
prayers 

by which  abundantly and to be explained the divinity  I do not doubt 


distinguished by your Virtue. Yours in God 
only by your most clement 


Light shines, to the ruler, with brightness 
ancient  at this time undoubtedly 
family  proper 
and 
prince  this labor 



 and the honor to complete it.

-> Nothing would please more <-
-> than if it were to prove itself to you alone <-
-> Which the mind owes <-

## Most Reverend & Most Illustrious
### Of Your Lordship
-> Most devoted in spirit & study <-
### JOANNES IORDANEUS
````

**Annotations** (8)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | warning | page | *page* | Extremely heavy bleed-through from the reverse side obscures much of the primary text. Ghost text from the verso is visible in mirror image; |
| 2 | unclear | mark | “ spirit ” |  |
| 3 | unclear (unclosed) | mark | “” |  |
| 4 | unclear | mark | “ I do not doubt ” |  |
| 5 | unclear | mark | “ at this time undoubtedly ” |  |
| 6 | unclear | mark | “ proper ” |  |
| 7 | unclear | mark | “ this labor ” |  |
| 8 | unclear | mark | “ and the honor to complete it.” |  |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 24. Siddhanta Sarvabhauma Purvardha — p. 114 (stray close tag)

https://sourcelibrary.org/book/siddhanta-sarvabhauma-part-1-munisvara/page/69907c465f855ec553e72d08 · language Sanskrit · prompt v10 · 1905 chars stored, 1236 in text · 20 annotations · scripts: Latin only

**Raw `translation.data`**

````text
In this statement, the <term>ahargaṇa</term> is subtracted from the year. The complexity of the mathematical operation <term>gaṇita-karma</term> is mentioned here for the sake of clarity. Because the <term>hagdṛśā</term> <gloss>observed observation</gloss> is equal, the modification of the measurement is for the purpose of proving the existence of the day.

In the previous table of the <term>grahakautuka</term> <gloss>curiosity of the planets</gloss> (a <term>karaṇa-grantha</term> <gloss>manual of astronomical calculation</gloss>), the subtraction of the <term>ahargaṇa</term> from the year has been well stated for the sake of simplicity by our noble teacher. Even for the sake of simplicity, one who knows the truth of the principles satisfies [the inquiry]. 

In this treatise, the <term>siddhānta</term> <gloss>established conclusion/text</gloss> is presented. By this, it is also noted in our previous part of the <term>siddhānta</term> text and the <term>gaṇita-prakāśa</term> <gloss>illumination of mathematics</gloss> how the calculation is done. 

<insert></insert>
In the stated measure, the <term>ahargaṇa</term> is done... [calculation fragment]... the era count is 32.
</insert>

The method for finding the desired <term>ahargaṇa</term> begins with finding the count of all path-traversed units. Having multiplied the part and increased it by the Sun, the day count is divided by the standard measures. The result is the elapsed [time]. The path-traversed [units] are equal to that. This is clear. The proof here: the entire world is determined by the days [1577917828] and the division of the era.

<summary>This page discusses the pedagogical approach to 'ahargaṇa' calculation, citing established 'siddhānta' texts and the necessity of mathematical rigor in planetary observation.</summary>
<keywords>Siddhānta, Gaṇita-prakāśa, Ahargaṇa, Karana-grantha, astronomical proof</keywords>
````

**Clean `translation.text`**

````text
In this statement, the ahargaṇa is subtracted from the year. The complexity of the mathematical operation gaṇita-karma is mentioned here for the sake of clarity. Because the hagdṛśā is equal, the modification of the measurement is for the purpose of proving the existence of the day.

In the previous table of the grahakautuka (a karaṇa-grantha), the subtraction of the ahargaṇa from the year has been well stated for the sake of simplicity by our noble teacher. Even for the sake of simplicity, one who knows the truth of the principles satisfies [the inquiry]. 

In this treatise, the siddhānta is presented. By this, it is also noted in our previous part of the siddhānta text and the gaṇita-prakāśa how the calculation is done. 


In the stated measure, the ahargaṇa is done... [calculation fragment]... the era count is 32.


The method for finding the desired ahargaṇa begins with finding the count of all path-traversed units. Having multiplied the part and increased it by the Sun, the day count is divided by the standard measures. The result is the elapsed [time]. The path-traversed [units] are equal to that. This is clear. The proof here: the entire world is determined by the days [1577917828] and the division of the era.
````

**Annotations** (20)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | term | mark | “ahargaṇa” |  |
| 2 | term | mark | “gaṇita-karma” |  |
| 3 | term | mark | “hagdṛśā” |  |
| 4 | definition | commentary | “hagdṛśā” | observed observation |
| 5 | term | mark | “grahakautuka” |  |
| 6 | definition | commentary | “grahakautuka” | curiosity of the planets |
| 7 | term | mark | “karaṇa-grantha” |  |
| 8 | definition | commentary | “karaṇa-grantha” | manual of astronomical calculation |
| 9 | term | mark | “ahargaṇa” |  |
| 10 | term | mark | “siddhānta” |  |
| 11 | definition | commentary | “siddhānta” | established conclusion/text |
| 12 | term | mark | “siddhānta” |  |
| 13 | term | mark | “gaṇita-prakāśa” |  |
| 14 | definition | commentary | “gaṇita-prakāśa” | illumination of mathematics |
| 15 | insert | mark | “” |  |
| 16 | term | mark | “ahargaṇa” |  |
| 17 | insert (stray-close) | mark | — |  |
| 18 | term | mark | “ahargaṇa” |  |
| 19 | summary | page | *page* | This page discusses the pedagogical approach to 'ahargaṇa' calculation, citing established 'siddhānta' texts and the necessity of mathematic |
| 20 | keywords | page | *page* | Siddhānta, Gaṇita-prakāśa, Ahargaṇa, Karana-grantha, astronomical proof |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 25. Stoicorum Veterum Fragmenta, vol. 3: Chrysippus (Ethica) — p. 75 (stray close tag)

https://sourcelibrary.org/book/stoicorum-veterum-fragmenta-vol-3-chrysippus-ethica-arnim/page/69a97a32f3f3d2fb7de27297 · language Latin · prompt v10 · 4162 chars stored, 3310 in text · 22 annotations · scripts: Latin only

**Raw `translation.data`**

````text
# ON VIRTUE.

Good order <term>eutaxia</term> <gloss>orderliness</gloss> is the experience of the classification of actions, or it contains within itself the certainty of actions, or the classifications of actions.
Self-sufficiency <term>autarkeia</term> <gloss>self-reliance</gloss> is a state satisfied with what is necessary, and capable through itself of providing for the duties of life.

**273** Andronicus, *On the Passions* p. 25, 9 Schuchardt.
Liberality <term>eleutheriotēs</term> <gloss>generosity</gloss> is a state providing those who are engaged in giving and receiving with consistency.
Kindness <term>chrēstotēs</term> <gloss>usefulness/goodness</gloss> is a state willingly inclined to do good.
Judicial skill is the knowledge of judgments, punishments, and offenses.
Gratitude <term>eugnōmosynē</term> <gloss>goodwill/thankfulness</gloss> is voluntary justice.
Piety <term>eusebeia</term> <gloss>reverence</gloss> is the knowledge of the service of the gods.
Thanksgiving <term>eucharistia</term> <gloss>gratitude</gloss> is the knowledge of to whom, when, how, and from whom one should give and receive thanks.
Holiness <term>hosiotēs</term> <gloss>piety toward divine law</gloss> is the knowledge that makes one faithful and observant of what is just toward the divine.
Fair dealing <term>eusynallaxia</term> <gloss>honesty in exchange</gloss> is a state that preserves justice in transactions.
Legislative skill is the knowledge of political ordinances referred to the community.

**274** Sextus, *Against the Mathematicians* IX 153 (Carneades uses the Stoic definitions of virtues):
For temperance is an insurmountable disposition regarding things that happen according to right reason, or a virtue making us superior to those things that seem difficult to endure. For they say that one is temperate not when one abstains from a dying old woman, but when one is able to enjoy the company of Lais, Phryne, or someone of that sort, and yet abstains. Perseverance is the knowledge of what must be endured and what must not, or a virtue making us superior to those things that seem difficult to bear.
*Ibid.* 158. If one possesses courage, one possesses the knowledge of terrible things, non-terrible things, and those in between.
*Ibid.* 161. If one possesses magnanimity, one possesses the knowledge that makes one superior to what happens.
*Ibid.* 162. If one possesses prudence, one also possesses the knowledge of good, bad, and indifferent things.
*Ibid.* 167. If the divine i
… [1662 more characters]
````

**Clean `translation.text`**

````text
# ON VIRTUE.

Good order eutaxia is the experience of the classification of actions, or it contains within itself the certainty of actions, or the classifications of actions.
Self-sufficiency autarkeia is a state satisfied with what is necessary, and capable through itself of providing for the duties of life.

**273** Andronicus, *On the Passions* p. 25, 9 Schuchardt.
Liberality eleutheriotēs is a state providing those who are engaged in giving and receiving with consistency.
Kindness chrēstotēs is a state willingly inclined to do good.
Judicial skill is the knowledge of judgments, punishments, and offenses.
Gratitude eugnōmosynē is voluntary justice.
Piety eusebeia is the knowledge of the service of the gods.
Thanksgiving eucharistia is the knowledge of to whom, when, how, and from whom one should give and receive thanks.
Holiness hosiotēs is the knowledge that makes one faithful and observant of what is just toward the divine.
Fair dealing eusynallaxia is a state that preserves justice in transactions.
Legislative skill is the knowledge of political ordinances referred to the community.

**274** Sextus, *Against the Mathematicians* IX 153 (Carneades uses the Stoic definitions of virtues):
For temperance is an insurmountable disposition regarding things that happen according to right reason, or a virtue making us superior to those things that seem difficult to endure. For they say that one is temperate not when one abstains from a dying old woman, but when one is able to enjoy the company of Lais, Phryne, or someone of that sort, and yet abstains. Perseverance is the knowledge of what must be endured and what must not, or a virtue making us superior to those things that seem difficult to bear.
*Ibid.* 158. If one possesses courage, one possesses the knowledge of terrible things, non-terrible things, and those in between.
*Ibid.* 161. If one possesses magnanimity, one possesses the knowledge that makes one superior to what happens.
*Ibid.* 162. If one possesses prudence, one also possesses the knowledge of good, bad, and indifferent things.
*Ibid.* 167. If the divine is perfectly virtuous and possesses prudence, it also possesses good counsel, insofar as good counsel is prudence regarding things that are to be deliberated upon.
*Ibid.* 174. For temperance is a state that, in choices and avoidances, preserves the judgments of prudence.

**275** Clement of Alexandria, *Stromateis* II p. 470 Pott. Since they define courage as the knowledge of terrible things,
… [810 more characters]
````

**Annotations** (22)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | term | mark | “eutaxia” |  |
| 2 | definition | commentary | “eutaxia” | orderliness |
| 3 | term | mark | “autarkeia” |  |
| 4 | definition | commentary | “autarkeia” | self-reliance |
| 5 | term | mark | “eleutheriotēs” |  |
| 6 | definition | commentary | “eleutheriotēs” | generosity |
| 7 | term | mark | “chrēstotēs” |  |
| 8 | definition | commentary | “chrēstotēs” | usefulness/goodness |
| 9 | term | mark | “eugnōmosynē” |  |
| 10 | definition | commentary | “eugnōmosynē” | goodwill/thankfulness |
| 11 | term | mark | “eusebeia” |  |
| 12 | definition | commentary | “eusebeia” | reverence |
| 13 | term | mark | “eucharistia” |  |
| 14 | definition | commentary | “eucharistia” | gratitude |
| 15 | term | mark | “hosiotēs” |  |
| 16 | definition | commentary | “hosiotēs” | piety toward divine law |
| 17 | term | mark | “eusynallaxia” |  |
| 18 | definition | commentary | “eusynallaxia” | honesty in exchange |
| 19 | margin | mark | “” |  |
| 20 | margin (stray-close) | mark | — |  |
| 21 | summary | page | *page* | This page defines various Stoic virtues and their subcategories, including self-sufficiency, liberality, and the cardinal virtues like coura |
| 22 | keywords | page | *page* | Eutaxia, Autarkeia, Andronicus, Eleutheriotēs, Chrestotēs, Judicial Skill, Eusebeia, Hosiotēs, Temperance, Perseverance, Courage, Magnanimit |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 26. Wy ondergesz., ons zullende begeven in den huwelyke staat, en ten opzichte van het middel  — p. 1 (stray close tag)

https://sourcelibrary.org/book/wy-ondergesz-ons-zullende-begeven-in-den-huwelyke-staat-en/page/69b525b22f891867c1ae43cf · language Dutch · prompt v10 · 1583 chars stored, 543 in text · 17 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>This page continues the documentation of the marriage tax registry for Amsterdam, dated 1773. The following is a translation of the official administrative form used to declare one's marriage tax classification.</meta>

<note>A woodcut displays the coat of arms of the city of Amsterdam, which features a central shield containing three vertical Saint Andrew’s crosses, supported by two rampant lions and topped with the Imperial Crown of Austria.</note>

<margin>De Huijsbert</margin>

**W**E, the undersigned, intending to enter into the <term>Huwelyke Staat</term> <gloss>state of matrimony</gloss>, and with respect to the <term>Middel op het Trouwen</term> <gloss>tax on marriage</gloss> issued, in accordance with the content of the Ordinance regarding this, each belonging to the class of three guilders, declare that we report ourselves accordingly in order to subsequently satisfy the aforementioned tax. Done in <term>Amſterdam</term> <gloss>Amsterdam</gloss>, the <insert>14th of April 1773.</insert>

<insert></insert>
Johan George groom <note>original: "bräütigam"</note>
Tryntje van den Bergh
</insert>

Received by me, Secretary, the
above-mentioned six guilders,
Today the date as above.

<insert></insert>
A J de Huijsbert
</insert>

<summary>This document is a formal marriage tax declaration from 1773 in which a couple registers their intent to marry and pays the required six-guilder fee according to Amsterdam ordinances.</summary>
<keywords>marriage tax, 1773, Amsterdam, ordinances, administrative records, Johan George, Tryntje van den Bergh</keywords>
````

**Clean `translation.text`**

````text
De Huijsbert

**W**E, the undersigned, intending to enter into the Huwelyke Staat, and with respect to the Middel op het Trouwen issued, in accordance with the content of the Ordinance regarding this, each belonging to the class of three guilders, declare that we report ourselves accordingly in order to subsequently satisfy the aforementioned tax. Done in Amſterdam, the 14th of April 1773.


Johan George groom
Tryntje van den Bergh


Received by me, Secretary, the
above-mentioned six guilders,
Today the date as above.


A J de Huijsbert

````

**Annotations** (17)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the documentation of the marriage tax registry for Amsterdam, dated 1773. The following is a translation of the official |
| 2 | note | commentary | “” | A woodcut displays the coat of arms of the city of Amsterdam, which features a central shield containing three vertical Saint Andrew’s cross |
| 3 | margin | mark | “De Huijsbert” |  |
| 4 | term | mark | “Huwelyke Staat” |  |
| 5 | definition | commentary | “Huwelyke Staat” | state of matrimony |
| 6 | term | mark | “Middel op het Trouwen” |  |
| 7 | definition | commentary | “Middel op het Trouwen” | tax on marriage |
| 8 | term | mark | “Amſterdam” |  |
| 9 | definition | commentary | “Amſterdam” | Amsterdam |
| 10 | insert | mark | “14th of April 1773.” |  |
| 11 | insert | mark | “” |  |
| 12 | original | commentary | “Johan George groom” | original: "bräütigam" |
| 13 | insert (stray-close) | mark | — |  |
| 14 | insert | mark | “” |  |
| 15 | insert (stray-close) | mark | — |  |
| 16 | summary | page | *page* | This document is a formal marriage tax declaration from 1773 in which a couple registers their intent to marry and pays the required six-gui |
| 17 | keywords | page | *page* | marriage tax, 1773, Amsterdam, ordinances, administrative records, Johan George, Tryntje van den Bergh |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 27. Medical Compendium: Hippocrates, Galen, Medicina Plinii (Royal MS 12 E XX) — p. 333 (text vs today's notes-off reader: 133 words differ)

https://sourcelibrary.org/book/royal-ms-12-e-xx-various-hippocrates/page/6991bf73734f402cad48a1fb · language Latin · prompt v5.2026-02 · 1637 chars stored, 136 in text · 12 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<meta>This page is a modern archival flyleaf or pastedown, likely added by library staff at the British Museum (now the British Library) during the 19th or 20th century. It documents the physical count of the manuscript's pages and its conservation history, following the medieval content of Royal MS 12 E XX.</meta>

<insert>
164 <term>folios</term> <note>A "folio" is a single leaf of parchment or paper. Unlike modern books where every page is numbered, manuscripts are usually numbered by the leaf; one folio consists of two pages (the "recto" or front, and the "verso" or back).</note>
</insert>

<insert>
Number of <term>MS.</term> 12 F XX <note>original: "MS."; an abbreviation for "Manuscript." This is the shelfmark used to locate the book in the library. Note that while the volume is known as 12 E XX, this slip reflects a variant or clerical error "12 F XX."</note>

Number of Folios: 164

Date: ? <note>The archivist left the date blank on this form, though the manuscript is historically dated to approximately 1125.</note>

Folioed by: ? <note>A record of which staff member performed the official numbering of the leaves.</note>

Examined by: ?

Checked after binding: May 1957 BA <note>This indicates that the manuscript underwent a physical inspection or rebinding in 1957, verified by a staff member with the initials "BA."</note>
</insert>

<summary>This page contains modern archival notes and library processing information documenting the manuscript's 164 leaves and a binding check performed in 1957.</summary>
<keywords>archival notes, British Library, foliation, shelfmark, conservation, 20th century</keywords>
````

**Clean `translation.text`**

````text

164 folios



Number of MS. 12 F XX

Number of Folios: 164

Date: ?

Folioed by: ?

Examined by: ?

Checked after binding: May 1957 BA

````

**Annotations** (12)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page is a modern archival flyleaf or pastedown, likely added by library staff at the British Museum (now the British Library) during th |
| 2 | insert | mark | “ 164 folios ” |  |
| 3 | term | mark | “folios” |  |
| 4 | definition | commentary | “folios” | A "folio" is a single leaf of parchment or paper. Unlike modern books where every page is numbered, manuscripts are usually numbered by the  |
| 5 | insert | mark | “ Number of MS. 12 F XX Number of Folios: 164 Date: ? Folioed by: ? Examined by: ” |  |
| 6 | term | mark | “MS.” |  |
| 7 | original | commentary | “12 F XX” | original: "MS."; an abbreviation for "Manuscript." This is the shelfmark used to locate the book in the library. Note that while the volume  |
| 8 | note | commentary | “Date” | The archivist left the date blank on this form, though the manuscript is historically dated to approximately 1125. |
| 9 | note | commentary | “Folioed by” | A record of which staff member performed the official numbering of the leaves. |
| 10 | note | commentary | “May 1957 BA” | This indicates that the manuscript underwent a physical inspection or rebinding in 1957, verified by a staff member with the initials "BA." |
| 11 | summary | page | *page* | This page contains modern archival notes and library processing information documenting the manuscript's 164 leaves and a binding check perf |
| 12 | keywords | page | *page* | archival notes, British Library, foliation, shelfmark, conservation, 20th century |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): 

````text
[-A "folio" is a single leaf of parchment or paper. Unlike modern books where every page is numbered, manuscripts are usually numbered by the leaf; one folio consists of two pages (the "recto" or front, and the "verso" or back).-]
[-original: "MS."; an abbreviation for "Manuscript." This is the shelfmark used to locate the book in the library. Note that while the volume is known as 12 E XX, this slip reflects a variant or clerical error "12 F XX."-]
[-The archivist left the date blank on this form, though the manuscript is historically dated to approximately 1125.-]
[-A record of which staff member performed the official numbering of the leaves.-]
[-This indicates that the manuscript underwent a physical inspection or rebinding in 1957, verified by a staff member with the initials "BA."-]
````

### 28. Anti-Cotton, oder kurtze und gegründte Widerlegung dess durch den Jesuiten Cotton aussgesp — p. 14 (text vs today's notes-off reader: 71 words differ)

https://sourcelibrary.org/book/anti-cotton-plaix/page/69750f1640760ddb6b77548b · language German · prompt v2 · 4855 chars stored, 2158 in text · 20 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<warning>The left margin of the page is partially cut off, resulting in incomplete words in the marginal annotations.</warning>
<meta>This page continues the critique of Jesuit political theory, specifically focusing on the power of the Pope to depose monarchs. It transitions from a discussion of Henry Garnet and the "Seal of Confession" to specific citations from influential Jesuit theologians like Bellarmine, Gretser, and Toletus, who argue that the Papacy holds the authority to release subjects from their oaths of allegiance.</meta>

<margin>[The Pope] can change kingdoms, take them away, and give them to another, as the supreme spiritual prince. <note>original: "potest mutare regna i auferre atq; alteri erre, tanquam sum- spiritualis princeps." The Latin here is partially abbreviated.</note></margin>
...and to release [subjects] from loyalty and grace; and Bellarmine's <note>Robert Bellarmine (1542–1621), a Cardinal and major Jesuit theologian.</note> words concerning this, in the 5th Book on the Pope, in the 6th Chapter, read as follows:
> **The Pope may change kingdoms, take them from one person, and give them to another, as the highest spiritual prince.** 

Likewise, the Jesuit Gretser <note>Jacob Gretser (1562–1625), a prolific Jesuit polemicist known for his sharp attacks on Protestants.</note> writes in his *Heretico-Political Bat* <note>original: "Ketzerpolitischen Fledermaus." This refers to Gretser's work *Vespertilio Haereticopoliticus* (1608), where he mocks his opponents' arguments.</note> as follows: 
<margin>The Heretico-Political Bat. We are not so timid or trembling that we would not dare to openly assert that the Roman Pontiff can, if necessity requires, release Catholic subjects from the oath of fidelity if the prince treats them tyrannically, etc. <note>The Latin margin is partially cut off. Reconstructed: "Vespertilio hæreticopoliticus. ...timidi & trepidi non sumus, ut asserere palàm audeamus Rom. Pont. possit, si necessitas exigat, subditos Catholicos juramento fidelitatis solvere, si princeps tyrannice illos tractet, &c."</note></margin>
> **We are not fearful nor terrified, so that we would not dare to publicly say and maintain that the Pope has the full power, in case of necessity, to release Catholic subjects from their loyalty and oath, when the ruler treats them tyrannically.** 

And he adds further: 
> **When the Pope undertakes such a thing wisely and cautiously, it is a meritorious work.** 

But is this new kind of "merit
… [2355 more characters]
````

**Clean `translation.text`**

````text
[The Pope] can change kingdoms, take them away, and give them to another, as the supreme spiritual prince.
...and to release [subjects] from loyalty and grace; and Bellarmine's words concerning this, in the 5th Book on the Pope, in the 6th Chapter, read as follows:
> **The Pope may change kingdoms, take them from one person, and give them to another, as the highest spiritual prince.** 

Likewise, the Jesuit Gretser writes in his *Heretico-Political Bat* as follows: 
The Heretico-Political Bat. We are not so timid or trembling that we would not dare to openly assert that the Roman Pontiff can, if necessity requires, release Catholic subjects from the oath of fidelity if the prince treats them tyrannically, etc.
> **We are not fearful nor terrified, so that we would not dare to publicly say and maintain that the Pope has the full power, in case of necessity, to release Catholic subjects from their loyalty and oath, when the ruler treats them tyrannically.** 

And he adds further: 
> **When the Pope undertakes such a thing wisely and cautiously, it is a meritorious work.** 

But is this new kind of "merit" not something to be wary of, when one incites mutiny and commands perjury? From which nothing else follows but that one makes an attempt on the life of his lord? Since it is easy to see that the lord will protect himself against the rebels and meet force with force—which cannot happen without danger to his life.

Subjects are [not] bound by the oath of loyalty to an excommunicated person.
Tolet writes in his 1st book of *Instruction for Priests*, in the 13th Chapter:
> **Subjects are not obligated to keep an oath to one who is under the Ban. Likewise, one who is under the Ban cannot perform any act of his jurisdiction.** 

An excommunicated person cannot perform an act of jurisdiction.
From this rule, then, King Henry III was no longer king; therefore, the one who murdered him did not murder a king.

The Spanish Jesuit Mariana published a book on the king and royal discipline and instruction, which was printed first in the year 1599 at Toledo by Peter Rodrigo, and then a second time at Mainz by Balthasar Lipp, in the year
````

**Annotations** (20)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | warning | page | *page* | The left margin of the page is partially cut off, resulting in incomplete words in the marginal annotations. |
| 2 | meta | page | *page* | This page continues the critique of Jesuit political theory, specifically focusing on the power of the Pope to depose monarchs. It transitio |
| 3 | margin | mark | “[The Pope] can change kingdoms, take them away, and give them to another, as the” |  |
| 4 | original | commentary | “supreme spiritual prince” | original: "potest mutare regna i auferre atq; alteri erre, tanquam sum- spiritualis princeps." The Latin here is partially abbreviated. |
| 5 | note | commentary | “grace; and Bellarmine's” | Robert Bellarmine (1542–1621), a Cardinal and major Jesuit theologian. |
| 6 | note | commentary | “the Jesuit Gretser” | Jacob Gretser (1562–1625), a prolific Jesuit polemicist known for his sharp attacks on Protestants. |
| 7 | original | commentary | “his *Heretico-Political Bat” | original: "Ketzerpolitischen Fledermaus." This refers to Gretser's work *Vespertilio Haereticopoliticus* (1608), where he mocks his opponent |
| 8 | margin | mark | “The Heretico-Political Bat. We are not so timid or trembling that we would not d” |  |
| 9 | note | commentary | “them tyrannically, etc” | The Latin margin is partially cut off. Reconstructed: "Vespertilio hæreticopoliticus. ...timidi & trepidi non sumus, ut asserere palàm audea |
| 10 | margin | mark | “Subjects are [not] bound by the oath of loyalty to an excommunicated person.” |  |
| 11 | note | commentary | “an excommunicated person” | Reconstructed Latin: "Excommunicato subditi non tenentur juramento fidelitatis." |
| 12 | note | commentary | “Tolet” | Francisco Toledo (1532–1596), the first Jesuit to be made a Cardinal. |
| 13 | note | commentary | “to one who is under the Ban” | The "Ban" refers to excommunication, a formal exclusion from the Church which, in this political context, was argued to strip a monarch of t |
| 14 | margin | mark | “An excommunicated person cannot perform an act of jurisdiction.” |  |
| 15 | note | commentary | “act of jurisdiction” | Reconstructed Latin: "Excommunicatus non potest jurisdictionis actum exercere." |
| 16 | note | commentary | “King Henry III” | Henry III of France (reigned 1574–1589), who was assassinated by a Dominican friar after being excommunicated by the Pope. |
| 17 | note | commentary | “Spanish Jesuit Mariana” | Juan de Mariana (1536–1624), whose book *De rege et regis institutione* (On the King and the Education of a King) became notorious for justi |
| 18 | meta | page | *page* | catchword: Year |
| 19 | summary | page | *page* | This page cites several Jesuit theologians to demonstrate their support for the Pope's power to depose kings and release subjects from their |
| 20 | keywords | page | *page* | Robert Bellarmine, Jacob Gretser, Francisco Toledo, Juan de Mariana, Henry III of France, excommunication, deposition, regicide, tyranny, Je |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): 

````text
[-original: "potest mutare regna i auferre atq; alteri erre, tanquam sum- spiritualis princeps." The Latin here is partially abbreviated.-]
[-The Latin margin is partially cut off. Reconstructed: "Vespertilio hæreticopoliticus. ...timidi & trepidi non sumus, ut asserere palàm audeamus Rom. Pont. possit, si necessitas exigat, subditos Catholicos juramento fidelitatis solvere, si princeps tyrannice illos tractet, &c."-]
[-Reconstructed Latin: "Excommunicato subditi non tenentur juramento fidelitatis."-]
[-Reconstructed Latin: "Excommunicatus non potest jurisdictionis actum exercere."-]
````

### 29. إحياء علوم الدين (Iḥyāʾ ʿUlūm al-Dīn) — p. 119 (script: Arabic)

https://sourcelibrary.org/book/ihya-ulum-al-din-al-ghazali/page/69e8b2a72ff2a8dc09e78684 · language Arabic · prompt v11 · 6278 chars stored, 5717 in text · 16 annotations · scripts: Arabic

**Raw `translation.data`**

````text
<meta>continues from previous page</meta>

-> 109 <-

**Explaining the Knowledge of the Attributes of God the Exalted**

<note>original: "بيان العلم بصفات الله تعالى"</note>

His knowledge and His power necessarily prove His life. If one could imagine a powerful and knowing agent who directs affairs without being alive, it would be possible to doubt the life of animals when they move or stay still. It would even be possible to doubt the life of craftsmen and laborers. Such a thought is a plunge into the depths of ignorance and error.

**The Fourth Foundation:** Knowledge that He, the Exalted, is the Willer of His actions. There is no existing thing except that it is grounded in His volition and issued from His will. He is the Beginner, the Restorer, and the Doer of whatever He wills. How could He not be a Willer when every action that issues from Him could have been its opposite? For those things that have no opposite, it would have been possible for them to issue exactly as they are either earlier or later. Power relates to two opposites or two different times in the same way. Therefore, there must be a will that directs power toward one of the two possibilities. If knowledge were enough to specify what is known without the need for will—to the point where one says "it existed at the time it was previously known to exist"—then knowledge would also be enough to replace power, and one would say "it existed without power because its existence was previously known."

**The Fifth Foundation:** Knowledge that He, the Exalted, is Hearing and Seeing. The whispers of the heart and the secrets of imagination and thought do not escape His vision. The crawling of a black ant on a hard, dark rock on a pitch-black night does not elude His hearing. How could He not be Hearing and Seeing when hearing and sight are perfections without doubt, not deficiencies? How could the creature be more perfect than the Creator, or the thing made be more noble and complete than the Maker? How would the balance be fair if deficiency were on His side and perfection on the side of His creation and handiwork? How would the argument of Abraham <gloss>peace be upon him</gloss> against his father stand? His father used to worship idols out of ignorance and error, and Abraham said to him: "Why do you worship that which does not hear, does not see, and cannot avail you anything?" <note>Quran 19:42</note>. If these same deficiencies applied to Abraham's own Deity, his argument would be refuted a
… [3778 more characters]
````

**Clean `translation.text`**

````text
-> 109 <-

**Explaining the Knowledge of the Attributes of God the Exalted**

His knowledge and His power necessarily prove His life. If one could imagine a powerful and knowing agent who directs affairs without being alive, it would be possible to doubt the life of animals when they move or stay still. It would even be possible to doubt the life of craftsmen and laborers. Such a thought is a plunge into the depths of ignorance and error.

**The Fourth Foundation:** Knowledge that He, the Exalted, is the Willer of His actions. There is no existing thing except that it is grounded in His volition and issued from His will. He is the Beginner, the Restorer, and the Doer of whatever He wills. How could He not be a Willer when every action that issues from Him could have been its opposite? For those things that have no opposite, it would have been possible for them to issue exactly as they are either earlier or later. Power relates to two opposites or two different times in the same way. Therefore, there must be a will that directs power toward one of the two possibilities. If knowledge were enough to specify what is known without the need for will—to the point where one says "it existed at the time it was previously known to exist"—then knowledge would also be enough to replace power, and one would say "it existed without power because its existence was previously known."

**The Fifth Foundation:** Knowledge that He, the Exalted, is Hearing and Seeing. The whispers of the heart and the secrets of imagination and thought do not escape His vision. The crawling of a black ant on a hard, dark rock on a pitch-black night does not elude His hearing. How could He not be Hearing and Seeing when hearing and sight are perfections without doubt, not deficiencies? How could the creature be more perfect than the Creator, or the thing made be more noble and complete than the Maker? How would the balance be fair if deficiency were on His side and perfection on the side of His creation and handiwork? How would the argument of Abraham peace be upon him against his father stand? His father used to worship idols out of ignorance and error, and Abraham said to him: "Why do you worship that which does not hear, does not see, and cannot avail you anything?". If these same deficiencies applied to Abraham's own Deity, his argument would be refuted and his proof would fail. Then the word of the Exalted would not be true: "And that was Our argument which We gave to Abraham against his 
… [3217 more characters]
````

**Annotations** (16)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | continues from previous page |
| 2 | original | commentary | “” | original: "بيان العلم بصفات الله تعالى" |
| 3 | gloss | mark | “peace be upon him” |  |
| 4 | note | commentary | “avail you anything” | Quran 19:42 |
| 5 | note | commentary | “against his people” | Quran 6:83 |
| 6 | term | mark | “qadim” |  |
| 7 | definition | commentary | “qadim” | eternal |
| 8 | term | mark | “Ba” |  |
| 9 | term | mark | “Sin” |  |
| 10 | term | mark | “Bismillah” |  |
| 11 | definition | commentary | “Bismillah” | In the name of God |
| 12 | term | mark | “Sin” |  |
| 13 | term | mark | “Ba” |  |
| 14 | note | commentary | “is no guide” | Quran 13:33 |
| 15 | gloss | mark | “peace be upon him” |  |
| 16 | vocab | page | *page* | إحياء علوم الدين, Iḥyāʾ ʿUlūm al-Dīn, الغزالي, Al-Ghazali, صفات الله, Attributes of God, القدرة, Power, الإرادة, Will, السمع, Hearing, البصر |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 30. Tomi secundi tractatus secundus; De praeternaturali utriusque mundi historia — p. 151 (script: Hebrew)

https://sourcelibrary.org/book/on-the-preternatural-history-of-both-worlds-fludd/page/6985ee1e270aa6cc9231cf2a · language Latin · prompt v2 · 7347 chars stored, 5553 in text · 18 annotations · scripts: Hebrew

**Raw `translation.data`**

````text
<meta>This page continues the discussion of light and fire as fundamental elements of creation. Having previously established the symbolic significance of the Hebrew letters, the author now categorizes the various types of fire mentioned in Scripture—ranging from the divine pillar of fire to the material fire of everyday life—and transitions into a deep philosophical exploration of "Uncreated Light" as the Word of God (the Logos) and the animating "Soul of the World."</meta>

<page-num>121</page-num>
<header>CONCERNING THE PRIMARY ELEMENTS OF NATURE. 121</header>

...Holy Scripture has made mention of the pillar of fire in Exodus 13:22. It also speaks of the fire of Jehovah descending and consuming the burnt offering, the stones, and the wood, and licking up all the water in the trench in 1 Kings 18:38. By this same spirit, the captain of fifty with his fifty men was consumed in 2 Kings 1:12. In this same way, there is the fire or light of the sun and the other stars; likewise, there is the light of fiery meteors, which we find mentioned throughout the Holy Bible. Similarly, there is common fire, which is called material fire. Finally, there is the fire of Gehenna <note>Gehenna: A term used in the New Testament for the place of ultimate punishment or "hell fire."</note>, of which Matthew 18:9 speaks. 

However, proceeding in a more exact method and order, we divide light into the **invisible** and the **visible**. Furthermore, we recognize that invisible light is either **uncreated**, eternal, and "supersubstantial" <note>original: "supersubstantialem," meaning existing beyond the nature of physical matter</note>, or it is that **created** light of the first day, from which the other species of invisible light were formed—namely, the angels of every order and holy souls. Into this category, we may also place the dark fire of Gehenna. 

We also distinguish visible light into the **manifest** and the **hidden**. We define manifest light as either proceeding from the luminous face of Jehovah (covered by a bright and visible garment), or celestial light proceeding from the stars, or elementary light perceived in meteors, or finally that common and material fire. We call that light **hidden** which is accustomed to lie concealed in metals, stones, wood, herbs, and animals; for indeed, it can be drawn out from these by motion or art <note>The author refers to friction or chemical extraction</note> in such a way that it is rendered visible, subjected to the sense
… [4847 more characters]
````

**Clean `translation.text`**

````text
...Holy Scripture has made mention of the pillar of fire in Exodus 13:22. It also speaks of the fire of Jehovah descending and consuming the burnt offering, the stones, and the wood, and licking up all the water in the trench in 1 Kings 18:38. By this same spirit, the captain of fifty with his fifty men was consumed in 2 Kings 1:12. In this same way, there is the fire or light of the sun and the other stars; likewise, there is the light of fiery meteors, which we find mentioned throughout the Holy Bible. Similarly, there is common fire, which is called material fire. Finally, there is the fire of Gehenna, of which Matthew 18:9 speaks. 

However, proceeding in a more exact method and order, we divide light into the **invisible** and the **visible**. Furthermore, we recognize that invisible light is either **uncreated**, eternal, and "supersubstantial", or it is that **created** light of the first day, from which the other species of invisible light were formed—namely, the angels of every order and holy souls. Into this category, we may also place the dark fire of Gehenna. 

We also distinguish visible light into the **manifest** and the **hidden**. We define manifest light as either proceeding from the luminous face of Jehovah (covered by a bright and visible garment), or celestial light proceeding from the stars, or elementary light perceived in meteors, or finally that common and material fire. We call that light **hidden** which is accustomed to lie concealed in metals, stones, wood, herbs, and animals; for indeed, it can be drawn out from these by motion or art in such a way that it is rendered visible, subjected to the senses, and observed by the eyes. We shall discuss these briefly in their proper order in the following chapter.

---

# C H A P T E R V.

### *Concerning uncreated invisible light, and how it is compared to the nature of visible fire: Furthermore, it is proved that visible light is a certain reflection of the uncreated and invisible light into the "garments" which it puts on.*

That invisible and uncreated light, from which heaven, earth, and all things both visible and invisible were formed, is that unique, sacrosanct, ineffable, and eternal **Word of God**, or the Messiah, and the true power of the Tetragrammaton. And this Word was in the beginning with God, and the Word was God. All things were made through this Word, and without Him was nothing made that was made; in Him was life. This is that Word in which all things firmly subsist
… [3053 more characters]
````

**Annotations** (18)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the discussion of light and fire as fundamental elements of creation. Having previously established the symbolic signifi |
| 2 | pagedata | page | *page* | 121 |
| 3 | pagedata | page | *page* | CONCERNING THE PRIMARY ELEMENTS OF NATURE. 121 |
| 4 | note | commentary | “the fire of Gehenna” | Gehenna: A term used in the New Testament for the place of ultimate punishment or "hell fire." |
| 5 | original | commentary | “eternal, and "supersubstantial” | original: "supersubstantialem," meaning existing beyond the nature of physical matter |
| 6 | note | commentary | “motion or art” | The author refers to friction or chemical extraction |
| 7 | note | commentary | “of the Tetragrammaton” | Tetragrammaton: The four-letter Hebrew name of God, YHWH. |
| 8 | term | mark | “יהי” |  |
| 9 | definition | commentary | “יהי” | Hebrew: "Yehi," meaning "Let there be." |
| 10 | note | commentary | “Word יהי **FIAT” | Latin: "Let it be done." |
| 11 | original | commentary | “before its "clarification” | original: "clarificationem," referring to the theological concept of glorification or the transformation of the body into a spiritual state |
| 12 | original | commentary | “that **peaceful knot” | original: "nodus pacificus" |
| 13 | original | commentary | “the Universal World” | original: "mundi universalis anima" |
| 14 | note | commentary | “and unique "act” | In the Aristotelian sense of "actualization" or "driving force" |
| 15 | pagedata | page | *page* | M |
| 16 | meta | page | *page* | Catchword: decay [from Latin 'corrumpuntur'] |
| 17 | summary | page | *page* | This page classifies light and fire into various spiritual and physical categories, identifying the "Uncreated Light" with the Word of God ( |
| 18 | keywords | page | *page* | Uncreated Light, Word of God, Messiah, Tetragrammaton, Fiat, Trinity, Soul of the World, Gehenna, elemental fire, divine wisdom |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 31. 道藏目錄詳註 (Daozang Catalogue with Detailed Notes) Vol 2 — p. 84 (script: Han)

https://sourcelibrary.org/book/daozang-catalogue-with-detailed-notes-vol-2/page/6992ca02d4d545ae73fed79f · language Chinese · prompt v5.2026-02 · 3047 chars stored, 1193 in text · 15 annotations · scripts: Han

**Raw `translation.data`**

````text
<meta>This page continues from the previous section focusing on longevity and health practices. It transitions from general "Great Clarity" methods to the "Shen" (Deep) character section, which cataloged specific manuals on seasonal hygiene, dietary regulation, and methods for living a healthy life while remaining in secular society.</meta>

<margin>Volume Three</margin>

# Section Marked with the Character "Shen" (Deep): Total Nine Volumes
<note>In the Daoist Canon, volumes were organized using the Thousand Character Classic as a numbering system. "Shen" (深) is one such classification character.</note>

<column-break/>

**Talismans for Delivering People** by [Name Unclear]
**Chapter on Suitable Foods**, **Chapter on Monthly Suitability**
These chapters all concern the regulation of diet
and are **techniques for nourishing Qi**.
<term>Yangqi</term> <note>A fundamental Daoist practice involving breathing exercises and lifestyle choices to cultivate and preserve the body's vital energy.</note>

<column-break/>

# Secret Records of Cultivating Reality
<term>Xiuzhen</term> <note>A term for the process of Daoist internal alchemy and self-transformation, aiming to return the practitioner to their original, "true" state of being.</note>

<gloss>Included in the same volume as the Record of Essential Statutes.</gloss>

<column-break/>

# Essential Records for Preserving Life

Written by Pu Dushi, Bureau Director for Deliberation.

Regulation 6
Regulation for Consumption Fatigue 7 <note>original: "huanlao." Refers to chronic wasting diseases or fatigue caused by overwork and spiritual depletion.</note>
Regulation for Wind Disorders 8 <note>In traditional medicine, "Wind" is considered a primary cause of many illnesses, ranging from the common cold to strokes.</note>
Domestic Regulation 9
Prohibitions and Regulation 10

<column-break/>

Compiled by Liu Xun, the Recluse of Mount Mao.
<note>Mount Mao (Maoshan) was the center of the Highest Clarity school of Daoism, famous for its focus on visualization and longevity techniques.</note>
Regulation of Food and Drink 1
Regulation of Drinking Alcohol 2
Regulation for the Spring Season 3
Regulation for the Summer Season 4
Regulation for the Autumn Season 5
Regulation for the Winter [Season 6]

<column-break/>

# Records for Nourishing Life While Living Among the Mundane
<note>original: "Hunsu Yisheng Lu." This title suggests a manual for people who want to practice Daoist health cultivation without becoming monks or retreati
… [547 more characters]
````

**Clean `translation.text`**

````text
Volume Three

# Section Marked with the Character "Shen" (Deep): Total Nine Volumes
<column-break/>

**Talismans for Delivering People** by [Name Unclear]
**Chapter on Suitable Foods**, **Chapter on Monthly Suitability**
These chapters all concern the regulation of diet
and are **techniques for nourishing Qi**.
Yangqi

<column-break/>

# Secret Records of Cultivating Reality
Xiuzhen

Included in the same volume as the Record of Essential Statutes.

<column-break/>

# Essential Records for Preserving Life

Written by Pu Dushi, Bureau Director for Deliberation.

Regulation 6
Regulation for Consumption Fatigue 7
Regulation for Wind Disorders 8
Domestic Regulation 9
Prohibitions and Regulation 10

<column-break/>

Compiled by Liu Xun, the Recluse of Mount Mao.
Regulation of Food and Drink 1
Regulation of Drinking Alcohol 2
Regulation for the Spring Season 3
Regulation for the Summer Season 4
Regulation for the Autumn Season 5
Regulation for the Winter [Season 6]

<column-break/>

# Records for Nourishing Life While Living Among the Mundane
Upper and Lower parts are in the same volume.

<column-break/>

Compiled and Edited by Lu Zunyuan,
Master of the Rosy Tower.

<column-break/>
````

**Annotations** (15)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues from the previous section focusing on longevity and health practices. It transitions from general "Great Clarity" method |
| 2 | margin | mark | “Volume Three” |  |
| 3 | note | commentary | “” | In the Daoist Canon, volumes were organized using the Thousand Character Classic as a numbering system. "Shen" (深) is one such classificatio |
| 4 | term | mark | “Yangqi” |  |
| 5 | definition | commentary | “Yangqi” | A fundamental Daoist practice involving breathing exercises and lifestyle choices to cultivate and preserve the body's vital energy. |
| 6 | term | mark | “Xiuzhen” |  |
| 7 | definition | commentary | “Xiuzhen” | A term for the process of Daoist internal alchemy and self-transformation, aiming to return the practitioner to their original, "true" state |
| 8 | gloss | mark | “Included in the same volume as the Record of Essential Statutes.” |  |
| 9 | original | commentary | “Consumption Fatigue 7” | original: "huanlao." Refers to chronic wasting diseases or fatigue caused by overwork and spiritual depletion. |
| 10 | note | commentary | “Wind Disorders 8” | In traditional medicine, "Wind" is considered a primary cause of many illnesses, ranging from the common cold to strokes. |
| 11 | note | commentary | “” | Mount Mao (Maoshan) was the center of the Highest Clarity school of Daoism, famous for its focus on visualization and longevity techniques. |
| 12 | original | commentary | “” | original: "Hunsu Yisheng Lu." This title suggests a manual for people who want to practice Daoist health cultivation without becoming monks  |
| 13 | gloss | mark | “Upper and Lower parts are in the same volume.” |  |
| 14 | summary | page | *page* | This page lists several key Daoist manuals regarding "nourishing life" (Yanggsheng), focusing on seasonal hygiene, dietary prohibitions, and |
| 15 | keywords | page | *page* | Nourishing Life, Qi cultivation, dietary regulation, seasonal health, Maoshan, Pu Dushi, Liu Xun, longevity manuals |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): 

````text
{+Yangqi+}
{+Xiuzhen+}
````

### 32. བསྟན་འགྱུར། སྡེ་དགེ། དབུ་མ། ཁི (Derge Tengyur, vol. 111) — p. 48 (script: Tibetan)

https://sourcelibrary.org/book/derge-tengyur-vol-111/page/6abeb4e8896ea18127c84a25 · language Tibetan · prompt v13 · 2705 chars stored, 1838 in text · 9 annotations · scripts: Tibetan, combining

**Raw `translation.data`**

````text
One should protect the body and so forth. From the *Bodhisattva Pratimokṣa* <term>bodhisattva pratimokṣa</term> <gloss>Individual Emancipation vow of a Bodhisattva</gloss>: "Śāriputra, if one thinks, 'I shall protect others,' one should protect oneself. Likewise, Śāriputra, a bodhisattva mahāsattva endowed with the wish to benefit others does not perform unwholesome actions even for the sake of life itself," and so forth, as it was spoken.

From the *Sūtra Requested by the Householder Śrīgupta* <note>Tibetan: ཁྱིམ་བདག་དཔལ་བྱིན་གྱིས་ཞུས་པའི་མདོ, Śrīguptaparipṛcchā-sūtra</note> as well: "Like a chariot for bearing a load, it should be held purely with the thought of Dharma," so it was said.

Likewise, from the *Noble Sūtra Taught by Akṣayamati* <note>Tibetan: འཕགས་པ་བློ་གྲོས་མི་ཟད་པས་བསྟན་པའི་མདོ, Akṣayamatinirdeśa-sūtra</note> as well: "By looking upon sentient beings, one is not completely worn out by bodily suffering," so it was said.

If one asks how to care for the body and so forth in that way: one must not forsake the spiritual mentor <term>kalyāṇamitra</term> <gloss>spiritual friend or virtuous guide</gloss>. As the noble Śrīsaṃbhava taught in the *Gaṇḍavyūha Sūtra* <note>Tibetan: སྡོང་པོ་བཀོད་པའི་མདོ, Array of Stalks Sūtra</note>:

"Noble son, bodhisattvas who are genuinely held by a spiritual mentor do not fall into lower realms. Bodhisattvas who are kept in mind by a spiritual mentor do not transgress the trainings of a bodhisattva. Bodhisattvas who are cared for by a spiritual mentor rise above the world. Bodhisattvas who venerate a spiritual mentor act without forgetfulness in all conduct. Bodhisattvas who are embraced by a spiritual mentor are difficult to overcome by karmas and afflictions. A spiritual mentor brings about the realization of what is to be done and what is not to be done. They genuinely turn one away from states of heedlessness. They deliver one from the city of saṃsāra.

"Noble son, therefore, with such continuous mindfulness, you must go into the presence of spiritual mentors: with a mind like the earth, so as never to grow weary from carrying every burden; with a mind like a vajra, so as to be indivisible; and [to endure] all suffering..."

<summary>This passage cites the Bodhisattva Pratimokṣa, the Śrīguptaparipṛcchā, and the Akṣayamatinirdeśa Sūtra on preserving the body for the Dharma and the benefit of others, followed by teachings from the Gaṇḍavyūha Sūtra on the vital role and qualities of relying on a spiritual friend.
… [205 more characters]
````

**Clean `translation.text`**

````text
One should protect the body and so forth. From the *Bodhisattva Pratimokṣa* bodhisattva pratimokṣa: "Śāriputra, if one thinks, 'I shall protect others,' one should protect oneself. Likewise, Śāriputra, a bodhisattva mahāsattva endowed with the wish to benefit others does not perform unwholesome actions even for the sake of life itself," and so forth, as it was spoken.

From the *Sūtra Requested by the Householder Śrīgupta* as well: "Like a chariot for bearing a load, it should be held purely with the thought of Dharma," so it was said.

Likewise, from the *Noble Sūtra Taught by Akṣayamati* as well: "By looking upon sentient beings, one is not completely worn out by bodily suffering," so it was said.

If one asks how to care for the body and so forth in that way: one must not forsake the spiritual mentor kalyāṇamitra. As the noble Śrīsaṃbhava taught in the *Gaṇḍavyūha Sūtra*:

"Noble son, bodhisattvas who are genuinely held by a spiritual mentor do not fall into lower realms. Bodhisattvas who are kept in mind by a spiritual mentor do not transgress the trainings of a bodhisattva. Bodhisattvas who are cared for by a spiritual mentor rise above the world. Bodhisattvas who venerate a spiritual mentor act without forgetfulness in all conduct. Bodhisattvas who are embraced by a spiritual mentor are difficult to overcome by karmas and afflictions. A spiritual mentor brings about the realization of what is to be done and what is not to be done. They genuinely turn one away from states of heedlessness. They deliver one from the city of saṃsāra.

"Noble son, therefore, with such continuous mindfulness, you must go into the presence of spiritual mentors: with a mind like the earth, so as never to grow weary from carrying every burden; with a mind like a vajra, so as to be indivisible; and [to endure] all suffering..."
````

**Annotations** (9)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | term | mark | “bodhisattva pratimokṣa” |  |
| 2 | definition | commentary | “bodhisattva pratimokṣa” | Individual Emancipation vow of a Bodhisattva |
| 3 | note | commentary | “the Householder Śrīgupta” | Tibetan: ཁྱིམ་བདག་དཔལ་བྱིན་གྱིས་ཞུས་པའི་མདོ, Śrīguptaparipṛcchā-sūtra |
| 4 | note | commentary | “Taught by Akṣayamati” | Tibetan: འཕགས་པ་བློ་གྲོས་མི་ཟད་པས་བསྟན་པའི་མདོ, Akṣayamatinirdeśa-sūtra |
| 5 | term | mark | “kalyāṇamitra” |  |
| 6 | definition | commentary | “kalyāṇamitra” | spiritual friend or virtuous guide |
| 7 | note | commentary | “the *Gaṇḍavyūha Sūtra” | Tibetan: སྡོང་པོ་བཀོད་པའི་མདོ, Array of Stalks Sūtra |
| 8 | summary | page | *page* | This passage cites the Bodhisattva Pratimokṣa, the Śrīguptaparipṛcchā, and the Akṣayamatinirdeśa Sūtra on preserving the body for the Dharma |
| 9 | keywords | page | *page* | bodhisattva pratimoksha, bodily protection, benefit of others, Śrīgupta, Akṣayamati, spiritual mentor, kalyanamitra, Gandavyuha Sutra, mind  |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 33. Oedipus Aegyptiacus Vol II — p. 567 (script: Greek)

https://sourcelibrary.org/book/oedipus-aegyptiacus-tomus-ii-kircher/page/695273a1ab34727b1f049de6 · language Latin · prompt v2 · 4621 chars stored, 2422 in text · 14 annotations · scripts: Greek

**Raw `translation.data`**

````text
<meta>This page continues the alphabetical index for Kircher’s *Oedipus Aegyptiacus*, picking up at the end of the letter 'P' with the conclusion of the entry on Pyramids. It then moves through the letters 'Q' (focusing on the mathematical mysteries of magic squares), 'R' (dealing with cosmic wheels and Rabbinical traditions), and begins 'S' (covering Egyptian priesthood and sacred symbols).</meta>

# INDEX.

[the Pyramids'] architecture . . . 296
their size . . . Ibid. <note>original: "Ibidem," meaning in the same place.</note>
& following.
The hieroglyphic mysteries of the Pyramid. 109
The Pythagorean problem seems to have been taken from the Egyptians . . . 26 <note>Kircher argues that the famous Pythagorean theorem (a² + b² = c²) originated in Egyptian geometric wisdom.</note>

## Q

**Q**uadrangle: what it denotes. 103
The use of the quadrant in calculating hours among the Egyptians. 229
Cubic squares, and their arrangement. 67. & seqq.
The mysteries of square numbers. 44
Which ones are dedicated to which Gods . . . 45
Their production . . . Ibid.
Their arrangement . . . 46
The square of Saturn . . . 46
of Jupiter . . . 47
of Mars . . . Ibid.
of the Sun . . . 48
of Venus . . . 49
of Mercury . . . Ibid.
of the Moon . . . 50 <note>These entries refer to "magic squares"—grids of numbers where every row and column adds up to the same sum—which Kircher associated with planetary influences.</note>
The square from the number two is imperfect. 51
How the square of three is arranged . . . Ibid.
Likewise the square of four . . . 56
of five . . . 58
of six . . . 60. 61
of seven . . . 62
of eight . . . 64
of nine . . . 67
The Mathematical Quadrivium . . . 4 <note>The "four ways" or higher division of the liberal arts: Arithmetic, Geometry, Music, and Astronomy.</note>
The fifth essence of things. 372 <note>The "quintessence," a pure, celestial element beyond the four earthly elements of earth, air, fire, and water.</note>
"Anything in anything": how it occurs. 528 <note>original: "Quodlibet in quolibet." A philosophical principle suggesting that every part of the universe contains the essence of the whole.</note>

## R

**R**abbinical blasphemy against Christ . . . 477
against the Eucharist . . . 478

Things of Saturn . . . 366
Things of Jupiter . . . Ibid.
Things of Mars . . . 367
Things of the Sun . . . Ibid.
Things of Venus . . . Ibid.
Things of Mercury . . . 368
Things of the Moon . . . Ibid. <note>In the "Great Chain of Being," Kircher categorized plants, mi
… [2121 more characters]
````

**Clean `translation.text`**

````text
# INDEX.

[the Pyramids'] architecture . . . 296
their size . . . Ibid.
& following.
The hieroglyphic mysteries of the Pyramid. 109
The Pythagorean problem seems to have been taken from the Egyptians . . . 26

## Q

**Q**uadrangle: what it denotes. 103
The use of the quadrant in calculating hours among the Egyptians. 229
Cubic squares, and their arrangement. 67. & seqq.
The mysteries of square numbers. 44
Which ones are dedicated to which Gods . . . 45
Their production . . . Ibid.
Their arrangement . . . 46
The square of Saturn . . . 46
of Jupiter . . . 47
of Mars . . . Ibid.
of the Sun . . . 48
of Venus . . . 49
of Mercury . . . Ibid.
of the Moon . . . 50
The square from the number two is imperfect. 51
How the square of three is arranged . . . Ibid.
Likewise the square of four . . . 56
of five . . . 58
of six . . . 60. 61
of seven . . . 62
of eight . . . 64
of nine . . . 67
The Mathematical Quadrivium . . . 4
The fifth essence of things. 372
"Anything in anything": how it occurs. 528

## R

**R**abbinical blasphemy against Christ . . . 477
against the Eucharist . . . 478

Things of Saturn . . . 366
Things of Jupiter . . . Ibid.
Things of Mars . . . 367
Things of the Sun . . . Ibid.
Things of Venus . . . Ibid.
Things of Mercury . . . 368
Things of the Moon . . . Ibid.
The chronological wheel according to the Egyptian mindset. 265
The divining wheel of the Hebrews from Hebrew letters . . . 471
of the Egyptians . . . 472
Turning wheels producing the water necessary for purification rituals . . . 536
A turning wheel displaying the ritual dances of the Gods . . . 537
The wheel of life & death . . . 491
Its structure . . . Ibid.
Its use . . . 492
Its refutation . . . Ibid.

## S

**S**Aa. . . 217
Egyptian priests, who prayed with rituals . . . 152
They sought after sacrificial rites. Ibid.
They used to threaten the Gods . . . Ibid.
They thought that the Spirits feared men who were worshipers.
Egyptian priests invoked darkness upon a supplicant God . . . 506
The Cabalistic seal of Solomon. 477
The salt of individual Planets and metals . . . 411
The method of dragging stones among the Egyptians. 513
The sun-dial bowl of the Egyptians. 229
The hieroglyphic of the Scarab. It denotes the Chymical art . . . 405
A diagram of the order of things and of the Worlds, and its explanation . . . 15. & seqq.
The use of secret message-sticks . . . 31
Semiramis erected three enormous statues . . . 390
````

**Annotations** (14)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the alphabetical index for Kircher’s *Oedipus Aegyptiacus*, picking up at the end of the letter 'P' with the conclusion  |
| 2 | original | commentary | “size . . . Ibid” | original: "Ibidem," meaning in the same place. |
| 3 | note | commentary | “. . 26” | Kircher argues that the famous Pythagorean theorem (a² + b² = c²) originated in Egyptian geometric wisdom. |
| 4 | note | commentary | “Moon . . . 50” | These entries refer to "magic squares"—grids of numbers where every row and column adds up to the same sum—which Kircher associated with pla |
| 5 | note | commentary | “Quadrivium . . . 4” | The "four ways" or higher division of the liberal arts: Arithmetic, Geometry, Music, and Astronomy. |
| 6 | note | commentary | “of things. 372” | The "quintessence," a pure, celestial element beyond the four earthly elements of earth, air, fire, and water. |
| 7 | original | commentary | “it occurs. 528” | original: "Quodlibet in quolibet." A philosophical principle suggesting that every part of the universe contains the essence of the whole. |
| 8 | note | commentary | “Moon . . . Ibid” | In the "Great Chain of Being," Kircher categorized plants, minerals, and animals according to the planet they were thought to be governed by |
| 9 | original | commentary | “sacrificial rites. Ibid” | original: θυηπολίας (thuyēpolias), referring to the act of offering burnt sacrifices. |
| 10 | original | commentary | “who were worshipers” | original: λάτρεις (latreis), meaning servants or religious devotees. |
| 11 | note | commentary | “. . 405” | Kircher identifies the Egyptian dung beetle (scarab) as a symbol for the alchemical process of transformation. |
| 12 | original | commentary | “. . 31” | original: "Scytalae." Ancient devices used for cryptography. |
| 13 | summary | page | *page* | This index page provides a finding aid for Kircher's investigations into planetary magic squares, the Egyptian origins of geometry, and the  |
| 14 | keywords | page | *page* | Pyramids, magic squares, planetary gods, Quadrivium, quintessence, chronological wheels, Egyptian priests, scarabs, alchemy, Solomon's seal |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 34. Stri Jataka — p. 179 (script: Devanagari)

https://sourcelibrary.org/book/female-horoscopy-stri-jataka-publishers/page/699068e42e4efe9106769d1a · language Sanskrit · prompt v2 · 3034 chars stored, 1778 in text · 16 annotations · scripts: Devanagari, combining

**Raw `translation.data`**

````text
<meta>This page continues the astrological analysis of Venus (Shukra) in various houses of a woman's birth chart, following the discussion of the fourth house on the previous page.</meta>

<page-num>155</page-num>
<header>With Hindi Commentary</header>

...always the leader within her own lineage. ||65||
**Meaning—** The woman at whose birth **Venus** is seated in the **fifth house** <note>The house of children and intelligence</note> will certainly be endowed with prosperity, many daughters, and a beautiful form; she remains detached yet is always the leader among her kin. ||65||

### Now, the result of Venus situated in the sixth house

When Venus is placed in the house of enemies, it makes a woman foremost in jealousy, filled with great anger, possessing a fierce temperament, one who has conquered the ranks of her enemies, but is always neglected by her husband and sons. ||66||
**Meaning—** The woman at whose birth **Venus** is located in the **sixth house** <note>The house of enemies, debt, and disease</note> is chief among those who bear malice, is very wrathful, and has a sharp nature. Although she defeats her enemies, she is always treated with disrespect by her husband, children, and family. ||66||

### Now, the result of Venus situated in the seventh house

The <term>Preceptor of the Daityas</term> <note>original: "Daitya-guru" — a title for Venus/Shukra, who in mythology is the teacher of the Titans</note> situated in the house of the spouse produces a woman of great power and wealth, beloved by her husband, devoted to the <term>Shastras</term> <note>Sacred scriptures or sciences</note>, bold, a benefactor to the <term>Brahmins</term> <note>The priestly/scholarly class</note>, and dear to the people. ||67||
**Meaning—** The woman at whose birth <note>The printed text reads 'अष्टमभवन' (8th house) here, which appears to be a clerical error as the heading and verse refer to the 7th house (सप्तम/कलत्र).</note> Venus is located in the **seventh house** <note>The house of marriage and partnerships</note> is possessed of the influence of great wealth, is dear to her husband, diligent in the scriptures, confident, does good for the priestly class, and is liked by all people. ||67||

### Now, the result of Venus situated in the eighth house

Venus in the eighth house makes a woman intoxicated with pride, sorrowful, deprived of riches, devoid of compassion, distressed by the deception of others, wearing dirty clothes, and abandoned by righteousness. ||68||
… [534 more characters]
````

**Clean `translation.text`**

````text
...always the leader within her own lineage. ||65||
**Meaning—** The woman at whose birth **Venus** is seated in the **fifth house** will certainly be endowed with prosperity, many daughters, and a beautiful form; she remains detached yet is always the leader among her kin. ||65||

### Now, the result of Venus situated in the sixth house

When Venus is placed in the house of enemies, it makes a woman foremost in jealousy, filled with great anger, possessing a fierce temperament, one who has conquered the ranks of her enemies, but is always neglected by her husband and sons. ||66||
**Meaning—** The woman at whose birth **Venus** is located in the **sixth house** is chief among those who bear malice, is very wrathful, and has a sharp nature. Although she defeats her enemies, she is always treated with disrespect by her husband, children, and family. ||66||

### Now, the result of Venus situated in the seventh house

The Preceptor of the Daityas situated in the house of the spouse produces a woman of great power and wealth, beloved by her husband, devoted to the Shastras, bold, a benefactor to the Brahmins, and dear to the people. ||67||
**Meaning—** The woman at whose birth Venus is located in the **seventh house** is possessed of the influence of great wealth, is dear to her husband, diligent in the scriptures, confident, does good for the priestly class, and is liked by all people. ||67||

### Now, the result of Venus situated in the eighth house

Venus in the eighth house makes a woman intoxicated with pride, sorrowful, deprived of riches, devoid of compassion, distressed by the deception of others, wearing dirty clothes, and abandoned by righteousness. ||68||
**Meaning—** The woman at whose birth **Venus** is located in the **eighth house** is...
````

**Annotations** (16)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the astrological analysis of Venus (Shukra) in various houses of a woman's birth chart, following the discussion of the  |
| 2 | pagedata | page | *page* | 155 |
| 3 | pagedata | page | *page* | With Hindi Commentary |
| 4 | note | commentary | “the **fifth house” | The house of children and intelligence |
| 5 | note | commentary | “the **sixth house” | The house of enemies, debt, and disease |
| 6 | term | mark | “Preceptor of the Daityas” |  |
| 7 | definition | commentary | “Preceptor of the Daityas” | original: "Daitya-guru" — a title for Venus/Shukra, who in mythology is the teacher of the Titans |
| 8 | term | mark | “Shastras” |  |
| 9 | definition | commentary | “Shastras” | Sacred scriptures or sciences |
| 10 | term | mark | “Brahmins” |  |
| 11 | definition | commentary | “Brahmins” | The priestly/scholarly class |
| 12 | note | commentary | “**Meaning—** The woman at whose birth” | The printed text reads 'अष्टमभवन' (8th house) here, which appears to be a clerical error as the heading and verse refer to the 7th house (सप |
| 13 | note | commentary | “the **seventh house” | The house of marriage and partnerships |
| 14 | note | commentary | “the **eighth house” | The house of longevity and hidden things |
| 15 | summary | page | *page* | This page details the astrological effects of the planet Venus (Shukra) when positioned in the fifth, sixth, seventh, and eighth houses of a |
| 16 | keywords | page | *page* | Venus, Shukra, Astrology, Fifth House, Sixth House, Seventh House, Eighth House, Women's Horoscopes, Jyotish, Shastras |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 35. Полное собрание сочинений Ф.М. Достоевского, Т. 11: Дневник писателя — p. 87 (script: Cyrillic)

https://sourcelibrary.org/book/11-dostoevsky/page/69af3c17e2921802c6c77be5 · language Russian · prompt v10 · 2480 chars stored, 2211 in text · 5 annotations · scripts: Cyrillic

**Raw `translation.data`**

````text
# POOR FOLK.

<note>original: "БѢДНЫЕ ЛЮДИ."</note>

...waters—you are already there; you stand before me, preening yourself, and keep looking into my eyes, as if you were showing me your own possessions. This proves that you have a kind heart, Makar Alexeyevich. That is why I love you. Well, goodbye. I am ill again today: I got my feet wet yesterday and caught a cold because of it; Fedora is also sick with something, so we are both ailing now. Do not forget me, visit more often.

->Yours<-
->*V. D.*<-

->June 12.<-

<meta>An ornamental drop cap 'Г' [G] decorated with floral patterns and leaves.</meta>

My dear, Varvara Alexeyevna!

And I thought, my dear, that you would describe all of yesterday to me in real verse, but you ended up with just one simple little sheet. I say this because, although you wrote little to me in your note, you described it all unusually well and sweetly. Both nature, and the various rural scenes, and everything else concerning feelings—in a word, you described it all very well. But I have no talent for it. Even if I scribbled ten pages, nothing comes of it, I cannot describe anything. I have already tried. You write to me, my dear, that I am a kind man, not malicious, incapable of harming my neighbor, and that I understand the goodness of the Lord as manifested in nature, and, finally, you bestow various praises upon me. All this is true, my dear, all this is absolute truth; I am indeed as you say, and I know it myself; but as one reads what you write, one's heart softens involuntarily, and then various heavy thoughts arise. But listen to me, my dear, I will tell you something, my own dear.

I will begin with the fact that I was only seventeen years old when I entered service, and my service career will soon hit thirty years. Well, there is nothing to say, I have worn out enough service coats <term>vits-mundir</term> <gloss>a formal frock coat or uniform worn by Russian civil servants</gloss>; I have matured, become wiser, seen people; I have lived, I can say that I have lived in this world, so much so that they even wanted to present me for a cross <note>referring to a medal or order of merit</note> once. You might not believe it, but I am truly not lying to you. And what of it, my dear—there were wicked people for all of this! But I will tell you, my dear, that although I am an obscure man, a foolish man perhaps, my heart is just the same as anyone else's. So do you know, Varinka, what that wicked man did...
````

**Clean `translation.text`**

````text
# POOR FOLK.

...waters—you are already there; you stand before me, preening yourself, and keep looking into my eyes, as if you were showing me your own possessions. This proves that you have a kind heart, Makar Alexeyevich. That is why I love you. Well, goodbye. I am ill again today: I got my feet wet yesterday and caught a cold because of it; Fedora is also sick with something, so we are both ailing now. Do not forget me, visit more often.

->Yours<-
->*V. D.*<-

->June 12.<-

My dear, Varvara Alexeyevna!

And I thought, my dear, that you would describe all of yesterday to me in real verse, but you ended up with just one simple little sheet. I say this because, although you wrote little to me in your note, you described it all unusually well and sweetly. Both nature, and the various rural scenes, and everything else concerning feelings—in a word, you described it all very well. But I have no talent for it. Even if I scribbled ten pages, nothing comes of it, I cannot describe anything. I have already tried. You write to me, my dear, that I am a kind man, not malicious, incapable of harming my neighbor, and that I understand the goodness of the Lord as manifested in nature, and, finally, you bestow various praises upon me. All this is true, my dear, all this is absolute truth; I am indeed as you say, and I know it myself; but as one reads what you write, one's heart softens involuntarily, and then various heavy thoughts arise. But listen to me, my dear, I will tell you something, my own dear.

I will begin with the fact that I was only seventeen years old when I entered service, and my service career will soon hit thirty years. Well, there is nothing to say, I have worn out enough service coats vits-mundir; I have matured, become wiser, seen people; I have lived, I can say that I have lived in this world, so much so that they even wanted to present me for a cross once. You might not believe it, but I am truly not lying to you. And what of it, my dear—there were wicked people for all of this! But I will tell you, my dear, that although I am an obscure man, a foolish man perhaps, my heart is just the same as anyone else's. So do you know, Varinka, what that wicked man did...
````

**Annotations** (5)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | original | commentary | “” | original: "БѢДНЫЕ ЛЮДИ." |
| 2 | meta | page | *page* | An ornamental drop cap 'Г' [G] decorated with floral patterns and leaves. |
| 3 | term | mark | “vits-mundir” |  |
| 4 | definition | commentary | “vits-mundir” | a formal frock coat or uniform worn by Russian civil servants |
| 5 | note | commentary | “for a cross” | referring to a medal or order of merit |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 36. Instruction à la France sur la verité de l'histoire des frères de la Roze-Croix — p. 20 (script: combining)

https://sourcelibrary.org/book/instruction-to-france-on-the-truth-of-the-history-of-the-naude/page/697e27c65ac4b1bfa22baed6 · language French · prompt v2 · 2835 chars stored, 1281 in text · 11 annotations · scripts: combining

**Raw `translation.data`**

````text
<meta>This page continues the "To the Reader" preface. It transitions from the author's internal conflict and feelings of inadequacy to his resolution, inspired by Seneca, to write a definitive account debunking the Rosicrucian "Chimera."</meta>

->### TO THE READER.<-

from my studies the fruits of such erudition that I judged necessary to combat this Chimera <note>A 'Chimera' refers to a monstrous, mythical illusion or a groundless fancy; here, the author uses it to describe the Rosicrucian rumors as a fabrication.</note> and erroneous persuasion. This is why I utterly despaired of being able to give some testimony of my affection to *France*, until, to deliver myself from all these anxieties and irresolutions, I relied upon this judgment of *Seneca*: *"To achieve a sound mind, few books are needed"* <note>original Latin: "Paucis ad bonam mentem opus est literis." From Seneca’s *Moral Letters*, 106. The author uses this to justify his work despite his modest library or study.</note>; of whom I can say that it is truly he who gave me the boldness, through the truth of his maxim, to set pen to paper, to unseal the eyes of your understanding, to strike down the films <term>tayes</term> <note>a medical term of the era for a white spot or opaque membrane covering the eye, like a leucoma</note> and cataracts of falsehood, and to make you recognize the truth that you must follow to instruct yourself in the history of the Rosicrucians (as *Mr. Boucher* calls them in his *Mystical Crown* <note>Jean Boucher (1548–1644) was a prominent and controversial doctor of theology; his "Mystical Crown" was a contemporary religious work.</note>) or Brothers of the *Rose-Cross*. To effect this more easily, I judged it appropriate to draft this Preface <note>original: "Aduertiſſemēt" — an introductory notice or warning to the reader.</note> to facilitate your understanding of the entire discourse following, and to first advise you that regarding the name of this Society, Father *Garasse* <note>François Garasse (1585–1631) was a Jesuit polemicist famous for his 1623 attacks on "libertines" and the Rosicrucians.</note> has most happily of all conjectured the reasons that moved its Author to give it this title of *Rose-Cross*; persuading himself that he had wished to oblige them by this symbol of silence to live hidden and covered, and to keep the secret

<sig>ẽ</sig>

<summary>The author explains his decision to write against the Rosicrucian "Chimera," citing Seneca as his insp
… [335 more characters]
````

**Clean `translation.text`**

````text
->### TO THE READER.<-

from my studies the fruits of such erudition that I judged necessary to combat this Chimera and erroneous persuasion. This is why I utterly despaired of being able to give some testimony of my affection to *France*, until, to deliver myself from all these anxieties and irresolutions, I relied upon this judgment of *Seneca*: *"To achieve a sound mind, few books are needed"*; of whom I can say that it is truly he who gave me the boldness, through the truth of his maxim, to set pen to paper, to unseal the eyes of your understanding, to strike down the films tayes and cataracts of falsehood, and to make you recognize the truth that you must follow to instruct yourself in the history of the Rosicrucians (as *Mr. Boucher* calls them in his *Mystical Crown*) or Brothers of the *Rose-Cross*. To effect this more easily, I judged it appropriate to draft this Preface to facilitate your understanding of the entire discourse following, and to first advise you that regarding the name of this Society, Father *Garasse* has most happily of all conjectured the reasons that moved its Author to give it this title of *Rose-Cross*; persuading himself that he had wished to oblige them by this symbol of silence to live hidden and covered, and to keep the secret
````

**Annotations** (11)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the "To the Reader" preface. It transitions from the author's internal conflict and feelings of inadequacy to his resolu |
| 2 | note | commentary | “combat this Chimera” | A 'Chimera' refers to a monstrous, mythical illusion or a groundless fancy; here, the author uses it to describe the Rosicrucian rumors as a |
| 3 | note | commentary | “books are needed” | original Latin: "Paucis ad bonam mentem opus est literis." From Seneca’s *Moral Letters*, 106. The author uses this to justify his work desp |
| 4 | term | mark | “tayes” |  |
| 5 | definition | commentary | “tayes” | a medical term of the era for a white spot or opaque membrane covering the eye, like a leucoma |
| 6 | note | commentary | “his *Mystical Crown” | Jean Boucher (1548–1644) was a prominent and controversial doctor of theology; his "Mystical Crown" was a contemporary religious work. |
| 7 | original | commentary | “draft this Preface” | original: "Aduertiſſemēt" — an introductory notice or warning to the reader. |
| 8 | note | commentary | “Society, Father *Garasse” | François Garasse (1585–1631) was a Jesuit polemicist famous for his 1623 attacks on "libertines" and the Rosicrucians. |
| 9 | pagedata | page | *page* | ẽ |
| 10 | summary | page | *page* | The author explains his decision to write against the Rosicrucian "Chimera," citing Seneca as his inspiration to speak out despite his own d |
| 11 | keywords | page | *page* | Seneca, Rosicrucians, Rose-Cross, Jean Boucher, Father Garasse, 17th-century polemic, secret societies, Paris history |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 37. Papyrus inscribed with an account and a religious text (reign of Senwosret I) — p. 1 (script: astral)

https://sourcelibrary.org/book/papyrus-inscribed-with-an-account-and-a-religious-text-reign-of-senwosret-i/page/69e11b22918f5a3cda71f834 · language Egyptian hieroglyphs · prompt v11 · 3288 chars stored, 806 in text · 77 annotations · scripts: astral

**Raw `translation.data`**

````text
<note>A fragment of Egyptian papyrus depicts vertical columns of Hieratic script. This style of cursive writing was used for everyday documents, such as accounts and letters, rather than formal inscriptions on stone.</note>

### Fragment of an Account or Religious Registry
#### Reign of Senwosret I

<note>The following text is highly repetitive and appears to be a formal register or an administrative list of personnel and their titles, likely for a temple or a royal estate. Each entry follows a specific formula identifying the individuals by their name and office.</note>

**Column 1**
Controller <note>original: 𓐍𓂋𓊪</note>. The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>. The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>.

**Column 2**
The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>. The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>.

**Column 3**
The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>. The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>.

**Column 4**
The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>. The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>.

**Column 5**
The name is <term>Itf-Amen</term> <gloss>The Father of Amun</gloss>, <term>Imy-ra Per</term> <gloss>Overseer of the House</gloss>. The name is <term>Senty</term> <gloss>The Two Sisters</gloss>. The name is <term>Itf-Amen</term> <gloss>The Father of Amun</glo
… [788 more characters]
````

**Clean `translation.text`**

````text
### Fragment of an Account or Religious Registry
#### Reign of Senwosret I

**Column 1**
Controller. The name is Itf-Amen, Imy-ra Per. The name is Senty. The name is Itf-Amen, Imy-ra Per. The name is Senty.

**Column 2**
The name is Itf-Amen, Imy-ra Per. The name is Senty. The name is Itf-Amen, Imy-ra Per. The name is Senty.

**Column 3**
The name is Itf-Amen, Imy-ra Per. The name is Senty. The name is Itf-Amen, Imy-ra Per. The name is Senty.

**Column 4**
The name is Itf-Amen, Imy-ra Per. The name is Senty. The name is Itf-Amen, Imy-ra Per. The name is Senty.

**Column 5**
The name is Itf-Amen, Imy-ra Per. The name is Senty. The name is Itf-Amen, Imy-ra Per. The name is Senty.

**Column 6**
The name is Itf-Amen, Imy-ra Per. The name is Senty. The name is Itf-Amen, Imy-ra Per. The name is Senty.
````

**Annotations** (77)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | note | commentary | “” | A fragment of Egyptian papyrus depicts vertical columns of Hieratic script. This style of cursive writing was used for everyday documents, s |
| 2 | note | commentary | “” | The following text is highly repetitive and appears to be a formal register or an administrative list of personnel and their titles, likely  |
| 3 | original | commentary | “Controller” | original: 𓐍𓂋𓊪 |
| 4 | term | mark | “Itf-Amen” |  |
| 5 | definition | commentary | “Itf-Amen” | The Father of Amun |
| 6 | term | mark | “Imy-ra Per” |  |
| 7 | definition | commentary | “Imy-ra Per” | Overseer of the House |
| 8 | term | mark | “Senty” |  |
| 9 | definition | commentary | “Senty” | The Two Sisters |
| 10 | term | mark | “Itf-Amen” |  |
| 11 | definition | commentary | “Itf-Amen” | The Father of Amun |
| 12 | term | mark | “Imy-ra Per” |  |
| 13 | definition | commentary | “Imy-ra Per” | Overseer of the House |
| 14 | term | mark | “Senty” |  |
| 15 | definition | commentary | “Senty” | The Two Sisters |
| 16 | term | mark | “Itf-Amen” |  |
| 17 | definition | commentary | “Itf-Amen” | The Father of Amun |
| 18 | term | mark | “Imy-ra Per” |  |
| 19 | definition | commentary | “Imy-ra Per” | Overseer of the House |
| 20 | term | mark | “Senty” |  |
| 21 | definition | commentary | “Senty” | The Two Sisters |
| 22 | term | mark | “Itf-Amen” |  |
| 23 | definition | commentary | “Itf-Amen” | The Father of Amun |
| 24 | term | mark | “Imy-ra Per” |  |
| 25 | definition | commentary | “Imy-ra Per” | Overseer of the House |
| 26 | term | mark | “Senty” |  |
| 27 | definition | commentary | “Senty” | The Two Sisters |
| 28 | term | mark | “Itf-Amen” |  |
| 29 | definition | commentary | “Itf-Amen” | The Father of Amun |
| 30 | term | mark | “Imy-ra Per” |  |
| 31 | definition | commentary | “Imy-ra Per” | Overseer of the House |
| 32 | term | mark | “Senty” |  |
| 33 | definition | commentary | “Senty” | The Two Sisters |
| 34 | term | mark | “Itf-Amen” |  |
| 35 | definition | commentary | “Itf-Amen” | The Father of Amun |
| 36 | term | mark | “Imy-ra Per” |  |
| 37 | definition | commentary | “Imy-ra Per” | Overseer of the House |
| 38 | term | mark | “Senty” |  |
| 39 | definition | commentary | “Senty” | The Two Sisters |
| 40 | term | mark | “Itf-Amen” |  |

… 37 more

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 38. Thesaurus Graecae Linguae (vol. 3) — p. 280 (longest page)

https://sourcelibrary.org/book/thesaurus-graecae-linguae-vol-3-estienne/page/69b2f4110e2f024dfbfbaaeb · language Greek · prompt v10 · 15293 chars stored, 9141 in text · 204 annotations · scripts: Greek

**Raw `translation.data`**

````text
<meta>Continuity: This page continues the dictionary entries for Greek terms derived from the root πρέσβυς (elder/ambassador).</meta>

# Π Ρ Ε

According to Hesychius, <term>πρέσβης</term> <gloss>ambassador/elder</gloss> refers not only to <term>γέροντες</term> <gloss>old men</gloss>, but also to <term>βασιλεῖς</term> <gloss>kings</gloss>, <term>ἄρχοντες</term> <gloss>rulers</gloss>, and <term>θεσμοφύλακοι</term> <gloss>guardians of the law</gloss>. Thus, those to whom this honor and reverence, usually shown to old men, is extended are called <term>πρέσβεις</term> <gloss>ambassadors</gloss>. ¶ Regarding "Senator," it is cited from an Epigram. According to Hesychius, it is <term>ἀγορανόμος</term> <gloss>a market official</gloss>. ¶ According to the same Hesychius, <term>πρέσβις</term> <gloss>elder/small bird</gloss> is also used to refer to <term>ὄρνις ὁ τρόχιλος</term> <gloss>the wren</gloss>. Likewise, Aristotle in the *History of Animals*, book 9, chapter 11, writes about the wren: <term>καλεῖται δὲ πρέσβις καὶ βασιλεύς</term> <gloss>it is called both "elder" and "king"</gloss>. As Pliny also writes in book 8, chapter 25: "A small bird, which is there called the wren, [is called] the king of birds in Italy."

<margin>A</margin>
<term>FEMININE.</term> <term>Πρέσβειρα</term> <gloss>Elder/Venerable (female)</gloss>, old woman, ancient. As in: <term>θήλεια δὲ πρέσβειρα ἡμίσεια ἀπ’ ὤμους</term> <gloss>a female elder, half [of the way] from the shoulders</gloss>. From this, by syncope <note>the contraction of a word by omitting sounds or letters</note>, comes <term>Πρέσβα</term> <gloss>elder/venerable (female)</gloss>, like <term>πότνια</term> <gloss>mistress/queen</gloss> from <term>πότνια</term>. These are discussed in my old lexicon, where <term>πρέσβα</term> is explained as <term>ἡ γεγηρακυῖα, πρεσβυτάτη, ἐντιμοτάτη</term> <gloss>the aged one, the most elder, the most honored</gloss>. This is read in Homer’s *Iliad*, books 5 and 8: <term>Ἥρη πρέσβα θεὰ, θυγάτηρ μεγάλοιο Κρόνοιο</term> <gloss>Hera, ancient and venerable goddess, daughter of great Cronus</gloss>. Elsewhere he says <term>πότνια Ἥρη</term> <gloss>venerable Hera</gloss>. In *Iliad* 19: <term>Πρέσβα Διὸς θυγάτηρ ἄτη</term> <gloss>Venerable Atë, daughter of Zeus</gloss>. Hesychius also explains <term>πρέσβα</term> as <term>τιμιωτάτη, ἔντιμος, σεμνή</term> <gloss>most honored, esteemed, holy</gloss>: just as Eustathius also notes that <term>πρέσβα</term> is said of one who is venerable either by t
… [12793 more characters]
````

**Clean `translation.text`**

````text
# Π Ρ Ε

According to Hesychius, πρέσβης refers not only to γέροντες, but also to βασιλεῖς, ἄρχοντες, and θεσμοφύλακοι. Thus, those to whom this honor and reverence, usually shown to old men, is extended are called πρέσβεις. ¶ Regarding "Senator," it is cited from an Epigram. According to Hesychius, it is ἀγορανόμος. ¶ According to the same Hesychius, πρέσβις is also used to refer to ὄρνις ὁ τρόχιλος. Likewise, Aristotle in the *History of Animals*, book 9, chapter 11, writes about the wren: καλεῖται δὲ πρέσβις καὶ βασιλεύς. As Pliny also writes in book 8, chapter 25: "A small bird, which is there called the wren, [is called] the king of birds in Italy."

A
FEMININE. Πρέσβειρα, old woman, ancient. As in: θήλεια δὲ πρέσβειρα ἡμίσεια ἀπ’ ὤμους. From this, by syncope, comes Πρέσβα, like πότνια from πότνια. These are discussed in my old lexicon, where πρέσβα is explained as ἡ γεγηρακυῖα, πρεσβυτάτη, ἐντιμοτάτη. This is read in Homer’s *Iliad*, books 5 and 8: Ἥρη πρέσβα θεὰ, θυγάτηρ μεγάλοιο Κρόνοιο. Elsewhere he says πότνια Ἥρη. In *Iliad* 19: Πρέσβα Διὸς θυγάτηρ ἄτη. Hesychius also explains πρέσβα as τιμιωτάτη, ἔντιμος, σεμνή: just as Eustathius also notes that πρέσβα is said of one who is venerable either by time or by honor. From the same, some think Πρέσβια is the origin of Πρέσβεια, which has the same meaning as πρέσβα, such as πρέσβειρα Ἥρη in Homer. Also cited is πρέσβειρα Ἐριννύων for the first-born of the Furies.

B
COMPARATIVE. Πρεσβύτερος, senior, older in age, greater by birth. Xenophon, *Hellenica* 4: "Pharnabazus spoke first, for he was the elder." To this is opposed νεώτερος, younger in age. Plutarch: "He is now an elder, but was a younger [man] when at the oracle." Regarding a man, Aristophanes in *The Frogs*: "I am departing, more than thirty years plus twenty." Aeschines, *On the False Embassy*: πρεσβύτεροι ταῖς ἡλικίαις. Usually, οἱ πρεσβύτεροι are those whose age is already verging toward old age. Indeed, they are opposed sometimes to οἱ νεώτεροι, and sometimes to οἱ ἀκμάζοντες. Aristotle, *Rhetoric* 2: "the elders or those past their prime." Isocrates, *On the Peace*: "I am amazed at the elders if they no longer remember any of the agricultural exercises." Aristotle: "For the young are courageous and intemperate, but the elders are cowardly and prudent." Plutarch, *Lycurgus*: "They commanded [him] as one who was older." Plato, *Epistle 7*: "to the one who has fewer votes [compared] to the elders," i.e., veteran soldiers. And πρεσβύτερα δέν
… [6641 more characters]
````

**Annotations** (204)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | Continuity: This page continues the dictionary entries for Greek terms derived from the root πρέσβυς (elder/ambassador). |
| 2 | term | mark | “πρέσβης” |  |
| 3 | definition | commentary | “πρέσβης” | ambassador/elder |
| 4 | term | mark | “γέροντες” |  |
| 5 | definition | commentary | “γέροντες” | old men |
| 6 | term | mark | “βασιλεῖς” |  |
| 7 | definition | commentary | “βασιλεῖς” | kings |
| 8 | term | mark | “ἄρχοντες” |  |
| 9 | definition | commentary | “ἄρχοντες” | rulers |
| 10 | term | mark | “θεσμοφύλακοι” |  |
| 11 | definition | commentary | “θεσμοφύλακοι” | guardians of the law |
| 12 | term | mark | “πρέσβεις” |  |
| 13 | definition | commentary | “πρέσβεις” | ambassadors |
| 14 | term | mark | “ἀγορανόμος” |  |
| 15 | definition | commentary | “ἀγορανόμος” | a market official |
| 16 | term | mark | “πρέσβις” |  |
| 17 | definition | commentary | “πρέσβις” | elder/small bird |
| 18 | term | mark | “ὄρνις ὁ τρόχιλος” |  |
| 19 | definition | commentary | “ὄρνις ὁ τρόχιλος” | the wren |
| 20 | term | mark | “καλεῖται δὲ πρέσβις καὶ βασιλεύς” |  |
| 21 | definition | commentary | “καλεῖται δὲ πρέσβις καὶ βασιλεύς” | it is called both "elder" and "king" |
| 22 | margin | mark | “A” |  |
| 23 | term | mark | “FEMININE.” |  |
| 24 | term | mark | “Πρέσβειρα” |  |
| 25 | definition | commentary | “Πρέσβειρα” | Elder/Venerable (female) |
| 26 | term | mark | “θήλεια δὲ πρέσβειρα ἡμίσεια ἀπ’ ὤμους” |  |
| 27 | definition | commentary | “θήλεια δὲ πρέσβειρα ἡμίσεια ἀπ’ ὤμους” | a female elder, half [of the way] from the shoulders |
| 28 | note | commentary | “this, by syncope” | the contraction of a word by omitting sounds or letters |
| 29 | term | mark | “Πρέσβα” |  |
| 30 | definition | commentary | “Πρέσβα” | elder/venerable (female) |
| 31 | term | mark | “πότνια” |  |
| 32 | definition | commentary | “πότνια” | mistress/queen |
| 33 | term | mark | “πότνια” |  |
| 34 | term | mark | “πρέσβα” |  |
| 35 | term | mark | “ἡ γεγηρακυῖα, πρεσβυτάτη, ἐντιμοτάτη” |  |
| 36 | definition | commentary | “ἡ γεγηρακυῖα, πρεσβυτάτη, ἐντιμοτάτη” | the aged one, the most elder, the most honored |
| 37 | term | mark | “Ἥρη πρέσβα θεὰ, θυγάτηρ μεγάλοιο Κρόνοιο” |  |
| 38 | definition | commentary | “Ἥρη πρέσβα θεὰ, θυγάτηρ μεγάλοιο Κρόνοιο” | Hera, ancient and venerable goddess, daughter of great Cronus |
| 39 | term | mark | “πότνια Ἥρη” |  |
| 40 | definition | commentary | “πότνια Ἥρη” | venerable Hera |

… 164 more

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 39. Les mécaniques ou L'élévateur de Héron (Carra de Vaux 1894) — p. 43 (word ledger not even)

https://sourcelibrary.org/book/les-mecaniques-ou-l-elevateur-de-heron-carra-de-vaux-1894-trans/page/695aa9bfbe4023bd34bd6dac · language French · prompt v2 · 3134 chars stored, 1346 in text · 20 annotations · scripts: Greek

**Raw `translation.data`**

````text
<meta>This page continues the scholarly analysis of Hero of Alexandria’s sources. While the previous page (numbered 17 in the provided context) discussed Hero’s connection to Apollonius and Pappus, this page (numbered 29) concludes the introduction by identifying references to Poseidonius and Philo, while acknowledging the difficulties of working with corrupted manuscripts.</meta>

<page-num>29</page-num>

“...they remain in such a way that the point of suspension and the center of gravity of the suspended object are placed on the perpendicular. For this too has been demonstrated.” <note>original Latin: "ita manent, ut punctum suspendii et centrum gravitatis suspensi in perpendiculari posita sint. Nam hoc quoque demonstratum est"</note> Heiberg <note>Johan Ludvig Heiberg (1854–1928), a Danish philologist and historian of mathematics who rediscovered many of Archimedes' works.</note> adds: “without doubt in the book <term>On Balances</term> <note>original Greek: *Περὶ ζυγῶν* (Peri zygon)</note>.” We agree with his opinion.

The doubtful name¹ to which we have alluded appears to be that of the famous Stoic philosopher <term>Poseidonius</term>² <note>Poseidonius of Rhodes (c. 135–51 BC), a polymath who studied everything from astronomy to history.</note>. <term>Hero</term> attributes to him a definition of the center of gravity, which he compares to the one given by <term>Archimedes</term>. This citation made by the author of the <term>Mechanics</term> would be a new element for determining his age <note>Scholars use these citations to narrow down when Hero lived, as he must have lived after the authors he quotes.</note>. Unfortunately, the text is quite obscure in this passage.

We would venture even further into the unknown if we recalled the names of <term>Philo</term> <note>Philo of Byzantium, an earlier Greek engineer who wrote on artillery and pneumatics.</note> or other more obscure mechanicians who have a part in <term>Hero’s</term> work, but to whom we cannot do exact justice, given our very incomplete knowledge of their work.

In concluding these remarks, we wish to express our gratitude to the management of the *Asiatic Journal* <note>original French: *Journal asiatique*</note> to whom we are indebted for the printing of our work; we must also ask the indulgence of scholars for the numerous imperfections they will find in this publication: They should not all be attributed to us. We were dealing with a text that was too often incorrect that—

---
¹
… [634 more characters]
````

**Clean `translation.text`**

````text
“...they remain in such a way that the point of suspension and the center of gravity of the suspended object are placed on the perpendicular. For this too has been demonstrated.” Heiberg adds: “without doubt in the book On Balances.” We agree with his opinion.

The doubtful name¹ to which we have alluded appears to be that of the famous Stoic philosopher Poseidonius². Hero attributes to him a definition of the center of gravity, which he compares to the one given by Archimedes. This citation made by the author of the Mechanics would be a new element for determining his age. Unfortunately, the text is quite obscure in this passage.

We would venture even further into the unknown if we recalled the names of Philo or other more obscure mechanicians who have a part in Hero’s work, but to whom we cannot do exact justice, given our very incomplete knowledge of their work.

In concluding these remarks, we wish to express our gratitude to the management of the *Asiatic Journal* to whom we are indebted for the printing of our work; we must also ask the indulgence of scholars for the numerous imperfections they will find in this publication: They should not all be attributed to us. We were dealing with a text that was too often incorrect that—

---
¹ *Mechanics*, Book I, 24.
² We owe to Mr. Clermont-Ganneau this very probable reading.
````

**Annotations** (20)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | meta | page | *page* | This page continues the scholarly analysis of Hero of Alexandria’s sources. While the previous page (numbered 17 in the provided context) di |
| 2 | pagedata | page | *page* | 29 |
| 3 | note | commentary | “has been demonstrated” | original Latin: "ita manent, ut punctum suspendii et centrum gravitatis suspensi in perpendiculari posita sint. Nam hoc quoque demonstratum  |
| 4 | note | commentary | “been demonstrated.” Heiberg” | Johan Ludvig Heiberg (1854–1928), a Danish philologist and historian of mathematics who rediscovered many of Archimedes' works. |
| 5 | term | mark | “On Balances” |  |
| 6 | definition | commentary | “On Balances” | original Greek: *Περὶ ζυγῶν* (Peri zygon) |
| 7 | term | mark | “Poseidonius” |  |
| 8 | note | commentary | “Stoic philosopher Poseidonius²” | Poseidonius of Rhodes (c. 135–51 BC), a polymath who studied everything from astronomy to history. |
| 9 | term | mark | “Hero” |  |
| 10 | term | mark | “Archimedes” |  |
| 11 | term | mark | “Mechanics” |  |
| 12 | note | commentary | “determining his age” | Scholars use these citations to narrow down when Hero lived, as he must have lived after the authors he quotes. |
| 13 | term | mark | “Philo” |  |
| 14 | definition | commentary | “Philo” | Philo of Byzantium, an earlier Greek engineer who wrote on artillery and pneumatics. |
| 15 | term | mark | “Hero’s” |  |
| 16 | note | commentary | “the *Asiatic Journal” | original French: *Journal asiatique* |
| 17 | term | mark | “Clermont-Ganneau” |  |
| 18 | definition | commentary | “Clermont-Ganneau” | Charles Simon Clermont-Ganneau (1846–1923), a French diplomat and archaeologist famous for his work on ancient inscriptions. |
| 19 | summary | page | *page* | The author concludes their introduction by identifying a potential reference to the philosopher Poseidonius in Hero's work and acknowledges  |
| 20 | keywords | page | *page* | Hero of Alexandria, Poseidonius, Archimedes, center of gravity, Philo of Byzantium, On Balances, mechanics, Greek mathematics, manuscript tr |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 40. Pal. gr. 108: Greek lexicon — p. 105 (word ledger not even)

https://sourcelibrary.org/book/greek-glossary-pal-gr-108-anonymous/page/69942f45b2f6748db4ac018a · language Greek · prompt v1 · 2079 chars stored, 1834 in text · 15 annotations · scripts: Latin only

**Raw `translation.data`**

````text
Passives through <gloss>ai</gloss> [and] i. <insert>ai</insert> These are: *pinō* [I drink]; *krinō* [I judge]; *klinō* [I incline]; *sinomai* [meaning] I harm, from which *sinos* [is] the harm; *orinō* [meaning] I rouse; *tinō* [meaning] I repay, and with the <gloss>k</gloss> prefix, *<unclear>ek</unclear>tinō*; *ōdinō* [meaning] I am in labor; *phthinō* [meaning] I perish; and others. <insert>T</insert>he following are through the <gloss>ei</gloss> diphthong: <gloss>ei</gloss> *ktainō* [meaning] I slay; *teinō* [meaning] I stretch and I look toward; *aleiphō* [meaning] I squeeze out; *oreinō* [meaning] I rouse; *phainō* [meaning] I shine; *geinō* [meaning] I beget; *geinō* [meaning] I cover, whence the "leaf-covered mountain," that which is shaded by leaves; and *peinō* [meaning] I hunger. <margin>inō</margin> But *peinō*, insofar as it means "to starve," is through <gloss>ō</gloss>; *pinō* [meaning] I am filthy; *dinō* [meaning] I whirl and move, with i; *tithenō* [meaning] I nourish, with i. <insert>ē</insert> *kinō* [meaning] I leap, with ē; these are customary in Doric. And otherwise: those beginning from the <gloss>ti</gloss> syllable are conjugated through <gloss>i</gloss>; and *tinō* through i; and the *namai*... <unclear>dia</unclear>. Through <gloss>i</gloss> are these: *piptō* [I fall]; *pissō* [I pound]; *pistō* [meaning] I believe; and in addition to these, *potēros*; *piptō*; *pissa* [meaning] the sow, from which [comes] *pissazein* [to act like a sow]; *pinos*, a marine creature; *pinos* [meaning] the filth; *pinō* [meaning] I am filthy; *pinō* [I drink]; *piomai* [I shall drink]; *pietai* [he shall drink]; *pithēkos* [ape]; *pithēkios* [apish]; *pikros* [bitter]; *pityron* [bran]; *pitys* the plant; *pilon*, the conical [hat] and the *pilon* [felt]; *ptainō* [meaning] I sift; *pion* [meaning] the fat; *pisaō*; *pisis*; *Pissa* the mountain; *pithos* [jar]; the *thaknon*, a small *pithos*; *pithoigia*, the opening of the <unclear>pi</unclear>thoi; *pynytos* [meaning] the wise; *pissō* [meaning] I trust; *pynyskō* [I make wise].
````

**Clean `translation.text`**

````text
Passives through ai [and] i. ai These are: *pinō* [I drink]; *krinō* [I judge]; *klinō* [I incline]; *sinomai* [meaning] I harm, from which *sinos* [is] the harm; *orinō* [meaning] I rouse; *tinō* [meaning] I repay, and with the k prefix, *ektinō*; *ōdinō* [meaning] I am in labor; *phthinō* [meaning] I perish; and others. The following are through the ei diphthong: ei *ktainō* [meaning] I slay; *teinō* [meaning] I stretch and I look toward; *aleiphō* [meaning] I squeeze out; *oreinō* [meaning] I rouse; *phainō* [meaning] I shine; *geinō* [meaning] I beget; *geinō* [meaning] I cover, whence the "leaf-covered mountain," that which is shaded by leaves; and *peinō* [meaning] I hunger. inō But *peinō*, insofar as it means "to starve," is through ō; *pinō* [meaning] I am filthy; *dinō* [meaning] I whirl and move, with i; *tithenō* [meaning] I nourish, with i. ē *kinō* [meaning] I leap, with ē; these are customary in Doric. And otherwise: those beginning from the ti syllable are conjugated through i; and *tinō* through i; and the *namai*... dia. Through i are these: *piptō* [I fall]; *pissō* [I pound]; *pistō* [meaning] I believe; and in addition to these, *potēros*; *piptō*; *pissa* [meaning] the sow, from which [comes] *pissazein* [to act like a sow]; *pinos*, a marine creature; *pinos* [meaning] the filth; *pinō* [meaning] I am filthy; *pinō* [I drink]; *piomai* [I shall drink]; *pietai* [he shall drink]; *pithēkos* [ape]; *pithēkios* [apish]; *pikros* [bitter]; *pityron* [bran]; *pitys* the plant; *pilon*, the conical [hat] and the *pilon* [felt]; *ptainō* [meaning] I sift; *pion* [meaning] the fat; *pisaō*; *pisis*; *Pissa* the mountain; *pithos* [jar]; the *thaknon*, a small *pithos*; *pithoigia*, the opening of the pithoi; *pynytos* [meaning] the wise; *pissō* [meaning] I trust; *pynyskō* [I make wise].
````

**Annotations** (15)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | gloss | mark | “ai” |  |
| 2 | insert | mark | “ai” |  |
| 3 | gloss | mark | “k” |  |
| 4 | unclear | mark | “ek” |  |
| 5 | insert | mark | “T” |  |
| 6 | gloss | mark | “ei” |  |
| 7 | gloss | mark | “ei” |  |
| 8 | margin | mark | “inō” |  |
| 9 | gloss | mark | “ō” |  |
| 10 | insert | mark | “ē” |  |
| 11 | gloss | mark | “ti” |  |
| 12 | gloss | mark | “i” |  |
| 13 | unclear | mark | “dia” |  |
| 14 | gloss | mark | “i” |  |
| 15 | unclear | mark | “pi” |  |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

### 41. Bodleian Library MS. Auct. T. inf. 2. 7 — p. 17 (word ledger not even)

https://sourcelibrary.org/book/bodleian-library-ms-auct-t-inf-2-7-anonymous/page/69bfce738ab50eb88e8c85c8 · language Greek · prompt v10 · 1303 chars stored, 458 in text · 27 annotations · scripts: Latin only

**Raw `translation.data`**

````text
<column-break/>

<unclear>arom</unclear><gloss>a</gloss>
let him follow me:
<margin>From the according to Matthew</margin>
<meta>Ornate gold and blue decorative initial 'E' (epsilon) with red accents.</meta>The <term>Lord</term> <gloss>Kyrios</gloss> said to his
own disciples: If anyone
wishes to come after me,
let him deny
himself and take up his
<term>cross</term> <gloss>stauros</gloss>
and let him follow me. +
For whoever wishes to save his
soul will lose it; + but whoever
loses his
soul for the sake of
me will find it. +
For what is a man
profited, if he gains the whole
world
<note>A detailed illustration of a peacock in the lower right margin, rendered in blue, gold, and red, holding a decorative bar with hanging ornaments in its beak.</note>

<column-break/>

<note>The right-hand column of the original manuscript is only partially visible at the edge of the image and contains fragmentary text.</note>
<unclear>mst</unclear>
<unclear>amo</unclear>
<unclear>dox</unclear>
<unclear>ma</unclear>
<unclear>aut</unclear>
<unclear>tw</unclear>
<unclear>ta</unclear>
<unclear>tou</unclear>
<unclear>go</unclear>
<unclear>ta</unclear>
<unclear>tim</unclear>
<unclear>tha</unclear>
<unclear>ida</unclear>
<unclear>amo</unclear>
<unclear>th</unclear>
<unclear>e</unclear>
8
<unclear>sw</unclear>
````

**Clean `translation.text`**

````text
<column-break/>

aroma
let him follow me:
From the according to Matthew
The Lord said to his
own disciples: If anyone
wishes to come after me,
let him deny
himself and take up his
cross
and let him follow me. +
For whoever wishes to save his
soul will lose it; + but whoever
loses his
soul for the sake of
me will find it. +
For what is a man
profited, if he gains the whole
world
<column-break/>

mst
amo
dox
ma
aut
tw
ta
tou
go
ta
tim
tha
ida
amo
th
e
8
sw
````

**Annotations** (27)

| # | type | kind | anchor phrase (exact) | body |
|---|---|---|---|---|
| 1 | unclear | mark | “arom” |  |
| 2 | gloss | mark | “a” |  |
| 3 | margin | mark | “From the according to Matthew” |  |
| 4 | meta | page | *page* | Ornate gold and blue decorative initial 'E' (epsilon) with red accents. |
| 5 | term | mark | “Lord” |  |
| 6 | definition | commentary | “Lord” | Kyrios |
| 7 | term | mark | “cross” |  |
| 8 | definition | commentary | “cross” | stauros |
| 9 | note | commentary | “” | A detailed illustration of a peacock in the lower right margin, rendered in blue, gold, and red, holding a decorative bar with hanging ornam |
| 10 | note | commentary | “” | The right-hand column of the original manuscript is only partially visible at the edge of the image and contains fragmentary text. |
| 11 | unclear | mark | “mst” |  |
| 12 | unclear | mark | “amo” |  |
| 13 | unclear | mark | “dox” |  |
| 14 | unclear | mark | “ma” |  |
| 15 | unclear | mark | “aut” |  |
| 16 | unclear | mark | “tw” |  |
| 17 | unclear | mark | “ta” |  |
| 18 | unclear | mark | “tou” |  |
| 19 | unclear | mark | “go” |  |
| 20 | unclear | mark | “ta” |  |
| 21 | unclear | mark | “tim” |  |
| 22 | unclear | mark | “tha” |  |
| 23 | unclear | mark | “ida” |  |
| 24 | unclear | mark | “amo” |  |
| 25 | unclear | mark | “th” |  |
| 26 | unclear | mark | “e” |  |
| 27 | unclear | mark | “sw” |  |

**Against today's notes-off reader** (word diff, `[-reader only-]` `{+text only+}`): identical

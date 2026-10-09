# #5762 track 2, Greek — two human transcriptions of one printed page

**Result: 41 pages from 17 printed volumes** (`pairs.jsonl`), 14 rejected candidates (`rejected.jsonl`).
8 pages edition-checked by eye against the page image, 33 by metadata. `ours` is filled on 4 pages (2 books).
Rebuild: `python3 build.py && python3 add_ours.py && python3 finalize.py` (the Hippocratic `work` titles were then patched from the Perseus TEI `<title>`) (sources cached under `src/`); sanity: `node sanity.mjs`.

## What is in pairs.jsonl

| printed volume | pages | A | B | ours |
|---|---|---|---|---|
| Dionysius Hal., Opuscula I, Usener–Radermacher, Teubner 1899 | 3 | Perseus | First1KGreek (DDD) | – |
| Hippocrates, Littré vol. 2 (1840) | 3 | Perseus | First1KGreek (Graeco-Arabic corpus) | – |
| Hippocrates, Littré vol. 3 (1841) | 3 | Perseus | First1KGreek | – |
| Hippocrates, Littré vol. 4 (1844) | 3 | Perseus | First1KGreek | – |
| Hippocrates, Littré vol. 6 (1849) | 3 | Perseus | First1KGreek | – |
| Eusebius HE, Lake/Oulton Loeb vol. 1 | 3 | Perseus | First1KGreek (DDD) | – |
| Eusebius HE, Lake/Oulton Loeb vol. 2 | 3 | Perseus | First1KGreek (DDD) | – |
| Epictetus fragments, Schenkl, Teubner 1916 | 3 | Perseus (anchor-cut) | First1KGreek | – |
| Galen, Natural Faculties, Brock Loeb 1916 | 3 | Perseus | Project Gutenberg #43383 (Distributed Proofreaders) | 6953e60e1479a63c11084af4, pp. 142/226/310 |
| Lucian, Harmon Loeb vol. 3 (1921) | 3 | Perseus (anchor-cut) | el.wikisource proofread | – |
| Aeschylus, Smyth Loeb vol. 1 | 3 | Perseus (anchor-cut) | el.wikisource proofread | – |
| Aeschylus, Smyth Loeb vol. 2 | 3 | Perseus (anchor-cut) | el.wikisource proofread | – |
| Diodorus, Teubner 1888 vol. 1 | 1 | Perseus (anchor-cut) | el.wikisource proofread | – |
| Greek Anthology, Paton Loeb vol. 1 | 1 | Perseus (anchor-cut) | el.wikisource proofread | 69de13298a46d0c97eedc969, p. 31 |
| Homer, Iliad, Monro–Allen OCT 1920 | 1 | Perseus (anchor-cut) | el.wikisource proofread | – |
| Plato, Theaetetus, Burnet OCT vol. 1 | 1 | Perseus (anchor-cut) | el.wikisource proofread | – |
| Plotinus, Volkmann, Teubner 1883 vol. 1 | 1 | First1KGreek (anchor-cut) | el.wikisource validated/proofread | – |

**Page choice is by position, not by agreement.** For each volume the eligible pages (both sides carry it, ≥400
folded letters, both cuts start and end on the same 10 letters) were listed and the pages at the 1/4, 1/2, 3/4
positions taken (for Littré: the middle eligible page of each of three treatises). `build.log` has the counts.
The start/end condition is a cut-validity filter (a `<pb>` placed a word early is markup, not transcription); it
removes 2–8% of pages in most files and ~35% in Eusebius, where the two files put `<pb>` inside broken words differently.

## Things the scorer / reader must know

1. **Letter-level CER is 0 on 27 of 41 pages** (`scripts/eval/lib/metrics.mjs` folds accents, case and punctuation for
   Greek). That is the finding, not a shared ancestor: on those pages the two sides still differ at the diacritic
   level (ῃ/η, αὑτῶν/αὐτῶν, ῤ/ῥ, grave/acute, ᾄ/ᾁ), in capitals and in punctuation (see `independence` per row).
   Four Littré pages (2-tlg005 p450, 3-tlg008 p312, 4-tlg011 p368, 4-tlg012 p530) agree in every letter AND every
   diacritic and differ only in capitals/punctuation/apostrophe encoding. A scorer that wants the human floor for
   polytonic Greek should also report a diacritic-sensitive CER; apostrophe (ʼ ’ ' ᾽ ᾿ ̓) and tonos/oxia encodings
   must be unified first or they dominate (raw difference 5–9% on Littré is almost all oxia-vs-tonos code points).
2. **Three outlier pages are real human differences, kept on purpose:**
   - `lucian3-ws106`: the proofread wikisource page omits a whole clause (θᾶττον ἄν τις ἐν πλοίῳ πεσὼν … ὀφθαλμός, 58 letters).
   - `euseb-he-v1-p136` (2.8%): First1K has uncorrected OCR-type slips (Ἀδισβηνῶν, χριατὸν, Ῥώμνη) and one
     eye-skip substitution (δεδηλωμένον for συναιρόμενος).
   - `aesch2-ws146` (1.4%), `aesch1-ws206`: lyric passages; bracketed/ephymnion text is handled differently.
3. **Quality of side B varies.** First1KGreek files are OCR corrected by hand (Digital Divide Data per the TEI
   respStmt), not double-keyed; the Eusebius file is visibly the weakest (the brief's "OCR, not proofread" line is
   close: I kept it because the header states human correction and most pages are clean — drop the 6 `euseb-he-*`
   rows for a strict "careful human" floor). Distributed Proofreaders (Galen) is the strongest B.
4. **Independence of the wikisource rows is argued, not documented.** Every el.wikisource page used was created with
   an already-polytonic e-text (not typed from the scan) and then proofread against the scan. I checked first
   revisions: the seeds differ from the Perseus files (capitalised sentence starts, other readings later corrected
   toward the scan, ᾽ apostrophes), so they are not Perseus pastes — but the seed's own ancestry is unknown. Weakest
   case: `homer-il-ws192` (0 letter differences in 1,022 letters; differs in accents/punctuation only). A strict
   reading of rule 2 would drop the 14 wikisource rows; the 27 TEI-vs-TEI/Gutenberg rows (9 volumes) stand without them.
5. **Dropped on both sides the same way:** heads, running heads, notes/apparatus, marginal page/line/section numbers,
   Kühn/Reiske marks; speaker names and strophe sigla for the drama/dialogue rows (Aeschylus, Lucian, Plato);
   line-end hyphens joined. Not harmonised (left as each side keyed it): chapter numerals inside the text
   (Eusebius "XIII."), source lemmata (Epictetus "Ἐπικτήτου."), editorial brackets 〈〉 [].
6. Edition caveats recorded per row: Perseus Littré headers cite the 1961 Hakkert photographic reprint; the Aeschylus
   vol. 1 wikisource scan is the 1927 reprint of the 1922 Loeb; Perseus Westcott–Hort etc. not used.
7. Epictetus printed page numbers are not marked in either file (First1K has `<pb facs>` only); `printed_page`
   holds the scan image name. Not eye-checked (the leaf ↔ facs offset was not resolved).

## What was searched

- All 41 tlg work ids present in both PerseusDL/canonical-greekLit and OpenGreekAndLatin/First1KGreek (trees
  intersected; every pair's `sourceDesc`/`respStmt`/`revisionDesc` read). Same edition and independent: Dionysius
  De Demosthene, 12 Littré treatises, Eusebius HE (Lake), Epictetus (Schenkl). Same edition but ONE keying:
  Barnabas, Zonaras. Derived: Aeschylus (Sidgwick made from Smyth). The rest are different editions.
- Project Gutenberg, language grc: 3 books. Galen (Loeb 1916) matches Perseus; Dionysius De comp. (Roberts) and the
  Didache (Hitchcock–Brown) are other editions than Perseus's.
- el.wikisource Index (Μεταγραφή) namespace, 439 indexes: every classical index whose edition Perseus/First1K also
  carries was checked for ProofreadPage level ≥3 pages.
- Westcott–Hort: Robinson's e-text and the wikisource 1881/1894 indexes — rejected (see rejected.jsonl).
- Our library: `greek-books.json` and a read-only `books` query. We hold none of Usener–Radermacher 1899, Littré,
  Loeb Eusebius, Schenkl 1916, Loeb Lucian 3, Smyth's Aeschylus, Diodorus 1888, Volkmann's Plotinus. We do hold the
  Galen Loeb and Greek Anthology I (used), and Homeri Ilias 1907 (an earlier OCT edition, not used as `ours`).

## How many pages exist in principle

Cut-valid pages available now: Dionysius 117; Littré 366 across 12 treatises (vols 2, 3, 4, 6); Eusebius 324;
Epictetus 15; Galen 161; Lucian 20; Aeschylus 201; single pages for Diodorus, Anthology, Homer, Plato, Plotinus.
About 1,200 pages, but only 17 printed volumes — the 3-per-book cap is what binds.

## What blocked more

- Volumes, not pages: outside the Perseus ∩ First1K overlap almost no Greek edition has two independent keyings with
  page breaks. Many Perseus files have no `<pb>` at all.
- For the editions we hold most of (Loebs of Hippocrates, Plutarch, Strabo, Dio, Appian, Josephus, Greek Anthology
  2–5; Teubner Plutarch, Pausanias) there is exactly one human transcription (Perseus), so `ours` could be attached
  to only two books.
- el.wikisource: most classical indexes sit at quality level 1; proofreading is concentrated in a few volumes.
- Not attempted: fr.wikisource Littré pages (would be a third transcription of volumes already covered), Swete /
  Rahlfs / Nestle 1904 (no two demonstrably independent page-faithful keyings found; Rahlfs is in copyright).

Licences: Perseus, First1KGreek, Wikisource CC BY-SA 4.0; Project Gutenberg public domain. Nothing CC BY-NC or in copyright.

---
stage: metadata
measure: none
languages: [la, grc, de, it, es, fr, en]
scripts: [Latn, Grek]
canons: []
n_books: 636
n_pages: 1633
verdict: "No new Philolaus or Archytas fragment. Two known witnesses confirmed (Barocci 41 = Wallis's Porphyry codex D; Boethius' Philolaus sentence identical in the 9th-, 12th- and 13th-c. copies). The residue is late misattribution, led by a quartan-fever amulet credited to 'Architas' in ps.-Albertus and copied by Agrippa, and one mistranslation (Cessolis' Agathocles rendered as Archytas)."
status: informational
decision: null
superseded_by: null
issue: [7065]
---
PRIOR ART: #7064 (Pythagoras, where no fragment list exists to check against). The DK reference comes from our own Diels 1912 (`6a3f0220661123baf6fe9d4e`; ch. 32 = DK 44, ch. 35 = DK 47) and Mullach FPG 1881 (`6a3f02bb97e91e1768f68204`). `scripts/eval/INDEX.md` has no fragment or incipit matcher. `canonical-loci.md` covers Bekker and Stephanus numbers, not Diels-Kranz.

## 2026-10-21 · Which Philolaus and Archytas attributions in Source Library have an ancient source behind them? (#7065)

**Design.** The input is the harvest of public books with every passage where the English names Philolaus or Archytas (apparatus stripped). The candidates are the books dated before 1700 whose passage has an attribution verb or a quotation: Philolaus 913 passages in 259 books, Archytas 720 in 377. For each candidate, the **original-language OCR** of its page is read from Mongo (`fetch-originals.mjs`, read-only). It is matched against the DK entries (`build-reference.mjs` → `classify.mjs`) by 12-character shingles over folded Greek and Latin. Names and ethnics are cut out first, so "Philolai Pythagorici" cannot carry a match. A match needs at least 40 covered characters with one run of 24 or more. A hand-keyed layer holds the Latin and Greek wordings the printed tradition quotes: Cicero, Valerius Maximus, Gellius, Lactantius, Boethius, Diogenes in Traversari's Latin, and the pseudo-Archytan *On Wisdom* and *On Law*. Rows with no text match fall back to keyword rules on the English context. Then every remaining row was read, and the ones that mattered were checked against the page image.

**Reference caveats.** Our 1906 (`69e8b21f…`) and 1954 vol. 3 (`69ae66d0…`) "Diels" copies are the Wortindex, not the text. In the 1912 copy, pp. 338 and 340 have no OCR (Philolaus B18–B19 are missing), and Archytas A1–A2 and A17 are not in the OCR. The Diogenes VIII 79–83 wording was keyed by hand. The genuine/spurious status follows Huffman (Philolaus 1993: B1–7, 13, 17 genuine; Archytas 2005: B1–4 genuine). That status was **entered from the literature**, because we hold neither book.

**Counts** (passages; "text" = matched on the original-language OCR; "rule" = keyword rule on the English, precision not measured):

| | genuine B | doubtful B | spurious B / pseudepigrapha | testimonium / anecdote | noise | unmatched |
|---|---:|---:|---:|---:|---:|---:|
| Philolaus (913) | 32 (11 text) | 4 (4) | 56 (27) | 302 (48) | 497 | 22 |
| Archytas (720) | 16 (9) | 9 (0) | 124 (8) | 485 (100) | 48 | 38 |

Philolaus noise is mostly one source: **Reuchlin, *De arte cabalistica* (1517)**, whose Pythagorean speaker is named Philolaus. The dialogue is reprinted with Galatino (1550, 1561, 1612, 1672), in the Basel Pico volumes (1557, 1572, 1601) and in Pistorius (1587). That accounts for 430 of the 497 noise rows, and for part of the 17 "younger Philolaus" rows that share a label with Boulliau. The rest are Philolaus of Corinth (the Theban lawgiver), Boulliau's *Philolaus* (1639), Philolaus of Citium in Philostratus, and lists of names. Archytas noise is grammar examples, Archytas of Amphissa, and lists.

**The three leads.**
1. **"Gold and silver are worth no more than clay"** (German Cessolis 1407, `69a5ee3c…` p.58). The manuscript reads **"Archyloga"**, not Archytas; the 1390 German *Schachzabelbuch* (`69f330c1…` p.79) has "Anthiloga". The Latin Cessolis (`69f33489…` p.35: *Narratur de Archaglada qui dicebat quod auro tanquam fictilibus et fictilibus tanquam auro utendum est … ego sum rex factus ex figulo*; `69a5ea0b…` p.52 *Ardinglata*) shows this is **Agathocles**, the potter's son who ate from earthenware (Ausonius, *Epigr.* 8; Plutarch, *Apophth. reg.* 176e). The saying has nothing to do with Archytas. The name was corrupted in the German and then "normalised" to Archytas by our English translation.
2. **Porphyry on Ptolemy's *Harmonics*, c.1450** (`69938a8f…`). This is **Bodleian MS. Barocci 41**, which is **Wallis's codex D**, the manuscript he preferred for the 1699 *editio princeps* (our Wallis, `69905abe…` p.227: *Codex D, (quem reliquis praefero,) est inter Codices MSS. Baroccianos … numero 41*). Diels cites Porphyry by Wallis's pages. Jan (1895) lists it too. So it is a known witness, not a new one. It carries DK 47 **B1** in full (p.410 ff.) and in part (p.456), DK 47 **B2** (p.477), and on p.362 the spurious ***On Wisdom*** (Thesleff, ps.-Archytas Περὶ σοφίας: *τοσοῦτον διαφέρει σοφία …*). We did not check whether Düring (1932) collated it.
3. **Boethius, *Arith.* II 32: the Philolaus sentence in three Florentine copies.** Read from the images. The 9th-c. copy (Plut. 29.20, `69b52ca2…` p.140) and the 12th-c. copy (Plut. 89 sup. 81, `69b52cc2…` p.90) both read *Philolaus uero necesse est inquit omnia quae sunt uel infinita esse uel finita*. The 13th-c. copy (Plut. 29.23, `69b52cb9…` p.48) reads *ł infinita esse ł finita*. **The quoted sentence is the same in all three.** They differ only in Boethius's gloss that follows it: *aut ex finita scilicet **esse*** (9th c.) against *aut ex finita scilicet **essentia*** (12th and 13th c.). The 12th-c. copy also has an erasure before *finita* and a superscript correction, and the 1521 print agrees with the 9th c. (*ex infinita scilicet esse, aut ex finita*). The "different readings" reported in #7065 came from our OCR (9th c.: "ex finitis … infinitis"; 13th c.: "nisi infinita essent & finita") and from the translations, not from the manuscripts.

**Residue, ranked by interest** (nothing here is a new genuine fragment):
1. **Quartan-fever amulets credited to "Architas"** (25 rows, 1478–1662). Pseudo-Albertus, *De mirabilibus mundi* (earliest of ours: the 1478 print, `69905e37…` p.72): *Et dixit architas, si accipiatur cor dum vivit et suspendatur super patientem quartanam, eradicat eam*. A second "Architas" cure follows: a dog's left-ear wax. Agrippa, *De occulta philosophia* I.42 (1531–1600, 15 of our copies; ps.-Albertus in 5) copies it as *simile est quod dicit Archytas* and so attaches it to the Pythagorean. There is no ancient source in DK or Thesleff. This is (c) a misattribution whose first appearance in our holdings is ps.-Albertus. The "Architas" is likely a corrupted name; this was not resolved.
2. **"Archytas, *De eventibus in natura*"** (Meffret, *Hortulus reginae*, 1488, `69dbcade…` p.16, read by eye): *Omne quod in universitatis ordine nimium et abundans fuerit ad corruptionem pronius et ad nihilum ipsum venit*. The title is unknown to DK and Thesleff. It is (b/c) a medieval Latin pseudepigraph or a mis-citation, with this one witness.
3. **Golden Verses line 3 credited to Philolaus** (Postel, *De magistratibus Atheniensium* 1551, `69c80239…` p.115, read by eye): *secundum Philolai versum, quem falso adscribunt Pythagorae: τούς τε καταχθονίους σέβου δαίμονας ἔννομα ῥέζων*. This is (c), with no earlier source found.
4. **The Gorgias 493a leaky jar credited to "divine Archytas of Tarentum and Plato"** (Ficino, 1490 and 1497 volumes). Plato's "clever Sicilian or Italian" is the man Diels tentatively identifies with Philolaus (B14 note). Ficino names Archytas instead. This is (c).
5. **The Pythagorean *symbolon* "entering a temple, do not turn back", credited to Philolaus** (Giraldi 1551, Hierocles ed. 1655, Stanley 1687), citing Olympiodorus *in Phaed.* It is a late-antique ascription and is not in DK 44. We did not check it against Olympiodorus.
6. **Plato "following Philolaus" on the krater of Hephaestus** (Proclus *in Tim.*, Basel Plato 1534 p.1092). This is (d): a Proclus testimonium that is not in the DK 1912 chapter.
7. **Smaller cases.** The ban on parallel octaves and fifths, credited to Philolaus (Bermudo 1555): an anachronism, (c). "The wise man's one disadvantage is poverty", credited to Archytas (Alciati commentary 1661): (d), no source found. Fate cannot be overcome by vows, credited to "Archytas and Heraclitus" (Arquatus 1494): (d). Archimedes' ship-hauling at Syracuse credited to Archytas (Daneau 1575): (c), a confusion of the two. Also some testimonia that are real but missing from DK 1912: Aristotle *Probl.* XVI 9 (later DK 47 A23a), Censorinus 4.3, Iamblichus *VP* 139, and Plutarch's "Need taught all things" (Stobaeus).

**Not a fragment, but worth fixing:** our English translation of `69a5ee3c…` p.58 ("Archytas" for *Archyloga*/Agathocles), and the OCR of Boethius `69b52ca2…` p.140 and `69b52cb9…` p.48 at the Philolaus sentence.

**Replicated?** No. The counts depend on the keyword rules for the rows not matched on text, and that precision was not measured. The three leads and the residue items above were checked by eye.

**Artifacts.** The scripts are in `scripts/eval/fragment-sort/` (`term-harvest.mjs` → `fetch-originals.mjs` → `build-reference.mjs` → `classify.mjs` → `residue.mjs` / `summarize.mjs`). The per-row classifications are on the job box at `/mnt/HC_Volume_105839809/jobs/fragment-sort-7065/{phil,arch}.cls.jsonl` and `reference.json`; they are not committed.

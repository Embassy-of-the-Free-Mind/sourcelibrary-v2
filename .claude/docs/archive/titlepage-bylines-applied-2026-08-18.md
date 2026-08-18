# Title-page bylines — what got written, and what got refused (2026-08-18)

Applied by `scripts/maintenance/apply-titlepage-bylines-3982.mjs`. Snapshot, not doctrine.
The method and its benchmark are PR #3982 / `.claude/handoffs/2026-08-17-titlepage-attribution-pilot.md`.

## The funnel

| stage | n | |
|---|---|---|
| flash-lite candidates, all classes | 1,239 books | the number a first pass wanted to act on |
| **benchmarked pool** | **161** | public, text, no author page, blank/placeholder byline, Latin script |
| independent reader named an author | 80 | **81 said the page names nobody** — the correct answer |
| survived deterministic screens | 38 | quote-on-page, role conflict, Sammelband, reference genre, name shape, multi-author title |
| survived the adversarial refuter | **24** | it killed 14 of 38 (37%) |
| **written** | **24** | `books.author` + `books_catalog.author` + a `field_provenance` row each |

Two classes were deliberately excluded from the 161 and are NOT covered by any measurement here:
**38 loose collectives** (`Various Authors`, `Anonymous (Byzantine)`) — #3950 settled that a collective
is a deliberate answer, not a missing one — and **31 non-Latin-script books**, where the prompt sits at
~52% precision with four named causes. A wider "261" folded both in.

## Ladder effect

These 24 move **T0 ABSENT → T2 UNLINKED**. `reachable` (T3+) and `anchored` (T4) are UNCHANGED,
because nothing here sets `author_id`. A reader now sees a byline and can search the name; the author
page comes from the additive-mint path (`additive-mint-authors-3780.mjs`), not from this script.

## Written (24)

| author | was | book |
|---|---|---|
| Aloysius Lipomanus | Unknown | [De vitis sanctorum ab Aloysio Lipomano, episcopo Veronae, ..](https://sourcelibrary.org/book/6a08524f15c643eb1af4c9d1) |
| Balthasar Schellig | Unknown | [Positiones circa libros Physicorum et De anima Aristotelis](https://sourcelibrary.org/book/69dbcb511040d1d5e20b5c8e) |
| Dictys Cretensis | Unknown | [Ephemeridos belli Troiani](https://sourcelibrary.org/book/69f335e7876dd827cbc4f69a) |
| Franciscus Philippus Pedimontius | Unknown | [Francisci Philippi Pedimontii Ecphrasis in Horatii Flacci ar](https://sourcelibrary.org/book/6a08571015c643eb1af5aa63) |
| H. A. van Hien | (blank) | [Eenige weinig bekende Javaansche legenden](https://sourcelibrary.org/book/6a196a2e3e125aa8d6e00883) |
| H. Zeydner | (blank) | [Iets over Java's overgang tot het Mohammedanisme](https://sourcelibrary.org/book/6a1d6d9b4808313bd55d17ea) |
| Inajati Adrisijanti | Unknown | [Candi Prambanan](https://sourcelibrary.org/book/6a195c313e125aa8d6dff77d) |
| Jean de Nostradamus | Unknown | [Les vies des plus celèbres et anciens poètes provensaux](https://sourcelibrary.org/book/69c63cd593cbf3c0fd742523) |
| Justus Christian Hennings | (blank) | [Von den Träumen und Nachtwandlern](https://sourcelibrary.org/book/69bda143f6d63c919748f149) |
| L. Th. Mayer | (blank) | [De sĕḍĕkahs en slamĕtans in de desa en de daarbij gewoonlijk](https://sourcelibrary.org/book/6a1d6d6c4808313bd55d1719) |
| L. W. C. van den Berg | Unknown | [De inlandsche rangen en titels op Java en Madoera](https://sourcelibrary.org/book/6a1958043e125aa8d6dfeb81) |
| L. W. C. van den Berg | Unknown | [Het Inlandsche gemeentewezen op Java en Madoera](https://sourcelibrary.org/book/6a1d6f1a4808313bd55d1f42) |
| Laurentius Maiolus | Unknown | [De gradibus medicinarum](https://sourcelibrary.org/book/6a08569515c643eb1af59560) |
| Marcus Tullius Cicero | Unknown | [1:Prima pars, academicarum quaestionum editionis primae libe](https://sourcelibrary.org/book/6a08526b49638a50931ba288) |
| Marcus Tullius Cicero | Unknown | [M. Tullii Ciceronis Orationum pars 2. Cum correctionibus Pau](https://sourcelibrary.org/book/6a06f5e04dcc6d5d8f0385fa) |
| Marcus Tullius Cicero | (blank) | [2: De philosophia volumen secundum, id est, De natura deorum](https://sourcelibrary.org/book/6a06d3a39a48d5139996365b) |
| Marianus Stephanellus | (blank) | [Reg.lat.1228](https://sourcelibrary.org/book/69a5e483006a4098422174aa) |
| N. Adriani | Unknown | [Geestelijke stroomingen onder de bevolking op Java](https://sourcelibrary.org/book/6a1d6d5f4808313bd55d16e0) |
| Paulus Manutius | (blank) | [Epistolarum Pauli. Manutij libri. 10. duobus. nuper. additis](https://sourcelibrary.org/book/6a09711dbf2196cdca9059ed) |
| Publius Ovidius Naso | Unknown | [Opera](https://sourcelibrary.org/book/69592ae97c072c27f686dc7c) |
| T. J. Bezemer | (blank) | [De inlandsche dorpsgemeenschap op Java](https://sourcelibrary.org/book/6a1d6f0a4808313bd55d1ed1) |
| Th. B. van Lelyveld | Unknown | [De Javaansche danskunst](https://sourcelibrary.org/book/6a1966a33e125aa8d6e002cb) |
| Theodorus Straitmannus | (blank) | [[Titre de départ :] Conjuctiones titulorum sive rubricarum u](https://sourcelibrary.org/book/69b630301c1c21a3737fe842) |
| Wolfgangus Lazius | (blank) | [Hungariae Descriptio](https://sourcelibrary.org/book/69b4d65c853c26e0d1561406) |

## Refused by the refuter (14) — every one would have shipped as a public byline

- **Petrus Artopaeus** — *Biblia Veteris Testamenti ... Biblische Historien* · `role-error` · The only appearance of the name is as the signer of a dedicatory greeting ("S. D." = salutem dicit) to Duke Johann Friedrich, which identifies the dedicator/contributor of the prefatory verses, not the author; the title page ("BIBLIA VETERIS TESTAMENti & Historię, artificiosis picturis effigiata ...
- **Iacobus Ziegler** — *Duplex confessio Valdensium* · `not-one-authors-book` · The contents leaf shows this is a composite volume of several distinct works by different hands — the Waldensian confession and apology, Augustinus de Olomucz's letters, and Ziegler's five books — so no single author owns the book. Ziegler's protestatio on p.18 claims only his own quinque libri ('qu
- **Iacobus minor** — *Protevangelion sive de natalibus Jesu Christi* · `not-one-authors-book` · The title page describes a composite Basel volume of at least three works by different hands - the pseudonymous sermo ascribed to James, the Gospel of Mark, and Bibliander's Vita of John Mark plus his indices - so no single author's byline fits, and the preface confirms Bibliander is the compiler an
- **Morienus Romanus** — *Turba Philosophorum, Das ist, Das Buch von der güldenen Kunst : * · `not-one-authors-book` · This is volume 2 of the Turba Philosophorum compilation (36 books 'neben andern Authoribus'), and its own title page says it contains Morienus's writings only 'mit andern Authoribus, die da auff dem nachfolgenden Blatt angezeigt werden' — a multi-hand anthology, not one author's book. The only indiv
- **Charles Vallancey** — *Collectanea de rebus hibernicis. 5. 1790* · `not-one-authors-book` · The Collectanea de rebus hibernicis is a serial miscellany, and this volume's own title page names a second contributor, Joseph C. Walker, alongside Vallancey, so the volume is not one author's book. Vallancey is its compiler/editor and a contributor, which is not the same as sole authorship of the 
- **Salomon Trismosin** — *Avrevm Vellvs, Oder Güldin Schatz vnd Kunstkammer : Darinnen der* · `not-one-authors-book` · The title page describes a compiled volume of tracts by many old and new writers, assembled from originals and manuscripts by an unnamed 'Kunst Liebhaber', so no single author owns the book. Trismosin is credited only with having the material 'disponirt' (arranged) and 'in das Teutsch gebracht' (ren
- **Hippocrates** — *Articella seu Opus artis medicinae. Ed: (with marginalia) Gregor* · `not-one-authors-book` · The Articella is a multi-author medical compendium: the preface's own table of contents lists Johannitius, Philaretus, Theophilus, Galen and others alongside the Hippocratic Aphorisms, so Hippocrates authored only part of it. The title-page phrase names one constituent text in the genitive, not the 
- **Constantinus** — *[Miscellanea medica]* · `not-one-authors-book` · The volume is catalogued as a medical miscellany (a composite codex of many hands), and the only evidence is a later, poor-Latin handwritten label naming a single item within it, Constantinus Africanus's Liber graduum, not the whole book. A one-work label on a miscellany cannot carry a volume-level 
- **Augustinus Hipponensis** — *Regula, habitus, et professio virginum, Sanctae Justinae Venetia* · `not-one-authors-book` · The genitive rightly marks Augustine as author of the Regula, but the Regula is only the first item in a composite convent manuscript (Regula, habitus, et professio virginum) whose subsequent texts — the ordo for clothing novices and the profession rite of Santa Giustina — are the house's own liturg
- **Victor of Capua** — *Liber evangelistarum* · `role-error` · The genitive governs 'prefacio', not the book: Victor of Capua wrote only the preface to this gospel harmony, and in that very preface he says he found the work anonymous and traces its compilation to Ammonius of Alexandria or Tatian. The book itself is a harmony of the four evangelists, so the byli
- **Alexander Neckam** — *Mythographi vaticani, mythographus tertius* · `wrong-person` · The name is not printed by the book but written by a later hand in inverted catalogue form ("Neckam, Alexander"), i.e. a cataloguer's conjecture inside the book rather than an authorial statement. The work is the anonymous Third Vatican Mythographer, whose old attribution to Alexander Neckam has bee
- **Joachimus Magdeburgius** — *Die Vnuerfelschete Augspurgische Confessio* · `not-one-authors-book` · The genitive 'Joachimi Magdeburgij' governs only 'einer Vermanung' — an admonition appended 'Sampt' (together with) the main texts — so it names the author of one supplementary piece, not of the volume. The volume's principal contents are the Augsburg Confession and the Schmalkaldic Articles, confes
- **Zoroaster** — *Oracula magica Zoroastris : cum scholiis Plethonis et Pselli nun* · `not-one-authors-book` · The volume is a compiled edition — oracles pseudepigraphically ascribed to Zoroaster printed together with the scholia of Plethon and Psellus, assembled from a royal manuscript by the editor Johannes Opsopoeus ('studio') — so no single person authored the book. 'Zoroastris' is a legendary attributio
- **Joachimus Magdeburgius** — *Die Vnuerfelschete Augspurgische Confessio[n]* · `not-one-authors-book` · The genitive 'Joachimi Magdeburgij' governs only 'einer Vermanung' — an admonition appended 'sampt' (together with) the main texts, which are the Augsburg Confession and the Smalcald Articles, confessional documents by other hands (Melanchthon, Luther). Magdeburg is the author of a subsidiary exhort

Three of these are the grammar trap `author-identity.md` names: a genitive that governs the *preface*
or an appended *Vermanung* rather than the book. One (Alexander Neckam) was never printed by the book
at all — a later hand wrote it in, inverted-catalogue style, and a reader took it for a byline.

## Human review queue (42)

Held back by a screen, not judged wrong. Machine-readable in
`titlepage-bylines-verdicts-2026-08-18.json` (`flagged[]`), with the flag reasons on each row.
Most are compilers of anthologies and reference works, where the right main entry is a cataloguing
decision a person should make, not a rule this script should apply.

| proposed | flags | book |
|---|---|---|
| Adam Michael Birkholz | sammelband | Allgemeines Hand- und Taschenbuch oder Universalphysik |
| Aldo Manuzio | role-conflict | Eleganze, insieme con la copia della lingua toscana e la |
| Aldus Manutius | also-subject, sammelband | De quaesitis per. epistolam libri. 3. Aldi. Manutij Paul |
| Aldus Manutius (the Younger) | sammelband | Eleganze insieme con la copia della lingua toscana, e la |
| Aldus Manutius (the Younger) | also-printer, also-subject, role-conflict, sammelband | Epitome orthographiae Aldi. Manutii Paulli. F. Aldi. N.  |
| Aloysius Lipomanus | role-conflict | De vitis sanctorum ab Aloysio Lipomano, episcopo Veronae |
| Anquetil Duperron | role-conflict | Oupnek'hat : (id est, Secretum tegendum): continens ...  |
| Arthur Edward Waite | role-conflict, sammelband | Elfin music: an anthology of English fairy poetry |
| Ashin Kelasa (အရှင်ကေလာသ) | role-conflict | Mandalay Thathanawin (မန္တလေးသာသနာဝင်, Burmese Buddhist  |
| Augustinus | sammelband | Anthology of devotional prose and verse |
| Buchner | reference-genre | Fachkatalog der Drucke der Bibliothek des Hochstifts Pas |
| Caillot | also-printer, role-conflict | Annales mac[onniques] |
| Calomira de Cimara | sammelband | Sepher Ietzirah ([Hebrew: Sefer jezirah]). Traduction du |
| Carolus II, dux Sabaudiae (Charles II, Duke of Savoy) | also-dedicatee, possibly-declined | Sequuntur Statuta per illustrum principem dominum d. Kar |
| Charles Vallancey | also-dedicatee | Collectanea de rebus hibernicis. 6. 1804 |
| Charles Vallancey | role-conflict | Collectanea de rebus hibernicis. 4. 1786 = Nr. 13 - 14 |
| Esther Inglis | role-conflict | Argumenta in librum Psalmorum, Estheræ Inglis manu exara |
| Francesco Antonio Zaccaria | also-dedicatee | Storia Letteraria D'Italia : divisa in tre libri. 5, Dal |
| Franciscus Balduinus | also-dedicatee, sammelband | Alchemical and Medical Illustrations |
| Franciscus Luisinus | sammelband | XFrancisci Luisini Vtinensis In librum Q. Horatii Flacci |
| Franciscus de Assisio | sammelband | Sermons against the Turks |
| Friedrich Karl Gottlob Hirsching | reference-genre | Versuch einer Beschreibung sehenswürdiger Bibliotheken T |
| G. A. Holland | reference-genre | Tagebuch über eine mit besonderer Beziehung auf Landwirt |
| Georg Schütz | reference-genre | Verzeichniss der altdeutschen Bilder und einiger andern, |
| Guilielmus Gratarolus | role-conflict, sammelband | Verae Alchemiae Artis'qve Metallicae, Citra Aenigmata, D |
| Herrenstadio-Silesius | sammelband | Deutsches Theatrum Chemicum : Auf welchem der berühmtest |
| Ioannes Crispinus | role-conflict | Juris civilis initia et progressus. Ad leges XII. Tabula |
| Iohannes de Sabaudia | role-conflict | Statuta noviter edicta per illustr[issimum] et revendere |
| J. A. D. | not-a-usable-name, reference-genre | Alphabetische naamlyst der voornaamste Ketteren |
| Johann Michael Faust | also-printer | Joh. Michaelis Faustij, Med. Doct. Physici Francofurt. O |
| Johannitius | sammelband | Articella seu Opus artis medicinae. Ed: Franciscus Argil |
| Joseph Mozler | role-conflict | Verzeichniß über 250 Nummern von gebundenen chemischen u |
| Lucas Jennis | also-printer, role-conflict | Hermetico-Spagyrisches Lustgärtlein : Darinnen Hundert v |
| Marcus Porcius Cato | multi-author-title | Libri de re rustica. M. Catonis lib 1. M. Terentii Varro |
| Marcus Porcius Cato | multi-author-title | Libri de re rustica. M. Catonis lib. 1. M. Terentii Varr |
| Morienus Romanus | sammelband | Auriferae artis, quam chemiam vocant, antiquissimi autho |
| Morienus Romanus | sammelband | Turba Philosophorum, Das ist, Das Buch von der güldenen  |
| Octavianus Mirandula | also-dedicatee, role-conflict, sammelband | Mirandulae Viridarium illustrium poetarum : cum ipsorum  |
| Paulus Manutius | also-subject | 2: Pauli Manutii Scholia, quibus et loci familiarium epi |
| Paulus Manutius | also-printer, role-conflict | In M. Tullii Ciceronis orationes Paulli Manutij commenta |
| Robertus Vallensis | role-conflict | De Arte Chemica : Libri Dvo ... Qvorvm Prior De veritate |
| Salomon Trismosin | role-conflict | Aureum Vellus, oder Güldin Schatz und Kunstkammer. [1,1] |

## Declined by the reader (81)

The page names nobody. Left alone — that is the correct outcome and the largest single bucket.

## Revert

`node --env-file=.env.production.local scripts/maintenance/apply-titlepage-bylines-3982.mjs --revert --apply`.
The backup merges on book id and lets the earliest `before` win.

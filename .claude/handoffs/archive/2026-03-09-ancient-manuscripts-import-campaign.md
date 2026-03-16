# Ancient Manuscripts Import Campaign (Mar 9, 2026)

## Summary

Multi-session import campaign targeting ancient manuscript collections, papyri, scholarly reference works, complete classical author corpora, and early modern music/natural philosophy sources. ~230+ books, ~101,600+ pages imported across 4+ conversation sessions.

## Collections Imported

### Herculaneum Papyri
- Naples 1793 facsimile volumes (Herculanensium Voluminum)
- Multiple volumes from the original publication series

### IRAIK (Russian Archaeological Institute in Constantinople)
- **All 16 volumes** of Izvestiia Russkogo Arkheologicheskogo Instituta v Konstantinopole
- Vols I-XI: imported via SUCHO archive identifiers (`sucho-id-*`) in prior session
- Vols XII-XVI: imported this session, also via SUCHO
- Slug collision fix: vols XII and XIV needed "IRAIK:" title prefix to avoid duplicate slugs

### Mt Athos Manuscripts
- Lambros Catalogue of Greek Manuscripts (multiple volumes)
- Various Athos-related catalogs and studies

### Istanbul/Constantinople
- IRAIK series (see above)
- Sotheby's Byzantine Manuscripts catalog (36pp, ID `69aea5987868e8f1c66a76f3`)

### Greek Papyri (British Museum)
- Vols I-V complete (`greekpapyriinbri01-05brit`)
- Total: ~2,370 pages
- Note: `*telesuoft` identifier suffix failed; `*brit` suffix worked

### Oxyrhynchus Papyri
- Multiple volumes from prior sessions
- Vol XVIII failed (no JP2)

### Gnostic/Coptic/Dead Sea Scrolls
- Imported in prior sessions
- Coptic texts, Ethiopian manuscripts, Sinai manuscripts

### Palaeography & Reference
- Gardthausen Griechische Palaeographie I (525pp)
- Thompson Handbook of Palaeography (456pp)
- Kenyon Palaeography of Greek Papyri (222pp)
- Novum Testamentum Graece, Tischendorf (771pp)
- Koptische Kunst, Strzygowski (476pp)

### Hermetic/Ancient Religion
- Egyptian Magic, Budge (278pp)
- Dawn of Civilization, Maspero (840pp)
- Diels Fragmente der Vorsokratiker I (486pp)
- Deissmann Light from Ancient East (690pp)

### Other
- Hierosolymitike Bibliotheke complete 5-vol edition (654pp)
- John Rylands Greek MSS catalog vols I-II (804pp)

### Classical Author Corpora (Session 4)

Complete scholarly editions of four major classical authors, plus Hermetic supplement:

#### Philo of Alexandria (~5,384 pages)
- **Yonge 4 vols** (complete English): `worksofphilojuda01-04phil` (2,210pp)
- **Yonge alt editions**: `worksofphilojuda01-02yonguoft`, `theworksofphiloj04yonguoft` (1,674pp)
- **Loeb Greek-English 4 vols**: `worksphilojudaeu01-04philuoft` (varies)
- **Supplements**: Questions on Genesis/Exodus, On Contemplative Life, On Confusion of Tongues

#### Josephus (~14,917 pages)
- **Loeb 7 vols** (Greek-English): `josephuswithengl01-07joseuoft` (4,872pp)
- **Whiston Complete (1905)**: `completeworksoff05jose` (992pp)
- **Whiston 4 vols (1800)**: `completeworksofj01-04jose` (2,678pp)
- **8 additional editions**: 1847-1890, various publishers (6,375pp)

#### Plutarch (~16,319 pages)
- **Moralia Loeb 13 vols**: `moraliainfifteen02-15plutuoft` + variants (7,186pp)
- **Lives Loeb 6 vols**: `plutarchslives01-09plutuoft` (3,654pp)
- **Lives alt editions**: 2 vols + Langhorne translation (2,045pp)
- **Additional**: Moralia Index, selected essays, standalone volumes (3,434pp)

#### Origen (~7,676 pages)
- **Contra Celsum** (Chadwick): `contracelsumlib00selwgoog` (411pp)
- **On First Principles**: `origen-on-first-principles` (290pp)
- **Against Celsus** (1660): `origenagainstcel00orig` (446pp)
- **Writings of Origen** (4 editions): ~2,308pp
- **Philocalia** (2 editions): 544pp
- **Commentary on John** (3 editions): ~1,098pp
- **ANF vols 2-10** (7 imported, 1 already existed): ~4,530pp
- **Additional**: Gregory Thaumaturgus, Origen anthology, Fragments of Heracleon, Preacher/Teacher

#### Festugière (Hermetic supplement, 857 pages)
- **La Révélation d'Hermès Trismégiste, Vol. IV** (467pp)
- **Corpus Hermeticum, Tome III** (Nock/Festugière, 390pp)

### Penelope Gouk's Cited Sources (Session 4-5, ~6,900+ pages)

Primary sources from Gouk's work on music and natural philosophy. All found on IA with IIIF manifests.

**Tier 1 — Imported** (unique to Gouk's scholarship):
1. Gaspar Schott, *Magia Universalis* Vol. I (1657, 653pp) — `magiauniversali00schogoog` [only vol 1 on IA]
2. Walter Charleton, *Physiologia Epicuro-Gassendo-Charltoniana* (1654, 524pp) — `b30323782`
3. John Wilkins, *Mercury* (1641, ~200pp) — `mercury-or-the-swift-and-secret-messenger`
4. John Wilkins, *Mathematicall Magick* (1648, 332pp) — `b30323915`
5. Samuel Morland, *Tuba Stentoro-Phonica* (1671, 17pp) — `bim_..._morland-sir-samuel_1671`
6. John Birchensha/Alsted, *Templum Musicum* (1664, 109pp) — `templvmmvsicvmor0000alst`

**Tier 2 — Imported:**
7. Thomas Wright, *Passions of the Minde in Generall* (1604, 399pp) — `bim_..._wright-thomas_1604`
8. William Holder, *Natural Grounds of Harmony* (1731, 223pp) — `treatiseofnatura00hold`
9. Thomas Salmon, *Essay to the Advancement of Musick* (1672, 140pp) — `essaytoadvanceme00salm`
10. Thomas Mace, *Musick's Monument* (1676, 306pp) — `musicksmonumento00mace`
11. Timothy Bright, *Treatise of Melancholie* (1586, 289pp) — `b30328846`
12. Thomas Morley, *Plaine and Easie Introduction to Practicall Musicke* (1597, 229pp) — `bim_..._morley-thomas_1597`
13. John Playford, *Briefe Introduction to the Skill of Musick* (1654, 89pp) — `bim_..._playford-john_1654`
14. Euclid/Billingsley/Dee, *Elements of Geometrie* with Dee's Praeface (1570) — `elementsgeometr00eucl`

**Tier 3 — Broader Gouk bibliography (imported Session 5):**
15. Joseph Glanvill, *Scepsis Scientifica* (1665, 302pp) — `scepsisscientifi00glaniala`
16. Joseph Glanvill, *Plus Ultra* (1668, 204pp) — `b30325080`
17. Thomas Sprat, *The History of the Royal Society of London* (1667, 480pp) — `b3032760x`
18. John Wilkins, *An Essay towards a Real Character and a Philosophical Language* (1668, 670pp) — `AnEssayTowardsARealCharacterAndAPhilosophicalLanguage`
19. William Holder, *Elements of Speech* (1669, 190pp) — `holderspeech`
20. Robert Plot, *The Natural History of Oxfordshire* (1677, 434pp) — `naturalhistoryof00plot`

### Robert Hooke Corpus (Session 5, ~1,970+ pages)

Complete importable Hooke works beyond the 2 already in library:

21. Robert Hooke, *The Diary of Robert Hooke, 1672-1680* (Robinson/Adams 1935 transcription, 582pp) — `diaryofroberthoo0000robe`
22. Robert Hooke, *An Attempt for the Explication of the Phaenomena* (1661, 46pp) — `attemptforexplic00hook`
23. Robert Hooke, *Animadversions on the first part of the Machina Coelestis* (1674, 124pp) — `animadversionson00hook`
24. Robert Hooke, *Lectures and Collections* (1678, 172pp) — `lecturesandcolle00hook`
25. Robert Hooke, *Micrographia Restaurata* (1745, 260pp) — `micrographiaresta00hook`

**Already in library (Hooke):**
- *Micrographia* (1665) — `6953e56577f38f6761bf0b7b`
- *Posthumous Works* (1705) — `695595e17bd6d2cd1d61f4fb`
- *Lectures de Potentia Restitutiva* — existing
- *Lampas* — existing
- *An Attempt to Prove the Motion of the Earth* — existing
- *A Description of Helioscopes* — existing
- *Lectiones Cutlerianae* — existing
- *Philosophical Experiments and Observations* — existing

**Note:** Hooke's actual laboratory notebooks are in the Royal Society and British Library archives, not digitized on IA. The Diary (Robinson/Adams 1935) is the key published primary source.

**Already in library (other Gouk authors — extensive coverage):**
- Francis Bacon: 79 books
- Athanasius Kircher: 24 books
- Robert Fludd: 27 books
- Giambattista della Porta: 18 books
- John Dee: *Monas Hieroglyphica* (1564) — `6952d04f77f38f6761bc4ee2`
- Robert Burton, *Anatomy of Melancholy* (1621) — `6990656f3dc2ed39a49f101f`

**Not importable:** Dee's *Mathematicall Praeface* standalone (only Gutenberg plaintext on IA; imported as part of Billingsley Euclid instead)

## Failed Imports (No JP2 on IA)

**NOTE (Mar 9):** The "JP2 barrier" was a misconception. Items without JP2 files are often still importable via IIIF manifests or `imagecount` metadata. The IA import route has a 3-way fallback: IIIF → imagecount → JP2 count. A new `/api/import/ia/check` endpoint was added to test importability without importing.

### Items genuinely not importable (no IIIF, no imagecount, no JP2):
- **Reitzenstein** — Poimandres, Mysterienreligionen
- **Scott** — Hermetica
- **Preisendanz** — Papyri Graecae Magicae vols 1-2
- **Cumont** — Textes et monuments du culte de Mithra
- **Diels** — Doxographi Graeci
- **Gardthausen** — Griechische Palaeographie vol 2
- **Montfaucon** — Palaeographia Graeca
- **Weitzmann** — Illustrations in Roll and Codex
- **Codex Sinaiticus** facsimile

### Previously thought blocked but NOW imported:
- **Festugière** — Révélation d'Hermès Trismégiste Vol. IV + Corpus Hermeticum III (imported via IIIF)
- **Berthelot** — Collection des anciens alchimistes grecs vols 2-3 (imported via alt identifiers)

### Pattern: 20th century German/French scholarly editions rarely have JP2. 19th century British institutional pubs (BM, Cambridge) often do.

## Confirmed JP2 Items NOT YET Imported

From IA advanced search (research agent findings):

| Identifier | Title | Images |
|-----------|-------|--------|
| `collectiondesanc23bert` | Berthelot Alchimistes Grecs combined vol 2+3 | 712 |
| `b24877797_0001` | Berthelot Chimie au moyen age vol 1 | 478 |
| `b24877797_0002` | Berthelot Chimie au moyen age vol 2 | 576 |
| `b24877797_0003` | Berthelot Chimie au moyen age vol 3 | 494 |
| `catalogueofsyria0000wwri` | Wright Syriac MSS BM | 654 |
| `catalogueofsyria02wrig` | Wright Syriac MSS Cambridge | 758 |
| `catalogueofsyria0001unse` | Syriac MSS Mosul | 388 |
| `catalogueofsyria0001will_q1r3` | Syriac MSS Cambridge | 590 |

Plus potentially more from: cuneiform, Coptic/Ethiopic/Armenian, Byzantine catalog, and Herculaneum category searches.

## Technical Notes

- All imports use `POST https://sourcelibrary.org/api/import/ia` with `Bearer $CRON_SECRET`
- SUCHO archive items (`sucho-id-*`) have JP2 for many Russian/Ukrainian scholarly items that standard IA doesn't
- Parallel imports (up to 6 concurrent) work well with bash `&` + `wait`
- Books auto-enroll in pipeline via Phase 0 cron (within 7 days of import)
- Berthelot vol 1 already existed: ID `699438326879ff0184cb7e24`
- Book of the Dead already existed: ID `69a5527c1e2c2347112f07cf`

## Importer Improvements (Session 4)

### `/api/import/ia/check` endpoint
- **GET** `?id=IDENTIFIER` — single item check
- **POST** `{ identifiers: ["id1", ...] }` — batch check up to 50
- Returns: `importable`, `pageCount`, `pageCountSource`, `iiifAvailable`, `alreadyExists`, `title`, `creator`, `date`
- No auth required (read-only)
- Prevents the "JP2 barrier" misconception by showing all available page count sources

### Page Count Discovery (existing in import route, now documented)
1. **IIIF manifest** (most reliable) — counts actual canvases
2. **imagecount metadata** — IA-provided field
3. **JP2 file count** — last resort, NOT required

Items returning HTTP 500 from IIIF are genuinely not importable (e.g., `worksofphilocomp0000phil`, `contracelsum0000orig`).

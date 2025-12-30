# Curator Reports

Session logs for Source Library acquisition work.

---

## 2025-12-29 05:04 CET — Session 001

### Summary
- Prepared first acquisition batch (Basil Valentine & Alchemical Corpus)
- Ran collection gap analysis
- QA spot checks on existing books
- **BLOCKED**: Archive.org global outage (503 since ~03:45 UTC)

### Batch 001 Status
| Book | IA ID | Status |
|------|-------|--------|
| Last Will and Testament | lastvvilltestame00basi | ALREADY IN COLLECTION |
| Triumphant Chariot of Antimony | b30336909 | PENDING (IA down) |
| Bruno Opera Vol II | operalatineconsc02brun | SKIPPED (duplicate) |
| Hermetic Museum Vol 1 | b24927363_0001 | PENDING (IA down) |
| Fourth Book Occult Philosophy | bib_fict_4103360 | PENDING (IA down) |
| De Occulta Philosophia Jung | DeOccultaPhilosophiaJungCollection1533 | SKIPPED (have 2 editions) |

### Google Books Check
- Searched for Triumphant Chariot: Found 1678 edition but **NO_PAGES** (not accessible)
- Google Books rarely has full public domain access for esoteric texts
- Recommend: Wait for Archive.org recovery

### Collection Stats
- 193 books total
- 74 with OCR (38%)
- Languages: Latin (85), German (34), English (9)

### Key Gaps Identified
- Thomas Vaughan (Lumen de Lumine, Aula Lucis)
- Gichtel (Theosophia Practica)
- Jane Lead (Philadelphian writings)
- Cudworth (True Intellectual System)

### QA Findings
- Spot checked De Occulta Philosophia pages 150, 400
- OCR quality: Excellent
- Translation quality: Accurate
- Page number offsets are consistent (front matter)

### Next Actions
1. Retry Archive.org imports when service recovers
2. Search for Thomas Vaughan works
3. Expand English language holdings

---

## 2025-12-29 05:17 CET — Gallica Discovery

### Alternative Source Found: Gallica (BnF)
Archive.org still down (503). Searched Gallica and found **major primary sources**:

### HIGH PRIORITY - Robert Fludd (Complete Utriusque Cosmi!)
| Title | Date | ARK | Status |
|-------|------|-----|--------|
| **Utriusque cosmi... historia** | 1617-1618 | bpt6k61073880 | PUBLIC DOMAIN |
| Tomus secundus de supernaturali | 1619 | bpt6k9802388r | PUBLIC DOMAIN |
| Philosophia sacra | 1626 | bpt6k1247982 | PUBLIC DOMAIN |
| Veritatis proscenium (vs Kepler) | 1621 | bpt6k98023895 | PUBLIC DOMAIN |
| Medicina catholica | 1629-1631 | bpt6k5596826j | PUBLIC DOMAIN |

### Paracelsus (16th c. Latin originals)
| Title | Date | ARK | Status |
|-------|------|-----|--------|
| Aurora thesaurusque philosophorum | 1577 | bpt6k65587p | PUBLIC DOMAIN |
| De Restituta utriusque medicinae | 1578 | bpt6k6531337m | PUBLIC DOMAIN |
| La grand chirurgie | 1589 | bpt6k791256 | PUBLIC DOMAIN |

### Agrippa
| Title | Date | ARK | Status |
|-------|------|-----|--------|
| De nobilitate foeminei sexus | **1529** | bpt6k71692s | PUBLIC DOMAIN |
| Déclamation sur l'incertitude | 1582 | bpt6k6266273s | PUBLIC DOMAIN |
| La philosophie occulte | 1727 | bpt6k6315516b | PUBLIC DOMAIN |

### Gallica Image URL Pattern
```
https://gallica.bnf.fr/ark:/12148/{ARK}/f{PAGE}.highres
https://gallica.bnf.fr/iiif/ark:/12148/{ARK}/manifest.json
```

### Action Required
~~Need to create Gallica import route (`/api/import/gallica`) using IIIF manifest.~~ **DONE**

### Imports Completed
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| Utriusque cosmi | Robert Fludd | 1617-1618 | 848 | 69520176ab34727b1f04136b |
| Tomus secundus (Microcosmi) | Robert Fludd | 1619 | 416 | 695201a9ab34727b1f041826 |
| Philosophia sacra | Robert Fludd | 1626 | 314 | 695201adab34727b1f0419c7 |
| Aurora thesaurusque philosophorum | Paracelsus | 1577 | 192 | 69520185ab34727b1f0416bc |
| De Restituta medicinae | Paracelsus (Dorn) | 1578 | 330 | 695201c3ab34727b1f041b02 |
| De nobilitate foeminei sexus | Agrippa | 1529 | 168 | 6952018fab34727b1f04177d |

**Total: 6 books, 2,268 new pages**

### OCR Jobs Created (05:25 CET)
All 6 books queued for batch OCR processing:
- `ICni4X0G-41y` - Fludd Utriusque (848 pages)
- `UyDsSpniCLEC` - Fludd Tomus (416 pages)
- `XsC0-lgux49T` - Fludd Philosophia (314 pages)
- `UJUvKBOaZkG4` - Paracelsus Aurora (192 pages)
- `3eZEC5Njm_lU` - Paracelsus De Restituta (330 pages)
- `VoRKaLbErRui` - Agrippa De nobilitate (168 pages)

### Additional Imports (05:30 CET)
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| Musaeum hermeticum reformatum | Various | 1678 | 882 | 695203a5ab34727b1f041c53 |
| Tripus chimicus Sendivogianus | Sendivogius | 1628 | 226 | 695203c8ab34727b1f041fc6 |

OCR Jobs: `QWIIz_GPdTiA` (882 pages), `WMOMjSGum5he` (226 pages)

**Session Total: 8 books, 3,376 pages imported**

### Batch 3 (05:35 CET) - Khunrath, Kircher, Dee, Bruno
| Title | Author | Date | Pages |
|-------|--------|------|-------|
| Amphitheatrum Sapientiae | Khunrath | 1609 | 191 |
| Musurgia universalis I | Kircher | 1650 | 751 |
| Musurgia universalis II | Kircher | 1650 | 545 |
| Sphinx mystagoga | Kircher | 1676 | 99 |
| Obeliscus pamphilius | Kircher | 1650 | 659 |
| Iter extaticum II | Kircher | 1657 | 770 |
| Monas hieroglyphica | Dee | **1564** | 61 |
| Cantus circaeus | Bruno | 1582 | 85 |
| De gli eroici furori | Bruno | 1585 | 294 |

**GRAND TOTAL: 17 books, 6,831 pages from Gallica**

All queued for batch OCR.

---

## 2025-12-29 06:15 CET — Session 002: Neoplatonic & Esoteric Expansion

### Summary
- Archive.org still down (503)
- Gallica SRU API returning security checks
- Successfully importing via direct IIIF manifest lookups
- Major Neoplatonic and esoteric texts acquired

### Source Status
| Provider | Status |
|----------|--------|
| Archive.org | **DOWN** (503 since 03:45 UTC) |
| Gallica SRU | Security check blocking API |
| Gallica IIIF | **WORKING** (direct manifest access) |

### Batch 4 Imports (06:15 CET)
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| De mysteriis Aegyptiorum | Iamblichus (trans. Ficino) | 1497 | 374 | 69520714ab34727b1f043564 |
| De incertitudine et vanitate scientiarum | Heinrich Cornelius Agrippa | 1531 | 312 | 69520717ab34727b1f0436db |
| De harmonia mundi totius | Francesco Giorgi (Giorgio Veneto) | 1545 | 1080 | 69520767ab34727b1f043814 |
| Steganographia | Johannes Trithemius | 1621 | 168 | 69520773ab34727b1f043c4d |
| Artis auriferae (Alchemy Anthology) | Various (Turba Philosophorum, Pseudo-Lull) | 1610 | 361 | 695207e4ab34727b1f043cf6 |

**Batch 4 Total: 5 books, 2,295 pages**

### Key Acquisitions Notes
- **Iamblichus De mysteriis (1497)**: Foundational Neoplatonic theurgy text, Ficino's Latin translation
- **Agrippa De incertitudine (1531)**: Skeptical counterpart to De Occulta Philosophia
- **Giorgi De harmonia mundi (1545)**: Major Cabalistic/Neoplatonic cosmology (1080 pages!)
- **Trithemius Steganographia (1621)**: Famous cryptography/angel magic treatise
- **Artis auriferae (1610)**: Contains Turba Philosophorum and major alchemical texts

### OCR Jobs Created (06:20 CET)
| Book | Job ID | Pages |
|------|--------|-------|
| Iamblichus De mysteriis | batch_1766984162064_i1lw0q | 374 |
| Agrippa De incertitudine | batch_1766984267253_m5dpxa | 311 |
| De harmonia mundi | (processing) | 1080 |
| Steganographia | batch_1766984378404_e0hwsa | 168 |
| Artis auriferae | (processing) | 361 |

### Skipped / Already Have
- Ficino Theologia Platonica (1559) - ALREADY IN COLLECTION

### Running Totals
- Session 001: 17 books, 6,831 pages
- Session 002: 5 books, 2,295 pages
- **GRAND TOTAL: 22 books, 9,126 pages from Gallica**

### Additional Batch 4 Imports (06:30 CET)
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| Zohar (Genesis) | Moses de León (attributed) | 1526 | 732 | 69520c0fab34727b1f043e63 |
| Atalanta fugiens | Michael Maier | 1618 | 229 | 69520c46ab34727b1f044141 |
| Pseudo-Dionysius Areopagita | Pseudo-Dionysius (trans. Ficino) | 1501-1600 | 92 | 69520de1ab34727b1f044227 |

### Key Acquisitions Notes (Additional)
- **Zohar Genesis (1526)**: Hebrew Cabalistic manuscript, foundational mystical text
- **Atalanta fugiens (1618)**: Maier's alchemical emblem book with musical fugues - MAJOR
- **Pseudo-Dionysius (Ficino)**: Celestial hierarchy, foundational for angel magic

### MAJOR Grimoire Acquisitions (06:45 CET)
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| Picatrix (Ghayat al-Hakim) | Pseudo-Maslama | 1500-1525 | 144 | 69520ee0ab34727b1f044285 |
| Clavicula Salomonis | Pseudo-Solomon | 1601-1700 | 71 | 69520f03ab34727b1f044317 |

### Key Acquisitions Notes (Grimoires)
- **Picatrix (1500-1525)**: Latin manuscript of THE foundational grimoire of astrological magic
- **Clavicula Salomonis (17th c.)**: The Key of Solomon, most influential Western grimoire

### Final Session 002 Totals
| Batch | Books | Pages |
|-------|-------|-------|
| Neoplatonic/Esoteric | 5 | 2,295 |
| Hebrew/Emblems/Angels | 3 | 1,053 |
| Grimoires | 2 | 215 |
| **Session 002 Total** | **10** | **3,563** |

### OCR Jobs Queued
All 10 Session 002 books queued for batch OCR:
- Iamblichus, Agrippa, Giorgi, Trithemius, Artis auriferae
- Zohar (Hebrew), Atalanta fugiens, Pseudo-Dionysius
- Picatrix, Key of Solomon

### Cumulative Totals
- Session 001: 17 books, 6,831 pages
- Session 002: 10 books, 3,563 pages
- **GRAND TOTAL: 27 books, 10,394 pages from Gallica**

### Highlights
- **Major Grimoires**: Picatrix + Key of Solomon (foundational ceremonial magic)
- **Neoplatonic Core**: Iamblichus De Mysteriis, Pseudo-Dionysius, Giorgi De Harmonia
- **Alchemical Gems**: Atalanta fugiens, Artis auriferae
- **Cabala**: Zohar Genesis manuscript (Hebrew)
- **Cryptography/Magic**: Steganographia

### Archive.org Status
Still returning 503. Pending imports when recovered:
- Triumphant Chariot of Antimony
- Hermetic Museum Vol 1
- Fourth Book of Occult Philosophy

---

## 2025-12-29 07:00 CET — Session 003: Lull, Pseudo-Aristotle, Hermetica

### Summary
- Archive.org still down (503)
- Continuing Gallica acquisition via IIIF
- Expanding into Lullian art, pseudo-Aristotelian texts, Hermetica, and witchcraft literature

### Session 003 Imports
| Title | Author | Date | Pages | Language | Book ID |
|-------|--------|------|-------|----------|---------|
| Arbor scientiae | Ramon Llull | 1515 | 723 | Latin | 69522ff2ab34727b1f044362 |
| Le roman de Blanquerna | Ramon Llull | 1301-1400 | 110 | Catalan | 69522fffab34727b1f044636 |
| Secretum secretorum (manuscript) | Pseudo-Aristotle | 1401-1500 | 68 | Latin | 6952306aab34727b1f0446a5 |
| Secretum secretorum (printed) | Pseudo-Aristotle | 1555 | 153 | Latin | 6952306eab34727b1f0446ea |
| Corpus Hermeticum (Greek) | Hermes Trismegistus | 1530-1539 | 284 | Greek | 695230c6ab34727b1f044784 |
| The Discovery of Witchcraft | Reginald Scot | 1665 | 416 | English | 6952310fab34727b1f0448a1 |

**Session 003 Total: 6 books, 1,754 pages**

### Key Acquisitions Notes (Session 003)
- **Arbor scientiae (1515)**: Lull's encyclopedic "Tree of Science" - foundational for combinatory logic
- **Blanquerna (14th c.)**: Catalan manuscript, contains "Book of the Lover and the Beloved"
- **Secretum secretorum**: The famous pseudo-Aristotelian "mirror for princes" - both manuscript and 1555 printed
- **Corpus Hermeticum (Greek)**: 16th century Greek manuscript with Hermetic texts
- **Discovery of Witchcraft (1665)**: Scot's skeptical masterpiece - first ENGLISH text this session

### Languages Added
- Catalan (new): 1 book
- Greek (new): 1 book
- English: 1 book (major expansion)

### Running Totals
- Session 001: 17 books, 6,831 pages
- Session 002: 10 books, 3,563 pages
- Session 003: 6 books, 1,754 pages
- **GRAND TOTAL: 33 books, 12,148 pages from Gallica**

### Additional Imports (07:15 CET)

**Malleus maleficarum** found on Gallica:
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| Malleus maleficarum | Kramer & Sprenger | 1486 | 266 | 69523495ab34727b1f044a45 |

**Archive.org Recovery** (07:20 CET):
Service returned 200. Imported pending Batch 001 books:
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| Triumphant Chariot of Antimony | Basil Valentine | 1678 | 385 | 695234baab34727b1f044b50 |
| The Hermetic Museum (Vol. 1) | Various | 1893 | 239 | 695234ddab34727b1f044cd2 |
| Fourth Book of Occult Philosophy | Pseudo-Agrippa | 1655 | 462 | 695234e3ab34727b1f044dc2 |

### Updated Session 003 Totals
| Source | Books | Pages |
|--------|-------|-------|
| Gallica (Lull, Pseudo-Aristotle, etc.) | 6 | 1,754 |
| Gallica (Malleus) | 1 | 266 |
| Archive.org (recovered) | 3 | 1,086 |
| **Session 003 Total** | **10** | **3,106** |

### Running Totals
- Session 001: 17 books, 6,831 pages (Gallica)
- Session 002: 10 books, 3,563 pages (Gallica)
- Session 003: 10 books, 3,106 pages (Gallica + Archive.org)
- **GRAND TOTAL: 37 books, 13,500 pages**

### OCR Jobs Queued (07:25 CET)
All Session 003 books queued for batch OCR:
- Lull Arbor, Blanquerna, Secretum secretorum (2 editions), Corpus Hermeticum, Discovery of Witchcraft
- Malleus maleficarum (Latin)
- Triumphant Chariot (English), Hermetic Museum (English), Fourth Book (Latin)

---

## 2025-12-29 08:00 CET — Session 004: Cambridge Platonism, Mysticism, Natural Magic

### Summary
- Filling key gaps identified in Session 001
- Major Cambridge Platonist and mystical texts acquired
- Both Archive.org and Gallica sources used

### Session 004 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Theosophia Practica | Johann Georg Gichtel | 1897 | 219 | Gallica | 6952584fab34727b1f044f95 |
| Lumen de Lumine | Thomas Vaughan | 1651 | 92 | IA | 69525855ab34727b1f045072 |
| Aula Lucis | Thomas Vaughan | 1652 | 64 | IA | 69525858ab34727b1f0450cf |
| True Intellectual System | Ralph Cudworth | 1678 | 1003 | IA | 69525874ab34727b1f045110 |
| Messages to Philadelphian Society | Jane Lead | 1696 | 73 | IA | 69525878ab34727b1f0454fc |
| Symbola aureae mensae | Michael Maier | 1617 | 490 | IA | 6952587bab34727b1f045546 |
| Tree of Faith | Jane Lead | 1696 | 144 | IA | 695258b9ab34727b1f045731 |
| Opus Mago-Cabbalisticum | Georg von Welling | 1760 | 810 | IA | 695258ceab34727b1f0457c2 |
| Magia naturalis | Giambattista della Porta | 1560 | 534 | IA | 695258d1ab34727b1f045aed |
| De originibus | Guillaume Postel | 1553 | 136 | Gallica | 6952592bab34727b1f045d04 |
| Philosophical Writings | Henry More | 1662 | 989 | IA | 695259b3ab34727b1f045d8e |

**Session 004 Total: 11 books, 4,554 pages**

### Key Acquisitions Notes
- **Cudworth (1678)**: Foundational Cambridge Platonist anti-atheism treatise (1003 pages!)
- **Henry More (1662)**: Collection includes Immortality of Soul, Conjectura Cabbalistica
- **Thomas Vaughan**: Both major mystical treatises (Lumen de Lumine, Aula Lucis)
- **Jane Lead**: Two Philadelphian Society works filled major gap
- **della Porta Magia naturalis (1560)**: Early natural magic classic
- **von Welling**: Major German theosophical-alchemical work
- **Maier Symbola aureae mensae**: Alchemical anthology with emblems

### Already in Collection (Skipped)
- Reuchlin De Verbo Mirifico (1514)
- Theatrum Chemicum (1659)

### OCR Jobs Queued (08:15 CET)
All 11 Session 004 books queued for batch OCR.

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| **GRAND TOTAL** | **48** | **18,054** |

---

## 2025-12-29 08:30 CET — Session 005: Pico, Böhme, Medieval Alchemy

### Summary
- Prioritizing earliest texts as requested
- Major Böhme corpus expanded
- Key medieval alchemical anthologies acquired

### Session 005 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Oratio de hominis dignitate | Pico della Mirandola | 1486 | 17 | IA | 69525f53ab34727b1f046173 |
| Aurora (English trans.) | Jakob Böhme | 1656 | 607 | IA | 69525f56ab34727b1f046185 |
| Theosophia revelata (Vol. 5) | Jakob Böhme | 1730 | 149 | IA | 69525f60ab34727b1f0463e5 |
| De signatura rerum | Jakob Böhme | 1635 | 400 | IA | 6952603cab34727b1f04647b |
| Mirror of Alchemy | Roger Bacon (attr.) | 1597 | 100 | IA | 695260d0ab34727b1f04660f |
| Auriferae artis (Turba Philosophorum) | Various | 1572 | 781 | IA | 69526137ab34727b1f046674 |
| Alchemiae Gebri Arabis | Geber (Jabir ibn Hayyan) | 1545 | 345 | IA | 69526191ab34727b1f046982 |

**Session 005 Total: 7 books, 2,399 pages**

### Key Acquisitions Notes
- **Pico Oratio (1486)**: Foundational Renaissance humanist manifesto
- **Böhme Aurora (1656)**: First English translation of his first major work
- **Böhme Signatura rerum (1635)**: Early German edition of "Signature of All Things"
- **Turba Philosophorum (1572)**: THE foundational medieval alchemical anthology
- **Geber Alchemiae (1545)**: Contains Bacon, Hermes, Tabula Smaragdina, pseudo-Lull

### Already in Collection (Skipped)
- Pico Opera Omnia (1506)
- Ficino Theologia Platonica
- Lull Ars Magna Generalis (1517)

### OCR Jobs Queued (08:45 CET)
All 7 Session 005 books queued for batch OCR.

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| **GRAND TOTAL** | **55** | **20,453** |

---

## 2025-12-29 09:00 CET — Session 006: Medieval Alchemy, Emblem Books, Grimoires

### Summary
- Key medieval alchemical texts acquired
- Major emblem books added
- Sendivogius corpus expanded

### Session 006 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Summa perfectionis magisterii | Pseudo-Geber | 1542 | 191 | IA | 695262d8ab34727b1f046ade |
| Philosophie naturelle (Flamel, Artephius) | Nicholas Flamel et al. | 1682 | 108 | Gallica | 695262ddab34727b1f046b9e |
| Miracula chymico-medica (with Novum Lumen) | Müller; Sendivogius | 1656 | 334 | IA | 69526348ab34727b1f046c0b |
| Mutus Liber (Silent Book) | Altus | 1677 | 100 | IA | 69526359ab34727b1f046d5a |

**Session 006 Total: 4 books, 733 pages**

### Key Acquisitions Notes
- **Geber Summa perfectionis (1542)**: THE foundational Latin alchemy text, Vatican exemplar
- **Flamel et al. (1682)**: Contains Livre des figures hiéroglyphiques
- **Sendivogius Novum Lumen (1656)**: Major Polish alchemist's key work
- **Mutus Liber (1677)**: Famous "silent" emblem book of alchemy

### Already in Collection (Skipped)
- Ars Notoria (1657)

### OCR Jobs Queued (09:15 CET)
All 4 Session 006 books queued for batch OCR.

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| **GRAND TOTAL** | **59** | **21,186** |

---

## 2025-12-29 13:00 CET — Session 007: Kepler and His Circle

### Summary
- Implemented chunked file-based batch OCR for large books (>10 pages)
- Acquired Kepler, Fludd, Giordano Bruno, Athanasius Kircher works
- Expanded Rosicrucian and early modern science collections

### Technical Improvements
- **Chunked Batch OCR**: Fixed 20MB payload limit by implementing file-based uploads
  - Inline mode: ≤10 pages (OCR) or ≤500 pages (translation)
  - File-based mode: 100-page chunks uploaded via Gemini File API
  - Status tracking aggregates across all chunks

### Session 007 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Epitome Astronomiae Copernicanae | Johannes Kepler | 1618 | 1,371 | IA | 69527214ab34727b1f047729 |
| Philosophia Moysaica | Robert Fludd | 1638 | 402 | IA | 69527227ab34727b1f047c85 |
| Mosaicall Philosophy | Robert Fludd | 1659 | 581 | IA | 6952722bab34727b1f047e18 |
| Veritatis Proscenium (vs Kepler) | Robert Fludd | 1621 | 175 | IA | 6952722eab34727b1f04805e |
| Integrum Morborum Mysterium | Robert Fludd | 1631 | 1,251 | IA | 6952723fab34727b1f04810e |
| Pro Suo Opere Harmonices Apologia | Johannes Kepler | 1622 | 131 | IA | 6952727dab34727b1f0485f2 |
| Le Opere Italiane | Giordano Bruno | 1888 | 1,182 | IA | 695272feab34727b1f048676 |
| Opera Latine Conscripta | Giordano Bruno | 1886 | 100 | IA | 69527313ab34727b1f048b15 |
| De Triplici Minimo et Mensura | Giordano Bruno | 1591 | 179 | IA | 69527326ab34727b1f048b7a |
| Obeliscus Pamphilius | Athanasius Kircher | 1650 | 777 | IA | 69527350ab34727b1f048c2e |
| Mundus Subterraneus | Athanasius Kircher | 1678 | 1,361 | IA | 69527367ab34727b1f048f38 |
| Magnes sive De Arte Magnetica | Athanasius Kircher | 1641 | 1,828 | IA | 69527376ab34727b1f04948a |
| Oedipus Aegyptiacus Vol II | Athanasius Kircher | 1653 | 2,904 | IA | 695273a1ab34727b1f049baf |
| Oedipus Aegyptiacus Vol III | Athanasius Kircher | 1654 | 2,756 | IA | 695273a7ab34727b1f04a708 |

**Session 007 Total: 14 books, 14,998 pages**

### Key Acquisitions Notes
- **Kepler Epitome (1618)**: Complete Copernican astronomy textbook
- **Kepler-Fludd Debate**: Both Apologia and Veritatis Proscenium (scientific vs. hermetic worldviews)
- **Fludd Mosaicall Philosophy**: English translation of his main philosophical work
- **Bruno Complete Works**: Italian & Latin collected editions
- **Kircher Magnum Opus**: Oedipus Aegyptiacus (massive hieroglyphics study)
- **Kircher Mundus Subterraneus**: Geology, volcanoes, underground world

### Already in Collection (Skipped)
- Kepler Astronomia Nova (1609)
- Kepler Harmonices Mundi (1619)
- Kepler Mysterium Cosmographicum (1621)
- Fludd Utriusque Cosmi Historia (1618)
- Tycho Brahe Opera Omnia (1648)
- Tycho Brahe Astronomiae Instauratae Mechanica (1598)
- Kircher Ars Magna Lucis et Umbrae (1645)
- Kircher Musurgia Universalis (1650)
- Kircher Oedipus Aegyptiacus Vol I (1652)
- Nicholas of Cusa De Vera Sapientia (1486)
- Fama Fraternitatis (1615)
- Chymische Hochzeit (1781 ed)

### OCR Jobs Queued
All 14 Session 007 books queued for batch OCR (testing new chunked system).

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| **GRAND TOTAL** | **73** | **36,184** |

---

## 2025-12-29 14:30 CET — Session 008: Renaissance Magic, Kabbalah, Theosophy

### Summary
- Major Renaissance Kabbalistic and magical texts
- Van Helmont iatrochemistry corpus
- Alchemical compendiums (Theatrum Chemicum)
- Swedenborg visionary works

### Session 008 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Private Diary of Dr. John Dee | John Dee | 1842 | 100 | IA | 69528509ab34727b1f04b1db |
| De Secretis Mulierum | Pseudo-Albertus Magnus | 1607 | 322 | IA | 69528549ab34727b1f04b240 |
| Ortus Medicinae | Jan Baptist van Helmont | 1648 | 1,130 | IA | 6952855fab34727b1f04b383 |
| Opuscula Medica Inaudita | Jan Baptist van Helmont | 1644 | 178 | IA | 69528566ab34727b1f04b7ee |
| Principia Philosophiae Antiquissimae | F.M. van Helmont | 1690 | 326 | IA | 69528570ab34727b1f04b8a1 |
| Conciliator Differentiarum Philosophorum | Pietro d'Abano | 1472 | 2,161 | IA | 695285a6ab34727b1f04b9e8 |
| Sepher Maphteah Shelomo | Anonymous | 1914 | 276 | IA | 695285cdab34727b1f04c25a |
| The Lesser Key of Solomon (Goetia) | Anonymous | 1916 | 100 | IA | 695285d5ab34727b1f04c36f |
| Polygraphia et De Septem Secundeis | Trithemius | 1600 | 10 | IA | 695285f6ab34727b1f04c3d4 |
| Pico Omnia Opera | Pico della Mirandola | 1519 | 390 | IA | 6952861eab34727b1f04c3df |
| Cabalistarum Selectiora Dogmata | Pico; Burgonovo | 1569 | 268 | IA | 69528622ab34727b1f04c566 |
| Picatrix | Pseudo-Maslama | 1200 | 132 | IA | 69528626ab34727b1f04c673 |
| De Harmonia Mundi | Francesco Giorgi | 1525 | 621 | IA | 69528662ab34727b1f04c6f8 |
| Origin of Letters (Sefer Yetzirah) | P. Mordell | 1914 | 38 | IA | 69528666ab34727b1f04c966 |
| Theatrum Chemicum Vol I | Zetzner (ed.) | 1659 | 809 | IA | 695286c8ab34727b1f04c98d |
| Theatrum Chemicum Vol II | Zetzner (ed.) | 1602 | 624 | IA | 695286dfab34727b1f04ccb7 |
| Alle Theosophische Wercken | Jakob Böhme | 1682 | 60 | IA | 695286feab34727b1f04cf28 |
| Der Weg zu Christo | Jakob Böhme | 1635 | 77 | IA | 69528702ab34727b1f04cf65 |
| Epistles of Jacob Behmen | Jakob Böhme | 1649 | 2 | IA | 69528706ab34727b1f04cfb3 |
| Arcana Coelestia | Swedenborg | 1749 | 717 | IA | 69528729ab34727b1f04cfb6 |
| Vera Christiana Religio | Swedenborg | 1771 | 813 | IA | 6952872cab34727b1f04d284 |
| Enchiridion Leonis Papae | Pseudo-Leo III | 1633 | 342 | IA | 6952872fab34727b1f04d5b2 |

**Session 008 Total: 22 books, 9,696 pages**

### Key Acquisitions Notes
- **Pietro d'Abano Conciliator (1472)**: Massive scholastic reconciliation of philosophy and medicine
- **Van Helmont Ortus Medicinae**: Foundational iatrochemistry text
- **Picatrix**: The most influential grimoire of astrological magic
- **De Harmonia Mundi (1525)**: Giorgi's Kabbalistic-Pythagorean cosmology - first edition!
- **Pico Opera (1519)**: Complete works including 900 Theses and Kabbalistic writings
- **Theatrum Chemicum I-II**: Parts of the essential alchemical compendium
- **Swedenborg Arcana/Vera Christiana**: Major visionary theological works
- **Enchiridion Leonis Papae**: Famous papal grimoire

### Already in Collection (Skipped)
- John Dee Monas Hieroglyphica
- Reuchlin De Verbo Mirifico
- Trithemius Steganographia
- Albertus Magnus De Mineralibus
- Fourth Book of Occult Philosophy
- Pseudo-Dionysius Opera
- Theatrum Chemicum Britannicum
- Musaeum Hermeticum
- Theatrum Chemicum Vol III

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| **GRAND TOTAL** | **95** | **45,880** |

---

## 2025-12-29 16:30 CET — Session 009: Women Authors and Texts About Women

### Summary
- First dedicated session for women's esoteric/mystical texts
- Medieval women mystics: Julian of Norwich, Marguerite Porete, Mechthild of Magdeburg, Hadewijch, Angela of Foligno
- Counter-Reformation mystics: Teresa of Ávila, Catherine of Siena
- Female alchemist: Marie Meurdrac (first chemistry book by a woman!)
- Quietist mystics: Madame Guyon
- Theosophists: Helena Blavatsky, Annie Besant, Anna Kingsford

### Session 009 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| La chymie charitable et facile | Marie Meurdrac | 1674 | 371 | Gallica | 6952898bab34727b1f04d709 |
| Recueil de divers traitez de theologie mystique | Madame Guyon | 1699 | 568 | Gallica | 695289a1ab34727b1f04d87d |
| Sixteen revelations of divine love | Julian of Norwich | 1864 | 141 | IA | 695289a9ab34727b1f04dab6 |
| The mirror of simple souls | Marguerite Porete | 1927 | 264 | IA | 695289acab34727b1f04db44 |
| The way of perfection | Teresa of Ávila | 1911 | 282 | IA | 695289bdab34727b1f04dc4d |
| Comfortable words for Christ's lovers | Julian of Norwich | 1911 | 1,122 | IA | 695289c1ab34727b1f04dd68 |
| The Key to Theosophy | Helena Blavatsky | 1889 | 1,117 | IA | 69528a11ab34727b1f04e1cb |
| The Secret Doctrine Vol. 2 | Helena Blavatsky | 1888 | 962 | IA | 69528a19ab34727b1f04e629 |
| The Perfect Way | Anna Kingsford | 1882 | 100 | IA | 69528a25ab34727b1f04e9ec |
| L'opere della serafica santa Caterina | Catherine of Siena | 1707 | 100 | IA | 69528a33ab34727b1f04ea51 |
| Isis Unveiled | Helena Blavatsky | 1877 | 663 | IA | 69528a4fab34727b1f04eab6 |
| Vie de sainte Thérèse écrite par elle-même | Teresa of Ávila | 1920 | 462 | Gallica | 69528aa5ab34727b1f04ed4e |
| Les sept méditations sur le Pater | Teresa of Ávila | 1670 | 349 | Gallica | 69528aaeab34727b1f04ef1d |
| Das fliessende Licht der Gottheit | Mechthild of Magdeburg | 1869 | 398 | IA | 69528b01ab34727b1f04f07b |
| Le livre des visions (Angèle de Foligno) | Angela of Foligno | 1921 | 243 | IA | 69528b14ab34727b1f04f20a |
| The Book of Divine Consolation | Angela of Foligno | 1908 | 404 | IA | 69528b19ab34727b1f04f2fe |
| Visionen | Hadewijch of Brabant | 1918 | 69 | IA | 69528b42ab34727b1f04f493 |
| Death--and After? | Annie Besant | 1906 | 100 | IA | 69528b65ab34727b1f04f4d9 |
| An Introduction to Yoga | Annie Besant | 1908 | 286 | IA | 69528b6bab34727b1f04f53e |

| Les nobles et cleres dames | Giovanni Boccaccio | 1493 | 309 | Gallica | 69528cf1ab34727b1f04f65d |
| De mulieribus claris (1506 Venice) | Giovanni Boccaccio | 1506 | 668 | IA | 69528f16b184004c526a0c18 |
| De claris mulieribus (14th c. trans.) | Boccaccio (Donato da Casentino) | 1841 | 100 | IA | 69528f29b184004c526a0eb5 |
| Delle donne famose | Giovanni Boccaccio | 1881 | 169 | IA | 69528f2bb184004c526a0f1a |
| De claris mulieribus (1473 Ulm incunabulum) | Giovanni Boccaccio | 1473 | 239 | MDZ | 69528ff8b184004c526a1365 |
| De claris mulieribus (1474-75 Strasbourg) | Giovanni Boccaccio | 1474 | 169 | MDZ | 69529012b184004c526a1455 |
| Von etlichen frowen (1474 Ulm German) | Boccaccio (German trans.) | 1474 | 309 | MDZ | 69529015b184004c526a14ff |
| Von etlichen frowen (1479 Augsburg German) | Boccaccio (German trans.) | 1479 | 302 | MDZ | 6952901bb184004c526a1635 |
| De claris mulieribus (1485 Brescia) | Giovanni Boccaccio | 1485 | 85 | MDZ | 6952902eb184004c526a1764 |
| Vitae sanctae Paulae (c.1471-75 Cologne) | Hieronymus (Jerome) | 1472 | 61 | MDZ | 69529033b184004c526a17ba |
| De claris selectisque mulieribus (1497 Ferrara) | Giacomo Filippo Foresti | 1497 | 361 | MDZ | 69529036b184004c526a17f8 |

**Session 009 Total: 30 books, 10,773 pages**

### Key Acquisitions Notes
- **Marie Meurdrac (1674)**: La chymie charitable - First chemistry book written by a woman, practical recipes for medicines and cosmetics
- **Julian of Norwich**: Two editions of her "Revelations of Divine Love" - foundational English mystical text
- **Marguerite Porete**: The Mirror of Simple Souls - condemned as heretical, she was burned at the stake in 1310
- **Mechthild of Magdeburg**: Das fliessende Licht der Gottheit (The Flowing Light of the Godhead) - Beguine mysticism
- **Hadewijch of Brabant**: Visionen - 13th century Beguine poet and visionary
- **Angela of Foligno**: Major Franciscan tertiary mystic, her visions influenced medieval spirituality
- **Madame Guyon**: Key Quietist texts, controversial for her mystical theology
- **Helena Blavatsky**: Founder of modern Theosophy - Isis Unveiled, Secret Doctrine, Key to Theosophy
- **Anna Kingsford**: Christian mystic and anti-vivisection activist, co-authored The Perfect Way
- **Annie Besant**: Theosophical leader, social reformer
- **Boccaccio De claris mulieribus**: 11 editions including 7 MDZ incunabula (1473-1497) and the 1493 French illuminated manuscript - the foundational Renaissance work on famous women
- **Incunabula acquired**: 7 editions from MDZ (Bavarian State Library) including the rare 1473 Ulm first illustrated edition
- **Foresti De claris selectisque mulieribus (1497)**: Expanded version of Boccaccio with additional women
- **Vitae sanctae Paulae (c.1471-75)**: Jerome's biography of St. Paula of Rome - hagiography of a learned woman

### Technical Accomplishments
- Created new MDZ (Bavarian State Library) IIIF import route: `/api/import/mdz`
- Now supports three digital library sources: Gallica, Internet Archive, and MDZ

### Women Authors Represented
- Marie Meurdrac (1613-1680) - French alchemist
- Jeanne-Marie Guyon (1648-1717) - French Quietist mystic
- Julian of Norwich (1343-1416) - English anchoress
- Marguerite Porete (d. 1310) - Beguine mystic
- Teresa of Ávila (1515-1582) - Spanish Carmelite reformer
- Catherine of Siena (1347-1380) - Dominican tertiary
- Mechthild of Magdeburg (1207-1282) - Beguine mystic
- Angela of Foligno (1248-1309) - Franciscan tertiary
- Hadewijch of Brabant (13th c.) - Beguine poet
- Helena Blavatsky (1831-1891) - Theosophical founder
- Anna Kingsford (1846-1888) - Christian mystic
- Annie Besant (1847-1933) - Theosophical leader

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| **GRAND TOTAL** | **175** | **80,786** |

---

## 2025-12-29 — Session 012: Rudolf II & James I Courts

### Summary
- Rudolf II's Prague court: alchemists, astronomers, and occult philosophers
- James I's English circle: Dee, Fludd (already in collection), and demonology
- Key figures of the "Rosicrucian Enlightenment" era

### Session 012 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Monas Hieroglyphica | John Dee | 1564 | 31 | IA | 6952d04f77f38f6761bc4ee2 |
| Basilica chymica | Oswald Croll | 1609 | 539 | IA | 6952d05177f38f6761bc4f02 |
| Basilica chymica | Oswald Croll | 1609 | 856 | MDZ | 6952d05477f38f6761bc5118 |
| Amphitheatrum sapientiae aeternae | Heinrich Khunrath | 1609 | 232 | IA | 6952d08677f38f6761bc5477 |
| True & Faithful Relation | Dee/Kelley | 1659 | 765 | IA | 6952d08877f38f6761bc5560 |
| Atalanta fugiens | Michael Maier | 1618 | 407 | IA | 6952d0c377f38f6761bc585e |
| Arcana arcanissima | Michael Maier | 1614 | 248 | IA | 6952d0c777f38f6761bc59f6 |
| Astronomiae instauratae mechanica | Tycho Brahe | 1598 | 252 | IA | 6952d0fa77f38f6761bc5aef |
| Harmonices mundi libri V | Johannes Kepler | 1619 | 572 | IA | 6952d12e77f38f6761bc5bec |
| Alchemical writings | Edward Kelly | 1893 | 135 | IA | 6952d13377f38f6761bc5e29 |
| A new light of alchymie | Sendivogius | 1650 | 288 | IA | 6952d19977f38f6761bc5eb1 |
| Epitome Astronomiae Copernicanae | Johannes Kepler | 1618 | 664 | MDZ | 6952d19c77f38f6761bc5fd2 |
| Optics (Ad Vitellionem Paralipomena) | Johannes Kepler | 1604 | 506 | MDZ | 6952d1a077f38f6761bc626b |
| De Stella nova | Johannes Kepler | 1606 | 234 | MDZ | 6952d1a477f38f6761bc6466 |

**Session 012 Total: 14 books, 5,729 pages**

### Key Acquisitions Notes
- **John Dee - Monas Hieroglyphica (1564)**: Dee's esoteric symbol unifying all knowledge
- **John Dee - True & Faithful Relation (1659)**: Enochian spirit diaries from Prague period
- **Oswald Croll - Basilica chymica (1609)**: Standard work of Paracelsian iatrochemistry
- **Heinrich Khunrath - Amphitheatrum (1609)**: Alchemical-Kabbalistic masterpiece
- **Michael Maier - Atalanta fugiens (1618)**: Alchemical emblems with 50 musical fugues
- **Tycho Brahe - Mechanica (1598)**: Description of Uraniborg instruments
- **Johannes Kepler - Harmonices mundi (1619)**: Music of the spheres, third law
- **Johannes Kepler - Optics (1604)**: Foundation of modern optics
- **Sendivogius - New Light of Alchemy (1650)**: Source for Newton's alchemical studies

### Rudolf II's Court Authors
- John Dee (1527-1608/9) - English polymath
- Edward Kelley (1555-1597/8) - Scryer
- Michael Maier (1568-1622) - Physician to Rudolf II
- Oswald Croll (c.1563-1609) - Paracelsian physician
- Heinrich Khunrath (c.1560-1605) - Hermetic philosopher
- Tycho Brahe (1546-1601) - Imperial astronomer
- Johannes Kepler (1571-1630) - Imperial Mathematician
- Michael Sendivogius (1566-1636) - Polish alchemist

---

## 2025-12-29 — Session 013: Agrippa's Circle, Dürer, and Extended Hermetic Corpus

### Summary
- Agrippa's circle: De Occulta Philosophia (additional edition)
- Albrecht Dürer: Art theory and human proportion treatises
- Robert Fludd: Major cosmological works (Utriusque Cosmi)
- Cambridge Platonists: Glanvill's Saducismus Triumphatus
- Athanasius Kircher: Egyptology and cosmology
- Giordano Bruno: Italian works
- Alchemical art: Splendor Solis, Paracelsus

### Session 013 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| De Occulta Philosophia Libri Tres | Heinrich Cornelius Agrippa | 1533 | 350 | IA | 6952daa277f38f6761bc6551 |
| De Symmetria Partium Humanorum Corporum | Albrecht Dürer | 1532 | 393 | IA | 6952dac277f38f6761bc66b0 |
| Utriusque Cosmi Historia Vol. 1 | Robert Fludd | 1617 | 1,141 | IA | 6952dac677f38f6761bc683a |
| Utriusque Cosmi Historia Vol. 2 | Robert Fludd | 1617 | 869 | IA | 6952dac977f38f6761bc6cb0 |
| Summum Bonum | Robert Fludd | 1629 | 169 | IA | 6952dacd77f38f6761bc7016 |
| Saducismus Triumphatus | Joseph Glanvill | 1700 | 829 | IA | 6952db2477f38f6761bc70c4 |
| Itinerarium Exstaticum | Athanasius Kircher | 1656 | 278 | IA | 6952db5477f38f6761bc7402 |
| Prodromus Coptus sive Aegyptiacus | Athanasius Kircher | 1636 | 215 | IA | 6952db5777f38f6761bc7519 |
| Opere di Giordano Bruno Nolano | Giordano Bruno | 1830 | 302 | IA | 6952dbc477f38f6761bc75f1 |
| Splendor Solis | Solomon Trismosin | 1920 | 113 | IA | 6952dbf977f38f6761bc7720 |
| Philosophy Reformed and Improved | Paracelsus | 1657 | 115 | IA | 6952dc0077f38f6761bc7792 |

**Session 013 Total: 11 books, 4,774 pages**

### Key Acquisitions Notes
- **Agrippa De Occulta Philosophia (1533)**: The foundational Renaissance grimoire, systematic occult philosophy
- **Dürer De Symmetria (1532)**: Posthumous treatise on human proportions, mathematical approach to beauty
- **Fludd Utriusque Cosmi (1617)**: Massive illustrated cosmological encyclopedia of macrocosm and microcosm
- **Fludd Summum Bonum (1629)**: Defense of Rosicrucianism against attacks
- **Glanvill Saducismus Triumphatus (1700)**: Cambridge Platonist defense of spirit world, witch trial evidence
- **Kircher Itinerarium Exstaticum (1656)**: Imaginary voyage through the celestial spheres
- **Kircher Prodromus Coptus (1636)**: Pioneering work on Egyptian language, Coptic as key to hieroglyphics
- **Bruno Opere (1830)**: Italian dialogues including De la causa, De l'infinito
- **Splendor Solis (1920)**: Famous illuminated alchemical manuscript with 22 allegorical paintings
- **Paracelsus Philosophy Reformed (1657)**: English translation of alchemical-philosophical treatises

### Authors Represented
- Heinrich Cornelius Agrippa von Nettesheim (1486-1535) - Occult philosopher
- Albrecht Dürer (1471-1528) - Artist and theorist
- Robert Fludd (1574-1637) - Rosicrucian philosopher
- Joseph Glanvill (1636-1680) - Cambridge Platonist
- Athanasius Kircher (1602-1680) - Baroque polymath
- Giordano Bruno (1548-1600) - Philosopher, burned for heresy
- Paracelsus (1493-1541) - Physician, alchemist
- Solomon Trismosin (legendary) - Alchemical master

### Already in Collection (Skipped)
- Fama Fraternitatis (Rosicrucian manifesto)
- Trithemius Steganographia
- Johann Weyer De Praestigiis Daemonum
- Dürer Underweysung der Messung
- Jacob Boehme Aurora and Mysterium Magnum
- Kircher Oedipus Aegyptiacus (3 volumes)
- Theatrum Chemicum Britannicum
- Musaeum Hermeticum
- Ramon Llull Ars Magna
- Paracelsus Opera (1575)
- Bruno Opera Latine
- Cudworth True Intellectual System
- Fludd Philosophia Moysaica
- Dürer Vier Bücher von menschlicher Proportion

### Session 013 Part 2: Forshaw Sources and Biblical Foundations

Following Peter J. Forshaw's scholarship on Khunrath, imported key primary sources he cites, plus foundational Biblical texts for understanding Christian Cabala and esoteric exegesis.

#### Forshaw-Cited Alchemical Sources
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Aurora Consurgens | Pseudo-Thomas Aquinas (ed. von Franz) | 1966 | 473 | IA | 6952e45177f38f6761bc7806 |
| Alchymia Triumphans | Andreas Libavius | 1607 | 711 | IA | 6952e45477f38f6761bc79e0 |
| Alchymia | Andreas Libavius | 1606 | 163 | IA | 6952e47c77f38f6761bc7ca8 |

#### Biblical Foundations
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Septuaginta (Greek Old Testament) | Septuagint | 1855 | 100 | IA | 6952e4b477f38f6761bc7d4c |
| Vetus Testamentum ex Versione Septuaginta | Septuagint (Vatican ed.) | 1822 | 166 | IA | 6952e4e277f38f6761bc9298 |
| Biblia Hebraica | Various (ed. Michaelis) | 1720 | 2,683 | IA | 6952e4bc77f38f6761bc7db1 |
| Biblia Sacra Vulgatae Editionis | Jerome (Clementine) | 1804 | 989 | IA | 6952e4c677f38f6761bc882d |
| Novum Testamentum Graece | Tischendorf | 1869 | 1,676 | IA | 6952e4cc77f38f6761bc8c0b |
| Erasmus Opera - Novum Testamentum | Desiderius Erasmus | 1705 | 635 | IA | 6952e50377f38f6761bc933f |
| The Hexaglot Bible | Various | 1901 | 857 | IA | 6952e50877f38f6761bc95bb |

**Part 2 Total: 10 books, 8,453 pages**
**Session 013 Grand Total: 21 books, 13,227 pages**

#### Key Acquisitions Notes (Part 2)
- **Aurora Consurgens**: Medieval alchemical text attributed to Thomas Aquinas, edited by Marie-Louise von Franz for Jung's Collected Works
- **Libavius Alchymia Triumphans (1607)**: Defense of alchemy against the Paris medical faculty - key source for Forshaw's Khunrath studies
- **Biblia Hebraica (1720)**: Critical Hebrew Bible with Masoretic text - essential for understanding Christian Cabala
- **Vulgate (Clementine)**: Official Latin Bible of the Catholic Church, basis for all medieval/Renaissance biblical interpretation
- **Greek NT (Tischendorf)**: Critical edition based on Codex Sinaiticus discovery - foundational for textual scholarship
- **Erasmus Novum Testamentum**: The humanist Greek NT that sparked the Reformation
- **Hexaglot Bible**: Hebrew, Septuagint, Vulgate, Syriac, English, German, French in parallel columns

---

## Session 014: Non-Canonical Ancient Texts (Original Languages)

**Date:** December 30, 2024
**Focus:** Pseudepigrapha, Gnostic texts, Dead Sea Scrolls, and Patristics in original languages (Ethiopic, Greek, Coptic, Syriac, Hebrew/Aramaic)

### Original Language Texts Imported
| Title | Language | Date | Pages | Source | Book ID |
|-------|----------|------|-------|--------|---------|
| The Ethiopic Version of the Book of Enoch | Ethiopic | 1906 | 294 | IA | 6953112e77f38f6761bcbe3b |
| Liber Jubilaeorum (Dillmann) | Ethiopic | 1859 | 181 | IA | 6953113277f38f6761bcbf62 |
| Dead Sea Scrolls: Hebrew, Aramaic, Greek | Hebrew/Aramaic | 1994 | 192 | IA | 6953113477f38f6761bcc018 |
| Oracula Sibyllina (Alexandre) | Greek | 1856 | 100 | IA | 6953113877f38f6761bcc0d9 |
| Patrum Apostolicorum Opera (Dressel) | Greek | 1863 | 825 | IA | 6953114a77f38f6761bcc13e |
| Nag Hammadi Codices (Facsimile) | Coptic | 1972 | 162 | IA | 6953114f77f38f6761bcc478 |
| Odes and Psalms of Solomon (Harris) | Syriac | 1911 | 549 | IA | 6953115277f38f6761bcc51b |
| Testamenta XII Patriarcharum (de Jonge) | Greek | 1964 | 83 | IA | 6953117a77f38f6761bcc741 |
| Apocryphon Johannis (Coptic Text) | Coptic | 1963 | 285 | IA | 6953117d77f38f6761bcc795 |
| Codex Alexandrinus (Facsimile) | Greek | 1883 | 3,846 | IA | 695311a477f38f6761bcc8b8 |
| Pistis Sophia (Schwartze) | Coptic/Latin | 1851 | 100 | IA | 6952f71777f38f6761bc997a |

**Session 014 Total: 11 books, 6,617 pages**

### Key Acquisitions Notes
- **Ethiopic Enoch (Charles 1906)**: Critical edition of the Ge'ez text of 1 Enoch
- **Liber Jubilaeorum (Dillmann 1859)**: First critical edition of the Ethiopic Jubilees
- **Dead Sea Scrolls (Hebrew/Aramaic)**: Princeton edition with original language texts
- **Oracula Sibyllina (Alexandre 1856)**: Standard Greek critical edition
- **Patrum Apostolicorum Opera (Dressel 1863)**: Greek/Latin critical edition of Apostolic Fathers
- **Nag Hammadi Codices (UNESCO 1972)**: Photographic facsimile of Coptic manuscripts
- **Odes of Solomon (Harris 1911)**: Editio princeps of the Syriac text
- **Testamenta XII Patriarcharum (de Jonge 1964)**: Critical Greek text
- **Apocryphon of John (Krause 1963)**: Critical Coptic text from Nag Hammadi
- **Codex Alexandrinus (BM 1883)**: Complete facsimile of 5th century Greek Bible
- **Pistis Sophia (Schwartze 1851)**: First edition Coptic text with Latin translation

### Languages Represented
- **Ethiopic (Ge'ez)**: 1 Enoch, Jubilees
- **Greek**: Sibylline Oracles, Apostolic Fathers, Testaments XII, Codex Alexandrinus
- **Coptic**: Nag Hammadi, Apocryphon of John, Pistis Sophia
- **Syriac**: Odes of Solomon
- **Hebrew/Aramaic**: Dead Sea Scrolls

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| Session 013 | 21 | 13,227 |
| Session 014 | 11 | 6,617 |
| **GRAND TOTAL** | **207** | **100,630** |

---

## 2025-12-29 — Session 011: Ficino's Circle (Florentine Platonists)

### Summary
- Pico della Mirandola complete works and key texts
- Poliziano humanist philology and poetry
- Landino's Neoplatonic Dante commentary and Camaldulensian Disputations
- Lorenzo de' Medici's poetry with philosophical commentary
- Pico's commentary on Benivieni's love canzone

### Session 011 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Opuscula (1496 Bologna incunabulum) | Pico della Mirandola | 1496 | 361 | MDZ | 6952b01b77f38f6761bc1cc9 |
| Opuscula cum Vita (1498 Venice) | Pico della Mirandola | 1498 | 303 | MDZ | 6952b01e77f38f6761bc1e33 |
| Examen vanitatis doctrinae gentium | Gianfrancesco Pico | 1520 | 438 | MDZ | 6952b02277f38f6761bc1f63 |
| Opera omnia (1557 Basel) | Pico della Mirandola | 1557 | 540 | IA | 6952b03577f38f6761bc211a |
| De hominis dignitate; Heptaplus; De ente et uno | Pico della Mirandola | 1942 | 804 | IA | 6952b03c77f38f6761bc2337 |
| Quaestiones Camaldulenses | Landino, Cristoforo | 1507 | 99 | IA | 6952b05277f38f6761bc265c |
| A Platonick Discourse Upon Love | Pico/Benivieni | 1651 | 100 | IA | 6952b05577f38f6761bc26c0 |
| Le stanze, Le Orfeo e Le rime | Poliziano, Angelo | 1863 | 100 | IA | 6952b06677f38f6761bc2725 |
| Commentary on a poem of platonic love | Pico/Benivieni | 1984 | 94 | IA | 6952b06a77f38f6761bc278a |
| Opere vol. 2 (poetry) | Lorenzo de' Medici | 1914 | 119 | IA | 6952b0a077f38f6761bc27e9 |
| Comento de' miei sonetti | Lorenzo de' Medici | 1991 | 84 | IA | 6952b0a277f38f6761bc2861 |
| Omnium operum tomus prior | Poliziano, Angelo | 1519 | 548 | MDZ | 6952b0fb77f38f6761bc28b7 |
| Miscellanea centuria una | Poliziano, Angelo | 1489 | 318 | MDZ | 6952b0fd77f38f6761bc2adc |
| Comento sopra la Comedia di Dante | Landino, Cristoforo | 1481 | 653 | MDZ | 6952b10077f38f6761bc2c1b |
| Dialoghi d'amore | Leone Ebreo | 1535 | 337 | IA | 6952c9c477f38f6761bc2eab |
| Plotini operum (Greek-Latin) | Plotinus/Ficino | 1580 | 100 | IA | 6952c9c777f38f6761bc2ffd |
| Plotini Enneades | Plotinus/Ficino | 1580 | 860 | MDZ | 6952c9ca77f38f6761bc3062 |
| De mysteriis Aegyptiorum | Iamblichus/Proclus/Porphyry | 1516 | 281 | IA | 6952ca2a77f38f6761bc33bf |
| Six Books on Theology of Plato | Proclus/Taylor | 1816 | 1,764 | IA | 6952ca2e77f38f6761bc34d9 |
| Sancti Dionysii Areopagitae opera | Pseudo-Dionysius | 1634 | 543 | IA | 6952ca3177f38f6761bc3bbe |
| In primum Euclidis commentaria | Proclus | 1560 | 314 | MDZ | 6952ca6877f38f6761bc3dde |
| Elementa theologica et physica | Proclus | 1618 | 152 | MDZ | 6952ca6a77f38f6761bc3f19 |
| Marini vita Procli | Marinus | 1814 | 216 | MDZ | 6952ca6e77f38f6761bc3fb2 |
| Complete Works of Plato | Plato/Taylor | 1804 | 2,850 | IA | 6952caa077f38f6761bc408b |
| Introduction to Plato | Taylor, Thomas | 1804 | 96 | IA | 6952caa277f38f6761bc4bae |
| Iamblichus on the Mysteries | Iamblichus/Taylor | 1821 | 722 | IA | 6952caa577f38f6761bc4c0f |

**Session 011 Total: 26 books, 12,796 pages**

### Key Acquisitions Notes
- **Leone Ebreo Dialoghi d'amore (1535)**: Influential Jewish Neoplatonic treatise on love
- **Plotinus Enneads (1580)**: Editio princeps with Ficino's Latin translation
- **Proclus Platonic Theology (Taylor)**: First English translation of major systematic work
- **Pseudo-Dionysius Opera**: Key source for Christian mysticism and negative theology
- **Thomas Taylor translations**: The "English Platonist" made Neoplatonism accessible to Romantics
- **Pico della Mirandola Opuscula (1496)**: First collected edition, published in Bologna shortly after his death
- **Pico Opuscula cum Vita (1498)**: Venetian edition with biography by his nephew Gianfrancesco
- **Gianfrancesco Pico - Examen vanitatis**: Major skeptical work arguing against pagan philosophy in favor of Christianity
- **Pico De hominis dignitate**: The "Oration on the Dignity of Man" - manifesto of Renaissance humanism
- **Landino Disputationes Camaldulenses**: Dialogue on active vs contemplative life, with Lorenzo de' Medici and Ficino as characters
- **Landino Dante Commentary (1481)**: First major Neoplatonic commentary on the Divine Comedy
- **Poliziano Miscellanea**: Pioneering work of humanist textual criticism
- **Poliziano Opera**: Complete Latin works including translations from Greek
- **Lorenzo de' Medici poetry**: The patron's own philosophical sonnets with self-commentary
- **Pico/Benivieni Commentary**: Pico's treatise on Platonic love, commenting on his friend Benivieni's canzone

### Authors in Ficino's Circle Represented
- Giovanni Pico della Mirandola (1463-1494) - Syncretic philosopher, Kabbalist
- Gianfrancesco Pico della Mirandola (1469-1533) - Nephew, skeptical philosopher
- Angelo Poliziano (1454-1494) - Humanist poet, philologist
- Cristoforo Landino (1424-1498) - Dante commentator, Neoplatonist
- Lorenzo de' Medici (1449-1492) - Patron, poet, "Il Magnifico"
- Girolamo Benivieni (1453-1542) - Poet, friend of Pico

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| **GRAND TOTAL** | **175** | **80,786** |

---

## 2025-12-29 — Session 012: Rudolf II & James I Courts

### Summary
- Rudolf II's Prague court: alchemists, astronomers, and occult philosophers
- James I's English circle: Dee, Fludd (already in collection), and demonology
- Key figures of the "Rosicrucian Enlightenment" era

### Session 012 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Monas Hieroglyphica | John Dee | 1564 | 31 | IA | 6952d04f77f38f6761bc4ee2 |
| Basilica chymica | Oswald Croll | 1609 | 539 | IA | 6952d05177f38f6761bc4f02 |
| Basilica chymica | Oswald Croll | 1609 | 856 | MDZ | 6952d05477f38f6761bc5118 |
| Amphitheatrum sapientiae aeternae | Heinrich Khunrath | 1609 | 232 | IA | 6952d08677f38f6761bc5477 |
| True & Faithful Relation | Dee/Kelley | 1659 | 765 | IA | 6952d08877f38f6761bc5560 |
| Atalanta fugiens | Michael Maier | 1618 | 407 | IA | 6952d0c377f38f6761bc585e |
| Arcana arcanissima | Michael Maier | 1614 | 248 | IA | 6952d0c777f38f6761bc59f6 |
| Astronomiae instauratae mechanica | Tycho Brahe | 1598 | 252 | IA | 6952d0fa77f38f6761bc5aef |
| Harmonices mundi libri V | Johannes Kepler | 1619 | 572 | IA | 6952d12e77f38f6761bc5bec |
| Alchemical writings | Edward Kelly | 1893 | 135 | IA | 6952d13377f38f6761bc5e29 |
| A new light of alchymie | Sendivogius | 1650 | 288 | IA | 6952d19977f38f6761bc5eb1 |
| Epitome Astronomiae Copernicanae | Johannes Kepler | 1618 | 664 | MDZ | 6952d19c77f38f6761bc5fd2 |
| Optics (Ad Vitellionem Paralipomena) | Johannes Kepler | 1604 | 506 | MDZ | 6952d1a077f38f6761bc626b |
| De Stella nova | Johannes Kepler | 1606 | 234 | MDZ | 6952d1a477f38f6761bc6466 |

**Session 012 Total: 14 books, 5,729 pages**

### Key Acquisitions Notes
- **John Dee - Monas Hieroglyphica (1564)**: Dee's esoteric symbol unifying all knowledge
- **John Dee - True & Faithful Relation (1659)**: Enochian spirit diaries from Prague period
- **Oswald Croll - Basilica chymica (1609)**: Standard work of Paracelsian iatrochemistry
- **Heinrich Khunrath - Amphitheatrum (1609)**: Alchemical-Kabbalistic masterpiece
- **Michael Maier - Atalanta fugiens (1618)**: Alchemical emblems with 50 musical fugues
- **Tycho Brahe - Mechanica (1598)**: Description of Uraniborg instruments
- **Johannes Kepler - Harmonices mundi (1619)**: Music of the spheres, third law
- **Johannes Kepler - Optics (1604)**: Foundation of modern optics
- **Sendivogius - New Light of Alchemy (1650)**: Source for Newton's alchemical studies

### Rudolf II's Court Authors
- John Dee (1527-1608/9) - English polymath
- Edward Kelley (1555-1597/8) - Scryer
- Michael Maier (1568-1622) - Physician to Rudolf II
- Oswald Croll (c.1563-1609) - Paracelsian physician
- Heinrich Khunrath (c.1560-1605) - Hermetic philosopher
- Tycho Brahe (1546-1601) - Imperial astronomer
- Johannes Kepler (1571-1630) - Imperial Mathematician
- Michael Sendivogius (1566-1636) - Polish alchemist

---

## 2025-12-29 — Session 013: Agrippa's Circle, Dürer, and Extended Hermetic Corpus

### Summary
- Agrippa's circle: De Occulta Philosophia (additional edition)
- Albrecht Dürer: Art theory and human proportion treatises
- Robert Fludd: Major cosmological works (Utriusque Cosmi)
- Cambridge Platonists: Glanvill's Saducismus Triumphatus
- Athanasius Kircher: Egyptology and cosmology
- Giordano Bruno: Italian works
- Alchemical art: Splendor Solis, Paracelsus

### Session 013 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| De Occulta Philosophia Libri Tres | Heinrich Cornelius Agrippa | 1533 | 350 | IA | 6952daa277f38f6761bc6551 |
| De Symmetria Partium Humanorum Corporum | Albrecht Dürer | 1532 | 393 | IA | 6952dac277f38f6761bc66b0 |
| Utriusque Cosmi Historia Vol. 1 | Robert Fludd | 1617 | 1,141 | IA | 6952dac677f38f6761bc683a |
| Utriusque Cosmi Historia Vol. 2 | Robert Fludd | 1617 | 869 | IA | 6952dac977f38f6761bc6cb0 |
| Summum Bonum | Robert Fludd | 1629 | 169 | IA | 6952dacd77f38f6761bc7016 |
| Saducismus Triumphatus | Joseph Glanvill | 1700 | 829 | IA | 6952db2477f38f6761bc70c4 |
| Itinerarium Exstaticum | Athanasius Kircher | 1656 | 278 | IA | 6952db5477f38f6761bc7402 |
| Prodromus Coptus sive Aegyptiacus | Athanasius Kircher | 1636 | 215 | IA | 6952db5777f38f6761bc7519 |
| Opere di Giordano Bruno Nolano | Giordano Bruno | 1830 | 302 | IA | 6952dbc477f38f6761bc75f1 |
| Splendor Solis | Solomon Trismosin | 1920 | 113 | IA | 6952dbf977f38f6761bc7720 |
| Philosophy Reformed and Improved | Paracelsus | 1657 | 115 | IA | 6952dc0077f38f6761bc7792 |

**Session 013 Total: 11 books, 4,774 pages**

### Key Acquisitions Notes
- **Agrippa De Occulta Philosophia (1533)**: The foundational Renaissance grimoire, systematic occult philosophy
- **Dürer De Symmetria (1532)**: Posthumous treatise on human proportions, mathematical approach to beauty
- **Fludd Utriusque Cosmi (1617)**: Massive illustrated cosmological encyclopedia of macrocosm and microcosm
- **Fludd Summum Bonum (1629)**: Defense of Rosicrucianism against attacks
- **Glanvill Saducismus Triumphatus (1700)**: Cambridge Platonist defense of spirit world, witch trial evidence
- **Kircher Itinerarium Exstaticum (1656)**: Imaginary voyage through the celestial spheres
- **Kircher Prodromus Coptus (1636)**: Pioneering work on Egyptian language, Coptic as key to hieroglyphics
- **Bruno Opere (1830)**: Italian dialogues including De la causa, De l'infinito
- **Splendor Solis (1920)**: Famous illuminated alchemical manuscript with 22 allegorical paintings
- **Paracelsus Philosophy Reformed (1657)**: English translation of alchemical-philosophical treatises

### Authors Represented
- Heinrich Cornelius Agrippa von Nettesheim (1486-1535) - Occult philosopher
- Albrecht Dürer (1471-1528) - Artist and theorist
- Robert Fludd (1574-1637) - Rosicrucian philosopher
- Joseph Glanvill (1636-1680) - Cambridge Platonist
- Athanasius Kircher (1602-1680) - Baroque polymath
- Giordano Bruno (1548-1600) - Philosopher, burned for heresy
- Paracelsus (1493-1541) - Physician, alchemist
- Solomon Trismosin (legendary) - Alchemical master

### Already in Collection (Skipped)
- Fama Fraternitatis (Rosicrucian manifesto)
- Trithemius Steganographia
- Johann Weyer De Praestigiis Daemonum
- Dürer Underweysung der Messung
- Jacob Boehme Aurora and Mysterium Magnum
- Kircher Oedipus Aegyptiacus (3 volumes)
- Theatrum Chemicum Britannicum
- Musaeum Hermeticum
- Ramon Llull Ars Magna
- Paracelsus Opera (1575)
- Bruno Opera Latine
- Cudworth True Intellectual System
- Fludd Philosophia Moysaica
- Dürer Vier Bücher von menschlicher Proportion

### Session 013 Part 2: Forshaw Sources and Biblical Foundations

Following Peter J. Forshaw's scholarship on Khunrath, imported key primary sources he cites, plus foundational Biblical texts for understanding Christian Cabala and esoteric exegesis.

#### Forshaw-Cited Alchemical Sources
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Aurora Consurgens | Pseudo-Thomas Aquinas (ed. von Franz) | 1966 | 473 | IA | 6952e45177f38f6761bc7806 |
| Alchymia Triumphans | Andreas Libavius | 1607 | 711 | IA | 6952e45477f38f6761bc79e0 |
| Alchymia | Andreas Libavius | 1606 | 163 | IA | 6952e47c77f38f6761bc7ca8 |

#### Biblical Foundations
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Septuaginta (Greek Old Testament) | Septuagint | 1855 | 100 | IA | 6952e4b477f38f6761bc7d4c |
| Vetus Testamentum ex Versione Septuaginta | Septuagint (Vatican ed.) | 1822 | 166 | IA | 6952e4e277f38f6761bc9298 |
| Biblia Hebraica | Various (ed. Michaelis) | 1720 | 2,683 | IA | 6952e4bc77f38f6761bc7db1 |
| Biblia Sacra Vulgatae Editionis | Jerome (Clementine) | 1804 | 989 | IA | 6952e4c677f38f6761bc882d |
| Novum Testamentum Graece | Tischendorf | 1869 | 1,676 | IA | 6952e4cc77f38f6761bc8c0b |
| Erasmus Opera - Novum Testamentum | Desiderius Erasmus | 1705 | 635 | IA | 6952e50377f38f6761bc933f |
| The Hexaglot Bible | Various | 1901 | 857 | IA | 6952e50877f38f6761bc95bb |

**Part 2 Total: 10 books, 8,453 pages**
**Session 013 Grand Total: 21 books, 13,227 pages**

#### Key Acquisitions Notes (Part 2)
- **Aurora Consurgens**: Medieval alchemical text attributed to Thomas Aquinas, edited by Marie-Louise von Franz for Jung's Collected Works
- **Libavius Alchymia Triumphans (1607)**: Defense of alchemy against the Paris medical faculty - key source for Forshaw's Khunrath studies
- **Biblia Hebraica (1720)**: Critical Hebrew Bible with Masoretic text - essential for understanding Christian Cabala
- **Vulgate (Clementine)**: Official Latin Bible of the Catholic Church, basis for all medieval/Renaissance biblical interpretation
- **Greek NT (Tischendorf)**: Critical edition based on Codex Sinaiticus discovery - foundational for textual scholarship
- **Erasmus Novum Testamentum**: The humanist Greek NT that sparked the Reformation
- **Hexaglot Bible**: Hebrew, Septuagint, Vulgate, Syriac, English, German, French in parallel columns

---

## Session 014: Non-Canonical Ancient Texts (Original Languages)

**Date:** December 30, 2024
**Focus:** Pseudepigrapha, Gnostic texts, Dead Sea Scrolls, and Patristics in original languages (Ethiopic, Greek, Coptic, Syriac, Hebrew/Aramaic)

### Original Language Texts Imported
| Title | Language | Date | Pages | Source | Book ID |
|-------|----------|------|-------|--------|---------|
| The Ethiopic Version of the Book of Enoch | Ethiopic | 1906 | 294 | IA | 6953112e77f38f6761bcbe3b |
| Liber Jubilaeorum (Dillmann) | Ethiopic | 1859 | 181 | IA | 6953113277f38f6761bcbf62 |
| Dead Sea Scrolls: Hebrew, Aramaic, Greek | Hebrew/Aramaic | 1994 | 192 | IA | 6953113477f38f6761bcc018 |
| Oracula Sibyllina (Alexandre) | Greek | 1856 | 100 | IA | 6953113877f38f6761bcc0d9 |
| Patrum Apostolicorum Opera (Dressel) | Greek | 1863 | 825 | IA | 6953114a77f38f6761bcc13e |
| Nag Hammadi Codices (Facsimile) | Coptic | 1972 | 162 | IA | 6953114f77f38f6761bcc478 |
| Odes and Psalms of Solomon (Harris) | Syriac | 1911 | 549 | IA | 6953115277f38f6761bcc51b |
| Testamenta XII Patriarcharum (de Jonge) | Greek | 1964 | 83 | IA | 6953117a77f38f6761bcc741 |
| Apocryphon Johannis (Coptic Text) | Coptic | 1963 | 285 | IA | 6953117d77f38f6761bcc795 |
| Codex Alexandrinus (Facsimile) | Greek | 1883 | 3,846 | IA | 695311a477f38f6761bcc8b8 |
| Pistis Sophia (Schwartze) | Coptic/Latin | 1851 | 100 | IA | 6952f71777f38f6761bc997a |

**Session 014 Total: 11 books, 6,617 pages**

### Key Acquisitions Notes
- **Ethiopic Enoch (Charles 1906)**: Critical edition of the Ge'ez text of 1 Enoch
- **Liber Jubilaeorum (Dillmann 1859)**: First critical edition of the Ethiopic Jubilees
- **Dead Sea Scrolls (Hebrew/Aramaic)**: Princeton edition with original language texts
- **Oracula Sibyllina (Alexandre 1856)**: Standard Greek critical edition
- **Patrum Apostolicorum Opera (Dressel 1863)**: Greek/Latin critical edition of Apostolic Fathers
- **Nag Hammadi Codices (UNESCO 1972)**: Photographic facsimile of Coptic manuscripts
- **Odes of Solomon (Harris 1911)**: Editio princeps of the Syriac text
- **Testamenta XII Patriarcharum (de Jonge 1964)**: Critical Greek text
- **Apocryphon of John (Krause 1963)**: Critical Coptic text from Nag Hammadi
- **Codex Alexandrinus (BM 1883)**: Complete facsimile of 5th century Greek Bible
- **Pistis Sophia (Schwartze 1851)**: First edition Coptic text with Latin translation

### Languages Represented
- **Ethiopic (Ge'ez)**: 1 Enoch, Jubilees
- **Greek**: Sibylline Oracles, Apostolic Fathers, Testaments XII, Codex Alexandrinus
- **Coptic**: Nag Hammadi, Apocryphon of John, Pistis Sophia
- **Syriac**: Odes of Solomon
- **Hebrew/Aramaic**: Dead Sea Scrolls

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| Session 013 | 21 | 13,227 |
| Session 014 | 11 | 6,617 |
| **GRAND TOTAL** | **207** | **100,630** |

---

## 2025-12-29 — Session 010: Francis Bacon

### Summary
- Complete Francis Bacon philosophical corpus
- Scientific method and natural philosophy foundational texts
- Both Latin and English editions where available

### Session 010 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Novum organum scientiarum | Francis Bacon | 1660 | 428 | MDZ | 69529492b184004c526a1963 |
| De augmentis scientiarum | Francis Bacon | 1662 | 696 | MDZ | 69529496b184004c526a1b10 |
| De sapientia veterum liber | Francis Bacon | 1633 | 216 | MDZ | 69529499b184004c526a1dc9 |
| Sylva sylvarum (Latin) | Francis Bacon | 1648 | 798 | MDZ | 6952949cb184004c526a1ea2 |
| Sylva Sylvarum, Sive Historia Naturalis | Francis Bacon | 1648 | 792 | MDZ | 69529544b184004c526a2c3c |
| Historia vitae et mortis | Francis Bacon | 1623 | 472 | MDZ | 69529509b184004c526a2793 |
| Sylva sylvarum (1631 English) | Francis Bacon | 1631 | 559 | IA | 695294acb184004c526a21c1 |
| The Advancement of Learning (1605) | Francis Bacon | 1605 | 825 | IA | 695294d8b184004c526a23f1 |
| New Atlantis | Francis Bacon | 1627 | 103 | IA | 695294dbb184004c526a272b |
| Essays (1625 edition) | Francis Bacon | 1625 | 719 | IA | 6952950cb184004c526a296c |

**Session 010 Total: 10 books, 5,608 pages**

### Key Acquisitions Notes
- **Novum Organum (1660)**: Bacon's magnum opus on scientific method, introduces the "idols" of the mind
- **De augmentis scientiarum (1662)**: Expanded Latin version of Advancement of Learning, encyclopedic classification of knowledge
- **De sapientia veterum (1633)**: Allegorical interpretations of Greek myths - shows Bacon's esoteric interests
- **Sylva Sylvarum**: Natural history experiments in "centuries" (groups of 100), includes alchemical and occult experiments
- **Historia vitae et mortis (1623)**: Medical treatise on longevity, introduces the word "euthanasia"
- **The Advancement of Learning (1605)**: First major philosophical work in English, dedicated to King James I
- **New Atlantis (1627)**: Utopian fiction featuring "Salomon's House" - prototype for scientific academies
- **Essays (1625)**: Final edition with 59 essays on civil and moral topics

### Technical Accomplishments
- Updated all import routes (MDZ, Gallica, IA) to extract actual license data from IIIF manifests and metadata APIs
- No longer hardcoding 'publicdomain' - now stores license URLs, attribution, and rights information

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| **GRAND TOTAL** | **175** | **80,786** |

---

## 2025-12-29 — Session 012: Rudolf II & James I Courts

### Summary
- Rudolf II's Prague court: alchemists, astronomers, and occult philosophers
- James I's English circle: Dee, Fludd (already in collection), and demonology
- Key figures of the "Rosicrucian Enlightenment" era

### Session 012 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Monas Hieroglyphica | John Dee | 1564 | 31 | IA | 6952d04f77f38f6761bc4ee2 |
| Basilica chymica | Oswald Croll | 1609 | 539 | IA | 6952d05177f38f6761bc4f02 |
| Basilica chymica | Oswald Croll | 1609 | 856 | MDZ | 6952d05477f38f6761bc5118 |
| Amphitheatrum sapientiae aeternae | Heinrich Khunrath | 1609 | 232 | IA | 6952d08677f38f6761bc5477 |
| True & Faithful Relation | Dee/Kelley | 1659 | 765 | IA | 6952d08877f38f6761bc5560 |
| Atalanta fugiens | Michael Maier | 1618 | 407 | IA | 6952d0c377f38f6761bc585e |
| Arcana arcanissima | Michael Maier | 1614 | 248 | IA | 6952d0c777f38f6761bc59f6 |
| Astronomiae instauratae mechanica | Tycho Brahe | 1598 | 252 | IA | 6952d0fa77f38f6761bc5aef |
| Harmonices mundi libri V | Johannes Kepler | 1619 | 572 | IA | 6952d12e77f38f6761bc5bec |
| Alchemical writings | Edward Kelly | 1893 | 135 | IA | 6952d13377f38f6761bc5e29 |
| A new light of alchymie | Sendivogius | 1650 | 288 | IA | 6952d19977f38f6761bc5eb1 |
| Epitome Astronomiae Copernicanae | Johannes Kepler | 1618 | 664 | MDZ | 6952d19c77f38f6761bc5fd2 |
| Optics (Ad Vitellionem Paralipomena) | Johannes Kepler | 1604 | 506 | MDZ | 6952d1a077f38f6761bc626b |
| De Stella nova | Johannes Kepler | 1606 | 234 | MDZ | 6952d1a477f38f6761bc6466 |

**Session 012 Total: 14 books, 5,729 pages**

### Key Acquisitions Notes
- **John Dee - Monas Hieroglyphica (1564)**: Dee's esoteric symbol unifying all knowledge
- **John Dee - True & Faithful Relation (1659)**: Enochian spirit diaries from Prague period
- **Oswald Croll - Basilica chymica (1609)**: Standard work of Paracelsian iatrochemistry
- **Heinrich Khunrath - Amphitheatrum (1609)**: Alchemical-Kabbalistic masterpiece
- **Michael Maier - Atalanta fugiens (1618)**: Alchemical emblems with 50 musical fugues
- **Tycho Brahe - Mechanica (1598)**: Description of Uraniborg instruments
- **Johannes Kepler - Harmonices mundi (1619)**: Music of the spheres, third law
- **Johannes Kepler - Optics (1604)**: Foundation of modern optics
- **Sendivogius - New Light of Alchemy (1650)**: Source for Newton's alchemical studies

### Rudolf II's Court Authors
- John Dee (1527-1608/9) - English polymath
- Edward Kelley (1555-1597/8) - Scryer
- Michael Maier (1568-1622) - Physician to Rudolf II
- Oswald Croll (c.1563-1609) - Paracelsian physician
- Heinrich Khunrath (c.1560-1605) - Hermetic philosopher
- Tycho Brahe (1546-1601) - Imperial astronomer
- Johannes Kepler (1571-1630) - Imperial Mathematician
- Michael Sendivogius (1566-1636) - Polish alchemist

---

## 2025-12-29 — Session 013: Agrippa's Circle, Dürer, and Extended Hermetic Corpus

### Summary
- Agrippa's circle: De Occulta Philosophia (additional edition)
- Albrecht Dürer: Art theory and human proportion treatises
- Robert Fludd: Major cosmological works (Utriusque Cosmi)
- Cambridge Platonists: Glanvill's Saducismus Triumphatus
- Athanasius Kircher: Egyptology and cosmology
- Giordano Bruno: Italian works
- Alchemical art: Splendor Solis, Paracelsus

### Session 013 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| De Occulta Philosophia Libri Tres | Heinrich Cornelius Agrippa | 1533 | 350 | IA | 6952daa277f38f6761bc6551 |
| De Symmetria Partium Humanorum Corporum | Albrecht Dürer | 1532 | 393 | IA | 6952dac277f38f6761bc66b0 |
| Utriusque Cosmi Historia Vol. 1 | Robert Fludd | 1617 | 1,141 | IA | 6952dac677f38f6761bc683a |
| Utriusque Cosmi Historia Vol. 2 | Robert Fludd | 1617 | 869 | IA | 6952dac977f38f6761bc6cb0 |
| Summum Bonum | Robert Fludd | 1629 | 169 | IA | 6952dacd77f38f6761bc7016 |
| Saducismus Triumphatus | Joseph Glanvill | 1700 | 829 | IA | 6952db2477f38f6761bc70c4 |
| Itinerarium Exstaticum | Athanasius Kircher | 1656 | 278 | IA | 6952db5477f38f6761bc7402 |
| Prodromus Coptus sive Aegyptiacus | Athanasius Kircher | 1636 | 215 | IA | 6952db5777f38f6761bc7519 |
| Opere di Giordano Bruno Nolano | Giordano Bruno | 1830 | 302 | IA | 6952dbc477f38f6761bc75f1 |
| Splendor Solis | Solomon Trismosin | 1920 | 113 | IA | 6952dbf977f38f6761bc7720 |
| Philosophy Reformed and Improved | Paracelsus | 1657 | 115 | IA | 6952dc0077f38f6761bc7792 |

**Session 013 Total: 11 books, 4,774 pages**

### Key Acquisitions Notes
- **Agrippa De Occulta Philosophia (1533)**: The foundational Renaissance grimoire, systematic occult philosophy
- **Dürer De Symmetria (1532)**: Posthumous treatise on human proportions, mathematical approach to beauty
- **Fludd Utriusque Cosmi (1617)**: Massive illustrated cosmological encyclopedia of macrocosm and microcosm
- **Fludd Summum Bonum (1629)**: Defense of Rosicrucianism against attacks
- **Glanvill Saducismus Triumphatus (1700)**: Cambridge Platonist defense of spirit world, witch trial evidence
- **Kircher Itinerarium Exstaticum (1656)**: Imaginary voyage through the celestial spheres
- **Kircher Prodromus Coptus (1636)**: Pioneering work on Egyptian language, Coptic as key to hieroglyphics
- **Bruno Opere (1830)**: Italian dialogues including De la causa, De l'infinito
- **Splendor Solis (1920)**: Famous illuminated alchemical manuscript with 22 allegorical paintings
- **Paracelsus Philosophy Reformed (1657)**: English translation of alchemical-philosophical treatises

### Authors Represented
- Heinrich Cornelius Agrippa von Nettesheim (1486-1535) - Occult philosopher
- Albrecht Dürer (1471-1528) - Artist and theorist
- Robert Fludd (1574-1637) - Rosicrucian philosopher
- Joseph Glanvill (1636-1680) - Cambridge Platonist
- Athanasius Kircher (1602-1680) - Baroque polymath
- Giordano Bruno (1548-1600) - Philosopher, burned for heresy
- Paracelsus (1493-1541) - Physician, alchemist
- Solomon Trismosin (legendary) - Alchemical master

### Already in Collection (Skipped)
- Fama Fraternitatis (Rosicrucian manifesto)
- Trithemius Steganographia
- Johann Weyer De Praestigiis Daemonum
- Dürer Underweysung der Messung
- Jacob Boehme Aurora and Mysterium Magnum
- Kircher Oedipus Aegyptiacus (3 volumes)
- Theatrum Chemicum Britannicum
- Musaeum Hermeticum
- Ramon Llull Ars Magna
- Paracelsus Opera (1575)
- Bruno Opera Latine
- Cudworth True Intellectual System
- Fludd Philosophia Moysaica
- Dürer Vier Bücher von menschlicher Proportion

### Session 013 Part 2: Forshaw Sources and Biblical Foundations

Following Peter J. Forshaw's scholarship on Khunrath, imported key primary sources he cites, plus foundational Biblical texts for understanding Christian Cabala and esoteric exegesis.

#### Forshaw-Cited Alchemical Sources
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Aurora Consurgens | Pseudo-Thomas Aquinas (ed. von Franz) | 1966 | 473 | IA | 6952e45177f38f6761bc7806 |
| Alchymia Triumphans | Andreas Libavius | 1607 | 711 | IA | 6952e45477f38f6761bc79e0 |
| Alchymia | Andreas Libavius | 1606 | 163 | IA | 6952e47c77f38f6761bc7ca8 |

#### Biblical Foundations
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Septuaginta (Greek Old Testament) | Septuagint | 1855 | 100 | IA | 6952e4b477f38f6761bc7d4c |
| Vetus Testamentum ex Versione Septuaginta | Septuagint (Vatican ed.) | 1822 | 166 | IA | 6952e4e277f38f6761bc9298 |
| Biblia Hebraica | Various (ed. Michaelis) | 1720 | 2,683 | IA | 6952e4bc77f38f6761bc7db1 |
| Biblia Sacra Vulgatae Editionis | Jerome (Clementine) | 1804 | 989 | IA | 6952e4c677f38f6761bc882d |
| Novum Testamentum Graece | Tischendorf | 1869 | 1,676 | IA | 6952e4cc77f38f6761bc8c0b |
| Erasmus Opera - Novum Testamentum | Desiderius Erasmus | 1705 | 635 | IA | 6952e50377f38f6761bc933f |
| The Hexaglot Bible | Various | 1901 | 857 | IA | 6952e50877f38f6761bc95bb |

**Part 2 Total: 10 books, 8,453 pages**
**Session 013 Grand Total: 21 books, 13,227 pages**

#### Key Acquisitions Notes (Part 2)
- **Aurora Consurgens**: Medieval alchemical text attributed to Thomas Aquinas, edited by Marie-Louise von Franz for Jung's Collected Works
- **Libavius Alchymia Triumphans (1607)**: Defense of alchemy against the Paris medical faculty - key source for Forshaw's Khunrath studies
- **Biblia Hebraica (1720)**: Critical Hebrew Bible with Masoretic text - essential for understanding Christian Cabala
- **Vulgate (Clementine)**: Official Latin Bible of the Catholic Church, basis for all medieval/Renaissance biblical interpretation
- **Greek NT (Tischendorf)**: Critical edition based on Codex Sinaiticus discovery - foundational for textual scholarship
- **Erasmus Novum Testamentum**: The humanist Greek NT that sparked the Reformation
- **Hexaglot Bible**: Hebrew, Septuagint, Vulgate, Syriac, English, German, French in parallel columns

---

## Session 014: Non-Canonical Ancient Texts (Original Languages)

**Date:** December 30, 2024
**Focus:** Pseudepigrapha, Gnostic texts, Dead Sea Scrolls, and Patristics in original languages (Ethiopic, Greek, Coptic, Syriac, Hebrew/Aramaic)

### Original Language Texts Imported
| Title | Language | Date | Pages | Source | Book ID |
|-------|----------|------|-------|--------|---------|
| The Ethiopic Version of the Book of Enoch | Ethiopic | 1906 | 294 | IA | 6953112e77f38f6761bcbe3b |
| Liber Jubilaeorum (Dillmann) | Ethiopic | 1859 | 181 | IA | 6953113277f38f6761bcbf62 |
| Dead Sea Scrolls: Hebrew, Aramaic, Greek | Hebrew/Aramaic | 1994 | 192 | IA | 6953113477f38f6761bcc018 |
| Oracula Sibyllina (Alexandre) | Greek | 1856 | 100 | IA | 6953113877f38f6761bcc0d9 |
| Patrum Apostolicorum Opera (Dressel) | Greek | 1863 | 825 | IA | 6953114a77f38f6761bcc13e |
| Nag Hammadi Codices (Facsimile) | Coptic | 1972 | 162 | IA | 6953114f77f38f6761bcc478 |
| Odes and Psalms of Solomon (Harris) | Syriac | 1911 | 549 | IA | 6953115277f38f6761bcc51b |
| Testamenta XII Patriarcharum (de Jonge) | Greek | 1964 | 83 | IA | 6953117a77f38f6761bcc741 |
| Apocryphon Johannis (Coptic Text) | Coptic | 1963 | 285 | IA | 6953117d77f38f6761bcc795 |
| Codex Alexandrinus (Facsimile) | Greek | 1883 | 3,846 | IA | 695311a477f38f6761bcc8b8 |
| Pistis Sophia (Schwartze) | Coptic/Latin | 1851 | 100 | IA | 6952f71777f38f6761bc997a |

**Session 014 Total: 11 books, 6,617 pages**

### Key Acquisitions Notes
- **Ethiopic Enoch (Charles 1906)**: Critical edition of the Ge'ez text of 1 Enoch
- **Liber Jubilaeorum (Dillmann 1859)**: First critical edition of the Ethiopic Jubilees
- **Dead Sea Scrolls (Hebrew/Aramaic)**: Princeton edition with original language texts
- **Oracula Sibyllina (Alexandre 1856)**: Standard Greek critical edition
- **Patrum Apostolicorum Opera (Dressel 1863)**: Greek/Latin critical edition of Apostolic Fathers
- **Nag Hammadi Codices (UNESCO 1972)**: Photographic facsimile of Coptic manuscripts
- **Odes of Solomon (Harris 1911)**: Editio princeps of the Syriac text
- **Testamenta XII Patriarcharum (de Jonge 1964)**: Critical Greek text
- **Apocryphon of John (Krause 1963)**: Critical Coptic text from Nag Hammadi
- **Codex Alexandrinus (BM 1883)**: Complete facsimile of 5th century Greek Bible
- **Pistis Sophia (Schwartze 1851)**: First edition Coptic text with Latin translation

### Languages Represented
- **Ethiopic (Ge'ez)**: 1 Enoch, Jubilees
- **Greek**: Sibylline Oracles, Apostolic Fathers, Testaments XII, Codex Alexandrinus
- **Coptic**: Nag Hammadi, Apocryphon of John, Pistis Sophia
- **Syriac**: Odes of Solomon
- **Hebrew/Aramaic**: Dead Sea Scrolls

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| Session 013 | 21 | 13,227 |
| Session 014 | 11 | 6,617 |
| **GRAND TOTAL** | **207** | **100,630** |

---

## 2025-12-29 — Session 011: Ficino's Circle (Florentine Platonists)

### Summary
- Pico della Mirandola complete works and key texts
- Poliziano humanist philology and poetry
- Landino's Neoplatonic Dante commentary and Camaldulensian Disputations
- Lorenzo de' Medici's poetry with philosophical commentary
- Pico's commentary on Benivieni's love canzone

### Session 011 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Opuscula (1496 Bologna incunabulum) | Pico della Mirandola | 1496 | 361 | MDZ | 6952b01b77f38f6761bc1cc9 |
| Opuscula cum Vita (1498 Venice) | Pico della Mirandola | 1498 | 303 | MDZ | 6952b01e77f38f6761bc1e33 |
| Examen vanitatis doctrinae gentium | Gianfrancesco Pico | 1520 | 438 | MDZ | 6952b02277f38f6761bc1f63 |
| Opera omnia (1557 Basel) | Pico della Mirandola | 1557 | 540 | IA | 6952b03577f38f6761bc211a |
| De hominis dignitate; Heptaplus; De ente et uno | Pico della Mirandola | 1942 | 804 | IA | 6952b03c77f38f6761bc2337 |
| Quaestiones Camaldulenses | Landino, Cristoforo | 1507 | 99 | IA | 6952b05277f38f6761bc265c |
| A Platonick Discourse Upon Love | Pico/Benivieni | 1651 | 100 | IA | 6952b05577f38f6761bc26c0 |
| Le stanze, Le Orfeo e Le rime | Poliziano, Angelo | 1863 | 100 | IA | 6952b06677f38f6761bc2725 |
| Commentary on a poem of platonic love | Pico/Benivieni | 1984 | 94 | IA | 6952b06a77f38f6761bc278a |
| Opere vol. 2 (poetry) | Lorenzo de' Medici | 1914 | 119 | IA | 6952b0a077f38f6761bc27e9 |
| Comento de' miei sonetti | Lorenzo de' Medici | 1991 | 84 | IA | 6952b0a277f38f6761bc2861 |
| Omnium operum tomus prior | Poliziano, Angelo | 1519 | 548 | MDZ | 6952b0fb77f38f6761bc28b7 |
| Miscellanea centuria una | Poliziano, Angelo | 1489 | 318 | MDZ | 6952b0fd77f38f6761bc2adc |
| Comento sopra la Comedia di Dante | Landino, Cristoforo | 1481 | 653 | MDZ | 6952b10077f38f6761bc2c1b |
| Dialoghi d'amore | Leone Ebreo | 1535 | 337 | IA | 6952c9c477f38f6761bc2eab |
| Plotini operum (Greek-Latin) | Plotinus/Ficino | 1580 | 100 | IA | 6952c9c777f38f6761bc2ffd |
| Plotini Enneades | Plotinus/Ficino | 1580 | 860 | MDZ | 6952c9ca77f38f6761bc3062 |
| De mysteriis Aegyptiorum | Iamblichus/Proclus/Porphyry | 1516 | 281 | IA | 6952ca2a77f38f6761bc33bf |
| Six Books on Theology of Plato | Proclus/Taylor | 1816 | 1,764 | IA | 6952ca2e77f38f6761bc34d9 |
| Sancti Dionysii Areopagitae opera | Pseudo-Dionysius | 1634 | 543 | IA | 6952ca3177f38f6761bc3bbe |
| In primum Euclidis commentaria | Proclus | 1560 | 314 | MDZ | 6952ca6877f38f6761bc3dde |
| Elementa theologica et physica | Proclus | 1618 | 152 | MDZ | 6952ca6a77f38f6761bc3f19 |
| Marini vita Procli | Marinus | 1814 | 216 | MDZ | 6952ca6e77f38f6761bc3fb2 |
| Complete Works of Plato | Plato/Taylor | 1804 | 2,850 | IA | 6952caa077f38f6761bc408b |
| Introduction to Plato | Taylor, Thomas | 1804 | 96 | IA | 6952caa277f38f6761bc4bae |
| Iamblichus on the Mysteries | Iamblichus/Taylor | 1821 | 722 | IA | 6952caa577f38f6761bc4c0f |

**Session 011 Total: 26 books, 12,796 pages**

### Key Acquisitions Notes
- **Leone Ebreo Dialoghi d'amore (1535)**: Influential Jewish Neoplatonic treatise on love
- **Plotinus Enneads (1580)**: Editio princeps with Ficino's Latin translation
- **Proclus Platonic Theology (Taylor)**: First English translation of major systematic work
- **Pseudo-Dionysius Opera**: Key source for Christian mysticism and negative theology
- **Thomas Taylor translations**: The "English Platonist" made Neoplatonism accessible to Romantics
- **Pico della Mirandola Opuscula (1496)**: First collected edition, published in Bologna shortly after his death
- **Pico Opuscula cum Vita (1498)**: Venetian edition with biography by his nephew Gianfrancesco
- **Gianfrancesco Pico - Examen vanitatis**: Major skeptical work arguing against pagan philosophy in favor of Christianity
- **Pico De hominis dignitate**: The "Oration on the Dignity of Man" - manifesto of Renaissance humanism
- **Landino Disputationes Camaldulenses**: Dialogue on active vs contemplative life, with Lorenzo de' Medici and Ficino as characters
- **Landino Dante Commentary (1481)**: First major Neoplatonic commentary on the Divine Comedy
- **Poliziano Miscellanea**: Pioneering work of humanist textual criticism
- **Poliziano Opera**: Complete Latin works including translations from Greek
- **Lorenzo de' Medici poetry**: The patron's own philosophical sonnets with self-commentary
- **Pico/Benivieni Commentary**: Pico's treatise on Platonic love, commenting on his friend Benivieni's canzone

### Authors in Ficino's Circle Represented
- Giovanni Pico della Mirandola (1463-1494) - Syncretic philosopher, Kabbalist
- Gianfrancesco Pico della Mirandola (1469-1533) - Nephew, skeptical philosopher
- Angelo Poliziano (1454-1494) - Humanist poet, philologist
- Cristoforo Landino (1424-1498) - Dante commentator, Neoplatonist
- Lorenzo de' Medici (1449-1492) - Patron, poet, "Il Magnifico"
- Girolamo Benivieni (1453-1542) - Poet, friend of Pico

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| **GRAND TOTAL** | **175** | **80,786** |

---

## 2025-12-29 — Session 012: Rudolf II & James I Courts

### Summary
- Rudolf II's Prague court: alchemists, astronomers, and occult philosophers
- James I's English circle: Dee, Fludd (already in collection), and demonology
- Key figures of the "Rosicrucian Enlightenment" era

### Session 012 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Monas Hieroglyphica | John Dee | 1564 | 31 | IA | 6952d04f77f38f6761bc4ee2 |
| Basilica chymica | Oswald Croll | 1609 | 539 | IA | 6952d05177f38f6761bc4f02 |
| Basilica chymica | Oswald Croll | 1609 | 856 | MDZ | 6952d05477f38f6761bc5118 |
| Amphitheatrum sapientiae aeternae | Heinrich Khunrath | 1609 | 232 | IA | 6952d08677f38f6761bc5477 |
| True & Faithful Relation | Dee/Kelley | 1659 | 765 | IA | 6952d08877f38f6761bc5560 |
| Atalanta fugiens | Michael Maier | 1618 | 407 | IA | 6952d0c377f38f6761bc585e |
| Arcana arcanissima | Michael Maier | 1614 | 248 | IA | 6952d0c777f38f6761bc59f6 |
| Astronomiae instauratae mechanica | Tycho Brahe | 1598 | 252 | IA | 6952d0fa77f38f6761bc5aef |
| Harmonices mundi libri V | Johannes Kepler | 1619 | 572 | IA | 6952d12e77f38f6761bc5bec |
| Alchemical writings | Edward Kelly | 1893 | 135 | IA | 6952d13377f38f6761bc5e29 |
| A new light of alchymie | Sendivogius | 1650 | 288 | IA | 6952d19977f38f6761bc5eb1 |
| Epitome Astronomiae Copernicanae | Johannes Kepler | 1618 | 664 | MDZ | 6952d19c77f38f6761bc5fd2 |
| Optics (Ad Vitellionem Paralipomena) | Johannes Kepler | 1604 | 506 | MDZ | 6952d1a077f38f6761bc626b |
| De Stella nova | Johannes Kepler | 1606 | 234 | MDZ | 6952d1a477f38f6761bc6466 |

**Session 012 Total: 14 books, 5,729 pages**

### Key Acquisitions Notes
- **John Dee - Monas Hieroglyphica (1564)**: Dee's esoteric symbol unifying all knowledge
- **John Dee - True & Faithful Relation (1659)**: Enochian spirit diaries from Prague period
- **Oswald Croll - Basilica chymica (1609)**: Standard work of Paracelsian iatrochemistry
- **Heinrich Khunrath - Amphitheatrum (1609)**: Alchemical-Kabbalistic masterpiece
- **Michael Maier - Atalanta fugiens (1618)**: Alchemical emblems with 50 musical fugues
- **Tycho Brahe - Mechanica (1598)**: Description of Uraniborg instruments
- **Johannes Kepler - Harmonices mundi (1619)**: Music of the spheres, third law
- **Johannes Kepler - Optics (1604)**: Foundation of modern optics
- **Sendivogius - New Light of Alchemy (1650)**: Source for Newton's alchemical studies

### Rudolf II's Court Authors
- John Dee (1527-1608/9) - English polymath
- Edward Kelley (1555-1597/8) - Scryer
- Michael Maier (1568-1622) - Physician to Rudolf II
- Oswald Croll (c.1563-1609) - Paracelsian physician
- Heinrich Khunrath (c.1560-1605) - Hermetic philosopher
- Tycho Brahe (1546-1601) - Imperial astronomer
- Johannes Kepler (1571-1630) - Imperial Mathematician
- Michael Sendivogius (1566-1636) - Polish alchemist

---

## 2025-12-29 — Session 013: Agrippa's Circle, Dürer, and Extended Hermetic Corpus

### Summary
- Agrippa's circle: De Occulta Philosophia (additional edition)
- Albrecht Dürer: Art theory and human proportion treatises
- Robert Fludd: Major cosmological works (Utriusque Cosmi)
- Cambridge Platonists: Glanvill's Saducismus Triumphatus
- Athanasius Kircher: Egyptology and cosmology
- Giordano Bruno: Italian works
- Alchemical art: Splendor Solis, Paracelsus

### Session 013 Imports
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| De Occulta Philosophia Libri Tres | Heinrich Cornelius Agrippa | 1533 | 350 | IA | 6952daa277f38f6761bc6551 |
| De Symmetria Partium Humanorum Corporum | Albrecht Dürer | 1532 | 393 | IA | 6952dac277f38f6761bc66b0 |
| Utriusque Cosmi Historia Vol. 1 | Robert Fludd | 1617 | 1,141 | IA | 6952dac677f38f6761bc683a |
| Utriusque Cosmi Historia Vol. 2 | Robert Fludd | 1617 | 869 | IA | 6952dac977f38f6761bc6cb0 |
| Summum Bonum | Robert Fludd | 1629 | 169 | IA | 6952dacd77f38f6761bc7016 |
| Saducismus Triumphatus | Joseph Glanvill | 1700 | 829 | IA | 6952db2477f38f6761bc70c4 |
| Itinerarium Exstaticum | Athanasius Kircher | 1656 | 278 | IA | 6952db5477f38f6761bc7402 |
| Prodromus Coptus sive Aegyptiacus | Athanasius Kircher | 1636 | 215 | IA | 6952db5777f38f6761bc7519 |
| Opere di Giordano Bruno Nolano | Giordano Bruno | 1830 | 302 | IA | 6952dbc477f38f6761bc75f1 |
| Splendor Solis | Solomon Trismosin | 1920 | 113 | IA | 6952dbf977f38f6761bc7720 |
| Philosophy Reformed and Improved | Paracelsus | 1657 | 115 | IA | 6952dc0077f38f6761bc7792 |

**Session 013 Total: 11 books, 4,774 pages**

### Key Acquisitions Notes
- **Agrippa De Occulta Philosophia (1533)**: The foundational Renaissance grimoire, systematic occult philosophy
- **Dürer De Symmetria (1532)**: Posthumous treatise on human proportions, mathematical approach to beauty
- **Fludd Utriusque Cosmi (1617)**: Massive illustrated cosmological encyclopedia of macrocosm and microcosm
- **Fludd Summum Bonum (1629)**: Defense of Rosicrucianism against attacks
- **Glanvill Saducismus Triumphatus (1700)**: Cambridge Platonist defense of spirit world, witch trial evidence
- **Kircher Itinerarium Exstaticum (1656)**: Imaginary voyage through the celestial spheres
- **Kircher Prodromus Coptus (1636)**: Pioneering work on Egyptian language, Coptic as key to hieroglyphics
- **Bruno Opere (1830)**: Italian dialogues including De la causa, De l'infinito
- **Splendor Solis (1920)**: Famous illuminated alchemical manuscript with 22 allegorical paintings
- **Paracelsus Philosophy Reformed (1657)**: English translation of alchemical-philosophical treatises

### Authors Represented
- Heinrich Cornelius Agrippa von Nettesheim (1486-1535) - Occult philosopher
- Albrecht Dürer (1471-1528) - Artist and theorist
- Robert Fludd (1574-1637) - Rosicrucian philosopher
- Joseph Glanvill (1636-1680) - Cambridge Platonist
- Athanasius Kircher (1602-1680) - Baroque polymath
- Giordano Bruno (1548-1600) - Philosopher, burned for heresy
- Paracelsus (1493-1541) - Physician, alchemist
- Solomon Trismosin (legendary) - Alchemical master

### Already in Collection (Skipped)
- Fama Fraternitatis (Rosicrucian manifesto)
- Trithemius Steganographia
- Johann Weyer De Praestigiis Daemonum
- Dürer Underweysung der Messung
- Jacob Boehme Aurora and Mysterium Magnum
- Kircher Oedipus Aegyptiacus (3 volumes)
- Theatrum Chemicum Britannicum
- Musaeum Hermeticum
- Ramon Llull Ars Magna
- Paracelsus Opera (1575)
- Bruno Opera Latine
- Cudworth True Intellectual System
- Fludd Philosophia Moysaica
- Dürer Vier Bücher von menschlicher Proportion

### Session 013 Part 2: Forshaw Sources and Biblical Foundations

Following Peter J. Forshaw's scholarship on Khunrath, imported key primary sources he cites, plus foundational Biblical texts for understanding Christian Cabala and esoteric exegesis.

#### Forshaw-Cited Alchemical Sources
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Aurora Consurgens | Pseudo-Thomas Aquinas (ed. von Franz) | 1966 | 473 | IA | 6952e45177f38f6761bc7806 |
| Alchymia Triumphans | Andreas Libavius | 1607 | 711 | IA | 6952e45477f38f6761bc79e0 |
| Alchymia | Andreas Libavius | 1606 | 163 | IA | 6952e47c77f38f6761bc7ca8 |

#### Biblical Foundations
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Septuaginta (Greek Old Testament) | Septuagint | 1855 | 100 | IA | 6952e4b477f38f6761bc7d4c |
| Vetus Testamentum ex Versione Septuaginta | Septuagint (Vatican ed.) | 1822 | 166 | IA | 6952e4e277f38f6761bc9298 |
| Biblia Hebraica | Various (ed. Michaelis) | 1720 | 2,683 | IA | 6952e4bc77f38f6761bc7db1 |
| Biblia Sacra Vulgatae Editionis | Jerome (Clementine) | 1804 | 989 | IA | 6952e4c677f38f6761bc882d |
| Novum Testamentum Graece | Tischendorf | 1869 | 1,676 | IA | 6952e4cc77f38f6761bc8c0b |
| Erasmus Opera - Novum Testamentum | Desiderius Erasmus | 1705 | 635 | IA | 6952e50377f38f6761bc933f |
| The Hexaglot Bible | Various | 1901 | 857 | IA | 6952e50877f38f6761bc95bb |

**Part 2 Total: 10 books, 8,453 pages**
**Session 013 Grand Total: 21 books, 13,227 pages**

#### Key Acquisitions Notes (Part 2)
- **Aurora Consurgens**: Medieval alchemical text attributed to Thomas Aquinas, edited by Marie-Louise von Franz for Jung's Collected Works
- **Libavius Alchymia Triumphans (1607)**: Defense of alchemy against the Paris medical faculty - key source for Forshaw's Khunrath studies
- **Biblia Hebraica (1720)**: Critical Hebrew Bible with Masoretic text - essential for understanding Christian Cabala
- **Vulgate (Clementine)**: Official Latin Bible of the Catholic Church, basis for all medieval/Renaissance biblical interpretation
- **Greek NT (Tischendorf)**: Critical edition based on Codex Sinaiticus discovery - foundational for textual scholarship
- **Erasmus Novum Testamentum**: The humanist Greek NT that sparked the Reformation
- **Hexaglot Bible**: Hebrew, Septuagint, Vulgate, Syriac, English, German, French in parallel columns

---

## Session 014: Non-Canonical Ancient Texts (Original Languages)

**Date:** December 30, 2024
**Focus:** Pseudepigrapha, Gnostic texts, Dead Sea Scrolls, and Patristics in original languages (Ethiopic, Greek, Coptic, Syriac, Hebrew/Aramaic)

### Original Language Texts Imported
| Title | Language | Date | Pages | Source | Book ID |
|-------|----------|------|-------|--------|---------|
| The Ethiopic Version of the Book of Enoch | Ethiopic | 1906 | 294 | IA | 6953112e77f38f6761bcbe3b |
| Liber Jubilaeorum (Dillmann) | Ethiopic | 1859 | 181 | IA | 6953113277f38f6761bcbf62 |
| Dead Sea Scrolls: Hebrew, Aramaic, Greek | Hebrew/Aramaic | 1994 | 192 | IA | 6953113477f38f6761bcc018 |
| Oracula Sibyllina (Alexandre) | Greek | 1856 | 100 | IA | 6953113877f38f6761bcc0d9 |
| Patrum Apostolicorum Opera (Dressel) | Greek | 1863 | 825 | IA | 6953114a77f38f6761bcc13e |
| Nag Hammadi Codices (Facsimile) | Coptic | 1972 | 162 | IA | 6953114f77f38f6761bcc478 |
| Odes and Psalms of Solomon (Harris) | Syriac | 1911 | 549 | IA | 6953115277f38f6761bcc51b |
| Testamenta XII Patriarcharum (de Jonge) | Greek | 1964 | 83 | IA | 6953117a77f38f6761bcc741 |
| Apocryphon Johannis (Coptic Text) | Coptic | 1963 | 285 | IA | 6953117d77f38f6761bcc795 |
| Codex Alexandrinus (Facsimile) | Greek | 1883 | 3,846 | IA | 695311a477f38f6761bcc8b8 |
| Pistis Sophia (Schwartze) | Coptic/Latin | 1851 | 100 | IA | 6952f71777f38f6761bc997a |

**Session 014 Total: 11 books, 6,617 pages**

### Key Acquisitions Notes
- **Ethiopic Enoch (Charles 1906)**: Critical edition of the Ge'ez text of 1 Enoch
- **Liber Jubilaeorum (Dillmann 1859)**: First critical edition of the Ethiopic Jubilees
- **Dead Sea Scrolls (Hebrew/Aramaic)**: Princeton edition with original language texts
- **Oracula Sibyllina (Alexandre 1856)**: Standard Greek critical edition
- **Patrum Apostolicorum Opera (Dressel 1863)**: Greek/Latin critical edition of Apostolic Fathers
- **Nag Hammadi Codices (UNESCO 1972)**: Photographic facsimile of Coptic manuscripts
- **Odes of Solomon (Harris 1911)**: Editio princeps of the Syriac text
- **Testamenta XII Patriarcharum (de Jonge 1964)**: Critical Greek text
- **Apocryphon of John (Krause 1963)**: Critical Coptic text from Nag Hammadi
- **Codex Alexandrinus (BM 1883)**: Complete facsimile of 5th century Greek Bible
- **Pistis Sophia (Schwartze 1851)**: First edition Coptic text with Latin translation

### Languages Represented
- **Ethiopic (Ge'ez)**: 1 Enoch, Jubilees
- **Greek**: Sibylline Oracles, Apostolic Fathers, Testaments XII, Codex Alexandrinus
- **Coptic**: Nag Hammadi, Apocryphon of John, Pistis Sophia
- **Syriac**: Odes of Solomon
- **Hebrew/Aramaic**: Dead Sea Scrolls

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Session 001 | 17 | 6,831 |
| Session 002 | 10 | 3,563 |
| Session 003 | 10 | 3,106 |
| Session 004 | 11 | 4,554 |
| Session 005 | 7 | 2,399 |
| Session 006 | 4 | 733 |
| Session 007 | 14 | 14,998 |
| Session 008 | 22 | 9,696 |
| Session 009 | 30 | 10,773 |
| Session 010 | 10 | 5,608 |
| Session 011 | 26 | 12,796 |
| Session 012 | 14 | 5,729 |
| Session 013 | 21 | 13,227 |
| Session 014 | 11 | 6,617 |
| **GRAND TOTAL** | **207** | **100,630** |

---

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

## Session 015: Non-Western Esoteric Traditions

**Date:** December 30, 2024
**Focus:** Arabic alchemy, Hebrew Kabbalah, Mandaean scriptures, Sanskrit Tantra, and Taoist inner alchemy (neidan)

### Arabic Alchemy
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Majmu nafis fi al-kimiya | Jabir ibn Hayyan | MS | 390 | IA | 6953619d9c494f9f9f042608 |
| The Works of Geber (1678) | Jabir ibn Hayyan | 1678 | 319 | IA | 695361a09c494f9f9f04278f |
| The Alchemical Works of Geber | Jabir / E.J. Holmyard | 1928 | 330 | IA | 695361c79c494f9f9f042bcb |
| Alchemical Compendium (Herat) | Ibrahim al-Husayni | 1499 | 353 | IA | 695361ba9c494f9f9f042a69 |
| Picatrix (Ghāyat al-Ḥakīm) | al-Majriti (attrib.) | c. 1000 | 275 | IA | 695361879c494f9f9f0424f4 |
| Ghayat al-Hakim (Arabic MS) | Maslama al-Majriti | MS | 748 | IA | 695361cd9c494f9f9f042f19 |

**Arabic Alchemy Total: 6 books, 2,415 pages**

### Hebrew Kabbalah
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Sefer HaBahir (Book of Illumination) | Aryeh Kaplan | 1979 | 278 | IA | 695361b59c494f9f9f0428cf |
| Origins of the Kabbalah | Gershom Scholem | 1987 | 514 | IA | 695361cb9c494f9f9f042d16 |

**Hebrew Kabbalah Total: 2 books, 792 pages**

### Ethiopian Magic
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Ethiopian Magic Scrolls | Jacques Mercier | 1979 | 130 | IA | 695361b79c494f9f9f0429e6 |

**Ethiopian Total: 1 book, 130 pages**

### Mandaean Scriptures
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Ginza Rabba (Mandaean Holy Book) | Lidzbarski / Ram Al-Sabiry | 2012 | 393 | IA | 695362099c494f9f9f043206 |
| Canonical Prayer Book of the Mandaeans | E.S. Drower | 1959 | 435 | IA | 6953621ee5b8ba20744132a1 |

**Mandaean Total: 2 books, 828 pages**

### Sanskrit Tantra
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| Tantric Texts Series | Arthur Avalon / John Woodroffe | 1913-1940 | 452 | IA | 6953620c9c494f9f9f043390 |
| Tantra Manuscripts | Haraprasada Shastri | 1939 | 846 | IA | 695362109c494f9f9f043555 |
| Yoga Tantra Vimarshini | Gopinath Kaviraj | 1963 | 283 | IA | 69536223e5b8ba2074413455 |

**Sanskrit Total: 3 books, 1,581 pages**

### Taoist Alchemy (Neidan)
| Title | Author | Date | Pages | Source | Book ID |
|-------|--------|------|-------|--------|---------|
| The Secret of the Golden Flower | Richard Wilhelm (tr.) | 1931 | 363 | IA | 695363bc77f38f6761bcddfa |
| The Secret of the Golden Flower (Cleary) | Lu Dongbin / Thomas Cleary | 1991 | 83 | IA | 695363dd77f38f6761bce25f |
| Baopuzi (Nei Pien of Ko Hung) | Ge Hong / James R. Ware | 1967 | 418 | IA | 695363c077f38f6761bcdf66 |
| Taoist Yoga: Alchemy and Immortality | Lu Kuan Yu (Charles Luk) | 1970 | 186 | IA | 695363c377f38f6761bce109 |
| Understanding Reality (Wuzhen pian) | Zhang Boduan / Thomas Cleary | 1988 | 62 | IA | 695363c577f38f6761bce1c4 |
| Vitality, Energy, Spirit: A Taoist Sourcebook | Thomas Cleary (ed.) | 1991 | 91 | IA | 695363db77f38f6761bce203 |
| Science and Civilisation in China Vol. 5 | Joseph Needham | 1974 | 578 | IA | 695363df77f38f6761bce2b3 |
| Alchemy of the Ancient Orient | Masumi Chikashige | 1936 | 158 | IA | 695363e177f38f6761bce4f6 |
| Immortal Sisters | Thomas Cleary (tr.) | 1989 | 90 | IA | 695363f477f38f6761bce595 |
| Early Chinese Mysticism | Livia Kohn | 1991 | 238 | IA | 695363f677f38f6761bce5f0 |
| The Book of Master Lie (Liezi) | Thomas Cleary (tr.) | 1991 | 184 | IA | 695363f877f38f6761bce6df |
| The Taoism Reader | Thomas Cleary (ed.) | 2000 | 55 | IA | 695363fa77f38f6761bce798 |

**Taoist Alchemy Total: 12 books, 2,506 pages**

### Session 015 Summary

| Tradition | Books | Pages |
|-----------|-------|-------|
| Arabic Alchemy | 6 | 2,415 |
| Hebrew Kabbalah | 2 | 792 |
| Ethiopian Magic | 1 | 130 |
| Mandaean Scriptures | 2 | 828 |
| Sanskrit Tantra | 3 | 1,581 |
| Taoist Alchemy | 12 | 2,506 |
| **Session 015 Total** | **26** | **8,252** |

### Key Acquisitions Notes

#### Arabic Alchemy
- **Jabir ibn Hayyan MS**: Original Arabic alchemical manuscript from NLM collection
- **Works of Geber (1678)**: Early English translation of Pseudo-Geber corpus
- **Holmyard Geber (1928)**: Scholarly critical edition of Latin Geber texts
- **Herat Compendium (1499)**: 15th century Arabic alchemical compilation from LJS collection
- **Picatrix/Ghayat al-Hakim**: The most influential Arabic grimoire, foundational for Renaissance magic

#### Mandaean Scriptures
- **Ginza Rabba**: The "Great Treasure" - central scripture of the Mandaean Gnostic religion
- **Canonical Prayer Book**: E.S. Drower's edition of Mandaean liturgical texts

#### Sanskrit Tantra
- **Arthur Avalon/Woodroffe Series**: Foundational English translations of Tantric texts
- **Shastri Manuscripts**: Critical editions of Bengali Tantric manuscripts
- **Kaviraj Yoga Tantra**: Commentary on yoga and tantra synthesis

#### Taoist Inner Alchemy
- **Secret of the Golden Flower**: Two translations (Wilhelm 1931, Cleary 1991) of this foundational neidan text
- **Baopuzi (Nei Pien)**: Ge Hong's 4th century classic on external and internal alchemy
- **Wuzhen pian**: Zhang Boduan's masterpiece on internal alchemy (11th century)
- **Needham Vol. 5**: Definitive scholarly treatment of Chinese alchemy in its scientific context
- **Lu Kuan Yu Taoist Yoga**: Detailed practical guide to neidan meditation

### Languages Added
- **Arabic**: Classical alchemical manuscripts
- **Hebrew**: Kabbalistic texts
- **Mandaic**: Gnostic scriptures
- **Sanskrit**: Tantric texts
- **Chinese**: Taoist internal alchemy (English translations)

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
| Session 015 | 26 | 8,252 |
| **GRAND TOTAL** | **233** | **108,882** |

---

## Session 016: Byzantine Greek Texts

**Date:** December 30, 2024
**Focus:** Greek patristics, Byzantine historians, and monastic literature from Internet Archive

### Research Notes
- **Mount Athos Digital Heritage**: 2.2M manuscript images, 15,000+ manuscripts digitized but access restricted
- **Library of Congress**: Greek manuscripts from Mt Athos photographed in 1952
- **Princeton Byzantine Studies**: 3,360+ manuscript descriptions
- **Key Public Access Sources**: Internet Archive Patrologia Graeca and Corpus Byzantinae

### Patrologia Graeca (Migne) Imports
| Title | Author | Vol. | Pages | Book ID |
|-------|--------|------|-------|---------|
| PG Vol. 1 - Clement of Rome | Migne (ed.) | 1 | 100 | 6953a5a377f38f6761bcff67 |
| PG Vol. 5 - Justin Martyr | Migne (ed.) | 5 | 100 | 6953a5a877f38f6761bcffcc |
| PG Vol. 7 - Irenaeus of Lyon | Migne (ed.) | 7 | 100 | 6953a5f877f38f6761bd0359 |
| PG Vol. 11 - Origen | Migne (ed.) | 11 | 100 | 6953a5ad77f38f6761bd0031 |
| PG Vol. 25 - Athanasius | Migne (ed.) | 25 | 100 | 6953a5bc77f38f6761bd0096 |
| PG Vol. 31 - Basil of Caesarea | Migne (ed.) | 31 | 100 | 6953a5ce77f38f6761bd00fb |
| PG Vol. 36 - Gregory of Nazianzus | Migne (ed.) | 36 | 100 | 6953a5f377f38f6761bd02f4 |
| PG Vol. 44 - Gregory of Nyssa | Migne (ed.) | 44 | 100 | 6953a5d377f38f6761bd0160 |
| PG Vol. 47 - John Chrysostom I | Migne (ed.) | 47 | 100 | 6953a5d877f38f6761bd01c5 |
| PG Vol. 65 - Desert Fathers (Apophthegmata) | Migne (ed.) | 65 | 100 | 6953a5fd77f38f6761bd03be |
| PG Vol. 90 - Maximus Confessor | Migne (ed.) | 90 | 100 | 6953a5dd77f38f6761bd022a |
| PG Vol. 94 - John of Damascus | Migne (ed.) | 94 | 100 | 6953a5ee77f38f6761bd028f |

**Patrologia Graeca Total: 12 books, 1,200 pages**

### Corpus Scriptorum Historiae Byzantinae
| Title | Author/Editor | Vol. | Pages | Book ID |
|-------|---------------|------|-------|---------|
| CSHB Vol. 1 - Procopius | Niebuhr (ed.) | 1 | 100 | 6953a61877f38f6761bd0423 |
| CSHB Vol. 3 - Agathias | Niebuhr (ed.) | 3 | 100 | 6953a61c77f38f6761bd0488 |
| CSHB Vol. 14 | Niebuhr (ed.) | 14 | 1,028 | 6953a55277f38f6761bcfb62 |
| CSHB Vol. 20 - Anna Comnena Alexiad | Niebuhr (ed.) | 20 | 100 | 6953a62177f38f6761bd04ed |
| CSHB Vol. 34 - Theophanes | Niebuhr (ed.) | 34 | 100 | 6953a62677f38f6761bd0552 |

**Corpus Byzantinae Total: 5 books, 1,428 pages**

### Byzantine Greek Standalone Texts
| Title | Author | Date | Pages | Book ID |
|-------|--------|------|-------|---------|
| Philokalia (Greek Text) | Various | 1893 | 884 | 6953a54c77f38f6761bcf531 |
| Origenis Philocalia | Origen / Robinson | 1677 | 699 | 6953a54f77f38f6761bcf8a6 |
| Dionysius Areopagita Opera Omnia | Pseudo-Dionysius | - | 100 | 6953a63877f38f6761bd05b7 |
| Scala Paradisi | John Climacus | - | 100 | 6953a63d77f38f6761bd061c |
| Ecclesiastical History | Eusebius of Caesarea | - | 100 | 6953a64277f38f6761bd0681 |
| Bibliotheca (Codex) | Photius I | - | 100 | 6953a64977f38f6761bd06e6 |
| Works (Greek) | Cyril of Alexandria | - | 100 | 6953a65b77f38f6761bd074b |
| Church History | Theodoret of Cyrus | - | 100 | 6953a66077f38f6761bd07b0 |
| Church History | Socrates Scholasticus | - | 100 | 6953a66677f38f6761bd0815 |
| Panarion | Epiphanius of Salamis | - | 100 | 6953a66b77f38f6761bd087a |

**Standalone Texts Total: 10 books, 2,383 pages**

### Session 016 Summary

| Category | Books | Pages |
|----------|-------|-------|
| Patrologia Graeca | 12 | 1,200 |
| Corpus Byzantinae | 5 | 1,428 |
| Standalone Texts | 10 | 2,383 |
| **Session 016 Total** | **27** | **5,011** |

### Key Acquisitions Notes

#### Patrologia Graeca
The standard reference edition for Greek Church Fathers (161 volumes total). Key volumes imported:
- **Vol. 1**: Clement of Rome - earliest post-apostolic writings
- **Vol. 7**: Irenaeus - foundational anti-heretical work
- **Vol. 25**: Athanasius - key Nicene theologian
- **Vol. 31**: Basil the Great - Cappadocian Father, monastic legislator
- **Vol. 44**: Gregory of Nyssa - philosophical theologian
- **Vol. 47**: John Chrysostom - greatest Greek preacher
- **Vol. 65**: Apophthegmata Patrum - Desert Fathers sayings
- **Vol. 90**: Maximus Confessor - Byzantine mystical theology
- **Vol. 94**: John of Damascus - systematic Byzantine theology

#### Byzantine Historians
- **Procopius**: 6th century historian of Justinian's wars
- **Agathias**: Continuation of Procopius
- **Anna Comnena**: Alexiad - 12th century Byzantine princess historian
- **Theophanes**: Chronicle covering 284-813 CE

#### Mystical Texts
- **Philokalia (Athens 1893)**: Standard Greek edition of hesychast spiritual texts
- **Pseudo-Dionysius**: Foundational mystical theology (Celestial/Ecclesiastical Hierarchies)
- **John Climacus**: Ladder of Divine Ascent - classic of ascetic spirituality

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
| Session 015 | 26 | 8,252 |
| Session 016 | 27 | 5,011 |
| **GRAND TOTAL** | **260** | **113,893** |

---

## Session 017: Byzantine Greek Manuscripts & Patristics (Extended)

**Date:** December 30, 2024
**Focus:** Major Greek manuscript facsimiles, biblical codices, Byzantine historians, hesychast texts, and hymnography

### Biblical Codices & Critical Editions
| Title | Author/Editor | Pages | Book ID |
|-------|---------------|-------|---------|
| Monumenta Sacra Inedita | Tischendorf | 767 | 6953a86177f38f6761bd0d10 |
| Codex Vaticanus (B) Facsimile | Vatican Library | 134 | 6953a86577f38f6761bd1010 |
| Novum Testamentum Graece | Tischendorf | 2,109 | 6953a88c77f38f6761bd19d6 |
| Greek Old Testament (10 vols) | Tischendorf | 4,369 | 6953a8a477f38f6761bd2334 |
| Septuagint Codex Vaticanus Edition | Brooke/McLean | 287 | 6953a89077f38f6761bd2214 |
| Codex Sinaiticus Facsimile | Tischendorf | 628 | 6953a8b277f38f6761bd365c |
| Chester Beatty Biblical Papyri | Kenyon | 82 | 6953a8ac77f38f6761bd3609 |
| Interlinear Greek-English Septuagint | Various | 3,665 | 6953a8d677f38f6761bd3ac2 |

**Biblical Codices Total: 8 books, 12,041 pages**

### Byzantine Court & History
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Synaxarium Constantinopolitanae | Delehaye (ed.) | 174 | 6953a86877f38f6761bd1097 |
| De Ceremoniis Aulae Byzantinae | Constantine VII | 877 | 6953a86d77f38f6761bd1146 |
| De Administrando Imperio | Constantine VII | 457 | 6953a88377f38f6761bd16b9 |
| Digenes Akrites (Byzantine Epic) | Anonymous | 262 | 6953a88877f38f6761bd18cf |
| Chronographia | Michael Psellus | 450 | 6953a8a877f38f6761bd3446 |
| Nicephori Gregorae Historia | Nicephorus Gregoras | 811 | 6953a96577f38f6761bd61d8 |
| Leonis Diaconi Historia | Leo the Deacon | 675 | 6953a96877f38f6761bd6504 |

**Byzantine History Total: 7 books, 3,706 pages**

### Hesychasm & Mystical Theology
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Traités Théologiques - Symeon | Symeon New Theologian | 542 | 6953a8e577f38f6761bd4914 |
| Defense des Saints Hesychastes | Gregory Palamas | 1,925 | 6953a8f977f38f6761bd4b33 |
| The Way of a Pilgrim | Anonymous (Russian) | 204 | 6953a8fd77f38f6761bd52b9 |
| On the Prayer of Jesus | Ignatius Brianchaninov | 214 | 6953a90077f38f6761bd5386 |

**Hesychasm Total: 4 books, 2,885 pages**

### Desert Fathers & Monasticism
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Anonymous Sayings of Desert Fathers | Wortley (trans.) | 496 | 6953a8d277f38f6761bd38d1 |
| Apophthegmata Studien | W. Bousset | 362 | 6953a93177f38f6761bd5789 |
| Institutions de Cassien | John Cassian | 322 | 6953a92e77f38f6761bd5646 |

**Monasticism Total: 3 books, 1,180 pages**

### Syriac/Greek Patristics
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Ephraem Syri Opera Omnia | Ephrem the Syrian | 100 | 6953a91277f38f6761bd545d |
| Rhythms of Saint Ephrem | Ephrem the Syrian | 387 | 6953a91677f38f6761bd54c2 |
| Nicephorus & Theodore Studite Opera | Nicephorus/Theodore | 741 | 6953a96277f38f6761bd5ef2 |

**Patristics Total: 3 books, 1,228 pages**

### Byzantine Music & Hymnography
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| History of Byzantine Music | Egon Wellesz | 498 | 6953a94277f38f6761bd5b21 |
| Three Byzantine Sacred Poets | Various | 90 | 6953a94577f38f6761bd5d14 |
| Essays on Music in Byzantine World | Oliver Strunk | 386 | 6953a94777f38f6761bd5d6f |

**Hymnography Total: 3 books, 974 pages**

### Session 017 Summary

| Category | Books | Pages |
|----------|-------|-------|
| Biblical Codices & Critical Editions | 8 | 12,041 |
| Byzantine Court & History | 7 | 3,706 |
| Hesychasm & Mystical Theology | 4 | 2,885 |
| Desert Fathers & Monasticism | 3 | 1,180 |
| Syriac/Greek Patristics | 3 | 1,228 |
| Byzantine Music & Hymnography | 3 | 974 |
| **Session 017 Total** | **28** | **22,014** |

### Key Acquisitions Notes

#### Biblical Manuscripts
- **Tischendorf Monumenta Sacra Inedita**: Previously unpublished sacred manuscripts from various libraries
- **Codex Vaticanus/Sinaiticus**: The two most important 4th century biblical manuscripts
- **Chester Beatty Papyri**: 3rd century biblical papyri, among oldest witnesses to NT text
- **Tischendorf Greek OT (10 vols)**: Critical apparatus for Septuagint text

#### Byzantine Sources
- **De Ceremoniis**: Constantine VII's detailed account of Byzantine court ritual
- **De Administrando Imperio**: Byzantine statecraft and foreign policy manual
- **Digenes Akrites**: The great Byzantine frontier epic
- **Psellus Chronographia**: 11th century court insider history
- **Nicephorus Gregoras**: 14th century Byzantine historian (Palaeologan period)
- **Leo the Deacon**: 10th century military history

#### Hesychast Tradition
- **Palamas Triads**: Foundational defense of hesychast prayer and theology of divine energies
- **Symeon New Theologian**: 11th century mystic, central figure in Byzantine spirituality
- **Way of a Pilgrim**: 19th century Russian classic on Jesus Prayer practice

### Access Notes
- **LOC Mt Athos Collection**: 209 manuscripts digitized from 1952 microfilms, available at loc.gov
- **British Library Greek MSS**: 900+ manuscripts, IIIF-enabled but requires individual manifest lookup
- **Vatican Digital Library**: Free access at digi.vatlib.it

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Sessions 001-015 | 233 | 108,882 |
| Session 016 | 27 | 5,011 |
| Session 017 | 28 | 22,014 |
| **GRAND TOTAL** | **288** | **135,907** |

---

## 2025-12-30 — Session 018: Ancient Manuscript Facsimiles

### Focus
Import of ancient manuscript facsimiles - actual photographic reproductions of original handwritten/inscribed sources rather than printed editions.

### Biblical Codex Facsimiles
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Codex Alexandrinus Facsimile | Frederic G. Kenyon | 346 | 6953cbb777f38f6761bdfc4d |
| Nag Hammadi Codices - Codex II | Egyptian Coptic Museum | 194 | 6953cbbb77f38f6761bdfda8 |
| Nag Hammadi Codices - Codex V | Egyptian Coptic Museum | 130 | 6953cbbe77f38f6761bdfe6b |
| Nag Hammadi Codices - Codex VII | Egyptian Coptic Museum | 162 | 6953cbc177f38f6761bdfeee |
| Nag Hammadi Codices - Codex III | Egyptian Coptic Museum | 184 | 6953cbc477f38f6761bdff91 |
| Codex Nuttall (Pre-Columbian Mixtec) | Zelia Nuttall | 94 | 6953cbc877f38f6761be004a |

**Biblical Codex Facsimiles Total: 6 books, 1,110 pages**

### Dead Sea Scrolls
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Dead Sea Scrolls Translated | Florentino Garcia Martinez | 588 | 6953cbde77f38f6761be00a9 |
| Dead Sea Scrolls Bible | Abegg, Flint, Ulrich | 680 | 6953cbe177f38f6761be02f7 |
| Complete Dead Sea Scrolls in English | Geza Vermes | 678 | 6953cbe577f38f6761be05a0 |
| Dead Sea Scrolls - A New Translation | Wise, Abegg, Cook | 692 | 6953cbea77f38f6761be0847 |
| Meaning of the Dead Sea Scrolls | VanderKam, Flint | 489 | 6953cbef77f38f6761be0afc |
| Dead Sea Scrolls and First Christians | Robert Eisenman | 497 | 6953cbf577f38f6761be0ce6 |

**Dead Sea Scrolls Total: 6 books, 3,624 pages**

### Insular Gospel Manuscripts (Celtic)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Book of Kells Facsimile | Edward Sullivan | 192 | 6953cc0c77f38f6761be0ed8 |
| Book of Kells Latin Text (Codex Kenanensis) | Thomas Kingsmill Abbott | 502 | 6953cc1077f38f6761be0f99 |
| Lindisfarne Gospels Vol. 4 | Stevenson, Waring | 313 | 6953cc1377f38f6761be1190 |
| Lindisfarne Gospels Vol. 2 | Stevenson, Waring | 259 | 6953cc1777f38f6761be12ca |
| Lindisfarne Gospels Vol. 3 | Stevenson, Waring | 308 | 6953cc1b77f38f6761be13ce |
| Lindisfarne Gospels Illustrated Study | Janet Backhouse | 106 | 6953cc1e77f38f6761be1503 |

**Insular Gospels Total: 6 books, 1,680 pages**

### Papyrus Collections
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Fragmenta Herculanensia | Walter Scott | 398 | 6953cc3677f38f6761be156e |
| Zenon Papyri Vol. I (Cairo Museum) | Campbell Edgar | 125 | 6953cc3977f38f6761be16fd |
| Zenon Papyri Vol. II | Campbell Edgar | 142 | 6953cc3d77f38f6761be177b |
| Zenon Papyri Vol. III | Campbell Edgar | 185 | 6953cc4077f38f6761be180a |
| Zenon Papyri Vol. IV | Campbell Edgar | 179 | 6953cc4377f38f6761be18c4 |
| Graeco-Roman Memoirs | Egypt Exploration Society | 368 | 6953cc4577f38f6761be1978 |
| Sammelbuch Griechischer Urkunden | Friedrich Preisigke | 686 | 6953cc4977f38f6761be1ae9 |

**Papyrus Collections Total: 7 books, 2,083 pages**

### Medieval Codex Facsimiles
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Cloisters Apocalypse (14th c.) | Metropolitan Museum | 86 | 6953cc6477f38f6761be1d98 |
| Lapidario del Rey Alfonso X | Alfonso X of Castile | 384 | 6953cc6777f38f6761be1def |
| Codex Vercellensis (Anglo-Saxon) | Max Förster | 312 | 6953cc6a77f38f6761be1f70 |
| De Proprietatibus Rerum | Bartholomaeus Anglicus | 530 | 6953cc6d77f38f6761be20a9 |
| Illuminated Medieval Bible | Free Library Philadelphia | 1,023 | 6953cc7077f38f6761be22bc |
| Decretals with Glossa Ordinaria | Bernardo da Parma | 603 | 6953cc7277f38f6761be26bc |
| Illuminated Manuscripts (Classical/Medieval) | J.H. Middleton | 307 | 6953cc7577f38f6761be2918 |
| Einsiedeln Codex (Pilgrims Guide Rome) | Unknown | 248 | 6953cc7a77f38f6761be2a4c |

**Medieval Codex Total: 8 books, 3,493 pages**

### Egyptian & Mysterious Manuscripts
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Book of Dead - Papyrus of Ani Facsimile | British Museum | 168 | 6953cca677f38f6761be2b45 |
| Book of Dead - Hieroglyphic Transcript | E.A. Wallis Budge | 746 | 6953ccaa77f38f6761be2bee |
| Book of Dead - Papyrus of Ani Translation | E.A. Wallis Budge | 556 | 6953ccad77f38f6761be2ed9 |
| Egyptian Book of Dead - Going Forth by Day | Unknown | 186 | 6953ccb077f38f6761be3106 |
| Voynich Manuscript (High Res Scans) | Beinecke Library, Yale | 100 | 6953ccb377f38f6761be31c1 |
| Voynich Manuscript - NSA Analysis | National Security Agency | 330 | 6953ccb677f38f6761be3226 |

**Egyptian & Mysterious Total: 6 books, 2,086 pages**

### Session 018 Summary

| Category | Books | Pages |
|----------|-------|-------|
| Biblical Codex Facsimiles | 6 | 1,110 |
| Dead Sea Scrolls | 6 | 3,624 |
| Insular Gospel Manuscripts | 6 | 1,680 |
| Papyrus Collections | 7 | 2,083 |
| Medieval Codex Facsimiles | 8 | 3,493 |
| Egyptian & Mysterious Manuscripts | 6 | 2,086 |
| **Session 018 Total** | **39** | **14,076** |

### Key Acquisitions Notes

#### Nag Hammadi Codices
- Photographic facsimiles of the 4th century Coptic manuscripts discovered at Nag Hammadi in 1945
- Includes Gospel of Thomas, Gospel of Philip, Apocryphon of John, and other Gnostic texts
- Original manuscripts now in Coptic Museum, Cairo

#### Dead Sea Scrolls Collection
- Four major translations covering all extant scroll fragments
- Eisenman's controversial interpretations linking scrolls to early Christianity
- Garcia Martinez's scholarly Spanish translation
- Includes Community Rule, War Scroll, Temple Scroll

#### Insular Gospel Manuscripts
- **Book of Kells**: 9th century masterpiece of Celtic illumination (Trinity College Dublin)
- **Lindisfarne Gospels**: 8th century Anglo-Saxon manuscript with interlinear gloss (British Library)
- These represent pinnacles of early medieval manuscript art

#### Herculaneum & Zenon Papyri
- **Herculaneum**: Carbonized papyri from villa buried by Vesuvius 79 CE (mostly Epicurean philosophy)
- **Zenon Archive**: 3rd century BCE papyri from Ptolemaic Egypt (administrative/economic documents)

#### Voynich Manuscript
- 15th century manuscript in unknown script and language
- NSA cryptographic analysis included
- One of the most studied unsolved ciphers in history

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Sessions 001-017 | 288 | 135,907 |
| Session 018 | 39 | 14,076 |
| **GRAND TOTAL** | **327** | **149,983** |

---

## 2025-12-30 — Session 019: Islamic Philosophy & Christian Mysticism

### Focus
Filling gaps in Islamic philosophy (Al-Ghazali, Ibn Arabi, Averroes) and Christian mysticism (Rhineland/Flemish mystics, English mysticism).

### Islamic Philosophy & Sufism
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Alchemy of Happiness | Al-Ghazali | 141 | 6953dd3077f38f6761be703a |
| Confessions (Deliverance from Error) | Al-Ghazali | 76 | 6953dd3677f38f6761be70c8 |
| Der Erretter aus dem Irrtum (German) | Al-Ghazali | 101 | 6953dd3977f38f6761be7115 |
| Tarjuman al-Ashwaq (Interpreter of Desires) | Ibn Arabi | 176 | 6953dd3c77f38f6761be717b |
| Awrad Ibn Arabi (Daily Prayers) | Ibn Arabi | 365 | 6953dd3e77f38f6761be722c |
| Kitab Falsafat - Philosophy | Averroes | 160 | 6953dd4277f38f6761be739a |

**Islamic Philosophy Total: 6 books, 1,019 pages**

### Meister Eckhart & Rhineland Mysticism
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Meister Eckhart - Complete Works | Meister Eckhart | 514 | 6953dd5b77f38f6761be743b |
| Meister Eckhart - Sermons | Meister Eckhart | 366 | 6953dd6077f38f6761be763e |
| Meister Eckhart der Mystiker | Adolf Lasson | 388 | 6953dd6477f38f6761be77ad |
| Eckhart und seine Jünger - Ungedruckte Texte | Meister Eckhart | 204 | 6953dd6777f38f6761be7932 |
| Essential Sermons, Commentaries, Treatises | Meister Eckhart | 100 | 6953dd6c77f38f6761be79ff |
| Teacher and Preacher | Meister Eckhart | 454 | 6953dd6f77f38f6761be7a64 |
| Mystics of the Renaissance | Rudolf Steiner | 306 | 6953dd7177f38f6761be7c2b |

**Meister Eckhart Total: 7 books, 2,332 pages**

### Jan van Ruysbroeck (Flemish Mysticism)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Ruysbroeck - Study by Underhill | Evelyn Underhill | 224 | 6953dd8b77f38f6761be7d5e |
| Spiritual Espousals and Other Works | Jan van Ruusbroec | 310 | 6953dd8f77f38f6761be7e3f |
| Ruysbroeck the Admirable | Alfred Wautier | 382 | 6953dd9477f38f6761be7f76 |
| Ruysbroeck and the Mystics | Maurice Maeterlinck | 169 | 6953dd9a77f38f6761be80f5 |
| Die Zierde der geistlichen Hochzeit | Jan van Ruusbroec | 220 | 6953dd9d77f38f6761be819f |
| A Mediaeval Mystic - Life of Ruysbroeck | Vincent Scully | 158 | 6953dda277f38f6761be827c |

**Ruysbroeck Total: 6 books, 1,463 pages**

### Cloud of Unknowing & English Mysticism
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Cloud of Unknowing and Other Treatises | Anonymous | 474 | 6953ddbb77f38f6761be831b |
| Cloud of Unknowing - Underhill Edition | Evelyn Underhill (ed.) | 330 | 6953ddbf77f38f6761be84f6 |
| Cloud of Unknowing - Walsh Translation | James Walsh (trans.) | 326 | 6953ddc377f38f6761be8641 |
| Cloud of Unknowing - Progoff Commentary | Ira Progoff (ed.) | 262 | 6953ddc877f38f6761be8788 |
| Cloud of Unknowing & Book of Privy Counseling | Anonymous | 206 | 6953ddcc77f38f6761be888f |
| Way of Paradox - Eckhart Spirituality | Cyprian Smith | 150 | 6953ddd077f38f6761be895e |

**Cloud of Unknowing Total: 6 books, 1,748 pages**

### Session 019 Summary

| Category | Books | Pages |
|----------|-------|-------|
| Islamic Philosophy & Sufism | 6 | 1,019 |
| Meister Eckhart & Rhineland Mysticism | 7 | 2,332 |
| Jan van Ruysbroeck (Flemish) | 6 | 1,463 |
| Cloud of Unknowing & English Mysticism | 6 | 1,748 |
| **Session 019 Total** | **25** | **6,562** |

### Key Acquisitions Notes

#### Islamic Philosophy
- **Al-Ghazali**: Most influential medieval Islamic theologian. "Alchemy of Happiness" = Persian abridgement of Ihya Ulum al-Din. "Deliverance from Error" = autobiographical account of spiritual crisis and turn to Sufism.
- **Ibn Arabi**: "Greatest Master" (al-Shaykh al-Akbar) of Sufi metaphysics. Tarjuman al-Ashwaq = mystical love poetry with esoteric commentary.
- **Averroes**: Leading Aristotelian commentator, major influence on Scholasticism.

#### Rhineland Mysticism
- **Meister Eckhart** (c.1260-1328): Dominican theologian, central figure in German mysticism. Teachings on detachment (Gelassenheit), the birth of the Word in the soul, and the "ground" (Grunt) of the soul.
- **Steiner's Mystics of the Renaissance**: Links Eckhart to Tauler, Paracelsus, Boehme, and Bruno.

#### Flemish Mysticism
- **Jan van Ruusbroec** (1293-1381): "The Admirable" - Flemish mystic whose "Spiritual Espousals" describes three stages of union with God. Major influence on Devotio Moderna and Thomas à Kempis.

#### English Mysticism
- **Cloud of Unknowing** (14th c.): Anonymous masterpiece of apophatic (negative) theology. Teaches contemplative prayer through unknowing and forgetting all concepts.
- **Book of Privy Counseling**: Sequel/companion to the Cloud, offering more direct instruction.

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Sessions 001-018 | 327 | 149,983 |
| Session 019 | 25 | 6,562 |
| **GRAND TOTAL** | **352** | **156,545** |

---

## 2025-12-30 — Session 020: Chinese Classics, Indian Tantra, Theosophy & Modern Occultism

### Focus
Comprehensive import of four major esoteric traditions: Chinese philosophy, Indian Tantra, Theosophy, and Golden Dawn/Thelema.

### Chinese Classics
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| I Ching - Wilhelm/Baynes Translation | Richard Wilhelm | 818 | 6953e27077f38f6761be89f5 |
| I Ching - Sacred Books of China (Legge) | James Legge | 502 | 6953e27477f38f6761be8d28 |
| Total I Ching - Myths for Change | Stephen Karcher | 474 | 6953e27877f38f6761be8f1f |
| Four Books of Confucius | James Legge | 1,028 | 6953e27b77f38f6761be90fa |
| Analects of Confucius - Soothill | William Soothill | 1,058 | 6953e27f77f38f6761be94ff |
| Confucius Sinarum Philosophus (1687 Latin) | Jesuit Missionaries | 568 | 6953e28477f38f6761be9922 |
| Zen Buddhism - D.T. Suzuki Selected | D.T. Suzuki | 326 | 6953e29e77f38f6761be9b5b |
| Zen Comes West | Christmas Humphreys | 218 | 6953e2a277f38f6761be9ca2 |
| Maps of Consciousness | Ralph Metzner | 180 | 6953e2a577f38f6761be9d7d |
| Secrets of the I Ching | Joseph Murphy | 232 | 6953e2a877f38f6761be9e32 |
| Economic Principles of Confucius | Chen Huan-Chang | 780 | 6953e2ab77f38f6761be9f1b |
| Ethics of Confucius | Miles Dawson | 366 | 6953e2af77f38f6761bea228 |

**Chinese Classics Total: 12 books, 6,550 pages**

### Indian Tantra (Kashmir Shaivism & Shakta)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Tantraloka of Abhinavagupta (Complete) | Abhinavagupta | 3,938 | 6953e2f677f38f6761bea397 |
| Tantraloka Vol. 1 with Jayaratha Commentary | Abhinavagupta | 372 | 6953e2ff77f38f6761beb2fa |
| Kularnava Tantra (Sanskrit) | Traditional | 303 | 6953e30277f38f6761beb46f |
| Kularnava Tantra - English (Avalon) | Arthur Avalon | 132 | 6953e30577f38f6761beb59f |
| Karpuradi Stotram - Hymn to Kali | Vimalananda; Avalon | 138 | 6953e30877f38f6761beb624 |
| Yantra Mantra Tantra Vidya | Kunthu Sagar Ji | 732 | 6953e30b77f38f6761beb6af |

**Indian Tantra Total: 6 books, 5,615 pages**

### Theosophy (Blavatsky & Steiner)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Secret Doctrine Vol. I - Cosmogenesis | H.P. Blavatsky | 776 | 6953e32877f38f6761beb98c |
| Secret Doctrine Vol. III - Esoterica | H.P. Blavatsky | 634 | 6953e32f77f38f6761bebc95 |
| Isis Unveiled Vol. I - Science | H.P. Blavatsky | 745 | 6953e33477f38f6761bebf10 |
| Isis Unveiled Vol. II - Theology | H.P. Blavatsky | 743 | 6953e33877f38f6761bec1fa |
| Key to Theosophy | H.P. Blavatsky | 410 | 6953e33c77f38f6761bec4e2 |
| Theosophical Glossary | H.P. Blavatsky | 380 | 6953e33f77f38f6761bec67d |
| Way of Initiation | Rudolf Steiner | 260 | 6953e35a77f38f6761bec7fa |
| Gates of Knowledge | Rudolf Steiner | 208 | 6953e35e77f38f6761bec8ff |
| Christianity as Mystical Fact | Rudolf Steiner | 270 | 6953e36177f38f6761bec9d0 |
| Initiation and Its Results | Rudolf Steiner | 180 | 6953e36477f38f6761becadf |
| Occult Significance of Blood | Rudolf Steiner | 56 | 6953e36777f38f6761becb94 |
| Lucifer-Gnosis (GA 34) | Rudolf Steiner | 660 | 6953e36a77f38f6761becbcd |

**Theosophy Total: 12 books, 5,322 pages**

### Modern Occultism (Golden Dawn & Crowley)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Complete Golden Dawn System of Magic | Israel Regardie | 1,077 | 6953e38c77f38f6761bece62 |
| The Golden Dawn (Black Brick Edition) | Israel Regardie | 717 | 6953e38f77f38f6761bed298 |
| The Golden Dawn Vol. 2 (1938) | Israel Regardie | 295 | 6953e39277f38f6761bed566 |
| Complete Golden Dawn Initiate | Steven Ashe | 589 | 6953e39577f38f6761bed68e |
| Magicians of the Golden Dawn - History | Ellic Howe | 177 | 6953e39777f38f6761bed8dc |
| Secrets of a Golden Dawn Temple | Cicero & Cicero | 390 | 6953e39b77f38f6761bed98e |
| Magick in Theory and Practice | Aleister Crowley | 482 | 6953e3b577f38f6761bedb15 |
| Book Four - Magick | Aleister Crowley | 228 | 6953e3b777f38f6761bedcf8 |
| Qabalah of Aleister Crowley | Aleister Crowley | 344 | 6953e3ba77f38f6761bedddd |
| Book of Thoth - Tarot | Aleister Crowley | 310 | 6953e3be77f38f6761bedf36 |
| Book of the Law (Liber AL) | Aleister Crowley | 134 | 6953e3c077f38f6761bee06d |
| Magical Diaries of the Beast 666 | Aleister Crowley | 262 | 6953e3c377f38f6761bee0f4 |
| Diary of a Drug Fiend | Aleister Crowley | 394 | 6953e3c677f38f6761bee1fb |

**Modern Occultism Total: 13 books, 5,399 pages**

### Session 020 Summary

| Category | Books | Pages |
|----------|-------|-------|
| Chinese Classics | 12 | 6,550 |
| Indian Tantra | 6 | 5,615 |
| Theosophy | 12 | 5,322 |
| Modern Occultism | 13 | 5,399 |
| **Session 020 Total** | **43** | **22,886** |

### Key Acquisitions Notes

#### Chinese Classics
- **I Ching**: Three major translations - Wilhelm/Baynes (psychological/Jungian), Legge (scholarly), Karcher (mythological)
- **Confucius**: Four Books complete (Analects, Great Learning, Doctrine of Mean, Mencius), plus rare 1687 Latin Jesuit translation
- **Zen**: D.T. Suzuki's foundational works introducing Zen to the West

#### Indian Tantra
- **Tantraloka**: Abhinavagupta's magnum opus - complete encyclopedia of Kashmir Shaiva tantra (nearly 4,000 pages)
- **Kularnava Tantra**: Key Kaula text on ritual practice
- **Arthur Avalon (John Woodroffe)**: Pioneer translator of Hindu tantra for Western audiences

#### Theosophy
- **Blavatsky**: Secret Doctrine (Vols I & III), Isis Unveiled (complete), Key to Theosophy, Glossary
- **Steiner**: Initiation texts, Christianity as Mystical Fact, Lucifer-Gnosis journal

#### Golden Dawn & Thelema
- **Regardie**: Complete Golden Dawn corpus - the definitive publication of GD rituals and teachings
- **Crowley**: Core Thelemic works - Magick, Book of Thoth, Liber AL, 777/Qabalah, plus diaries

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Sessions 001-019 | 352 | 156,545 |
| Session 020 | 43 | 22,886 |
| **GRAND TOTAL** | **395** | **179,431** |

---

## 2025-12-30 — Session 021: Scientific Revolution & Ancient Medicine

### Focus
Primary sources of the Scientific Revolution (1543-1700): Copernicus, Galileo, Kepler, Newton, Bacon, Descartes, Harvey, Vesalius, Boyle, Hooke, Huygens, Gilbert, Leibniz, Pascal, Leeuwenhoek. Plus Galen's ancient medical corpus.

### Astronomical Revolution
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| De Revolutionibus (German Translation) | Nicolaus Copernicus | 466 | 6953e42e77f38f6761beed60 |
| Sidereus Nuncius (1610 First Edition) | Galileo Galilei | 68 | 6953e45877f38f6761bee67c |
| Sidereal Messenger (English Translation) | Galileo Galilei | 150 | 6953e45c77f38f6761bee6dd |
| Dialogo sopra i due massimi sistemi (1632) | Galileo Galilei | 520 | 6953e46277f38f6761bee798 |
| Dialogue Concerning Two World Systems (German) | Galileo Galilei | 686 | 6953e46677f38f6761beeafb |
| Discorsi e Dimostrazioni (Two New Sciences) | Galileo Galilei | 346 | 6953e48077f38f6761beeda0 |
| Tabulae Rudolphinae (1627) | Johannes Kepler | 276 | 6953e49377f38f6761beee27 |
| Kepler Opera Omnia Vol. I | Johannes Kepler | 1,150 | 6953e4a277f38f6761beed5d |

**Astronomical Revolution Total: 8 books, 3,662 pages**

### Newton, Bacon & Descartes (Natural Philosophy)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Philosophiae Naturalis Principia Mathematica (1687 First Edition) | Isaac Newton | 526 | 6953e4fa77f38f6761bef1dc |
| Mathematical Principles of Natural Philosophy (Motte 1729) | Isaac Newton | 417 | 6953e4ff77f38f6761bef3eb |
| Opticks (1704 First Edition) | Isaac Newton | 458 | 6953e50277f38f6761bef58d |
| Novum Organum Scientiarum (1762) | Francis Bacon | 408 | 6953e50577f38f6761bef758 |
| Novum Organum (English Translation) | Francis Bacon | 300 | 6953e50877f38f6761bef8f1 |
| Of the Advancement and Proficience of Learning (1640) | Francis Bacon | 628 | 6953e50b77f38f6761befa1e |
| Discours de la Méthode suivi des Méditations | René Descartes | 485 | 6953e51c77f38f6761befc93 |
| Discourse on Method, Meditations, Principles of Philosophy | René Descartes | 296 | 6953e51e77f38f6761befe79 |
| Oeuvres de Descartes Vol. VI (La Géométrie) | René Descartes | 758 | 6953e52177f38f6761beffa2 |

**Natural Philosophy Total: 9 books, 4,276 pages**

### Medicine & Anatomy
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Exercitatio Anatomica de Motu Cordis (1628 First Edition) | William Harvey | 88 | 6953e55177f38f6761bf0299 |
| Works of William Harvey (Sydenham Society 1847) | William Harvey | 732 | 6953e55477f38f6761bf02f2 |
| De Humani Corporis Fabrica (1543 First Edition) | Andreas Vesalius | 734 | 6953e55777f38f6761bf05cf |

**Medicine & Anatomy Total: 3 books, 1,554 pages**

### Chemistry, Microscopy & Physics
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| The Sceptical Chymist (1661 First Edition) | Robert Boyle | 472 | 6953e55c77f38f6761bf08ae |
| New Experiments Physico-Mechanical (1660) | Robert Boyle | 243 | 6953e56277f38f6761bf0a87 |
| Micrographia (1665 First Edition) | Robert Hooke | 384 | 6953e56577f38f6761bf0b7b |
| Traité de la Lumière (1690) | Christiaan Huygens | 201 | 6953e58d77f38f6761bf0cfc |
| Horologium Oscillatorium (1673) | Christiaan Huygens | 186 | 6953e59077f38f6761bf0dc6 |
| De Magnete (1600 First Edition) | William Gilbert | 270 | 6953e59377f38f6761bf0e81 |
| On the Loadstone and Magnetic Bodies (English) | William Gilbert | 436 | 6953e59677f38f6761bf0f90 |

**Chemistry, Microscopy & Physics Total: 7 books, 2,192 pages**

### Mathematics
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Mathematische Schriften Vol. IV | Gottfried Wilhelm Leibniz | 556 | 6953e5ef1479a63c1108408e |
| Oeuvres de Blaise Pascal Vol. I | Blaise Pascal | 476 | 6953e5f21479a63c110842bb |
| Arcana Naturae Detecta (1695) | Antony van Leeuwenhoek | 659 | 6953e5f41479a63c11084498 |

**Mathematics & Natural History Total: 3 books, 1,691 pages**

### Galen (Ancient Medicine)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Opera Omnia Vol. I | Galen | 967 | 6953e60b1479a63c1108472c |
| On the Natural Faculties (Loeb Classical Library) | Galen | 420 | 6953e60e1479a63c11084af4 |
| De Simplicium Medicamentorum Facultatibus (1561) | Galen | 764 | 6953e6111479a63c11084c99 |
| The Writings of Hippocrates and Galen | Hippocrates and Galen | 436 | 6953e6141479a63c11084f96 |
| Opera Omnia (Kühn Edition) Vol. I | Galen | 976 | 6953e6171479a63c1108514b |

**Galen Total: 5 books, 3,563 pages**

### Session 021 Summary

| Category | Books | Pages |
|----------|-------|-------|
| Astronomical Revolution | 8 | 3,662 |
| Newton, Bacon, Descartes | 9 | 4,276 |
| Medicine & Anatomy | 3 | 1,554 |
| Chemistry, Microscopy & Physics | 7 | 2,192 |
| Mathematics & Natural History | 3 | 1,691 |
| Galen (Ancient Medicine) | 5 | 3,563 |
| **Session 021 Total** | **35** | **16,938** |

### Key Acquisitions Notes

#### Astronomical Revolution
- **Copernicus De Revolutionibus**: The book that launched the heliocentric revolution (1543)
- **Galileo's Works**: Sidereus Nuncius (first telescopic observations), Dialogue (defense of heliocentrism), Two New Sciences (kinematics and materials science)
- **Kepler's Tabulae Rudolphinae**: Definitive planetary tables using elliptical orbits, foundation of modern astronomy

#### Natural Philosophy
- **Newton Principia (1687)**: Foundation of classical mechanics; both original Latin first edition and Motte's 1729 English translation
- **Newton Opticks (1704)**: Corpuscular theory of light, experimentalism
- **Bacon Novum Organum**: New method of scientific inquiry (induction), rejection of Aristotelian syllogism
- **Descartes**: Discourse on Method (methodical doubt), Meditations (cogito), La Géométrie (analytic geometry)

#### Medicine & Physiology
- **Harvey De Motu Cordis (1628)**: Discovery of blood circulation - overthrew Galenic physiology
- **Vesalius De Humani Corporis Fabrica (1543)**: Modern scientific anatomy, direct observation vs. ancient authority
- **Galen's Corpus**: The ancient authority Harvey and Vesalius built upon and corrected - foundational for understanding the revolution

#### Chemistry & Physics
- **Boyle Sceptical Chymist (1661)**: Transformed alchemy into chemistry, atomic theory of matter
- **Hooke Micrographia (1665)**: First microscopic observations, coined "cell"
- **Huygens**: Wave theory of light (Traité), pendulum clock mathematics (Horologium)
- **Gilbert De Magnete (1600)**: First systematic study of magnetism, coined "electricity"

#### Mathematics
- **Leibniz Mathematische Schriften**: Development of calculus (independently of Newton)
- **Pascal Oeuvres**: Probability theory, hydraulics, calculating machines
- **Leeuwenhoek Arcana Naturae**: First observations of bacteria and protozoa

### Session 021 Part 2: Extended Scientific Revolution

#### Euler (Mathematics & Mechanics)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Elements of Algebra | Leonhard Euler | 642 | 6953e9e71479a63c1108551c |
| Mechanica Vol. I (1736) | Leonhard Euler | 544 | 6953e9f41479a63c1108579f |
| Mechanica Vol. II (1736) | Leonhard Euler | 556 | 6953e9ff1479a63c110859c0 |
| Einleitung in die Analysis des Unendlichen | Leonhard Euler | 632 | 6953ea0a1479a63c11085bed |
| Methodus Inveniendi (Calculus of Variations, 1744) | Leonhard Euler | 354 | 6953ea151479a63c11085e66 |
| Vollständige Anleitung zur Algebra (1771) | Leonhard Euler | 669 | 6953ea1d1479a63c11085fc9 |

**Euler Total: 6 books, 3,397 pages**

#### Natural Magic (Della Porta & Wilkins)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Natural Magick (1658 English) | Giambattista della Porta | 438 | 6953ea371479a63c11086267 |
| Magia Naturalis (1619 Latin) | Giambattista della Porta | 1,356 | 6953ea3e1479a63c1108641e |
| Mathematical and Philosophical Works | John Wilkins | 598 | 6953ea4a1479a63c1108696b |

**Natural Magic Total: 3 books, 2,392 pages**

#### Additional Leibniz (Philosophy)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Philosophical Works (Monadology, Theodicy, Clarke) | Gottfried Wilhelm Leibniz | 418 | 6953ea641479a63c11086bc2 |
| Die philosophischen Schriften Vol. IV | Gottfried Wilhelm Leibniz | 648 | 6953ea711479a63c11086d65 |
| Die philosophischen Schriften Vol. I | Gottfried Wilhelm Leibniz | 633 | 6953ea7c1479a63c11086fee |
| The Monadology and Other Philosophical Writings | Gottfried Wilhelm Leibniz | 472 | 6953ea881479a63c11087268 |

**Additional Leibniz Total: 4 books, 2,171 pages**

#### Additional Descartes (Complete Works)
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Oeuvres de Descartes Vol. I (Correspondance) | René Descartes | 714 | 6953eaad1479a63c11087441 |
| Oeuvres de Descartes Vol. VII (Meditationes) | René Descartes | 650 | 6953eab81479a63c1108770c |
| Oeuvres de Descartes Vol. VIII (Principia Philosophiae) | René Descartes | 786 | 6953eac21479a63c11087997 |
| Oeuvres de Descartes Vol. XI (Le Monde) | René Descartes | 804 | 6953eae01479a63c11087e87 |
| Philosophical Works Vol. I (Haldane-Ross) | René Descartes | 476 | 6953eacc1479a63c11087caa |

**Additional Descartes Total: 5 books, 3,430 pages**

#### Additional Gilbert
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| De Mundo Nostro Sublunari Philosophia Nova (1651) | William Gilbert | 350 | 6953eaf41479a63c110881ac |

**Additional Gilbert Total: 1 book, 350 pages**

### Session 021 Extended Summary

| Category | Books | Pages |
|----------|-------|-------|
| Part 1: Astronomical Revolution | 8 | 3,662 |
| Part 1: Newton, Bacon, Descartes | 9 | 4,276 |
| Part 1: Medicine & Anatomy | 3 | 1,554 |
| Part 1: Chemistry, Microscopy & Physics | 7 | 2,192 |
| Part 1: Mathematics & Natural History | 3 | 1,691 |
| Part 1: Galen (Ancient Medicine) | 5 | 3,563 |
| Part 2: Euler | 6 | 3,397 |
| Part 2: Natural Magic | 3 | 2,392 |
| Part 2: Additional Leibniz | 4 | 2,171 |
| Part 2: Additional Descartes | 5 | 3,430 |
| Part 2: Additional Gilbert | 1 | 350 |
| **Session 021 Total** | **54** | **28,678** |

### Key Acquisitions Notes (Part 2)

#### Euler
- **Mechanica (1736)**: First systematic treatise on analytical mechanics, foundation of classical mechanics alongside Newton
- **Analysis of the Infinite**: Introduction to infinitesimal calculus
- **Calculus of Variations (1744)**: Foundational work on optimization, variational principles
- **Elements of Algebra**: One of the most influential algebra textbooks ever written

#### Natural Magic
- **Della Porta Magia Naturalis**: 20-book encyclopedia of "natural magic" - experiments in optics, magnetism, alchemy, cryptography. Major influence on early modern science.
- **Wilkins Mathematical Magick**: Explains mechanical wonders (automata, perpetual motion) - bridges magic and science

#### Leibniz Philosophy
- **Monadology**: Central metaphysical work - monads, pre-established harmony, best of all possible worlds
- **Die philosophischen Schriften**: Gerhardt's critical German edition of philosophical works

#### Descartes Extended
- **Adam-Tannery Edition**: Definitive critical edition of complete works
- **Le Monde**: Descartes' suppressed cosmological treatise
- **Haldane-Ross Translation**: Standard English philosophical translation

#### Gilbert De Mundo
- Posthumous work on cosmology, extending De Magnete's magnetic philosophy to the cosmos

### Session 021 Part 3: British Moral Philosophy

#### Hutcheson & Shaftesbury
| Title | Author | Pages | Book ID |
|-------|--------|-------|---------|
| Inquiry into Beauty and Virtue (1726) | Francis Hutcheson | 344 | 6953efda1479a63c1108830b |
| Essay on Passions and Moral Sense (1728) | Francis Hutcheson | 380 | 6953efdf1479a63c11088464 |
| Characteristicks (1714 original) | Earl of Shaftesbury | 462 | 6953efe21479a63c110885e1 |
| Characteristics Vol. I (Robertson 1900) | Earl of Shaftesbury | 408 | 6953efe61479a63c110887b0 |
| Characteristics Vol. II (Robertson 1900) | Earl of Shaftesbury | 396 | 6953efe91479a63c11088949 |
| Inquiry Concerning Virtue or Merit | Earl of Shaftesbury | 132 | 6953efed1479a63c11088ad6 |

**British Moral Philosophy Total: 6 books, 2,122 pages**

### Session 021 Final Summary
| Category | Books | Pages |
|----------|-------|-------|
| Part 1: Scientific Revolution Core | 35 | 16,938 |
| Part 2: Euler, Natural Magic, Leibniz, Descartes, Gilbert | 19 | 11,740 |
| Part 3: British Moral Philosophy | 6 | 2,122 |
| **Session 021 Total** | **60** | **30,800** |

### Cumulative Totals
| Session | Books | Pages |
|---------|-------|-------|
| Sessions 001-020 | 395 | 179,431 |
| Session 021 | 60 | 30,800 |
| **GRAND TOTAL** | **455** | **210,231** |

---

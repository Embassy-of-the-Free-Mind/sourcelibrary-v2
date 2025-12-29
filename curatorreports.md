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

---

# Session: Rithmomachia Visual Guide + Historical Game Manuscripts

**Date:** 2026-03-02 / 2026-03-03

## What happened

### 1. Rithmomachia Visual Guide Page (completed + deployed)

Created `/rithmomachia/guide` — a visual teaching page with 6 illustrated board diagrams showing movement and capture mechanics. Uses a new `MiniBoard` component that renders cropped SVG boards with pieces, legal move indicators, and capture highlights.

**Files created:**
- `src/components/rithmomachia/MiniBoard.tsx` — cropped SVG board renderer (no interactivity, purely illustrative)
- `src/app/rithmomachia/guide/page.tsx` — guide page with 6 examples

**Files edited:**
- `src/components/rithmomachia/RithmomachiaGame.tsx` — added "Visual guide" links in header and How to Play panel

**Live:** https://sourcelibrary.org/rithmomachia/guide

### 2. Historical Research: Origins of Rithmomachia and Chess

Research into the earliest manuscripts of Rithmomachia and chess rules revealed a fascinating timeline:

**Rithmomachia (c. 1030):**
- Invented ~1030 at the cathedral school of Wurzburg by Asilo
- Earliest rules survive in Vatican lat. 3101 (ff. 71v-72v)
- Hermannus Contractus (Reichenau) refined the rules ~1040s (Munich Clm 14836)
- Predates modern chess rules by ~470 years

**Chess rule evolution:**
- Arabic/Persian chess inherited from India (c. 600 CE) — different piece movements
- Oldest known chess book: Arabic compilation from 1257 (BL Add MS 7515)
- Cessolis's chess allegory (c. 1300) spread chess culture across Europe
- Modern rules (queen's gambit, castling) emerged 1470s-1490s in Spain/Italy
- Lucena (1497) is the earliest surviving book with modern rules

**The overlap:** Rithmomachia was being played across European universities at the SAME TIME that chess was evolving from its medieval form into the modern game. They coexisted as intellectual games for ~500 years.

### 3. Manuscript Imports (17 books, 4,566 pages)

Three research sessions importing medieval game manuscripts — chess, card games, Rithmomachia, and general games.

#### Session 1: Rithmomachia + Chess Manuscripts (7 books, 1,721 pages)

| ID | Title | Date | Pages | Source |
|----|-------|------|-------|--------|
| `69a5e8faeddf1fffb1c3688c` | Vatican lat. 3101 (Rithmomachia) | c. 1030 | 167 | Vatican Library |
| `69a5e8fceddf1fffb1c36935` | Munich Clm 14836 (Rithmomachia) | c. 1040 | 334 | BSB Munich |
| `69a5e9fd787d6e9b8d42ea49` | Alfonso X, Libro de los juegos | 1283 | 219 | Escorial |
| `69a5ea00d507939f0352c836` | Cessolis, Schachzabelbuch | 1463 | 168 | Heidelberg UB |
| `69a5ea03d507939f0352c8df` | Cessolis, Le jeu des echecs moralises | c. 1390 | 194 | Gallica / BnF |
| `69a5ea0b815633a563894ba1` | Cessolis, De ludo schacchorum | 1409 | 363 | IA / UPenn |
| `69a5ea0d815633a563894d0e` | Arabic chess compilation (BL Add MS 7515) | 1257 | 276 | QDL / British Library |

#### Session 2: Expanded Chess + Games (4 books, 1,425 pages)

| ID | Title | Date | Pages | Source |
|----|-------|------|-------|--------|
| `69a5ee27bfd8cafd91e435db` | Einsiedeln Codex 319 (Versus de Scachis) | c. 990 | 317 | e-codices |
| `69a5ee3cbfd8cafd91e43719` | Cessolis, Cgm 49 (German translation) | 1407 | 133 | BSB Munich |
| `69a5ee4dbfd8cafd91e437a0` | Caxton, Game of the Chesse (1855 facsimile) | 1474/1855 | 200 | Wellcome Collection |
| `69a5ee5abfd8cafd91e4386a` | Cardano, Opera Omnia Vol 1 (incl. De ludo aleae) | 1663 | 775 | Internet Archive |

#### Session 3: Card Games + More Chess (6 books, 1,420 pages)

| ID | Title | Date | Pages | Source |
|----|-------|------|-------|--------|
| `69a5ef33bfd8cafd91e43b73` | Cessolis, Cgm 1111 (verse translation) | 1414 | 363 | BSB Munich |
| `69a5ef37bfd8cafd91e43ce0` | Johannes von Rheinfelden, De moribus et disciplina humanae conversationis (card treatise) | 1429 | 392 | e-codices |
| `69a5ef38bfd8cafd91e43e69` | Jost Amman, Charta lusoria (playing card designs) | 1588 | 134 | BSB Munich |
| `69a5ef3fbfd8cafd91e43ef1` | Ringhieri, Cento giuochi liberali et d'ingegno | 1551 | 342 | Internet Archive |
| `69a5ef41bfd8cafd91e44049` | Master of Playing Cards (engravings) | c. 1450 | 61 | Gallica / BnF |
| `69a5efb5bfd8cafd91e44089` | al-Sakhawi, 'Umdat al-muhtajj (Islamic ruling on chess) | 15th c. | 128 | QDL / British Library |

### 4. Research Notes

**Card game manuscripts:**
- Johannes von Rheinfelden (1429, Basel) wrote the earliest known European treatise on playing cards — a moral/intellectual analysis, not a rules book
- Jost Amman's Charta lusoria (1588) is the most famous set of playing card designs from the German tradition
- Master of Playing Cards (c. 1450) — anonymous engraver, some of the earliest European playing card prints
- Yale's Visconti Tarocchi (c. 1445) is digitized but rights-restricted — not imported

**Arabic chess manuscripts:**
- al-Adli (c. 840) and al-Suli (c. 940s) — the original great chess masters — their texts are LOST as independent works, surviving only in the BL Add MS 7515 compilation we imported
- al-Sakhawi's treatise is unique: a legal/theological analysis of whether chess is permissible (halal) under Islamic law
- Cleveland Public Library has al-Lajlaj's chess treatise (10th century) but CONTENTdm stores pages individually, not as a compound IIIF object — can't import via our IIIF route
- Manchester/Rylands may have al-Hakim's Nuzhat (1506) digitized but couldn't confirm

**General games:**
- Versus de Scachis (c. 990, Einsiedeln Codex 319) is the earliest Latin chess poem — predates Cessolis by 300 years
- Cardano's De ludo aleae (written c. 1564, published 1663) is the first mathematical treatment of gambling probability — contained within Opera Omnia Vol 1
- Ringhieri's Cento giuochi (1551) catalogues 100 "liberal games" of the Italian Renaissance

**Not imported (and why):**
- Lucena, Repeticion de amores (1497) — BnE doesn't expose IIIF; IA copy is a 1954 reprint
- Visconti Tarocchi (Yale, c. 1445) — rights restricted
- al-Lajlaj chess treatise (Cleveland PL) — CONTENTdm pages not aggregated into compound IIIF manifest
- al-Hakim Nuzhat (Manchester) — unconfirmed digitization
- Ibn Abi Hajalah Unmudhaj al-qital (EAP/DLME) — digitized but no IIIF manifest found

**Copyright:** All works are public domain (400-1000 years old). Digitization rights vary:
- BSB Munich (4 books): CC-BY-NC-SA 4.0
- Heidelberg: Public Domain Mark 1.0
- IA/UPenn + IA: Public Domain Mark / various
- Gallica/BnF: Licence Ouverte (very permissive)
- Vatican: Free scholarly use, attribution requested
- Escorial: Patrimonio Nacional (attribution required)
- QDL/BL (2 books): Academic/research use, attribution to British Library
- e-codices (2 books): CC-BY-NC 4.0
- Wellcome: CC-BY 4.0

## What's next

1. **Split detection** — queued automatically for all imports. Medieval manuscripts often have two-page openings.
2. **Pipeline processing** — all 17 books will flow through the auto pipeline (archive > OCR > translate > enrich > images).
3. **Arabic OCR** — the 1257 chess compilation and al-Sakhawi treatise will test Arabic OCR.
4. **Collection curation** — these books form natural groupings:
   - "Rithmomachia" — the 2 manuscripts + 5 existing printed source books
   - "Chess & Board Games" — Cessolis copies, Alfonso X, Einsiedeln poem, Arabic chess treatises
   - "Card Games & Playing Cards" — Rheinfelden, Amman, Master of Playing Cards
   - "Games & Recreation" — Ringhieri, Cardano
5. **Lucena** — try again when BnE improves IIIF support
6. **Cleveland al-Lajlaj** — revisit if Cleveland PL improves their IIIF compound object support

## Context for the Rithmomachia game feature

The game at `/rithmomachia` now has:
- Playable game with AI opponents (easy/medium/hard)
- Visual guide with diagrams (`/rithmomachia/guide`)
- Interactive tutorial overlay
- Demo mode (auto-play)
- Blog post with primary sources (`/blog/rithmomachia`)
- 5 primary source books (1496-1616) already in the collection
- Now 2 manuscript sources (c. 1030, c. 1040) with the *original rules*
- 15 additional chess/games/cards manuscripts for historical context (c. 990-1663)

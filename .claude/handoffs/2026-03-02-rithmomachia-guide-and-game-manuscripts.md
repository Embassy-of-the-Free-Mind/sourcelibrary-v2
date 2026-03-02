# Session: Rithmomachia Visual Guide + Historical Game Manuscripts

**Date:** 2026-03-02

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
- Invented ~1030 at the cathedral school of Würzburg by Asilo
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

### 3. Manuscript Imports (7 books, 1,721 pages)

| ID | Title | Date | Pages | Source |
|----|-------|------|-------|--------|
| `69a5e8faeddf1fffb1c3688c` | Vatican lat. 3101 (Rithmomachia) | c. 1030 | 167 | Vatican Library |
| `69a5e8fceddf1fffb1c36935` | Munich Clm 14836 (Rithmomachia) | c. 1040 | 334 | BSB Munich |
| `69a5e9fd787d6e9b8d42ea49` | Alfonso X, Libro de los juegos | 1283 | 219 | Escorial |
| `69a5ea00d507939f0352c836` | Cessolis, Schachzabelbuch | 1463 | 168 | Heidelberg UB |
| `69a5ea03d507939f0352c8df` | Cessolis, Le jeu des échecs moralisés | c. 1390 | 194 | Gallica / BnF |
| `69a5ea0b815633a563894ba1` | Cessolis, De ludo schacchorum | 1409 | 363 | IA / UPenn |
| `69a5ea0d815633a563894d0e` | Arabic chess compilation | 1257 | 276 | QDL / British Library |

**Not imported:**
- Lucena, Repetición de amores (1497) — BnE doesn't expose IIIF; IA copy is a 1954 reprint under controlled lending

**Copyright:** All works are public domain (500-1000 years old). Digitization rights vary:
- Heidelberg + IA/UPenn: Public Domain Mark 1.0
- Gallica/BnF: Licence Ouverte (very permissive)
- Vatican: Free scholarly use, attribution requested
- BSB Munich: CC-BY-NC-SA 4.0
- Escorial: Patrimonio Nacional (more restrictive, attribution required)
- QDL/BL: Academic/research use, attribution to British Library

## What's next

1. **Split detection** — queued automatically for all imports. Medieval manuscripts often have two-page openings.
2. **Pipeline processing** — all 7 books will flow through the auto pipeline (archive → OCR → translate → enrich → images).
3. **Arabic OCR** — the 1257 chess compilation will be interesting to test with Arabic OCR prompts.
4. **Lucena** — try again when BnE improves their IIIF support, or find another digitized copy.
5. **Collection curation** — these books form a natural "Games & Recreation" collection alongside the existing Rithmomachia source books.

## Context for the Rithmomachia game feature

The game at `/rithmomachia` now has:
- Playable game with AI opponents (easy/medium/hard)
- Visual guide with diagrams (`/rithmomachia/guide`)
- Interactive tutorial overlay
- Demo mode (auto-play)
- Blog post with primary sources (`/blog/rithmomachia`)
- 5 primary source books (1496-1616) already in the collection
- Now 2 manuscript sources (c. 1030, c. 1040) with the *original rules*
- 5 chess/games manuscripts for historical comparison

# Demonology & Western Esoteric Tradition — Acquisition Campaign

**Date:** February 13-14, 2026
**Scope:** 4 context windows, ~153 books, ~57,000 pages

## Overview

Massive multi-session acquisition campaign building out Source Library's coverage of demonology, witchcraft, magic, and the Western esoteric tradition. The campaign traced the concept of the "demon" from ancient daimons through medieval witch trials, early modern skepticism, and into modern psychology and anthropology.

## What Was Imported

### Wave 1: Core Demonology (~25 books)
Primary treatises on demons, possession, and exorcism:
- **Psellus** — De operatione daemonum (1615 Gaulmyn edition)
- **Wier/Weyer** — De praestigiis daemonum (1583, 6th edition)
- **Bodin** — De la demonomanie des sorciers (1580)
- **Del Rio** — Disquisitionum magicarum (1599-1600, 3 vols)
- **Sinistrari** — De Demonialitate (1879 Liseux edition)
- **Menghi** — Compendio dell'arte essorcistica (1582)
- **Thyraeus** — De Daemoniacis (1598)
- **Remy** — Daemonolatreiae (1595)
- **Tartarotti** — Del congresso notturno delle lammie (1749)
- **Bekker** — De Betoverde Weereld (1691-93, 4 vols)
- And more...

### Wave 2: Grimoires & Practical Magic (~15 books)
- **Agrippa** — De occulta philosophia (1533)
- **Trithemius** — Steganographia (1606)
- **Abano** — Heptameron (1565)
- **Waite** — Book of Ceremonial Magic (1911)
- **Mathers** — Key of Solomon, Goetia
- Various grimoire collections and studies

### Wave 3: Witch Trial & Inquisition Sources (~20 books)
Primary sources and legal treatises:
- **Kramer** — Malleus Maleficarum (1486/1580)
- **Guazzo** — Compendium Maleficarum (1608/1929)
- **Sprenger** — multiple editions
- **Scot** — Discoverie of Witchcraft (1584)
- **Glanvill** — Saducismus Triumphatus (1681)
- **Perkins** — Discourse of the Damned Art of Witchcraft
- **Ady** — A Candle in the Dark (1656)
- **Wagstaffe** — Question of Witchcraft Debated (1671)
- **Darrell** — possession narratives (2 texts)
- **More** — True Discourse (1600)
- **Crouch** — Kingdom of Darkness (1688)

### Wave 4: Lycanthropy
- **Nynauld** — De la Lycanthropie (1615)
- **Prieur** — Dialogue de la Lycanthropie (1596)

### Wave 5: Major Reference Works (~30 books)
The most significant discovery of the campaign — found via systematic false-positive verification:

**Thorndike's History of Magic & Experimental Science** (7 vols imported, 5,727 pages)
The single most important reference work for the history of magic and science. Vols 1-8 (Vol 3 confirmed as already present under a different identifier).

**Lea's Collected Works** (7 books, 4,696 pages)
- History of the Inquisition of the Middle Ages (3 vols)
- Materials Toward a History of Witchcraft (3 vols)
- Superstition and Force

**German Historiography** (5 books, 2,609 pages)
- Soldan — Geschichte der Hexenprozesse
- Roskoff — Geschichte des Teufels (2 vols)
- Horst — Zauberbibliothek (3+ vols)

**English Secondary Literature** (11 books, 5,545 pages)
- Ennemoser — History of Magic (2 vols)
- Notestein — History of Witchcraft in England
- Kittredge — Witchcraft in Old and New England
- Murray — Witch-Cult in Western Europe
- Lecky — Rationalism in Europe (2 vols)
- Wright — Narratives of Sorcery and Magic
- Conway — Demonology and Devil-Lore
- Waite — Book of Black Magic
- Lang — Making of Religion
- Hauber — Bibliotheca Acta et Scripta Magica (3 vols)

### Wave 6: Psychical Research & Supernatural (~11 books, 7,137 pages)
Late 19th/early 20th century investigations bridging demonology and psychology:
- Gurney — Phantasms of the Living (2 vols)
- Myers — Human Personality and Its Survival of Bodily Death (2 vols)
- Podmore — Modern Spiritualism (2 vols)
- Tylor — Primitive Culture (2 vols)
- Crowe — Night-Side of Nature
- Flammarion — Haunted Houses
- Lang — Cock Lane and Common-Sense
- Kerner — Seherin von Prevorst
- Jung-Stilling — Theorie der Geisterkunde

### Wave 7: Vampires & Evil Eye (6 books, 2,608 pages)
- Calmet — Dissertations sur les vampires (1746)
- Calmet — Traité sur les apparitions (1759, 2 vols)
- Ranft — De Masticatione Mortuorum (1728)
- Seligmann — Der böse Blick (2 vols)

## Key Technical Discovery

**MongoDB fuzzy search false positives:** The Source Library search API (`/api/search?q=TERM`) uses MongoDB `$text` search which returns fuzzy matches. A search returning "1 result" does NOT mean the target text is present — it could be any book containing similar words. Example: searching "Roskoff Geschichte Teufels" returned Böhme's "Aurora"; searching "Calmet Vampires" returned Calmet's geography dictionary.

This led to implementing a two-pass verification strategy:
1. First pass: check result count
2. Second pass: examine actual returned title/author fields

This protocol uncovered ~30+ major reference works that initial gap analysis had falsely reported as present.

## Collection Strengths After Campaign

- **Deep primary source coverage** for Continental and English witchcraft/demonology (15th-18th century)
- **Complete Thorndike** — the foundational 8-volume history of magic and science
- **Complete Lea** — all major inquisition and witchcraft historical works
- **Strong German historiography** — Soldan, Roskoff, Horst
- **Psychical research classics** — the SPR canon (Gurney, Myers, Podmore)
- **Lycanthropy** — rare specialist texts
- **Vampire studies** — Calmet and Ranft originals

## Known Gaps Remaining

- **Non-European demonology** — Islamic jinn literature, Hindu/Buddhist demon traditions, Chinese/Japanese yokai, African traditions → next acquisition target
- **Some specific editions** may be preferable to what was imported (e.g., earlier editions of certain texts)
- **Post-1926 works** not available on Internet Archive due to copyright

## Pages by Language (Approximate)
- Latin: ~15,000
- English: ~25,000
- German: ~8,000
- French: ~5,000
- Italian: ~3,000
- Dutch: ~1,000

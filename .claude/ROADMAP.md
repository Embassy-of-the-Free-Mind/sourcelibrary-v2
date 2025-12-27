# Source Library Translation Roadmap

## Priority System

| Priority | Description | Action |
|----------|-------------|--------|
| 1 | **UNTRANSLATED** - Never translated to English | Highest priority for translation |
| 2 | Already in English or partial translations | Lower priority |
| 3 | Has modern scholarly translations | Reference only |

## Priority 1: Untranslated Works (HIGHEST PRIORITY)

These works have NEVER been translated into English and are the core mission of Source Library.

### Kircher (massive encyclopedias, zero translations)
- Oedipus Aegyptiacus Vol I-II (1652-53) - Egyptian wisdom, hieroglyphics, Kabbalah
- Ars Magna Lucis et Umbrae (1671) - Optics, astronomy, physics
- Musurgia Universalis (1650) - Music, harmony, cosmic correspondences

### Fludd
- Utriusque Cosmi Historia (1617) - Macrocosm/microcosm, illustrated cosmic philosophy

### Alchemical Anthologies
- Theatrum Chemicum (1602) - 21 Latin treatises, mostly untranslated
- Musaeum Hermeticum (1677) - 21 Latin treatises with Merian engravings
- Turba Philosophorum (1572) - Only poor 1896 Waite version exists

### Natural Philosophy
- Della Porta: Magia Naturalis (1607) - Only old 1658 partial translation
- Cardano: De Subtilitate (1550) - 21 books, never translated
- Albertus Magnus: De Mineralibus (1519) - Medieval natural history

### Renaissance Art/Design
- Lomazzo: Trattato dell'arte della pittura (1584) - Only old 1598 partial
- Poliziano: Miscellaneorum (1489) - Never translated
- Landino: Dante Commentary (1481) - Never translated

### Magic & Cryptography
- Llull: Ars Magna Generalis (1517) - Combinatory art, never properly translated
- Steganographia (1608) - Hidden writing, never fully translated
- Weyer: De Praestigiis Daemonum (1568) - Only partial (Mora 1991)

### Alchemy
- Paracelsus: Opera Omnia Latin (1658) - Mostly untranslated
- Sendivogius: Novum Lumen Chymicum (1611) - Only partial old translations

### Comenius (Pansophism & Education)
- Orbis Sensualium Pictus (1659) - Revolutionary illustrated encyclopedia
- Pansophiae Diatyposis (1645) - UNTRANSLATED. Outline of universal knowledge
- Pansophiae Prodromus (1638) - UNTRANSLATED. Vision of universal knowledge reform

## Criteria for Adding New Books

When searching for books to add to the roadmap:

1. **Must be OLD edition** (pre-1800, preferably pre-1700)
2. **Must be on Internet Archive** with valid ia_identifier
3. **Prioritize UNTRANSLATED works** - check if English translation exists
4. **Verify publication date** from IA metadata, not just title claims

### Search Strategies

```bash
# Search Internet Archive
https://archive.org/advancedsearch.php?q=creator:"AUTHOR"+AND+mediatype:texts&fl=identifier,title,date,creator&output=json&rows=20

# Verify edition
https://archive.org/details/IDENTIFIER
```

### Target Areas for Discovery

1. **Ficino's Circle** - Florentine Platonists (Poliziano, Landino, Pico associates)
2. **Kircher's other works** - Mundus Subterraneus, China Illustrata, etc.
3. **Paracelsian school** - Croll, Dorn, Severinus
4. **Rosicrucian** - More manifestos, responses, Fludd's other works
5. **Alchemical manuscripts** - Mellon, Beinecke collections
6. **Art treatises** - Vasari (old editions), Cellini, Zuccari
7. **Natural magic** - Agrippa's other works, Porta's other works
8. **Medieval Latin** - Aquinas, Roger Bacon, Grosseteste

## API Access

```bash
# Get current roadmap
curl -s "https://sourcelibrary-v2.vercel.app/api/books/roadmap"

# Response includes:
# - total: number of books
# - in_database: already imported
# - pending: not yet imported
# - books: array with priority, categories, notes
```

## File Location

Roadmap source: `src/app/api/books/roadmap/route.ts`
Contains `ROADMAP_BOOKS` array with all verified old editions.

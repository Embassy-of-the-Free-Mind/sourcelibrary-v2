# Books Requiring Page Splitting

Generated: 2025-12-29

These books contain two-page spreads that need to be split into individual pages before OCR/translation.

## Summary

- **Total books needing splits:** 41
- **Detection method:** Aspect ratio analysis (pages 10 & 15)
- **Verification:** Gemini 3 Flash Preview visual confirmation

## How to Process

1. Go to `/book/[id]/split` in the UI
2. Or use auto-split: `POST /api/books/[id]/auto-split-ml`
3. After splitting, run cropped image generation, then OCR

## Books to Split

### Large Books (>200 pages)

| Title | Pages | Source | ID |
|-------|-------|--------|-----|
| In quatuor Evangelia enarrationes luculentissimae | 511 | IA | `6909ec3ecf28baa1b4cb09c3` |
| Opuscula theologici, historici et philosophici argumenti | 589 | IA | `6909d654cf28baa1b4cb0269` |
| Historisch-theologische Betrachtungen | 361 | IA | `68fa138e6bd5e42f9c120538` |
| Kirchen- oder Haus-Postill | 336 | IA | `690c44f3e0787282ad593d7d` |
| Opera | 319 | IA | `690c2b8fe0787282ad593441` |
| Magni philosophorum arcani revelator | 259 | IA | `690c3a0ce0787282ad593939` |
| Pymander, de potestate et sapientia Dei | 237 | IA | `68fb0dc412055a03a58d3281` |
| Pymander. Asclepius. De mysteriis Aegyptiorum | 237 | IA | `690989d5cf28baa1b4cae1c9` |
| De hermetica Aegyptiorum vetere et Paracelsicorum nova medicina | 218 | IA | `2e046860-d037-472d-ac44-51690d93a652` |

### Medium Books (50-200 pages)

| Title | Pages | Source | ID |
|-------|-------|--------|-----|
| Historia: von dem Leben und Wandel der heyligen Barlaam | 170 | IA | `023f2b73-5a9f-4ada-92c2-258a408d89c2` |
| Mirabilium divinorum humanorumque volumina quattuor | 165 | IA | `6909aba7cf28baa1b4caef69` |
| Vier Tractaetlein | 147 | IA | `6909cd99cf28baa1b4cafdf1` |
| Picatrix (Ghayat al-Hakim) | 144 | Gallica | `69520ee0ab34727b1f044285` |
| Astronomica et astrologica | 135 | IA | `6867c208aadfee9e955ec955` |
| Liber egregius de unitate ecclesia | 127 | IA | `68fb0b2712055a03a58d3193` |
| Das Buch Meteororum | 113 | IA | `6867bf5a009d20a23245ac0d` |
| Le roman de Blanquerna | 110 | IA | `69522fffab34727b1f044636` |
| Incipit: Ex Ilss. quodam Philosophi R.C. extractum | 91 | IA | `d850a255-4633-43d5-8383-7c67a7e55144` |
| Pseudo-Dionysius Areopagita (Ficino translation) | 92 | IA | `69520de1ab34727b1f044227` |
| Asis rimonim | 79 | IA | `fec0b295-0795-440f-a467-434e17ba2a8e` |
| Geometrie practique | 73 | IA | `c1eb9995-02e3-45b3-afa1-c0a52fd5b646` |
| Clavicula Salomonis | 71 | Gallica | `69520f03ab34727b1f044317` |
| Aristotelis Secretum secretorum | 68 | IA | `6952306aab34727b1f0446a5` |
| Plan général et raisonné des divers objets (Monde primitif) | 58 | IA | `6911cffa8cb6d2ae494a1091` |

### Small Books (<50 pages)

| Title | Pages | Source | ID |
|-------|-------|--------|-----|
| Kurtze Instruction zu der Geomantia | 47 | IA | `6867ad0f009d20a23245abad` |
| Ausführlicher Bericht vom Gebrauch desz Instruments | 37 | IA | `6867aa3e009d20a23245ab41` |
| Complementum Astrologiae | 29 | IA | `6867a87bfc518f6dbf33510a` |
| La sabiduria universal del Raymundo Lullio | 27 | IA | `6909bd18cf28baa1b4caf5a5` |
| De Mineralibus | 25 | IA | `34cd723e-19ce-4d50-a5aa-f86991e09946` |
| The strange effects of faith. Fourth part | 25 | IA | `6909afeecf28baa1b4caf0b5` |
| Sefer ha-bahir | 23 | IA | `6911cf678cb6d2ae494a1061` |
| Geboorte Christi | 23 | IA | `6909c3a3cf28baa1b4caf8f3` |
| Von der liebe Gottes ein wunder hübsch underrichtung | 21 | IA | `69099983cf28baa1b4cae913` |
| Dichiaratione sopra il XIII cap. dell'Apocalisse | 19 | IA | `6909c96acf28baa1b4cafbf3` |
| Ontdeckinghe van eenighe secrete handelinghe der Jesuyten | 17 | IA | `690c37e5e0787282ad593849` |
| Le cimetière d'Amboise | 11 | IA | `6909bf03cf28baa1b4caf69d` |
| Der himmlische Samariter | 9 | IA | `68fb0a5212055a03a58d317f` |
| Copey und Abtruck Mandati | 5 | IA | `68fb09b112055a03a58d3173` |
| Nachricht von der zu Berlin (Aletophilorum) | 5 | IA | `68fb108512055a03a58d3311` |
| Warhafft, umbständ und gründlicher Bericht | 5 | IA | `68fb0f9712055a03a58d32fb` |
| Kavyamimansa | 5 | IA | `676578c2bda54ffa65999288` |

## Gemini Verification Results

All books were verified using Gemini 3 Flash Preview vision analysis.

**Confirmed as two-page spreads (high confidence):**
- Clavicula Salomonis
- Picatrix
- Sefer ha-bahir
- Historisch-theologische Betrachtungen
- Opera
- In quatuor Evangelia enarrationes
- Opuscula theologici
- Vier Tractaetlein
- All others in list above

## Ambiguous Books (Need Manual Review)

These books had aspect ratios in the 0.9-1.3 range and require manual verification:

| Title | Gemini Result | Notes |
|-------|--------------|-------|
| Magnes | Single page | Aspect ratio ~1.1 but actually single |
| Die Lehren der Rosenkreuzer | Two-page spread | Confirmed |
| Histoire d'un voyage aux isles Malouines | Two-page spread | Confirmed |
| Essai sur le feu sacré et sur les Vestales | Two-page spread | Confirmed |
| Die Macht der Kinder in der letzten Zeit | Two-page spread | Confirmed |

## Books with Broken Image URLs

These need reimport or URL fixes before processing:

- Mutus Liber (`69526359ab34727b1f046d5a`) - 404 from IA
- Sefer Yetzirah (`2302ba5b-d07f-4bea-a3ee-720ad9617373`) - 404 from IA
- Corpus Hermeticum (`b453af34-40c2-46ff-876b-9d0245b70087`) - 404 from IA

## Processing Commands

```bash
# Check status of a book
curl "https://sourcelibrary.org/api/books/BOOK_ID/check-needs-split"

# Auto-split with ML model
curl -X POST "https://sourcelibrary.org/api/books/BOOK_ID/auto-split-ml" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'

# Generate cropped images after split
curl -X POST "https://sourcelibrary.org/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{"type": "generate_cropped_images", "book_id": "BOOK_ID"}'
```

## Priority Order

1. **Highest priority** - Large untranslated works:
   - In quatuor Evangelia (511 pages)
   - Opuscula theologici (589 pages)
   - Historisch-theologische Betrachtungen (361 pages)

2. **High priority** - Core hermetic/alchemical texts:
   - Picatrix
   - Clavicula Salomonis
   - Pymander editions
   - Sefer ha-bahir

3. **Medium priority** - German Rosicrucian pamphlets:
   - Vier Tractaetlein
   - Various small German texts

4. **Lower priority** - Very small items (<10 pages)

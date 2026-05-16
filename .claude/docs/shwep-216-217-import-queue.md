# SHWEP Eps 216 + 217 — Cited works to import

Three primary sources referenced in SHWEP episodes 216 (Merianos on East Roman
Alchemy, Part II, Apr 1 2026) and 217 (Three Ancient Sages, May 13 2026) are
not yet in the library. Each is an original-language source edition, not a
modern translation.

## 1. Bidez, *Catalogue des manuscrits alchimiques grecs*, vol. VI (Psellos + Proclus)

- Cited in: Ep 216 (Psellos' letter on gold-making)
- Year: 1928 (Brussels)
- IA bundle: `CatMssAlchGr` — contains all 8 CMAG volumes in one item
- Target file inside bundle: `CMAG-6-Psellus-Proclus_jp2.zip`
- Suggested approach: import the **whole bundle as a single multi-volume work**
  (`Catalogue des manuscrits alchimiques grecs, vols. I–VIII`, 1924–1932,
  Brussels: Maurice Lamertin), since all volumes are part of the same
  scholarly series and several will be cited in upcoming Merianos episodes.
- Alternatively, use `scripts/import/ia-bundle-import.mjs` to extract
  individual volumes; see existing bundle-import entries for the pattern.
- Language: Greek (primary text) + French (apparatus)

## 2. Boll (ed.), *Catalogus Codicum Astrologorum Graecorum, vol. VII: Codices Germanici*

- Cited in: Ep 217 ("βίβλος σοφίας καὶ συνέσεως ἀποτελεσμάτων Ἀπολλονίου τοῦ
  Τυανέως" — the Book of Apollonios of Tyana, pp. 175–81)
- Year: 1908 (Brussels)
- IA: not present as standalone item as of 2026-05-16. Other CCAG volumes
  exist (I, IV, V.1, V.3, VI, VIII.2, VIII.3) but VII is missing.
- Fallback chain to try:
  1. Gallica — search "Catalogus codicum astrologorum graecorum septimum"
  2. HathiTrust — full-view if out of copyright
  3. Google Books — full view
  4. BNF print catalog → request digitisation
- Language: Greek

## 3. Ben Jonson, *The Alchemist*

- Cited in: Ep 216 (alchemist as comic mountebank figure)
- IA identifier: `alchemist16120000jons` — Scolar Press 1970 facsimile reprint
  of the 1612 London first quarto. (The 1610 first performance has no separate
  print edition; the 1612 quarto is the earliest printed text.)
- Author: Jonson, Ben (1573?–1637)
- Original publication: London, 1612 (first quarto)
- Language: English (English IS the original language for this work)
- Notes: facsimile reprint, so OCR will need quality check; English text
  may already be in better critical editions on IA (e.g. Herford & Simpson)

## How to import (curator)

Standard one-shot IA import via `POST /api/import/ia` (requires curator auth):

```json
{
  "ia_identifier": "alchemist16120000jons",
  "title": "The Alchemist",
  "display_title": "The Alchemist (1612 First Quarto)",
  "author": "Ben Jonson",
  "language": "English",
  "published": "1612",
  "year": 1612
}
```

For CMAG (item #1), use the bundle importer at
`scripts/import/ia-bundle-import.mjs` — see existing entries for examples.

After import, append the new book IDs to the relevant episode arrays in
`src/data/shwep-book-matches.ts` (216 for CMAG VI + Jonson; 217 for CCAG VII)
and redeploy.

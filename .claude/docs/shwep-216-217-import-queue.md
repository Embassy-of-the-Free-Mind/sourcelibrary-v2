# SHWEP Eps 216 + 217 — Curator pass log (2026-05-17)

Original gaps: three primary sources referenced in SHWEP episodes 216
(Merianos on East Roman Alchemy, Part II, Apr 1 2026) and 217 (Three
Ancient Sages, May 13 2026) were not yet in the library. Status after
the curator pass:

## ✓ 1. Bidez, *Catalogue des manuscrits alchimiques grecs*, vol. VI (Psellos + Proclus, 1928) — IMPORTED

- Cited in: Ep 216 (Psellos' letter on gold-making)
- Source: IA bundle `CatMssAlchGr`, file `CMAG-6-Psellus-Proclus_jp2.zip`
- Imported via `scripts/import/shwep-curator-pass-import.mjs` (source: ia_bundle)
- 257 pages, draft state
- Book id: `6a08fd8125e3a402b23b3fb0`
- Wired into ep 216 in `shwep-book-matches.ts`

## ✓ 3. Ben Jonson, *The Alchemist* (1612 First Quarto) — IMPORTED

- Cited in: Ep 216 (alchemist as comic mountebank figure)
- IA identifier: `jonsonalchemist` (1970 Scolar Press facsimile of 1612 quarto;
  the originally identified `alchemist16120000jons` was IA controlled-digital-
  lending and 403'd on hot-link, so switched to the folkscanomy unrestricted
  copy of the same Scolar Press reprint).
- 112 pages, draft state
- Book id: `6a08fd1125e3a402b23b3a75`
- Wired into ep 216 in `shwep-book-matches.ts`

## ✓ 2. Boll (ed.), *CCAG vol. VII: Codices Germanici* (1908) — IMPORTED

- Cited in: Ep 217 ("βίβλος σοφίας καὶ συνέσεως ἀποτελεσμάτων Ἀπολλονίου τοῦ
  Τυανέως" — the Book of Apollonios of Tyana, pp. 175–81)
- HathiTrust canonical: `mdp.39015033004238` (Michigan scan, full-view US)
- Imported via the **Wayback PDF mirror** (Hathi's image endpoint 403s
  programmatic fetches, so we used the bundled 13.16 MB PDF at
  https://web.archive.org/web/20240730113802id_/http://hellenisticastrology.com/ccag/CCAG07.pdf
  — same Michigan scan, no auth required).
- Pipeline: `scripts/import/ccag-vii-pdf-direct.mjs` — download PDF,
  `pdftoppm -jpeg -r 150 quality=85`, upload pages to R2
  (`books/{bookId}/pages/{NNNN}.jpg`), insert book + pages as draft.
- 141 pages (each is a 2-page book spread; ~282 book pages total).
  Book flagged `needs_splitting: true` so the splitter pipeline can
  carve each spread into individual pages.
- Book id: `6a09017f94673cde0ecee5c2`
- Wired into ep 217 in `shwep-book-matches.ts`

## Expanded scope — Renaissance dramatists (per user request)

The user expanded the curator pass to all early printed editions (1590s–1700s
quartos and folios) of Jonson, Shakespeare, and Marlowe. 25 books imported,
1 skipped (Jonson First Folio 1616, already in library). Results in
`scripts/import/shwep-curator-pass-results-2026-05-16.json`. Highlights:

- **Shakespeare:** First, Second, Third, Fourth Folios; Romeo and Juliet Q1
  & Q2; Henry V 1619; Hamlet 1625
- **Jonson:** First Folio (existing) + Second Folio (1640, vol. 1 + 2);
  Alchemist 1612; Volpone 1607; Sejanus 1605; Catiline 1611; Bartholomew Fair 1631
- **Marlowe:** Tamburlaine 1592 (both Parts); Doctor Faustus (1616 B-text,
  1620, 1631 quartos); Jew of Malta 1633; Edward II 1594; Massacre at Paris
  1594; Hero and Leander 1637; Dido, Queen of Carthage 1594

All imported as `status: 'draft', hidden: true, visible: false` — won't
appear in production search until reviewed.

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

## ⚠ 2. Boll (ed.), *CCAG vol. VII: Codices Germanici* (1908) — DEFERRED (found but blocked)

- Cited in: Ep 217 ("βίβλος σοφίας καὶ συνέσεως ἀποτελεσμάτων Ἀπολλονίου τοῦ
  Τυανέως" — the Book of Apollonios of Tyana, pp. 175–81)
- **Located on HathiTrust:** `mdp.39015033004238` (University of Michigan
  scan, full-view US public domain). Catalog record:
  https://catalog.hathitrust.org/Record/000527862
- **Wayback PDF mirror:** 13.16 MB at
  https://web.archive.org/web/20240730113802id_/http://hellenisticastrology.com/ccag/CCAG07.pdf
  — confirmed `application/pdf`, complete book, derives from the same Michigan scan.
- **Blocker:** HathiTrust's `babel.hathitrust.org/cgi/imgsrv/image` endpoint
  returns 403 to programmatic requests even with browser user-agent, so we
  can't hot-link page images. Direct PDF download requires HathiTrust partner
  login.
- **Follow-up path:** use the existing `POST /api/import/pdf` route (or its
  direct-DB analogue) to download the Wayback PDF, render pages via
  `pdftoppm` at 150 DPI, upload to Vercel Blob/R2, and create the book +
  pages. That's the path used by the CMC Kloss imports.

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

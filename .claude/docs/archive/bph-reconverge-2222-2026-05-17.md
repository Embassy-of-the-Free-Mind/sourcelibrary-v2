# BPH catalogue: 34 stale links unlinked (re-converge to 2,222, 2026-05-17)

Mode: **APPLY**

## Context

After the 2026-05-12 convergence pass (#1742) landed at 2,222 catalogued works, the count drifted up to 2,256. The `/api/cron/sync-bph-sl-book-ids` cron re-PATCHed `sl_book_id` for hidden duplicate books within 6h of convergence, since its query didn't filter on `visible`.

This pass:
1. Patches the cron to add `visible: { $ne: false }`.
2. NULLs `sl_book_id` on the 34 bph_works rows pointing at hidden Mongo books.
3. Sets `bph_catalog_link: false` on each hidden book (belt-and-suspenders).

**Before:** 2256 rows • **After:** 2222 rows

## The 34 books unlinked (partner review)

Each row's Mongo book remains in MongoDB — just hidden and opted out of catalog auto-link. To restore: clear `bph_catalog_link` and `dedupe`, set `visible: true`. The cron will then re-link on its next 6h run.

| UBN | Title | Author | Year | Pages | Dedupe reason | Mongo id |
|---|---|---|---|---|---|---|
| 1 | De bombardis: ac item de typographia | Kallendorf, Craig W\|Wells, Maria X | 1998 | 36 | final_pass_not_in_catalogue | `697768b0e832d9422ad6e0ba` |
| 608 | Ander Theil Gnothi Seauton. Nosce teipsum. Astrologia theolo | Weigel, Valentin | 1618 | 65 | final_pass_collision_swap | `68679f27fc518f6dbf334eb6` |
| 648 | Anleitung zur primitiven gabalistischen Wissenschaft | anonymous | 1780 | 250 | shared_numeric_ubn | `6867c831aadfee9e955ecc6a` |
| 2067 | Das Buoch, meteororum. Liber quartus paramiri de matrice | Paracelsus, Theophrastus | 1566 | 250 | final_pass_collision_swap | `6977813098a09acb229a3f0d` |
| 3585 | Dichiaratione sopra il XIII cap. dell'Apocalisse | Doni, Antonio Francesco | 1562 | 50 | shared_numeric_ubn | `6909c96acf28baa1b4cafbf3` |
| 3977 | Echo der von Gott hocherleuchten Fraternitet dess löblichen  | [Sperber, Julius] | 1616 | 313 | shared_numeric_ubn | `697b0799b42177f3ebcc7f4d` |
| 5220 | Die Lehren der Rosenkreuzer aus dem 16ten und 17ten Jahrhund |  | 1785 | 117 | shared_numeric_ubn | `690c27e6e0787282ad593281` |
| 5408 | Geoffenbarter Einfluss in das allgemeine Wohl der Staaten de | [Schleiss von Löwenfeld, Bernhard Joseph | 1779 | 186 | shared_numeric_ubn | `697c8e0fbaa544415f85b6b2` |
| 5409 | Geoffenbarter Einfluss in das allgemeine Wohl der Staaten de | [Schleiss von Löwenfeld, Bernhard Joseph | 1779 | 186 | shared_numeric_ubn | `697c8e0fbaa544415f85b6b2` |
| 8139 | Lebensbeschreibungen berühmter Männer aus den Zeiten der Wie | Meiners, Christoph | 1795 | 510 | shared_numeric_ubn | `69804b901fb2ba7cf1d43a1c` |
| 8338 | Liber egregius de unitate ecclesia | [Hus, Johannes] | 1520 | 252 | shared_numeric_ubn | `68fb0b2712055a03a58d3193` |
| 8762 | Magni philosophorum arcani revelator | anonymous | 1688 | 544 | gemini_orphan_collision_swap | `69819203084978306e4933f6` |
| 11122 | Philosophia maturata, oder ein ausführlicher philosophischer | Colson, Lancelot | 1696 | 104 | gemini_orphan_collision_swap | `6909c9d0cf28baa1b4cafc1b` |
| 11417 | Les plus secrets mystères des hauts grades de la maçonnerie  | [Köppen, Karl Friedrich] | 1767 | 194 | gemini_orphan_collision_swap | `6985ca6d9d0a51f652882363` |
| 11805 | Pymander. Asclepius. De mysteriis Aegyptiorum. In Platonicum | Hermes Trismegistus\|Jamblichus\|Proclus | 1532 | 336 | gemini_orphan_collision_swap | `690989d5cf28baa1b4cae1c9` |
| 11807 | Pymander | Hermes Trismegistus | 1585 | 532 | shared_numeric_ubn | `6985ca72b037546226b9db91` |
| 13257 | Silentium post clamores, das ist, Apologi und Verantwortung | [Maier, Michael] | 1617 | 200 | shared_numeric_ubn | `690c3840e0787282ad59386d` |
| 15423 | Vier Tractaetlein | Pordage, John | 1704 | 147 | shared_numeric_ubn | `6909cd99cf28baa1b4cafdf1` |
| 17508 | Historia: von dem Leben und Wandel der heyligen Barlaam dess | anonymous | 1603 | 320 | shared_numeric_ubn | `023f2b73-5a9f-4ada-92c2-258a408d89c2` |
| 19517 | Sefer ha-bahir | [Nechunja ben haKana] | 1651 | 62 | final_pass_collision_swap | `6911cf678cb6d2ae494a1061` |
| 20573 | Geometrie practique | Bovelles, Charles de | 1547 | 73 | shared_numeric_ubn | `c1eb9995-02e3-45b3-afa1-c0a52fd5b646` |
| 20591 | Le cimetière d'Amboise | Saint-Martin, Louis Claude de | 1801 | 21 | shared_numeric_ubn | `6909bf03cf28baa1b4caf69d` |
| 20840 | Erzählungen zum Vergnügen und zur Seelenbildung | Eckartshausen, Karl von | 1785 | 424 | shared_numeric_ubn | `6909f42ecf28baa1b4cb0dc3` |
| 21141 | Controversiae cum Judaeis prodromi libri II | Wienner von Sonnenfels, Aloys | 1758 | 332 | shared_numeric_ubn | `6909ba43cf28baa1b4caf455` |
| 21142 | Philosophia pia | Glanvill, Joseph | 1671 | 258 | shared_numeric_ubn | `6909b22fcf28baa1b4caf185` |
| 21528 | Histoire curieuse de la vie, de la conduite, & des vrais sen | [Marets, Daniel des] | 1670 | 390 | shared_numeric_ubn | `6909bf46cf28baa1b4caf6b5` |
| 21571 | Opera | Cyrillus Alexandrinus | 1566 | 632 | shared_numeric_ubn | `690c2b8fe0787282ad593441` |
| 30161 | Medulla animae, das ist, von Vollkommenheit aller Tugenden | Tauler, Johannes | 1672 | 307 | shared_numeric_ubn | `690c4d40e0787282ad59401f` |
| 30465 | Raphael artem medicam explanans | Hafenreffer, Samuel | 1629 | 80 | shared_numeric_ubn | `6909d388cf28baa1b4cb0103` |
| 30562 | Der mitternächtige Post-Reuter | [anonymous] | 1631 | 20 | shared_numeric_ubn | `6909d1c8cf28baa1b4cb0023` |
| 30601 | Kirchen- oder Haus-Postill, über die Sonntags- und fürnehmst | Weigel, Valentin | 1700 | 670 | shared_numeric_ubn | `690c44f3e0787282ad593d7d` |
| 30882 | Enchiridion Leonis papae | anonymous | 1810 | 224 | shared_numeric_ubn | `697b079611cc8928b55ea386` |
| 30959 | Morgenröte im Aufgang, das ist: die Wurzel oder Mutter der P | Böhme, Jacob | 1780 | 448 | final_pass_collision_swap | `6867c580aadfee9e955eca92` |
| 31185 | Origine de la maçonnerie adonhiramite | [Guillemain de Saint-Victor, Louis] | 1787 | 166 | shared_numeric_ubn | `6984e84ed13e559bb970b9a4` |
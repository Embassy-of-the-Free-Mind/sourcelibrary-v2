# `published` fill (#6056, #4572): 20-row by-eye check before the write

Run 2026-10-20, job published-fill. Script: `scripts/maintenance/fill-published-from-title-page-6056.mjs`.
Draw: `sample-seed2026102001.json` (seed 2026102001, mulberry32, uniform over the 3,691 rows that passed every
exclusion rule). Each title page was opened as an image and the printed date compared with the value to be written.

**Result: 20/20 right, 0 wrong.** The bar was 0 wrong.

| # | book | value | page | what the leaf prints | verdict |
|---|---|---|---|---|---|
| 1 | 6a4de8857f10a16d4eddb3ae | 1543 | 1 | Ingolstadii Anno. M. D. XLIII. | right |
| 2 | 6a4adbed2f55066780cb4bea | 1681 | 1 | "quae fuit 2. Jun. Anno 1681", Jena, Bauhofer; no separate imprint year | right (occasion date, catalogue agrees) |
| 3 | 6a4ab33c0a459d47e0d00029 | 1666 | 3 | Editio quarta, Exscribebat Michael Wendt, Anno MDCLXVI (disputation 1657) | right |
| 4 | 6a4c8a2a6a017d6d1595c8f2 | 1669 | 1 | Ad diem … Octobris, M. DC. LXIX., Altorffi | right |
| 5 | 6a4e59a600c1250433dc255e | 1589 | 1 | Francofurti, impensis Feyrabendij, M. D. LXXXIX. | right |
| 6 | 6a490f0da9e39181572dd59a | 1664 | 1 | Beruthi, apud Gebhardum, Anno MDCLXIV | right |
| 7 | 6a49232da45b99e46af93275 | 1700 | 1 | Franckfurt und Leipzig … Liegnitz … 1700 | right |
| 8 | 6a4c12f86fcacb6a93788bae | 1659 | 1 | oration "13. Decemb: 1659", Rostock, Richel; no separate imprint year | right (occasion date, catalogue agrees) |
| 9 | 6a4aab5014a573f4677174a6 | 1623 | 3 | Coloniae, Albinus Dusseldorpff, Anno M. DC. XXIII (title's M.DC.XIX is the subject) | right |
| 10 | 6a4b2f0debdd5bdf63df0761 | 1687 | 1 | Ad d. 23. Mart. Anno 1687, Lipsiae, Coler | right |
| 11 | 6a4f2173ce720e255f3c5162 | 1657 | 3 | Lipsiae, Wittigau, M DC LVII | right (the quoted evidence is a handwritten 1657 at the head) |
| 12 | 6a4f091130413060585942f4 | 1651 | 9 | Rostochii, Kilius, Anno M. DC. LI. | right |
| 13 | 6a4a70427b720133514b2b70 | 1569 | 1 | "Anno Sexagesimo nono", Ingolstadii, Weissenhorn | right (the quoted 1569 is a pencil note; the printed text gives the year in words) |
| 14 | 6a4bfc384f392afd49e42bd3 | 1660 | 1 | Wittenberg, Haken, M. DC. LX. | right (the quoted 1660 is a marginal note) |
| 15 | 6a4f7e782a450f51978cffdf | 1600 | 1 | Henricopoli, Corneus, Anno MDC | right |
| 16 | 6a4aff5e19bd0084b1bf282d | 1684 | 1 | Ad D. XIX. Aprilis A.R.S. M DC LXXXIV, Wittenberg | right |
| 17 | 6a4f3ac139ecc8e27dc65333 | 1661 | 5 | Die … Aug: Anno M DC LXI, Frankfurt/Oder | right |
| 18 | 6a4b84a4c0fa233644e30e15 | 1608 | 1 | Helmaestadii, Excudebat Iacobus Lucius. Anno 1608 | right |
| 19 | 6a4f225bce720e255f3c5d0e | 1657 | 5 | Excudebat Hubertus Reulandt, Anno 1657 | right |
| 20 | 6a4ef2d3451d36458a83887f | 1624 | 1 | Giessae, Hampelius, M DC XXIV | right |

Notes for whoever reads the provenance later:
- In 3 of 20 (11, 13, 14) the dating run's quoted evidence is a handwritten year, not the printed one. The value is
  still right in all three because the rule rows (3,591 of 3,691) also require the source library's catalogue year to
  match. The stamp quotes the evidence as the dating run stored it; it is not always the printed line.
- 2 of 20 (2, 8) are occasional prints that give the date of the event (an entry, an oration) and no separate year
  in the imprint. That is how these are catalogued (MDZ gives the same year).

Exclusions (291 of 3,982) are listed row by row in `plan-summary.json`.

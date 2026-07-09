# BPH cover-quality audit — 2026-05-12

Issue #1679, step 1. Read-only audit of BPH books with missing, blank, placeholder, or tiny cover thumbnails. Sorted by `read_count` so the most-visited broken covers come first.

## Summary

| Bucket | Count |
|---|---|
| Total BPH books | 2280 |
| OK | 2275 |
| MISSING | 0 |
| BLANK | 4 |
| PLACEHOLDER | 1 |
| TINY | 0 |
| **Total flagged** | **5** |

## Top 5 books to fix (by read_count)

| # | State | Reads | Title | Author | Reason | Book |
|---|---|---:|---|---|---|---|
| 1 | BLANK | 5 | [Greek] Argonauticon libri IIII | Apollonius Rhodius | page 2 classified as blank | [link](https://sourcelibrary.org/book/argonautica-rhodius) |
| 2 | BLANK | 5 | De amore dialogi tres | Abrabanel, Jehuda | page 1 classified as blank | [link](https://sourcelibrary.org/book/three-dialogues-on-love-abrabanel) |
| 3 | BLANK | 0 | Chemiae definitio, objectum, origo, usus, et divisio (PH164 bis) | Unknown | page 3 classified as blank | [link](https://sourcelibrary.org/book/definition-of-chemistry-18th-century-latin-ms) |
| 4 | BLANK | 0 | Hermetis philosophi de revolutionibus nativitatum (PH216) | Hermes Trismegistus | page 3 classified as blank | [link](https://sourcelibrary.org/book/hermes-trismegistus-on-the-revolutions-of-nativities-trismegistus) |
| 5 | PLACEHOLDER | 0 | Offenbahrung Jesu Christi: das ist: ein Beweisz durch den Titul uber das Creutz  | Lautensack, Paulus | OCR matches digitizer-insert/library-stamp pattern | [link](https://sourcelibrary.org/book/revelation-of-jesus-christ-lautensack) |

Full ranked list (all 5 flagged books) is in `bph-cover-audit-2026-05-12.json`.

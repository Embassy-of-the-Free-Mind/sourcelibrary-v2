# (d) page-order detector — precision by eye

PRIOR ART: none — the #5699 detector is new (see page-marker-order.mjs header for where we looked).

Detector: `scripts/eval/page-marker-order.mjs` (v5, the version committed). Read by eye from the
OCR's running heads, centred and bare numerals on the flagged pages and their neighbours. The
`<page-num>` tag is shown as a cross-check only; the detector does not use it. No images were
opened, so a verdict rests on the printed numbers as the OCR read them.

**TRUE** means a served page range really stands in the wrong order: printed numbers fall in storage
order, or two leaves are swapped. **FALSE** means the numbers were not page numbers (verse, chapter,
paragraph, table cells, marginal references), or a single OCR digit misread made something that
looked like a swap.

## Final sample: v5, fresh, seed 56995, 20 books never reviewed before → 16/20 TRUE (80%, Wilson 95% CI 58–92%)

| book | lang | verdict | why |
|---|---|---|---|
| [69e534c6…70b2](https://sourcelibrary.org/book/69e534c6d48480a3869670b2) Book of Misers | Arabic | TRUE | index pages 289, 288, 287 … descend through storage 35–41 |
| [69c1bb3c…d9af](https://sourcelibrary.org/book/69c1bb3c8522835be845d9af) Tzemach Tzedek II | Hebrew | FALSE | bare-last 95/90/85/80 are paragraph numbers; the pages ascend (153–156) |
| [69ea3ea1…3bd6](https://sourcelibrary.org/book/69ea3ea1300d991d0f1d3bd6) Precious Records | Arabic | TRUE | ٣٠٩, 308, ٣٠٧, 306 at storage 101–104 |
| [69c8330b…e140](https://sourcelibrary.org/book/69c8330b6c6f3cc53c84e140) Ausführliche Nachricht | German | FALSE | "368" at storage 385 is a misread 365; the rectos run 363, 365, 367, 369 |
| [69b63e87…11a3](https://sourcelibrary.org/book/69b63e87535439aaa48911a3) Kitab al-Luma | Arabic | TRUE | ١٨٦ → 180 descending over storage 511–517 |
| [69b63e85…e472](https://sourcelibrary.org/book/69b63e852a1dde00d5a9e472) Al-Kashshaf | Arabic | TRUE | ٣٥٩, ٣٥٨, ٣٥٧ … ٣٥٣ descending |
| [69a5eb4d…6d10](https://sourcelibrary.org/book/69a5eb4daa8e0e4092146d10) Acts of the Martyrs III | Syriac | TRUE | 690, 688, 686, 684: the whole Bedjan volume descends |
| [69935b20…c445](https://sourcelibrary.org/book/69935b208e28d8f4c5d3c445) Kashf al-Maḥjūb | Persian | TRUE | the Russian apparatus at the back runs — 64 —, 63, 61, 60 |
| [6a085539…555a](https://sourcelibrary.org/book/6a08553915c643eb1af5555a) Aeschyli Tragoediae | Greek | TRUE | heads 112 (storage 12), 111, 109 (18), 107, 106 |
| [69ae9cd3…3443](https://sourcelibrary.org/book/69ae9cd3591c8449ffb83443) Codex Climaci Rescriptus | Greek/Syriac | TRUE | 201, 200, 199 … descending |
| [69e96144…ac2b](https://sourcelibrary.org/book/69e961442beefe2f6f72ac2b) Riḥlat Ibn Jubayr | Arabic | TRUE | index 360, ٣٥٩, 358 … descending |
| [69e4209e…1eb7](https://sourcelibrary.org/book/69e4209e813af15d2bdc1eb7) Tawq al-Hamama | Arabic | TRUE | ١٢٧, ١٢٦, ١٢٥, 124, ١٢٢ |
| [6a21994b…b7e5](https://sourcelibrary.org/book/6a21994b4b61907ea5ffb7e5) Flashes of Light | Persian | TRUE | (63), (62), (61), (60) centred |
| [69943c78…7b20](https://sourcelibrary.org/book/69943c7813c9a0dce2757b20) On Religious Perfection | Syriac | TRUE (probable) | 110, **113, 112**, 114: two leaves swapped |
| [69a5ed2c…9bc2](https://sourcelibrary.org/book/69a5ed2c96d6dd816a569bc2) Syriac Chronicle | Syriac | TRUE | 524, 522 … 490 descending |
| [69920bef…d569](https://sourcelibrary.org/book/69920befebe5b0fa6be5d569) Mishnah, Kaufmann MS | Hebrew | FALSE | the numbers are Mishnah chapter/mishna numbers ("פרק ד משנה א") |
| [69e53454…5c84](https://sourcelibrary.org/book/69e53454d48480a386965c84) Kalila wa Dimna | Arabic | TRUE | 69, 68, 69, 68, 67, 64, 65: descending AND duplicated leaves |
| [69a5ed79…aae6](https://sourcelibrary.org/book/69a5ed7996d6dd816a56aae6) Syriac Anecdotes III–IV | Syriac | TRUE | 324, 323, 322, 318 … 302 over storage 41–63 (printed + storage ≈ 365 throughout) |
| [69ee8906…63cf](https://sourcelibrary.org/book/69ee89064501bec8965463cf) Hymns of the Rigveda | English | FALSE | "128" at storage 140 is a misread 123 (3↔8) |
| [69e75acc…8f0e](https://sourcelibrary.org/book/69e75accb3d509fcb7a48f0e) Chikamatsu Jōruri III | Japanese | TRUE | 559, 557, 555, 553 … the volume is stored back to front |

## How the detector got there (each round reviewed 20 flagged books by eye)

| version | change | precision on that round's sample |
|---|---|---|
| v1 | heads + centred + bare numerals | 9/20 looked true, **but 6 of the 9 sat on negative `page_number`s** (soft-hidden original spreads, numbered −n, so they sort in reverse; `paired-artifacts.md`). Reader-relevant: 3/20 |
| v2 | reject verse references at the end of heads ("ENOCH 51. 3—52. 8"), Hebrew dictionary letter heads, non-local swaps | 16/20 looked true, but 9 of the 16 were negative-numbered spreads. Reader-relevant: 7/20 |
| v3 | **served pages only (`page_number >= 0`)** | 8/20 |
| v4 | ignore numbers inside `<margin>`; a long-gap descending step counts only when it follows the reversed-page slope; a swap needs both members from the same source | 12/19 on a fresh sample (one draw was the positive control) |
| v5 | head references ending in a number ("XXXIX. 1.—XLI. 8.", "1 IOH. 4, 13."), a leading number only when it is the head's only number | **16/20 on a fresh sample** (above) |

v4 and v5 were each tuned on the round before them. Each headline figure therefore comes from a sample
the detector had not seen. Rounds 1–4 are archived with the raw packets, outside the repo.

**Positive controls, every version:** 69e9617a2beefe2f6f72ba14 (Benjamin of Tudela) flags DESC on
storage 190–236 and 260–309. 6a9fb207732b9e75e96ba46f (Maqrizi) flags SWAP, and not only p107/p108:
the section counters `[CHAP. XXXIX, n]` run 6, 11, 9, 18, 14, 21 … through the book. **The book is
pair-swapped throughout**, not at one place.

**Remaining false-positive shapes:** a single OCR digit misread (3↔8, 5↔8, ٦↔٩) that looks like a
swap; paragraph or Mishnah numbering read as a bare numeral. **Recall is not measured.** Only books
whose OCR carries ≥10 readable markers can be checked at all: 237 of 736 RTL books, 65 of 1,456 CJK
books and 353 of the 1,500-book Latin-script sample.

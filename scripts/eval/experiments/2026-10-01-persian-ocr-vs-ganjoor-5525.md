---
stage: ocr
measure: accuracy
languages: [fa]
scripts: [Arab]
canons: [persian-poetry]
n_books: 21
n_pages: 21
verdict: "Served Persian manuscript OCR scores sequence accuracy 0.41 and line accuracy 0.74 vs Ganjoor, 4/21 pages degenerate; the 0.90 gate is not met."
status: rejected
decision: "Stage 2 (OCR and translate the six prose manuscripts on the served lane) not run; needs a different OCR lane first (#5525)"
superseded_by: null
issue: 5525
---
## 2026-10-01 · Is served Persian OCR accurate enough to OCR and translate the six prose Sufi manuscripts? Measured on classical poetry vs Ganjoor (#5525)

**Question.** Eternity's Persian shelf (110 hidden books). Before paying to OCR and translate six prose manuscripts (*Laṭāyif-i Ashrafī*, *ʿImād-i Subḥāniyah*, the *Tarjumah-i Upnakhat*, *Khulāṣat al-Akhbār*, *Tārīkh al-Ḥukamāʾ*, *48 Texts on Philosophy*; ~4,700 pages), how accurate is the Persian OCR we already serve? The gate set in the issue: median character accuracy ≳ 0.90, or by-eye reads that say the text is usable.

**Design.** `measure: accuracy` against an independent reference, the Ganjoor open SQLite dump (`ganjoor-db-14050703.zip`, github.com/ganjoor/desktop v3.1, 3.2M verse rows, 263 poets). Sample: 24 hidden poetry books with OCR'd preview pages, one interior text page per book (`persian-ganjoor/sample.mjs`, seed 20261001, 20–80% band of OCR'd pages, ≥ 400 Arabic-script letters in the body, `page-type` text). Manṭiq al-Ṭayr has 0 OCR'd pages. Amīr Shāhī has no text page. One draw was a 2009 cataloguing page and is excluded. Instrument: `persian-ganjoor/persian_align.py`, which imports `nalanda-readiness/indic_align.py`'s retrieval, span rule and edlib score unchanged and adds a Persian normaliser (ی/ي, ک/ك, hamza seats, harakat, ZWNJ). The primary score also folds گ/ک, پ/ب, چ/ج, ژ/ز, because the scribes do not distinguish them; the strict score differs by ≤ 0.04. It reports two metrics:
- **seq**: sequence accuracy, 1 − ed/len(ref). Reading order counts.
- **line**: order-free line accuracy. Each OCR line is matched to its best Ganjoor hemistich or couplet near the located passage (`line_local`) or anywhere in the expected poet's works (`line_global`, an upper bound).

Strata were read from the image: 3 typeset (Būlāq 1851 ×2, Istanbul 1860) and 21 manuscripts. There are **no lithographs** in the poetry set, and the six prose books are all manuscripts (Manchester, Chester Beatty), so the manuscript stratum is the one the gate is about. Arms: 14 of 21 manuscript pages are `gemini-3.1-flash-lite`, which is what the production router sends today (`OCR_LITE_ONLY`). The rest are `gemini-3-flash-preview`.

**Controls first (folded; both separate).**

| Control | seq | line |
|---|---|---|
| Exact | 1.000 (min 1.000) | 1.000 |
| +5% noise | 0.943 (min 0.918) | 0.950 (min 0.942) |
| Wrong page (another page's span) | 0.273 (max 0.288) | n/a |
| Wrong place, same poet | 0.274 (max 0.325) | 0.360 (max 0.399) |
| Wrong poet, global | n/a | 0.424 (max 0.491) |

**Result (folded).**

| Stratum | Located pages | seq median (IQR) | line_local median (IQR) | Lines ≥ 0.80 |
|---|---|---|---|---|
| Manuscript | 9 of 16 in Ganjoor | **0.414** (0.369–0.625) | **0.738** (0.632–0.764) | 46% |
| Typeset | 3 of 3 | 0.81 (0.50, 0.81, 0.90) | 0.62, 0.67, **0.97** | |

- **Manuscripts, intention to treat** (all 16 whose work is in Ganjoor): `line_global` median 0.64 (IQR 0.46–0.76), and the median page has 20% of lines ≥ 0.80. 7 of 16 could not be located at all:
  - two loops: Shahnama, where `که` is 67% of words; Ḥadīqa, where `اش` repeats for ~5K chars;
  - two more dominated by repetition: Dīvān-i Shams (Chester Beatty), 22% `که`; Masnavī 1500, 14% `بود`;
  - one garbled page (read 1 below);
  - one where the reference is missing, not the reading (read 3 below);
  - one Masnavī page at 0.55, near the 0.49 wrong-poet ceiling.
  
  4 of 21 manuscript pages are degenerate output.
- **Typeset**: the text is right, but the reading order often is not.
  - Istanbul 1860 was read column by column: seq 0.50, line 0.97.
  - The Būlāq pages interleave Persian verse with an Ottoman Turkish verse translation. Both are tagged `Persian, Ottoman Turkish`, correctly. Seq on the Persian is 0.81–0.90; line is lower because the Turkish lines have no reference.
- **Reading order** is a defect in its own right. A page read column-wise splits every couplet, and the translator then pairs the wrong hemistichs. Part of the gap between manuscript seq and line comes from this (seen by eye on the Ḥadīqa page, read 2). The rest is dropped words and margins. Column order was not counted on every page.

**By-eye reads (labelled read-from-image).**
1. **Masnavī, Manchester, 1633–35** (`69c1b8db…_27`). The OCR invents marginal headings that are not on the leaf ("در بیانِ صفتِ مرغ و صیاد"); the margins actually hold verse. The main block is garbled paraphrase: "سایهٔ یزدان چو باشد دایه‌اش" became "سایه زد حاج باشد دانه او", and "عقبهٔ زین صعب‌تر در راه نیست" became "پنجه زین صعبِ رود راه". Not usable.
2. **Ḥadīqa, Manchester, 681 AH / 1283** (`69c1ba2e…_34`). This is the best manuscript page: a clear early naskh, line 0.87. It is a real reading, not recitation: variants follow the leaf ("از پی جاه و حشمت و صولت"). But words drop ("ز بهر دیدن" became "به دیدن", "بلمس بر عضوی" became "به لمس عضوی"), and the two columns were read one after the other, so the couplets are split.
3. **Dīvān-i Shams, Manchester, 1859** (`69c1b9d1…_33`). The ghazal "یار بیا یار بیا" is not in Ganjoor's Dīvān, so this page is a reference gap and not an OCR failure. By eye: roughly 1–2 errors per hemistich, several of which change the sense or delete a name:
   - "مالک دینار" became "مالک دین" (the Sufi Mālik Dīnār is lost);
   - "مفخر" became "مغفر", "مطلع" became "قطر", "زبده" became "بازده";
   - "معنی الفاظ نبی" became "منبع الفانی".

**Decision.** The gate is **not met**. Manuscript sequence accuracy is 0.41 and order-free line accuracy is 0.74, against a 0.90 bar. 4 of 21 pages are degenerate, and even the cleanest hand loses words and couplet order. The six prose books are dense nastaʿlīq/naskh manuscripts with no line structure to help, so they would be read no better. **Stage 2 was not run; spend $0.** The same flash-lite text is what any Persian manuscript would be served with today, so publishing one needs a different OCR lane first, not just this check. Typeset Persian reads well, apart from column order.

**Not measured.** No lithographs; `gemini-3-flash-preview` and flash-lite were not compared on the same pages (paired A/B, a later question); prose was not scored.

**Ganjoor licence (quoted from its own pages, 2026-10-01).**
- ganjoor.net/about: "گنجور نیز اشعاری را که از منابع دیگر نقل کرده به صورت دوره‌ای و در قالب پایگاه داده‌های نرم‌افزار آزاد و رایگان گنجور رومیزی منتشر می‌کند تا گروهها و علاقمندان دیگر بتوانند با استفاده از این مجموعه کارهای مشابه گنجور را انجام دهند" ("Ganjoor periodically publishes the poems it has taken from other sources as the database of the free Ganjoor Desktop software, so that other groups and enthusiasts can use this collection to do work similar to Ganjoor's").
- ganjoor.net/faq: "اطلاعات گنجور در قالب پروژه بازمتن و رایگان گنجور رومیزی و در قالب SQLite برای عموم در دسترس است" ("Ganjoor's data is available to the public as the open-source, free Ganjoor Desktop project, in SQLite format").

No licence is named for the text itself. The code repos are MIT (desktop) and GPL-3.0 (GanjoorService). Ganjoor credits a source per poem, and some are modern critical editions (Forūzānfar and others). So the reference licence is recorded as `unknown`: usable for scoring, blocked from export (eval-design §4.1). The #5513 poetry import needs a per-source check first. No Ganjoor text is committed here, only scores.

*Replicated?* No; n = 9 located manuscript pages is `exploratory`. *Artifacts:* `scripts/eval/persian-ganjoor/` (sampler, aligner, book→poet map, strata), `results/persian-ganjoor-2026-10-01/` (summary.json, folded and strict scores, sample metadata without text). Spend $0 (CPU). Comment on #5525.

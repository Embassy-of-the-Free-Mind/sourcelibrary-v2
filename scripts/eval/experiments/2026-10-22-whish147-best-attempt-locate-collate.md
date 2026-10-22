---
stage: ocr
measure: [coverage]
languages: [sa]
scripts: [Mlym]
canons: [sanskrit]
n_books: 1
n_pages: 159
verdict: "Leaf-by-leaf locate + collation with Opus placed 209 of the 304 non-blank leaves on pp. 4–159 of Whish MS 147 in a published text, in unbroken sequence through the Sāṅkhyakārikā, Jayamaṅgalā, Dīpikā and Tarkasaṃgraha. It placed none of the 91 leaves of pp. 66–111 (a denser 11–12-row hand), at half- or quarter-leaf resolution; Fable free reads of those found connected words on 27 of their 182 half-leaves."
status: informational
decision: "The 159 pages were written with per-page warnings (#7119). For dense-hand palm leaf, locating needs something other than a whole-leaf view; the planted-error rate still covers only the verses."
superseded_by: null
issue: 7119
---
PRIOR ART: 2026-10-21-whish147-malayalam-palm-leaf-opus.md — it measured collation against an edition (25/36 planted differences found) and free reads (at chance) on 9 leaves, and placed 15 left half-leaves; it did not try to place a whole manuscript leaf by leaf, nor the commentaries.

## 2026-10-22 · How far does locate-then-collate reach across a whole palm-leaf manuscript? (#7119)

**Design.** Every scan of RAS Whish MS 147 (`6ad845ec6037414ddef152af`, 159 scans, two leaves each) was segmented automatically and each leaf cut at its midpoint. For each leaf, Opus 5.5 (`claude -p`, subscription, sealed folder) was given both halves and a window of the reference text starting where the previous leaf ended, and asked to copy, row by row, the first and last words it could see. A leaf counted as placed only when at least 3 of those phrases matched the window and clustered (`locate.mjs`, `parseLocate`). Placed leaves were then collated against their excerpt (`collate.mjs`). Three streams started at work boundaries found by a colophon probe (`probe.mjs`). References: GRETIL kārikās, Jayamaṅgalā (Sarma 1926), Tarkasaṃgraha and Dīpikā; the Tattvakaumudī from our own OCR of Tārānātha's print. Artifacts: `scripts/eval/results/whish147-best-attempt-2026-10-22/`.

**Result.**

| stretch | text leaves | placed |
|---|---|---|
| pp. 4–65: kārikās, then Jayamaṅgalā | 124 | 123 (4t, a leaf of large loose syllables before the text, was not) |
| pp. 66–111: Tattvakaumudī stretch, fragment, Malayalam note | 91 | 0 |
| pp. 112–159: Dīpikā, then Tarkasaṃgraha, end boards | 89 | 86 (not: the guard leaf 144t, 156t, the board on p. 159) |

- The placed spans run in sequence with no backward jump. The Jayamaṅgalā stream ended at the edition's last character (87,076 of 87,079) on the leaf whose probe showed the colophon (65b). The kārikās ended on 11t, where the Jayamaṅgalā invocation stands. The Tarkasaṃgraha opened on 144b, where the probe saw its invocation. Each is an independent check that the placement followed the text, not the window.
- **Not placed: pp. 66–111.** Opus placed no row on 66t–72t at half-leaf resolution, nor on 70t cut into four quarters at native resolution (~1,250 px wide each), nor on 85t and 100b with 16,000-character windows at the estimated position. On 107b and 108t it did pick out words (*pratyayasarga*, *tanmātra*, *vivekakhyāti*) and named them as Sāṅkhya commentary, but placed no row. Fable free reads of these 91 leaves found 5 or more distinct words of 4+ letters on only 27 of 182 half-leaves. The rest came back as runs like "[illegible] ca [illegible] ca", and the pages say no connected words were read.
- Where the scan order of the Tattvakaumudī lies is still open. The colophon probe saw a Tattvakaumudī-like colophon and the scribe's closing verse at 66b–67t, and no opening invocation in 67–111.
- **Translation.** 151 of 159 pages carry an English translation with its warning. The translation write door refused 8 free-read pages (66, 67, 95, 100, 106–109) as `collapsed`: a long OCR attempt with almost no English, which is the right English for those reads.

- *Replicated?* One manuscript.
- *Not measured:* how accurate the collated text is beyond the verses. The 25/36 planted-difference figure covers kārikā leaves only, and the page warnings say so.

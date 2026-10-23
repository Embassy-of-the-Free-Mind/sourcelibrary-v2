---
stage: ocr
measure: [accuracy, stability]
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
PRIOR ART: 2026-10-21-whish147-malayalam-palm-leaf-opus.md — it measured collation against an edition (25/36 planted differences found) and free reads (reported at chance there; see the correction below) on 9 leaves, and placed 15 left half-leaves; it did not try to place a whole manuscript leaf by leaf, nor the commentaries.

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

- **Correction to the free-read figure (parent session, #7119, 2026-10-22).** The 2026-10-21 at-chance CER (0.64–0.75) scored a whole half-leaf read against one contiguous window of GRETIL, which a half-leaf row cannot match. Re-scored row by row inside each leaf's verse span (noise floor 0.70), Fable 5.1 half-leaf free reads pool at CER 0.51 (7 leaves, 0.45–0.58; 2 of 9 declined), Opus 0.54. The free-read page warnings were rewritten to that figure (52 pages). 8 pages whose free read is long and fluent also say the model may be supplying a remembered text.
- **Fresh direct Opus read from column crops (2026-10-23, Derek's request).** After the one-leaf-per-page split, each leaf was cut at its two string holes into column pieces (each ≤ 1,600 px, nothing downscaled) and read by Opus 5.5 in one call, in Malayalam script, with no edition shown (`fresh.mjs`). Scored per row with #7148's instrument (`score-fresh.py`):
  - On the 9 verse leaves the pooled CER is 0.37 (floor 0.75), better than the half-leaf reads (0.51 Fable / 0.54 Opus), but bimodal: 0.04–0.17 on five leaves and 0.48–0.63 on four. On 8t Opus wrote that recognising kārikās 40–45 "shaped what I wrote". A second read of 6t went from 0.09 to 0.40; 5b stayed at 0.04–0.05. The low scores are partly memory of the verses.
  - Across all 209 placed leaves, commentaries included, the fresh read differs from the edition excerpt at CER 0.53 pooled (median 0.55; under 0.2 on 6 leaves), against the anchored text's own excerpt (low by construction).
  - Kept as the page OCR on 108 leaves (unplaced, blank and boards) and as a labelled note under the anchored text on 206 leaves. On 3 leaves the fresh read scored below the anchored text and became the OCR: two verse leaves at 0.03–0.04, one Tarkasaṃgraha leaf at 0.20.
- *Replicated?* One manuscript.
- *Not measured:* how accurate the collated text is beyond the verses. The 25/36 planted-difference figure covers kārikā leaves only, and the page warnings say so.

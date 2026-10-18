---
stage: pipeline
measure: [accuracy]
languages: [en, la, grc, ru, zh, bo, ar, he]
scripts: [Latn, Grek, Cyrl, Hani, Tibt, Arab, Hebr]
canons: []
n_books: 300
n_pages: 300
verdict: "On 300 random live pages, the keyword service finds a page printing a copied phrase in the top 10 as often as the Atlas lane or more often, in every script stratum, at 1/12 to 1/50 of the time. Quoted: 300/300 for both, 9 ms vs 108 ms at p50. Unquoted, both lanes are weak (0.42 vs 0.43 Hit@10 for a distinctive run), and unquoted Han and Tibetan phrases find nothing in either: the page lane ORs single characters and syllables."
status: informational
issue: [2049, 6852]
---

PRIOR ART: `2026-10-17-keyword-service-parity-6852.md` compared the two lanes on logged queries, against each other, with no ground truth. This one samples pages and uses the page itself as the truth. Instrument: `scripts/eval/search-evals-2049/known-item.harness.ts`.

## 2026-10-17 · Does the keyword service find the page a reader copied a phrase from? (#2049 eval check 4)

**Question.** A reader who types a few words they saw on a page should get that page back. Does the keyword service do that as well as the Atlas page lane it would replace, in every script?

**Method.**
- **Sample.** 300 random live pages (visible, `pages_count > 0`, not hidden, content types), stratified by book language: English translation 60, Latin-script OCR 60, Greek 30, Cyrillic 30, Han 40, Tibetan 30, Arabic-script 25, Hebrew 25. Seed 2049; the phrases stay in scratch.
- **Phrase.** From the page's own text: OCR for originals, translation for English. `pages_search` maps both.
  - Spaced scripts: a 3–5 word run joined by spaces only, words ≥ 3–4 letters and not function words, two of them ≥ 5 letters.
  - Han: 5 characters. Tibetan: 4 syllables.
- **Arms.**
  - `random`: a random qualifying run.
  - `distinctive`: the run whose shortest word is longest. For Han and Tibetan it is the random run.
  - `quoted`: the distinctive run in `"…"`.
- **Atlas.** The route's main stage, `buildPageSearchStage(q)`, top 25, then the route's live-book drop. **Service:** `POST /lane`, k 25.
- **Scoring.** Strict = the source page's rank. Lenient = the first page printing the phrase (duplicate scans, other editions). Hit@10 and MRR over the top 25. 0 errors on either side in 900 calls each.

**Results.**

### arm random
| stratum | n | Atlas Hit@10 strict / lenient | Atlas MRR strict / lenient | service Hit@10 strict / lenient | service MRR strict / lenient | Atlas ms p50 / p90 | service ms p50 / p90 |
|---|---|---|---|---|---|---|---|
| english_translation | 60 | 0.20 / 0.28 | 0.12 / 0.15 | 0.20 / 0.28 | 0.12 / 0.16 | 1243 / 2202 | 56 / 92 |
| latin_script | 60 | 0.17 / 0.22 | 0.09 / 0.14 | 0.22 / 0.27 | 0.10 / 0.14 | 845 / 1408 | 21 / 60 |
| greek | 30 | 0.10 / 0.13 | 0.03 / 0.06 | 0.13 / 0.20 | 0.03 / 0.07 | 557 / 862 | 23 / 39 |
| cyrillic | 30 | 0.63 / 0.63 | 0.27 / 0.27 | 0.67 / 0.67 | 0.41 / 0.43 | 282 / 580 | 10 / 31 |
| han | 40 | 0.00 / 0.03 | 0.00 / 0.03 | 0.00 / 0.03 | 0.00 / 0.03 | 342 / 570 | 40 / 54 |
| tibetan | 30 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 420 / 656 | 44 / 93 |
| arabic | 25 | 0.64 / 0.68 | 0.39 / 0.43 | 0.80 / 0.84 | 0.45 / 0.49 | 325 / 482 | 10 / 13 |
| hebrew | 25 | 0.68 / 0.80 | 0.48 / 0.51 | 0.72 / 0.84 | 0.59 / 0.65 | 396 / 571 | 9 / 11 |
| ALL | 300 | 0.26 / 0.30 | 0.14 / 0.17 | 0.29 / 0.34 | 0.18 / 0.21 | 564 / 1399 | 24 / 73 |
errors atlas/svc (0, 0); lenient top-10 found by Atlas only 3, by service only 14

### arm distinctive
| stratum | n | Atlas Hit@10 strict / lenient | Atlas MRR strict / lenient | service Hit@10 strict / lenient | service MRR strict / lenient | Atlas ms p50 / p90 | service ms p50 / p90 |
|---|---|---|---|---|---|---|---|
| english_translation | 60 | 0.27 / 0.37 | 0.16 / 0.24 | 0.23 / 0.33 | 0.15 / 0.23 | 993 / 2374 | 47 / 97 |
| latin_script | 60 | 0.28 / 0.33 | 0.16 / 0.20 | 0.30 / 0.35 | 0.19 / 0.23 | 661 / 1638 | 19 / 38 |
| greek | 30 | 0.30 / 0.37 | 0.15 / 0.19 | 0.37 / 0.43 | 0.18 / 0.24 | 463 / 676 | 14 / 23 |
| cyrillic | 30 | 0.97 / 0.97 | 0.68 / 0.73 | 1.00 / 1.00 | 0.72 / 0.79 | 265 / 361 | 12 / 56 |
| han | 40 | 0.00 / 0.05 | 0.00 / 0.05 | 0.00 / 0.05 | 0.00 / 0.05 | 349 / 533 | 45 / 58 |
| tibetan | 30 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 430 / 875 | 42 / 129 |
| arabic | 25 | 0.88 / 0.88 | 0.73 / 0.73 | 0.88 / 0.88 | 0.78 / 0.78 | 302 / 384 | 12 / 15 |
| hebrew | 25 | 0.84 / 0.84 | 0.70 / 0.73 | 0.88 / 0.88 | 0.75 / 0.80 | 356 / 557 | 12 / 15 |
| ALL | 300 | 0.38 / 0.42 | 0.27 / 0.31 | 0.39 / 0.43 | 0.29 / 0.33 | 443 / 1117 | 23 / 69 |
errors atlas/svc (0, 0); lenient top-10 found by Atlas only 3, by service only 6

### arm quoted
| stratum | n | Atlas Hit@10 strict / lenient | Atlas MRR strict / lenient | service Hit@10 strict / lenient | service MRR strict / lenient | Atlas ms p50 / p90 | service ms p50 / p90 |
|---|---|---|---|---|---|---|---|
| english_translation | 60 | 0.88 / 1.00 | 0.79 / 0.99 | 0.88 / 1.00 | 0.78 / 0.99 | 389 / 934 | 12 / 25 |
| latin_script | 60 | 1.00 / 1.00 | 0.91 / 0.99 | 1.00 / 1.00 | 0.92 / 0.99 | 163 / 470 | 8 / 12 |
| greek | 30 | 1.00 / 1.00 | 0.82 / 0.98 | 1.00 / 1.00 | 0.83 / 0.98 | 56 / 248 | 8 / 10 |
| cyrillic | 30 | 1.00 / 1.00 | 0.95 / 1.00 | 1.00 / 1.00 | 0.93 / 1.00 | 22 / 59 | 9 / 48 |
| han | 40 | 0.75 / 1.00 | 0.44 / 0.98 | 0.75 / 1.00 | 0.45 / 0.98 | 194 / 457 | 15 / 32 |
| tibetan | 30 | 0.77 / 1.00 | 0.56 / 0.97 | 0.80 / 1.00 | 0.58 / 0.97 | 309 / 518 | 16 / 59 |
| arabic | 25 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 27 / 93 | 8 / 9 |
| hebrew | 25 | 1.00 / 1.00 | 0.93 / 1.00 | 1.00 / 1.00 | 0.93 / 1.00 | 16 / 104 | 8 / 9 |
| ALL | 300 | 0.92 / 1.00 | 0.79 / 0.99 | 0.92 / 1.00 | 0.79 / 0.99 | 108 / 515 | 9 / 29 |
errors atlas/svc (0, 0); lenient top-10 found by Atlas only 0, by service only 0

**Conclusion.**
- **For keyword serve:** the service matches or beats Atlas on every stratum and arm but one (English translation, distinctive arm: 0.33 vs 0.37 lenient, 3 pages).
  - Pages found in the top 10 by Atlas only: 3 per arm. By the service only: 14 / 6 / 0.
- **For the lane, in both engines:** an unquoted phrase is weak, because the page lane matches ANY word (`buildPageSearchStage`).
  - Unquoted Han and Tibetan score 0.00: `lucene.standard` (and the service's tokenizer, which copies it) split them into single characters and syllables, and a page printing any one of them qualifies.
  - The same strings in quotes: lenient MRR 0.98 / 0.97.
  - Phrase-first for unspaced scripts and for 3+ word queries, with any-word as the fallback, is the cheap fix. Follow-up: #6877.
- **Caveats.**
  - "Distinctive" is a word-length proxy, not document frequency.
  - Strict scores understate both lanes where the corpus holds duplicates: quoted Han 0.75 strict vs 1.00 lenient.
  - One sample. The strata are small (25–60), so a ±0.1 difference within a stratum is noise.

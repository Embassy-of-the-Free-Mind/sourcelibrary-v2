---
stage: pipeline
measure: [accuracy]
languages: [en, la, grc, ru, zh, bo, ar, he]
scripts: [Latn, Grek, Cyrl, Hani, Tibt, Arab, Hebr]
canons: []
n_books: 300
n_pages: 300
verdict: "Phrase-first for unquoted Han and Tibetan queries finds the page a reader copied 5 characters or 4 syllables from: on the Atlas page lane, unquoted lenient Hit@10 goes from 0.03 to 1.00 (Han, n 40) and from 0.00 to 1.00 (Tibetan, n 30). The quoted arm and the six spaced-script strata do not change. Cost: unquoted Tibetan p50 goes from 420 to 962 ms (p90 from 656 to 1606 ms), and Han p50 from 342 to 516 ms."
status: informational
issue: [6877, 2049]
---

PRIOR ART: `2026-10-17-keyword-known-item-2049.md`, the run that found the problem. This one re-runs the same 300 pages and phrases (`SAMPLE_FROM`) after the fix. Instrument: `scripts/eval/search-evals-2049/known-item.harness.ts`.

## 2026-10-18 · Phrase-first for unquoted unspaced-script queries (#6877)

**Change.** `buildPageSearchStage` (`src/lib/atlas-search.ts`): an unquoted query containing Han, kana, Tibetan, Thai, Lao, Khmer or Myanmar gets two extra `phrase` clauses (translation and OCR), boosted 100× over the plain clauses (`PHRASE_FIRST_BOOST`). The any-token `text` clauses stay. Pages that print the run as typed come first, and the any-character pages follow as the fallback. All of this is one `$search`, with no second round trip. Fuzzy is off for these scripts, because a run of characters is not one long word. The keyword service (`scripts/workers/keyword-search/server.py`) does the same.

**Method.** Same 300 pages and random phrases as 2026-10-17 (`SAMPLE_FROM`, seed 2049). The distinctive phrases also matched: 300/300 identical. Atlas page lane only. The deployed service still runs the old code, so its arm was not measured here; `test_engine.py` covers the service (below). 0 Atlas errors in 900 calls.

**Result: Atlas page lane, Hit@10 strict / lenient.**

| stratum | n | random, before | random, after | quoted, before | quoted, after |
|---|---|---|---|---|---|
| english_translation | 60 | 0.20 / 0.28 | 0.20 / 0.28 | 0.88 / 1.00 | 0.88 / 1.00 |
| latin_script | 60 | 0.17 / 0.22 | 0.17 / 0.22 | 1.00 / 1.00 | 1.00 / 1.00 |
| greek | 30 | 0.10 / 0.13 | 0.10 / 0.13 | 1.00 / 1.00 | 1.00 / 1.00 |
| cyrillic | 30 | 0.63 / 0.63 | 0.63 / 0.63 | 1.00 / 1.00 | 1.00 / 1.00 |
| **han** | 40 | 0.00 / 0.03 | **0.90 / 1.00** | 0.75 / 1.00 | 0.75 / 1.00 |
| **tibetan** | 30 | 0.00 / 0.00 | **0.77 / 1.00** | 0.77 / 1.00 | 0.77 / 1.00 |
| arabic | 25 | 0.64 / 0.68 | 0.64 / 0.68 | 1.00 / 1.00 | 1.00 / 1.00 |
| hebrew | 25 | 0.68 / 0.80 | 0.68 / 0.80 | 1.00 / 1.00 | 1.00 / 1.00 |

- Lenient MRR, unquoted: Han 0.03 → 0.96, Tibetan 0.00 → 0.97. This matches the quoted arm (0.98 / 0.97).
- Strict is below lenient because the same run is often printed in another scan or edition of the text. Quoted searches show the same gap.
- The distinctive arm moved the same way (Han 0.05 → 1.00, Tibetan 0.00 → 1.00 lenient). One latin_script page fell from rank ≤ 10 (0.28 → 0.27 strict) with no change to its stage. That is ranking drift between runs a day apart, not this fix.

**Latency (Atlas, ms from main, p50 / p90).** Han unquoted 342 / 570 → 516 / 890. Tibetan unquoted 420 / 656 → 962 / 1606. Spaced scripts do not change. The phrase clause has to check the positions of very common syllables (Tibetan པ, Han 之), so a query that used to return useless results now returns the right page at about twice the cost. The route's page lane has an 8 s `maxTimeMS`.

**Service.** `test_engine.py` gets five new checks. On a small index, a page printing 司射遂適階 is ranked against pages dense in those characters but not the run, and the same for བུཾ་པ་དབང་ཙག. Old `server.py`: 3 FAIL (the dense page ranks first; a 6-character Han run goes fuzzy). New: all pass. `tests/unit/keyword-search.test.ts` pins the service's `PHRASE_FIRST_BOOST` to the app's.

**Not done.**
- Phrase-first for 3+ word queries in spaced scripts. The issue asks to measure it first, because it changes ranking for every multi-word search. A distinctive unquoted run reaches 0.32–0.37 lenient there, against 1.00 quoted.
- Installing the new `server.py` on the service box (`bootstrap.sh`), and re-running the service arm.

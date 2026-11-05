# Freeze: counsel test (#8142)

Spec: `scripts/eval/PREREGISTRATION-wisdom-counsel.md`, Amendment 1 governs. Frozen 2026-11-05, before any test-dilemma arm ran. Only the 5 pilots have been through the harness, and their verdicts are discarded. A change to a file below after this commit is a new pre-registration.

PRIOR ART: `scripts/eval/PREREGISTRATION-*.md` set the house format; the hash table is this study's own.

## Interpretations fixed before any data (where the spec leaves a choice)

1. **Score of record:** Opus. Gemini gives reliability only.
2. **"Beats" on a plant dilemma:** the composite is strictly higher; a tie does not count. Computed on the retained facets, and reported on all six as well.
3. **Agreement levels:** per-facet `krippendorffAlpha` at `ordinal`, composite at `interval`, on the 50 plant answers. A facet below `ALPHA_TENTATIVE` (0.667) is dropped.
4. **The instrument passes** only if the four plant tallies are each at least 9 of 10, at least four facets remain, and the composite alpha on the retained facets is at or above 0.667. The spec's original composite-alpha condition is kept alongside Amendment 1's per-facet check, because the amendment does not withdraw it and keeping it is the stricter reading. No Gemini read means agreement is not measured, and the instrument fails.
5. **Plants "unlabelled among the others":** plant packets also hold the 10 pilot A/A2 answers as fillers, whose scores are never used. Arm answers cannot be used as fillers, because the instrument runs before the arms.
6. **Size check:** SD of the paired A − A2 composite on the retained facets; above 1.1 means stop and report. The bar's noise figure is |mean(A − A2)|.
7. **"D beats C" (secondary):** the same three conditions as "C beats B". It stays exploratory.
8. **Means check row:** C flagged on at least 3 more dilemmas than B, by Opus, counted on all 40.
9. **Packets:** 8 answers, at most one per dilemma, seeded. Noise and full-run answers are judged in separate batches, so C vs A carries a batch effect and is labelled so. C vs B and C vs M are within one batch. Judge reads run at concurrency 3 (Opus) and 1 (Gemini); the writer at 1.
10. **Second judge:** `gemini-3.8-flash-medium` on root's account, the only one not held to Flash low. Writers rotate between the `.agy-milo` and `.agy-james` pools. All are subscription CLIs.

## Passages

- **Route:** `/api/search/semantic?level=page&limit=50&diversity=off&exclude_languages=English` for C, and `/api/books/:id/search` (semantic leg, similarity only) for D, with the internal key. `VECTOR_SEARCH_TOKEN` is not on gex45, and these routes are how this box reaches the page-vector search; the app falls back to the RPC on the same vectors if the service misses. Embeddings of the query are the app's own (standing approval).
- **"English translation text":** `pages.translation.data`, books whose language is not English, `page_type` text or null, no `translation_withheld`. Printed-English books are excluded even where a translation field holds text. This takes the arm D frame from 60 books to 47.
- **Length band:** a window of whole sentences, 100–300 words, starting at the search snippet (C, D) or a seeded random point (B), extended backwards if short.
- **One per work:** `work_id`, else author + title start; in D, the inventory row.
- **B frame:** visible, `pages_count > 0`, `pages_translated > 0`, not English; a book by translated pages, then a page uniformly, seeded per dilemma.
- **D frame:** inventory rows marked `teaches` or `both`. The genre classes in `select-passages.mjs` apply the critique's groups to the inventory by work name; they are exploratory.

## Known-outcome set

Round 1 (names removed, setting kept): Flash identified 15 of 15. Rounds 2–4 moved each case to another setting and removed its signature details. A case counts as identified if the true case is among three guesses, with Flash told that it is a disguised real decision (`recognition-log.jsonl`, 44 candidates). V01 and U22 gained a means temptation and were rechecked. **Limit, to be reported:** after transposition the outcome belongs to the original case, and the story is an analogy to it. Keys list what materialised there, reworded for the new setting. The strict test also favours less iconic structures.

## Means-tempting dilemmas

F02, F03, W01, W03, W07, C03, C06, C10, U22, V01 (10; personal 2, work 3, civic 3, known 2).

## Hashes (sha256)

- `bedcea6c81c49114e4a60f56dec872e57d59b37b45f46b75890c6b927a8dd72e` rubric.md
- `958336034a7f2b65e497a5d0e8a6a0c71e6d0b09c326ca571c3cf207c5e4ed9a` dilemmas.json
- `fe1a36e135e5a62de19d67934f0f058e333b12286ea418e869e85832d05975bb` known-candidates.json
- `d4f89cf734f40c75daec71f5fbb0b9d436a56af79dc0c32fa6b8f491cd6665b0` known-selected.json
- `2fa20dc5068549fe3c27da9c74116f1d0647753d9ce41bdd04cc4398b9810d19` recognition-log.jsonl
- `95f65ef290fe36c3f7774495467bc579f1a8059ba21c17a31779e9cd0eb5721d` recognition-round1.jsonl
- `b24598ed9ec75185710431a6993250504cd69601955804a79a363148a1db2b22` plants.json
- `be62fdab0a9cc8b49289a3b04fc2fd4873ca023a498e3e909c07d2b0582bb8e9` inventory.json
- `52d17c21a7d67497cd0c75a2928386664a8d3b1ed0a49198f06dd8e962cf0f83` lib.mjs
- `b1e048e5475f03718365b7c0325666c2fd20e8ed579648a2312397a71d531b8a` recognition-check.mjs
- `f413e6854cf966d716dba4579937d2b9a20ded7762c4233a4977eafc8956a43b` select-passages.mjs
- `41f73e86e10193311c26a5b0d886ab83925b24ecdf84f877b5f5e7db28f2a744` write-arms.mjs
- `ab3092507ee50168528c310994583fd93a584c74165c3f10efb87cbe398f5a9f` judge.mjs
- `c5318058ec7696014d0c3eb6674792257da41e64a34d7a53d726b9c99880f250` analyze.mjs
- `f878267a973b9d7a4f50fe6d25b6b8f70d95bf145ec90c6c288a5ff644de440f` detector.mjs
- `d0d0630acf10f8e1adb7c0315be6bbaa8b73be6c3a7f5ab585a2c1bfb872e0a7` ../PREREGISTRATION-wisdom-counsel.md

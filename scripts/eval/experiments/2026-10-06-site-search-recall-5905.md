## 2026-10-06 · Why does site search return so few books for a name, and does RRF fix concept queries? (#5905)
<!-- PRIOR ART: scripts/eval/librarian-search/ (golden set at page grain for the Librarian's tools, precision/recall/MRR@5) and scripts/eval/search-quality-eval.mjs (pass/fail assertions). Neither scores /api/search for book recall, and no earlier entry measures the page lane's roll-up. -->

- **Question.** "Drebbel" returned 9 results while Atlas finds the name on 732 pages in 232 books. Concept queries in modern words ("self-regulating oven") miss the books that discuss the thing. The issue proposed two causes: page hits do not roll up into books, and `auto-ladder` lets keyword results beat semantic ones (fix: RRF).
- **Answer.** The first cause is real and has two parts; the second is not supported. (1) The page lane read its 25 best pages, which sit in 3 books for "Drebbel". (2) When title matches filled `limit`, every passage was dropped, although the 20 title rows then collapse to fewer works. Fixing both and ordering passages by pages-per-book takes recall@10 from **0.32 to 0.42** and recall@20 from **0.23 to 0.38** (30 queries; names 0.44 → 0.57 and 0.30 → 0.52). **Forcing RRF on the old lanes did nothing** (0.32 → 0.31), and routing no-title-match queries to RRF on the new lanes added +0.00 to +0.01 over two runs each, so that was not shipped. "self-regulating oven" stays at 0.00 under every variant: no lane retrieves the Réaumur volumes for that wording, so no ranking can surface them.
- **measure:** recall against a scripted expected set (not accuracy, not judged). Expected = the 20 live works with the most pages printing the term as a phrase, by Atlas facet. recall@k = expected works in the top k / min(k, expected).

### Design

- 30 fixed queries in `scripts/eval/search-recall/queries.json`: 10 names, 5 spelling variants, 8 concepts in modern words, 7 of the same concepts in period words. Expected sets frozen in `expected.json` before any code changed; "before" posted on #5905 first.
- Before = prod `/api/search` and the same code run locally (they agree: 0.32 / 0.22 and 0.32 / 0.23). Variants were run through the real route handler on prod data (`local/route.harness.ts`). The name-variant query (#5893) merged during the work; the final before/after pair was re-run on top of it, twice each (before 0.32 / 0.23 and 0.31 / 0.22; after 0.42 / 0.38 both times). The variant rows below were measured before that merge.

### Result (local, R@10 / R@20, mean of 30)

| variant | R@10 | R@20 | shipped |
|---|---|---|---|
| before | 0.32 | 0.23 | |
| before, `ranking=rrf` forced (prod) | 0.31 | 0.22 | no |
| pool more pages by score (300) and group by book, lane alone | 0.26–0.41 | 0.21–0.30 | no: score order is a poor proxy for coverage |
| roll-up by facet count (lane alone 0.56 / 0.51) | 0.41 | 0.36 | yes |
| + keep passages when title matches fill the window | 0.41 | 0.37 | yes |
| + evidence rung between passages / between semantic-only books; RRF page list in count order | 0.42, 0.43 | 0.38, 0.38 | yes |
| + route 1–2-word queries with no title match to RRF | +0.00, +0.01 | +0.00, +0.01 | no |
| + one passage per book in the semantic page lane | +0.00 | +0.01 | no |
| alt: passages with 2+ matching pages above semantic-only books | 0.47, 0.47 | 0.43, 0.44 | no: see below |

- **The alternative that scores higher was not shipped.** It moves evidenced passages above books the semantic lane proposed. "Tsongkhapa" goes 0.20 → 1.00. But for "depression" it replaces Bright's *Treatise of Melancholy* and Burton with acupuncture points and desert basins (pages that print "depression"), and the measure barely moves (0.10 → 0.00) because the expected set is built from period terms. Left as a decision.
- **Worse after the change:** none traced to the change. "Paracelsus" read 0.10 / 0.25 in some runs and 0.00 / 0.10 in others, on the old code as well as the new: its top 20 are all title matches from the book lane, which reads an unordered 40-row sample of the matching titles, and that sample changed during the session.
- **Latency (local, 30 queries, final pair).** Page lane median 467–610 ms → 631–776 ms, p90 1.1–1.8 s → 1.3–1.6 s, max 1.7–2.1 s → 2.1–2.4 s. The whole request is bounded by the semantic lanes (median 2.4–2.5 s before and 2.4 s after). The roll-up never hit its 4 s budget in 180 requests.
- **Degraded lanes.** Prod, 60 uncached requests: `semantic_page` 6, `book` 1. Local, 270 requests: `semantic_page` 26, `book` 10. No history exists; `search_queries.degraded_lanes` is added by the PR.
- **Caveat.** The expected set ranks by the same page count the roll-up orders by, so the gain on names is partly by construction. Result lists for Drebbel, Tsongkhapa, Khunrath, Ibn Arabi, Paracelsus, pranayama, reincarnation and depression were read by eye.
- *Replicated?* Each shipped and rejected variant was run twice locally; prod preview numbers are on PR.
- **Artifacts.** `scripts/eval/search-recall/` (queries, expected, runner, local harness, `results/2026-10-06-*.json`).

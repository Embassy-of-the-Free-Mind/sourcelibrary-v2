---
stage: translation
measure: agreement
languages: [la, grc, it, fr]
scripts: [Latn, Grek]
canons: []
n_books: 36
n_pages: 36
verdict: "Recitation of public-domain translations not detected: 4/36 served pages share a 12+ word run, below the 20% two-human-translator baseline; 0/5 recited by eye."
status: informational
decision: "None needed; no routing or prompt change proposed (#5523)"
superseded_by: null
issue: 5523
---
## 2026-10-01 · Translation recitation pilot: does a served English page reproduce a published translation instead of translating the page? (#5523)

**Question.** For a famous work, a translator model may emit a remembered published English translation instead of translating our transcription. That costs fidelity (a different edition or reading) and, for a modern translation, rights. Unmeasured until now (#5495 limitations).

**Label (deviation from the issue's design).** The "Did the AI Read This?" membership posteriors are **not stored per book**: not in the repo (only the blog post and preprint PDF), not in Mongo (no collection or `books` field). So the known/unknown label is the **bibliographic disposition** (`translation_verification.disposition`), not a posterior: **known** = `translation_found` plus a public-domain English e-text on Project Gutenberg (36 works, one library book each, chosen by hand before any page was drawn; bilingual editions with an English facing page excluded); **unknown** = `confirmed_first`, matched one-to-one on `language` and nearest date (35; no match for the one Greek/Latin book).

**Design.** One served interior page per book (skip 15% front, 5% back; seeded 5523, `makeRng`; the served body has ≥ 120 words once `<note>`, `<meta>` and markup are stripped). Instrument (`translation-recitation.mjs`, string overlap only, no model call): the **longest verbatim word run** between the served body and the whole published translation, and the **share of the page's 8-grams** found in it; a locator (idf-weighted content-word window) finds the corresponding passage. `measure: agreement` with a published translation. It is **not** quality. Controls, read first:
- *Positive.* A verbatim 250-word span of each reference: run 250, share8 1.00, located 36/36. The same span with 10% of words substituted: run median 33.5, share8 0.43, located 36/36. The instrument sees recitation, including recitation with drift.
- *Chance floor.* Each known page against a **different** work's translation: run max 6, share8 0. Each unknown page against its matched known work's translation: run max 8, share8 ≤ 0.0007.
- *Human-vs-human baseline (the comparison that matters).* For the 7 works with a second, independent PD translation on Gutenberg, 8 × 300-word spans of translation A against the whole of translation B. This is how much two human translators of one passage share verbatim.

**Result.**

| arm | n | run ≥ 12 words | 95% CI (Wilson) | longest run | 8-gram share, mean [boot 95%] |
|---|---:|---:|---|---:|---|
| known: served vs its published translation | 36 books | **4 (11%)** | 4–25% | 17 | 0.0085 [0.0043, 0.0133] |
| known, located pages only (coverage > wrong-work p95) | 28 | 4 (14%) | 6–31% | 17 | 0.0107 |
| unknown: served vs a matched unrelated translation (chance) | 35 | 0 | 0–10% | 8 | 0.0000 |
| known vs a wrong work (chance) | 36 | 0 | 0–10% | 6 | 0.0000 |
| **human vs human**, same work, two PD translators | 56 spans / 7 works | **11 (20%)** | 11–32% (spans, clustered) | 21 | 0.0174 [0.0108, 0.0250] |

- Served English shares more with the right published translation than chance (Δ share8 +0.0085 [0.0044, 0.0134]), which is what any translation of the same passage does. It shares **less** than two human translators share with each other: 11% vs 20% of units with a ≥ 12-word run, mean 8-gram share 0.0085 vs 0.0174. By work, 4 of 7 human pairs have a ≥ 12-word run; Kempis (Benham vs Challoner) has one in 7 of 8 spans.
- **No preference for the published text.** On the 7 pages where a second translation exists, the served page is as close to translation B as to A (runs 5/5, 9/9, 11/15, 5/4, 4/5, 9/7, 6/6). A page reciting Marriott would be closer to Marriott than to Ricci. It is not.
- **By eye (5 highest-overlap pages, `read-from-text`): 0 of 5 recited.** Machiavelli, Calvin, Herodotus (the 17-word run), 2 Maccabees and Castiglione are all literal, modern-diction translations of the right passage. The shared runs are word-for-word renderings of the source sentence (`results/translation-recitation-5523-2026-10-01/by-eye.md`).
- **Recitation of public-domain translations: not detected.** Upper bound at this n: the 95% interval on ≥ 12-word runs (4–25%) is at or below the human-translator baseline, and none of the 4 is recited.

**What this does not cover.** (1) **Modern copyrighted translations**, the rights half of the question, cannot be measured without fetching them; out of scope by design (TDM route via the research partner, counsel first, per the issue). A model might recite a modern Loeb or Penguin rather than a Victorian one; this pilot cannot see that. (2) The label is disposition, not membership posterior, and disposition is noisy: the control drew a Hebrew Bible, Landino's Dante commentary and Cesariano's Vitruvius as `confirmed_first`. It only affects the chance-floor arm. (3) The locator misses 8 of 36 pages (verse translations Leonard and Evelyn-White, commentary pages); the whole-text run is the primary instrument and does not depend on it. (4) Exploratory per work: one page per book.

*Grade.* Directional (36 books with a reference). `run_id` translation-recitation-5523-2026-10-01. *Decision.* None needed: no routing or prompt change proposed. The rights question stays open on #5523 for the TDM route. *Replicated?* No. A second seed on the same 36 works, and the 4 works whose second translation was not used, would replicate it at $0. *Cost* $0 (CPU, Mongo read-only, 59 Gutenberg texts (46 references, 13 second translations) cached outside the repo and never committed). *Artifacts:* `results/translation-recitation-5523-2026-10-01/` (summary.json, scores.jsonl, controls.jsonl, by-eye.md), `store/scores/translation-recitation@1/2026-10.jsonl`, `translation-recitation.mjs`.

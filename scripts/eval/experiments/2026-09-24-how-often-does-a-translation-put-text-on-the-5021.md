## 2026-09-24 — How often does a translation put text on the wrong page? Intra-block drift (#5021) and continuity leakage (#5026)

**Question.** (a) How often does block translation (8 pages per prompt) finish page N's last
sentence with page N+1's opening words? (b) How often does a page's translation reproduce
the previous page's text, and does the current lane still do it?

**Design.** Walk of the local mirror (`scripts/audit/translation-page-boundaries.mjs`, 64,990
books, 20,996 with ≥2 translated pages, 5.19M consecutive translated pairs, zero Atlas page
reads). Drift = `scripts/lib/block-drift.mjs` (source N+1 opens mid-sentence with a clause, the
translation doesn't, and N's last sentence grew by about the clause's length). Leak = shared run
≥200 chars between consecutive translations after stripping editorial blocks; pairs whose
SOURCES share such a run are excluded. Segmented by `translation.prompt_version`/model/month on
a random 1,500-book sample, with metadata read from Atlas (55 of 374,576 pairs were dropped
because the mirror text no longer matched). Hand-read: one flag per book.

**Result — drift.** 77,775 of 3.83M in-block prose boundaries flagged (2.03%, 9,315 books);
Greek 4.5%, Russian 3.1%, Latin 2.5%, English 2.0%, German 1.6%; caseless scripts ~0 by
construction. **Precision on a fresh sample of 20: 9 real, 8 false, 3 unclear.** The control is
prompt version, not block position: the single-page lane (v2/v5, cannot move text) flags
0.70–0.86%, which is the detector's floor. Block-era v10/v11 flag 2.0–2.4%. So ≈1–1.5% of in-block
boundaries really have a clause on the wrong page. Reconstructed in-block vs block-start boundaries
flag at nearly the same rate (2.03% vs 1.78%), so the block partition cannot be recovered from the
mirror; don't use it as a control. The first cut (steps 1–4, no length test) flagged 4.7% at
6/20 precision — the length test is what makes it usable. Known misses: Saffo 58→59 (N ends in a
long quotation, score 0.45), verse boundaries (capitalised lines), German fragments opening on
a noun.

**Result — leak (#5026).** 43,250 flagged pairs (0.83%). By position of the shared run: 
*forward duplicate* (N+1's opening also at the end of N) 8,092 — 7/7 hand-read real, **0.00% under
v2/v5, 0.2% under v10/v11, 0.45% under v13** (21 books; small) — a block artefact, same family as
drift; *N's head reproduced in N+1* (the #4968 context-slice shape) 4,365, of which runs ≥500 chars
(2,313 pairs, 1,240 books) were 4/4 real and runs under 500 were 0/6 (Loeb facing pages, proof
formulae, sutra openings). **≥500-char context leak: v2 0.11%, v5 0.07%, v10/v11 0.02%, v13 0 of
6,671 pairs.** Atalanta control: 21/21 flagged, 12/21 fall in the n-head class. So the context
leak is mostly a single-page-era defect; the current block lane duplicates forward instead.

**Prompt fix: not supported.** Smoke on the three production drift boundaries (6 flash-lite calls,
≈$0.004): a "keep each page's text on its page" instruction fixed none and turned 30→31 into a
duplicate. Shipped the parser reject only (both shapes → the two pages re-translate single-page).

*Replicated?* No — one walk, two 20-flag hand-reads (the first was the tuning set).
Artifact: `scripts/eval/results/page-boundary-drift-leak-2026-09-24.json`; fixtures
`tests/fixtures/block-drift/`.

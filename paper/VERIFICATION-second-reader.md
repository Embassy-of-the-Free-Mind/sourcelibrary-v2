# Number verification checklist — second-reader-calibration.md (#6338)

PRIOR ART: paper/VERIFICATION.md (the same checklist for reading-or-reciting-chr2027.md).

Every numeric claim and citation in the draft, mapped to its source of truth. Before freeze, each row is checked by
regenerating the named file or reading the named source, never from memory or a chat. Mark ✓ + date + verifier.
A discrepancy is fixed in the DRAFT, never in the data. Result rows are added as each result section is written,
each pointing at a field of `src/data/second-reader-6338.json` (itself checked in CI by `export --check`).

| # | Claim in draft | Source of truth | Status |
|---|---|---|---|
| 1 | Design numbers: 100 pages per script, 1 per book, a third enriched, λ 0.8, 28% planted, five classes, blocks of 50, decision bar +5 per 100, false-alarm margin 3 per 100 | `scripts/eval/PREREGISTRATION-second-reader-6338.md` at the commit cited in §3 | ☐ |
| 2 | Same-model agreement κ 0.85–0.92 on the serious flag | `scripts/eval/experiments/2026-10-07-script-run-reviewers-6174.md` | ☐ |
| 3 | "roughly one page in five" serious on random public books | `scripts/eval/experiments/_series-fortnightly-spot-check.md` (latest rolling window; quote with its n and interval) | ☐ |
| 4 | Four harness defects; allow-list did not confine, restricted mode did | `scripts/eval/experiments/2026-10-08-second-reader-harness-synthetic-check-6338.md` | ☐ |
| 5 | Haaf, Wiegand & Geyken 2013, double keying | the article (jTEI 4) | ☐ |
| 6 | Hossain et al. 2020, negation in MT | find and read; fix title and claim | ☐ |
| 7 | arXiv 2410.21819, self-preference bias | read the abstract; fix title, authors and the claim attributed | ☐ |
| 8 | Krippendorff 2011, α; example values 0.743 / 0.815 / 0.849 | the paper; `tests/unit/second-reader-6338.test.ts` | ☐ |
| 9 | Wolfe, Horowitz & Kenner 2005, prevalence effect | Nature 435 | ☐ |
| 10 | Every number in §4 | `src/data/second-reader-6338.json`, field named in the draft | ☐ |

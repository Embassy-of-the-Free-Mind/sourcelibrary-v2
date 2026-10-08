# Number verification checklist — second-reader-calibration.md (#6338)

PRIOR ART: paper/VERIFICATION.md (the same checklist for reading-or-reciting-chr2027.md).

Every numeric claim and citation in the draft, mapped to its source of truth. Before freeze, each row is checked by
regenerating the named file or reading the named source, never from memory or a chat. Mark ✓ + date + verifier.
A discrepancy is fixed in the DRAFT, never in the data. Result rows are added as each result section is written,
each pointing at a field of `src/data/second-reader-6338.json` (itself checked in CI by `export --check`).

| # | Claim in draft | Source of truth | Status |
|---|---|---|---|
| 1 | Design numbers: 100 pages per script, 1 per book, a third enriched, λ 0.8, 28% planted, five classes, sign test α 0.025 per model, gain bar +3 per 100, false-alarm margin 3 per 100 | `scripts/eval/PREREGISTRATION-second-reader-6338.md` at the commit cited in §3 (amendment 1) | ☐ |
| 1b | Power: first rule 34% at +6.3/100 (60% at +9.4); amended pooled rule 93% at +6.3, 75% at +4.7, < 1% at 0 | `node scripts/eval/second-reader/power.mjs --reps 600` (seeded) | ☐ |
| 2 | Same-model agreement κ 0.85–0.92 on the serious flag | `scripts/eval/experiments/2026-10-07-script-run-reviewers-6174.md` | ☐ |
| 3 | "roughly one page in five" serious on random public books | `scripts/eval/experiments/_series-fortnightly-spot-check.md` (latest rolling window; quote with its n and interval) | ☐ |
| 4 | Four harness defects; allow-list did not confine, restricted mode did | `scripts/eval/experiments/2026-10-08-second-reader-harness-synthetic-check-6338.md` | ☐ |
| 5 | Haaf, Wiegand & Geyken 2013: proofreading bore out double keying's advertised accuracy | Abstract (via DOAJ/BBAW listings), 2026-10-08. Full text NOT read: journals.openedition.org and edoc.bbaw.de unreachable from the cloud session. The earlier claim "double keying fails where both keyers err alike" (from #6203) could not be found in the paper and was removed; the blind-spot point is now stated as our own reasoning. Read the full text before freeze. | ◐ abstract only |
| 6 | Hossain, Anastasopoulos, Blanco & Palmer 2020: negation, quality loss > 60% in some directions | Abstract and ACL Anthology record, 2026-10-08 (title and author list corrected from the draft) | ✓ abstract, 2026-10-08, Claude |
| 7 | Wataoka, Takahashi & Ri 2024 (arXiv 2410.21819): LLM judges rate low-perplexity (familiar) text higher; self-preference | Abstract via search listing, 2026-10-08; arxiv.org unreachable for the full text | ◐ abstract only |
| 8 | Krippendorff 2011, α; example values 0.743 / 0.815 / 0.849 | Values reproduced exactly by `tests/unit/second-reader-6338.test.ts`; the paper itself not re-read | ◐ |
| 9 | Wolfe, Horowitz & Kenner 2005: rare targets are missed more often (Nature 435:439–440) | Abstract/PMC listing, 2026-10-08. The draft's earlier "over-report common ones" went beyond this paper and was rephrased as an analogy | ✓ abstract, 2026-10-08, Claude |
| 9b | Vander Wiel & Votta 1993, capture–recapture for inspections (IEEE TSE 19(11):1045–1054) | Bibliographic record via search, 2026-10-08; content not read | ◐ |
| 10 | Every number in §4 | `src/data/second-reader-6338.json`, field named in the draft | ☐ |

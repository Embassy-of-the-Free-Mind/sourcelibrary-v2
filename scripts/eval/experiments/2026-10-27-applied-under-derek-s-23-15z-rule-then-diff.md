## 2026-10-27 · Applied under Derek's 23:15Z rule, then diff-QA

**The rule.** Write a page when it passes the automatic guards and does not lower Derge identity by more than 0.01 (where
the draft has a parallel, identity ≥ 0.85). An audited page that introduced a severe error keeps Yigdzin. The re-score
(`pass/rescore.mjs`): SEVERE = line-level, negation or mantra; a page passes with net ≥ 0 and no severe error introduced.
This gate passed 35/38 pages.

**Reads.** 8,278 pages, by agy Flash-low on main ($0). Reads came back through R2.

**Derge placement.** 15 sample pages per volume against all of P000001, then the whole volume against those Derge volumes
± 1. Derge v103's Pagination layer has a single entry, which makes one enormous window, so it is left out.

**Written: 7,287 pages** in 19 volumes, through `writePageText` (runs: `results/.../pass-gate-wave2-6740/runs.json`; per
volume: `written-by-volume.md`).

| | pages |
|---|---|
| refused: line count changed | 349 |
| refused: 25% cap | 94 |
| refused: ya-btags, no leaf check | 46 |
| refused: adds Latin letters | 5 |

The **line-count guard** was added after the wave-A by-eye check. On Thadrak brGyad stong p.233, Flash merged two lines of
the upper leaf (the draft had 7, Flash wrote 6). A dropped line and a removed invented line cannot be told apart without
the image, so the draft stays. Moving or adding the leaf-break marker does not count as a line change.

**Restores (run `revert-lines-6740`):** brGyad p.233 and p.289, gZungs 'dus p.260 (a dropped negation, from the rolling
audit) and Neyphug p.303. Neyphug p.131 was restored and then put back on the Flash text (run `unrevert-lines-6740`): the
scribe repeats that sentence, as checked by eye by tib-opus-translate-6948.

**Rolling audit:** 10 seeded written pages, judge B. 9/10 pass; 90 errors fixed, 8 introduced, 1 severe introduced
(restored). Controls 19/20.

### Diff-QA (Derek 2026-10-27 05:10Z)
`pass/diffqa.mjs` diffs each written page against its Yigdzin draft and classifies every changed span.
- **LOW** (auto-accepted): tsheg/merge only, a particle swapped within its class, or a one-letter fix to a Derge dictionary word.
- **RISKY**: everything else; negation, number, mantra, added/dropped and > 8 syllables always are.
- **Calibration** on 680 spans already judged: LOW is right on 94% of decided spans, RISKY on 86%. The four known severe
  introductions of the router-30 reads all classify RISKY.
- **RISKY spans** go to the leaf: `leafcheck audit-req --pages --spans`, judge B, 2 controls a page. A span the leaf does not
  show as corrected is put back to the draft (`diffqa.mjs merge`, `write`; runs `diffqa-6740-*`).
- **Pilot, 40 pages:** 155/210 risky spans confirmed (74%), 38 show the draft. 55 spans were put back on 24 pages.
- **Tranche 1** covers the 3,757 + 634 written pages that carry a severe-type risky span; results follow in #6740.

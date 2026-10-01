## 2026-09-21 — Which engine should read Greek print, per period? (#4925 step 2, #4744)

**Headline: for 1700–1799 (53 referenced books, decision-grade) production flash-lite is
inadequate by the preregistered threshold (median CER 0.107, CI 0.080–0.140, threshold 0.10)
and flash-preview is the preferred reader (median CER 0.085, Δ −0.018 [−0.024, −0.010], 46
wins / 6 losses, 0 vs 1 catastrophic). Kraken greek-cllg reads the letters as well as preview
(0.082) but is closed for the period: it clears Δ ≤ −0.05 on 15 % of pages, not the 60 % the
better-reader rule needs. For 1450–1699 the cell holds 48 referenced books, two short of 50,
so it is DIRECTIONAL: lite 0.170, preview 0.088 (48 wins / 0 losses), Kraken 0.091 (46/1/1).**
(CI recomputed 2026-09-30, #5373 — lite's interval was 0.077–0.122 and the preview Δ [−0.024, −0.009]. Rule (a)
reads the median against 0.10 and rule (b) the sign of CI-upper, so every verdict stands.)

- **Design.** `PREREGISTRATION-greek-ext-4925.md`. One Greek-majority interior leaf per book,
  typeset print only, by-eye `greek_share ≥ 0.5`; references from First1KGreek / Perseus /
  el.wikisource; Greek letters only are scored. Arms: flash-lite, its repeat, flash-preview
  (all `temperature: 0`, `thinkingBudget: 0`), Kraken greek-cllg on Hetzner CPU. Spend: $1.36
  Gemini (approved ≈ $2).
- **Spot check by hand (2026-09-21) — read before quoting any number here.**
  1. The ranking holds on the image: on the 1531 Aristotle page Kraken reads *ἐστὶ θεῶν πλέα τε*
     correctly, preview writes a fluent wrong *διὰ θεῶν τελέα τε*, lite garbles the line.
  2. **The noise floor cannot fail in this design.** At temperature 0 the repeat read is
     byte-identical on 91 of 101 cell pages; Δ₀ = 0 measures API nondeterminism, not reading
     variance. Rule (d) is reported as untested, not as passed.
  3. **The preregistered invention metric was degenerate for lite**: "in neither the reference
     nor any other engine" lets the identical repeat vouch for lite, so lite scores 0 on nearly
     every page and no arm could ever pass "invention ≤ lite's". DEVIATION, recorded: the
     scorer now also writes `invention_indep` (a repeat arm never vouches for its twin) and the
     decision file reports all three definitions. Preview passes under `invention_indep` and
     `invention_ref`, fails only under the degenerate literal one. Kraken's verdict does not
     depend on invention in either period.
  4. Kraken's "invention" is word segmentation (run-together words, line-break fragments), not
     hallucinated text. Describe it that way.
  5. A reference is a modern critical edition; where the early edition prints a different text
     (the 1538 New Testament against Westcott–Hort) every arm carries the same ≈ 0.16 floor.
     This compresses differences; it does not favour an arm.
  6. **Selection caveat.** A page gets a reference only if the preview read locates a window
     (overlap ≥ 0.35). Pages preview reads worst are therefore under-represented, which can only
     flatter preview. Six pre-1700 in-cell pages were dropped this way.
- **Reference-builder bug fixed.** A tie between two EDITIONS of the same work voided the
  identification (Eusebius 1544, 32/40 phrase hits, discarded). A tie now voids only against a
  different work: +1 reference pre-1700, +1 in 1700–1799, none lost.
- **Not settled.** Pre-1700 needs two more referenced books, by drawing further down the sealed
  walk (412 of 3,525 books walked) — never by lowering the overlap threshold. Rule (d) needs a
  repeat arm at temperature > 0 to mean anything.
- **SUPPLEMENT, same day (greek-ext2, seed 47442, Derek approved 10 pages).** Rule (e) says a
  shortfall is a draw-more item. Ten more pre-1700 books were sealed as a separate file (every book
  in greek.json / greek-ext.json excluded; 66 books walked). By eye, before any engine output was
  read: 9 typeset Greek leaves, 1 codex (excluded). 8 of the 9 found a reference. **Pre-1700 is now
  decision-grade at 56: lite 0.171 [0.158, 0.188] = inadequate; flash-preview 0.090, Δ −0.068
  [−0.093, −0.056] (CI recomputed 2026-09-30, #5373 — was [0.159, 0.188] and [−0.093, −0.057]), 55W/1L = preferred; Kraken 0.088, Δ −0.054, 52W/3L/1T, and it passes the
  better-reader rule at 60.7 % of pages (34 of 56) against a 60 % bar — ONE page. An independent
  recompute puts that share at 57 %. Treat Kraken ≈ preview on letters, not "Kraken wins".** Spend
  $0.11. Optional-stopping note: the supplement was drawn after seeing results, but its size was
  fixed beforehand, the remedy is the preregistered one, and no verdict turned on it except that
  knife-edge. The numbers above in this entry's headline are the pre-supplement state.
- **THE ABSOLUTE NUMBERS CARRY A FLOOR THAT IS NOT READER ERROR (second spot check).** The scorer
  replicates: independent code matched 18 of 18 values within 0.01. But a word diff of preview on
  median 1700s pages shows the charged "errors" are mostly convention — sentence capitals, grave vs
  acute, δ' vs δὲ, γίγνεται vs γίνεται — plus footnote apparatus the modern edition lacks (one
  "error", Κράτης for Σωκράτης, is probably the early edition's true reading).
  `benchmark-convention-floor.py` removes those layers (median CER, strict → tolerant):
  pre-1700 lite 0.174 → 0.127, preview 0.093 → 0.052, Kraken 0.094 → 0.049; 1700–1799 lite
  0.112 → 0.051, preview 0.088 → 0.033, Kraken 0.090 → 0.040. **So rule (a)'s thresholds, borrowed
  from the 19th-c cell, do not transfer: "lite inadequate for 1700–1799" is WITHDRAWN (tolerant
  0.051 sits on the adequate line; preview's edge is ≈ 1 character in 100 at 3× the price).
  Pre-1700 "inadequate" stands under both measures.** Paired rules survive because every arm pays
  the same floor. Next benchmark over early print: score convention-folded, and set adequacy
  thresholds from the cell's own best-of-arms floor, not from another period.
- **Files.** `results/benchmark/greek{,-ext,-ext2}-2026-09-21.json`, `benchmark/greek-ext2.json`,
  `results/benchmark/decisions/greek-period-*-2026-09-21.json` (the `prereg` block is the
  verdict; the generic `verdict` string is the step-1 cost-lane rule and does not apply to a
  3×-cost arm). Raw reads: `~/sl-benchmark-reads/greek-4925-2026-09-20/` on Derek's laptop.

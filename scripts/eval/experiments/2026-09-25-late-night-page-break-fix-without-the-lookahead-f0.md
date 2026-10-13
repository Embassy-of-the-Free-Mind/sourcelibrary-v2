---
stage: translation
measure: judged
languages: [la, de]
scripts: [Latn]
canons: []
n_books: 9
n_pages: 63
verdict: "Page-break fix without lookahead (F0) cuts device breaks carrying a defect from 71% to 42% (15-5, p=0.04) with no duplication penalty; any lookahead adds duplication"
status: adopted
decision: "PAGE_BREAK_SCOPED (F0) is on in translate-worker since 2026-09-25 (#5103, code PR #5111)"
superseded_by: null
issue: 5103
---
## 2026-09-25 (late night) — Page-break fix without the lookahead (F0) and with a clause-length one (FC), same 63 seams, same judge — F0 halves the defect rate on device breaks with no duplication penalty; any lookahead is where the duplication comes from

Follow-up to the entry above, $0.37 more ($0.94 total of the $3 cap). Two new arms, B and B2 reused
unchanged, a fresh A/A row in the same packet so each judge carries its own floor: **F0** = edits + rule
line, no lookahead; **FC** = edits + rule + lookahead cut at the first clause boundary
(`LOOKAHEAD_CLAUSE`, ≤160 chars; the virgule counts). 187 blinded junctions, 8 Opus judges.

| pair | fidelity (a / b / tie) | breaks with ≥1 defect | p (split) |
|---|---|---|---|
| A/A, B vs B2 (61) | 15 / 23 / 23 | B 70%, B2 69% | 0.26 |
| F0 vs B, all 63 | 30 / 17 / 16 | F0 67%, B 71% | 0.079 |
| **F0 vs B, device breaks (24)** | **15 / 5 / 4** | **F0 42%, B 71%** | 0.041 |
| F0 vs B, plain breaks (39) | 15 / 12 / 12 | F0 82%, B 72% | 0.70 |
| FC vs B, all 63 | 27 / 21 / 15 | FC 63%, B 65% | 0.47 |
| FC vs B, device breaks (24) | 13 / 8 / 3 | FC 42%, B 67% | 0.38 |
| FC vs B, plain breaks (39) | 14 / 13 / 12 | FC 77%, B 64% | 1 |

Defects at the break, F0 vs B: omission 20 vs 20, addition 5 vs 9, mistranslation 25 vs 20, untranslated
3 vs 6, **duplication 3 vs 3**. FC vs B: 18 / 23, 4 / 8, 20 / 17, 0 / 4, **duplication 10 vs 5**. On the
device subset F0 is lower in every type (3/2/4/1/1 vs 6/4/6/5/2).

**Instrument check:** this round's A/A row split 15–23 — identical arms can draw 61% of decided by chance
here, so the whole-set preferences (F0 64%, FC 56% of decided) are NOT separable from the floor; read the
per-arm defect rates, which are not paired preferences. 14 random defect claims on the new pairs hand-read
against the source: 13 real (5 minor), 1 unverifiable from the excerpt. Five verdicts across the packet
(j014, j020, j125, j140, j141) were decided by one side's page N being shorter at its HEAD (no leading
ellipsis) — a real length difference but off the junction; three favoured a fix arm, one B, one B/B2.

**Mechanical:** F0 carried no fragment into the English on the 12 edited seams and shows B's duplication
profile (1 shared run ≥40 chars, 1 two-word repeat, vs B 1 / 0); FC 4 / 3, F 3 / 6. Whole-page collapse
into `<meta>continues from previous page:</meta>`: F0 0, FC 0 of 63 (B 4, B2 3).

**Read:** the deterministic edits plus the rule line are the fix. F0 is no worse than production on any
row and roughly halves the share of device breaks carrying a defect (71% → 42%), with duplication back at
production's level; the sentence-length lookahead (F, 12) and the clause-length one (FC, 10) are where the
extra duplications came from — flash-lite renders "context only" text. **F0 is the flip candidate**; the
flip itself is Derek's call and stays OFF in PR #5111. Still single-page prompts (see the caveat above).

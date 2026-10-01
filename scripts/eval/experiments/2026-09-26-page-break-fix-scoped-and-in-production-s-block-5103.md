## 2026-09-26 — Page-break fix, SCOPED and in production's BLOCK shape (#5103, Derek's go): device breaks 11–3–10 with defects 7/24 vs 12/24, plain breaks unchanged, floor dead even

The flip candidate made concrete and measured the way production runs it. **Scope:** `PAGE_BREAK_SCOPED`
(edits + rule line, no lookahead) applies only to a page that ends on, or begins after, a split word or
a catchword; every other page's prompt is byte-identical to production (unit test + negative control in
tests/unit/translate-page-break.test.ts). **Block shape:** the worker's 8-page block prompt moved into
translate-core (`buildBlockTranslationPrompt`; the worker now calls it — the one change to the live
string is that `{target_language}` is filled, as the single-page path always did), and the harness
(`--blocks`) sends one production-shaped block per seam (N-3..N+4, shrunk by the worker's own rules; 52
of 62 are full 8-page blocks, one seam had no such block), seeded with the stored translation of the
page before it. Arms **B** (current block prompt), **B2** (A/A floor), **Fs** (scoped fix, in the block).
$1.21 on Hetzner; $2.15 total across the three rounds of the $3 approval. Same 8-Opus source-grounded
judge, 124 blinded junctions, retries as production gives them.

| pair | fidelity (a / b / tie) | breaks with ≥1 defect | p (split) |
|---|---|---|---|
| A/A, B vs B2 (62) | 18 / 19 / 25 | B 52%, B2 50% | 1.0 |
| Fs vs B, all 62 | 21 / 11 / 30 | Fs 47%, B 53% | 0.11 |
| **Fs vs B, device breaks (24)** | **11 / 3 / 10** | **Fs 29%, B 50%** | 0.057 |
| Fs vs B, plain breaks (38) | 10 / 8 / 20 | Fs 58%, B 55% | 0.82 |

Defects at the break, Fs vs B: omission 6 vs 10, addition 5 vs 2, mistranslation 22 vs 26, untranslated
4 vs 0, **duplication 3 vs 6** (device subset 1 vs 6). Floor B/B2: 10/3/23/0/4 vs 10/1/26/4/5.

**Instrument check:** the A/A row is 18–19 with a 40% tie rate — dead even. 14 random defect claims on
the Fs/B pairs hand-read against the source: 9 real (3 minor), 1 not a defect ("melius" as "best"),
4 about text outside the 550-char excerpt window and not verifiable from it. **Mechanical:** the block
prompt already carries fewer fragments than the single-page one (B 0, B2 2 of 12 checked seams vs 5–6
before); Fs 0. The scoped fix fired in 31 of 62 blocks (167 pages across the blocks, every in-block break
is resolved page against page). Whole-page collapse: B 1, B2 1, Fs 0.

**Read:** in production's own shape the baseline is better than single-page (52% of breaks defective,
not 71–78%), and the scoped fix does what it was built for and nothing else: device breaks 11–3–10 with
the defect share cut from 50% to 29% and duplication 6 → 1, plain breaks 10–8–20 against a dead-even
floor. The untranslated count rose 0 → 4 on Fs (a joined word left as a `<term>` on three pages, e.g.
"Cretice") — the one cost seen. In-block drift (#5021: next-page text pulled before the break) appears
on every arm (B 3, B2 3, Fs 1 junctions named by the judges) and is not what this fix addresses.
**Ready to flip on Derek's word**: `PAGE_BREAK_SCOPED` with `prevOcrText`/`nextOcrText` in both worker
paths; the option stays OFF in this PR.

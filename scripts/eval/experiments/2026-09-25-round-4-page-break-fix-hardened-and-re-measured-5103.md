## 2026-09-25 (round 4) — Page-break fix hardened and re-measured on the 24 device breaks (#5103, "I want quality"): Fs2 vs B 10–5–9, defective 38% vs 58%, duplication 2 vs 6; one seam shape fails on the fix arm in both rounds

**What round 3 called the cost was not in the rows.** Round 3 (2026-09-26 entry) counted untranslated 0 → 4 on
the fix arm and read it as "the joined word kept inside `<term>`". Checked against the 188 block rows: no arm
(B, B2, Fs) wrapped any of the 38 joined words in `<term>`. The four Fs UNTRANSLATED verdicts were Cankel /
Morgenroethe (j100, a catchword seam, not a joined word), a Latin book title kept in Latin (conventional) and a
dropped initial on a plain seam; B2 had 4 untranslated too. What the rows do carry is **four garbage joins**, each
a point or a dash the OCR read as a hyphen before a NEW unit of text: "Respon-" | "101. O Herr" → *Respono*,
"Respon-" | "199. Christus" → *Responchristus* (flash-lite rendered it verbatim), "Scrip-" | "(m) Scripsit" →
*Scripm*, "præter-" | "(This page is blank.)" → *præterthis*.

**Hardening** (`scripts/lib/page-break-devices.mjs` `continuationPlausible`, `translate-core.mjs`): the next page's
first token must have ≥ 2 letters, stand after nothing but punctuation or a bare page number ("36 ” ne" passes,
"101. O" and "(m)" do not), and not be capitalised unless the fragment overlaps it or the catchword tag names it
("Fi-" | "Dei," still joins on the tag «dei,»). A refused join leaves both pages as production sends them. A
block resolves a break only between CONSECUTIVE page numbers (the worker's block is drawn from the pages still
to translate, so neighbours in the array can be pages 16 and 18). The foot note now says the joined word is
"ordinary text of this page … do not leave it in the original". 8 new tests, each with a negative control
(`guard: false` reproduces the four garbage joins). Arm **Fs2** = `PAGE_BREAK_SCOPED` after the hardening, run
on the 24 device blocks only ($0.143 on Hetzner; **$2.29 of the $3 approval** across four rounds), against the
round-3 B / B2 rows; 48 blinded junctions (24 Fs2/B + the 24 B/B2 re-judged as the same-instrument control),
8 Opus judges, source in every packet.

| pair (24 device breaks) | fidelity (a / b / tie) | breaks with ≥1 defect | duplication | untranslated |
|---|---|---|---|---|
| A/A, B vs B2 (re-judged) | 4 / 7 / 13 | B 13, B2 11 | 6 / 4 | 0 / 1 |
| **Fs2 vs B** | **10 / 5 / 9** (p 0.30) | **Fs2 9 (38%), B 14 (58%)** | **2 / 6** | 2 / 0 |
| round 3, Fs vs B (same seams) | 11 / 3 / 10 | Fs 7 (29%), B 12 (50%) | 1 / 6 | 3 / 0 |

Defects Fs2 / B: omission 3 / 4, addition 1 / 1, mistranslation 7 / 5, untranslated 2 / 0, duplication 2 / 6.
**Mechanical:** joined word left in the original Fs2 0 (Fs 1, B2 1); `<term>` tags Fs2 78 (B 138, B2 77,
Fs 87) — no term inflation on any arm; catchword fragments carried onto the seam page 0 on every arm; whole-page
collapse B 1, B2 1, Fs2 0. The gate fired: 24 of 24 blocks applied the fix on 138 pages.

**Hand read, 14 claims (7 per side) against the source:** 12 real (4 minor: *depontanus* dropped, *Natur-Sprache*
kept as a term, *mit Fleiß* as "diligently", *constantia* dropped), 2 about text outside the excerpt window,
0 not-a-defect. The six B duplications are the device failure the fix targets, verbatim: "to whom … / to whom",
"78. There / 78. Therefore", "Whether / Whether", "obtain nothing… / obtain nothing", and B dropped a whole
crossing sentence on j037 (*toritate Magistratus … temere iudicare*) that Fs2 rendered in full.

**The two Fs2 majors, both block-drift shapes (#5021), read to the row:**
- **j012 block (pp. 6–13): shifted by one page.** Fs2 dropped page 13 and its `<translation page="8">` holds
  page 9's text, and so on down the block. B2 dropped page 13 on the same block in round 3 without shifting;
  blocks that lose a page happen on every arm (B 4, B2 3 of 62; Fs 1, Fs2 1). A shifted block passes the
  worker's parse (7/8) and would write seven pages' text one page off — the worker has no alignment check.
- **j109 seam ("nostri Capi-" | "Capituli Patronis…"), the electors' oath: the fix arm fails it in BOTH rounds**
  — Fs (round 3) rendered the oath before and after the break; Fs2 pulled the whole oath onto page 67 and then
  echoed page 68's Latin as its "translation" (the realtime health gate checks collapse and runaway only, not a
  source echo, so production would have written it). B splits it "Chap- / Chapter" both times. Shape: a
  syllable catchword closing an UNFINISHED sentence; with the fragment removed the page ends on a clean word
  and lite completes the sentence from the next page despite the rule line. 1 seam of 24, systematic.

**Read:** the fix does what it was built for in both measurements — device breaks 11–3–10 then 10–5–9 against a
dead-even floor, duplication 6 → 1–2, the defect share down by a fifth to a third — and the round-3 "cost" was a
misreading; the real costs are one garbage-join class (now refused) and one seam shape (a syllable catchword on
an open sentence) that the fix makes worse and production handles by mirroring the fragment. **Flip candidate
stands**: `PAGE_BREAK_SCOPED` with adjacent-page OCR in both worker paths, in a separate review-gated PR; the
j109 shape and the block-shift hazard are filed for the next iteration, not blockers for this one.

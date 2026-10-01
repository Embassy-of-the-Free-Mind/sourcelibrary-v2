## 2026-09-25 — RETRACTION of the arm label on both #4681 seam draws: the judges read the plain DRAFT, never the repair

**Found by hand.** Spot-checking 11 of the 62 decisive S1/P junctions against the source OCR (4 production wins,
4 lane wins, 3 ties by the judges): 8 agreed on reading, 1 judge reason was factually wrong but the verdict
held (j028: neither side dropped the Titus/Timothy sentence; the lane's "Titum" stayed untranslated), 1 was
a tie the judge scored for production (j107: both sides repeat "Confession"), and **j009 was backwards** —
the judged lane text opened at paragraph 164, silently dropping the ~40-word first sentence of p.65
("O no! we poor cannot pay for it…"), and the judge rewarded the smoother, shorter side. A junction-only
judge cannot see an omission; only a read against the source can.

**Then the mechanism.** The lane's REPAIR for j009 is complete ("out there / O no! We poor people…").
It was never judged: `chooseSeamText` writes `seam_outcomes[].source: 'repair'`; the harness's `laneTexts`
matched the literal `'repaired'`, which no outcome carries (220 outcomes across 32 shadow runs: 169
`repair`, 51 `draft`, 0 `repaired`). So in BOTH draws (#5020 first shadow, #5053 decisive) every "S1
repaired" seam page was the draft, and the first shadow's "plain batch" control row was the same arm
twice. The tie (production 19 / lane 14 / 29 ties) is therefore **plain batch vs production**; the
batch + seam-repair design has not been judged at all. Fix: the harness imports `SEAM_SOURCE_REPAIR` from
the writer and throws when a run with repairs substitutes nothing (a matcher pinned to a literal passes
vacuously — `lesson_a_check_can_stop_checking_and_still_report_green`). Re-scoring the existing verdict
files is unchanged by design (same verdicts, corrected label); a decisive draw of the repaired arm needs a
NEW packet and a new judging round (Derek's call — it spends).

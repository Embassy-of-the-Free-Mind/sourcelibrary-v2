# Preregistration addendum: Clef and Jev as non-Gemini token readers (#6184)

PRIOR ART: `PREREGISTRATION-reader-diversity-6184.md` (PR #6207) — the sealed 63 slots and Gemini arms this extends.
Committed before any Clef/Jev call as an addendum to that file (commits `f24fd5ede` and the count fix `c58690ce0`, kept on branch `job-clef-jev-arms-6184-prereg-trail`). It is moved here verbatim, so this PR does not touch #6207's file.

## Addendum (2026-10-07, before any Clef/Jev call): non-Gemini arms, Clef and Jev

- **Items.** The same 63 sealed slots. Disputed slots ask "Flash token vs lite token". Controls have no second
  reading, so the foil is fixed by rule: drop the first ā-mark in the print token (or insert one after the
  first character if it has none). For c51 and c56, where both stored reads are wrong, the foil is the stored
  Flash token. Every item is asked in both orders (A/B and B/A). An item counts as right only if the two orders
  agree on the print reading. Disagreeing orders are a position-bias flip: they count as wrong, and the flips
  are reported separately.
- **Arms.** Clef and clef-flash on the line-band crop (the by-eye crop, about 4 lines at 2×), and Clef on
  the whole page. Jev is text only: the stored Flash read gives about 300 characters of context, shown once
  with each candidate. The primary measure is accuracy vs print on the disputed 36, with exact (Clopper-Pearson)
  CIs. Secondary measures are phi with each Gemini arm (F0, stored Flash, stored lite, P0, Pro-3 majority) on
  all 63 slots, accuracy where the Gemini arms split, the flip rate, and cost.
- **Qualifies as the #6203 tie-break reader** iff it gets ≥ 80% on the disputed 36 (Pro-3 = 83%), its flip rate
  is ≤ 10%, and its errors are not concentrated where Pro is wrong (phi with P0 ≤ 0.2). Jev cannot see the
  print, so it can at most qualify as a coherence prior, never as a reader. Cap $1.

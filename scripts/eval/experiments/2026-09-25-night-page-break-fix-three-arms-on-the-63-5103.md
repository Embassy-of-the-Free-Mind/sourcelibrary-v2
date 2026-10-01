## 2026-09-25 (night) — Page-break fix (#5103), three arms on the 63 seams, source-grounded fidelity judge — fix preferred 32–15 overall, TIE on the device subset it targets; the lookahead trades omissions for duplications

The fix, behind `buildTranslationPrompt({ pageBreak: PAGE_BREAK_FIX })` (default OFF, production untouched):
`scripts/lib/page-break-devices.mjs` joins a split word onto the page where it begins and removes the
fragment from the next page, removes a trailing catchword from the page's text and names it, sends the
SOURCE of the next page's first sentence as context, and adds one prompt line. Resolved on the 63 seams
by string edits alone: 24 carry a device (12 catchword, 4 split, 2 split+catchword, 1 merged catchword,
5 tag-only). Harness `scripts/eval/translation-page-break-fix-ab.mjs`: arms **B** (current v13 prompt,
single-page realtime, chained), **B2** (B again, the A/A floor), **F** (B + fix); both pages of every seam,
production model (lite), nothing written to `pages`; $0.57 on Hetzner (cap $3). Same judge as the entry
above (8 Opus, source beside both sides, defect list before the verdict), 124 blinded junctions.

| pair | fidelity (a / b / tie) | fluency (a / b / tie) | breaks with ≥1 defect | p (split) |
|---|---|---|---|---|
| A/A, B vs B2 (61) | 20 / 17 / 24 | 15 / 9 / 37 | B 77%, B2 79% | 0.74 |
| F vs B, all 63 | **32** / 15 / 16 | 26 / 17 / 20 | F 68%, B 78% | 0.019 |
| F vs B, device breaks (24) | 10 / 7 / 7 | 11 / 8 / 5 | F 71%, B 79% | 0.63 |
| F vs B, plain breaks (39) | **22** / 8 / 9 | 15 / 9 / 15 | F 67%, B 77% | 0.016 |

Defects at the break, F vs B (63 junctions): omission **11 vs 24**, addition 9 vs 7, mistranslation 29 vs 31,
untranslated 6 vs 9, duplication **12 vs 5** (B2: 20 / 7 / 32 / 9 / 7).

**Instrument check:** the A/A row is 20–17 with a 39% tie rate — no invented preference. 14 random defect
claims read against the source (seed 5103): 13 real (3 minor: "our pastors" for "us pastors", "pupil" for
"orphan", a dropped "ii. reg. i"), 1 not a defect (a garbled OCR "Ab ho dixi" rendered literally) — ~93%.

**Mechanical check (arm-independent, free):** on the 12 seams whose device the resolver edits, F carried
no fragment into the English; B and B2 carried "178. Dare", "ente", "Anony-", "Ca-", "Re", "rum" on 5–6
each. Whole-page collapse into `<meta>continues from previous page: …</meta>` (an empty page to the reader,
what the worker's health gate refuses): B 4 of 63, B2 3 (+2 on the retry), F 1 — three of B's four on
device seams. Every arm got production's one retry (`--rerun-degenerate`).

**Read:** F is preferred on fidelity, 32–15 (68% of decided; A/A floor 54%), and the gain is fewer
OMISSIONS — B drops the head of the next page (the whole first paragraph, or the clause that crosses)
at 24 junctions, F at 11. But on the 24 device breaks the fix was built for, 10–7–7 is not separated
from the floor: the deterministic edits do remove the carried fragment every time, and the LOOKAHEAD
then undoes some of it — flash-lite translates the "context only" opening on page N and page N+1 either
repeats it (j057 seam: the next page's first three sentences rendered twice) or skips it (j090: N ends
"constancy of the Bishops...", N+1 opens at the paragraph after). Duplication 5 → 12 is that. Not a flip:
the next arm is F WITHOUT the lookahead (edits + rule only, ~$0.20), and a lookahead cut to the crossing
clause rather than the sentence. Caveat on B: all arms are single-page prompts chained through the
fresh previous page; production sends 8-page blocks, so B is production's prompt, not its block shape.

## 2026-09-30 — Where does translation invention live, and can a reader see it? (#5305, tq9)

**Headline: on served pages the major inventions are in the BODY (14 of 15: the next page pulled back across
the break, or prose over garbled OCR); under the current prompt door the continuity `<meta>` is the largest
single location (21 of 57). And the meta hides page text: 0.84% of translated pages in a 3,000-book mirror
sample (240 of 930 translated books) carry ≥ 8 words after "continues from previous page:" that are not the
previous page — hand-read, 18 of 25 are the page's own opening lines, which no reader sees.**
Design: every judged invention in the #5274 audit (48) and the #5349 restraint A/B (57) located in its text;
render path traced in code; new `metaPayload()` check run over a seeded mirror sample; 25 flags hand-read
against OCR (not images). Notes render as "Editorial note" with no AI label. Recommendation: bare continuity
marker in v16 (Derek's call), a write guard for the whole-page case, detector shipped. *Replicated?* No.
Artifact: `results/translation-invention-location-2026-09-30/README.md`.

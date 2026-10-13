---
stage: ocr
measure: accuracy
languages: [egy]
scripts: [Egyp]
canons: []
n_books: 5
n_pages: 38
verdict: "gemini-3-flash-preview cannot read printed hieroglyphs: median anchored sign error 0.78 over 38 pairs (noise level), 37 of 38 outputs looped into recitation"
status: informational
decision: null
superseded_by: null
issue: null
---
## 2026-09-19 — Can a vision model read hieroglyphs off a printed edition? (baseline for `scripts/eval/hieroglyph-ocr/`)

**Headline: no — and the benchmark can say so.** `gemini-3-flash-preview`, temperature 0,
thinking off, one request per pair over 38 pairs (10,203 ground-truth signs, Sethe *Urk.* I
autograph + four BM *Hieroglyphic Texts* line-drawing volumes, ground truth from ORAEC):
**median anchored sign error rate 0.78**; 35 of 38 outputs hit the 8,000-token cap and 37 of
38 are flagged `looped` (a 20-sign window recurring ≥ 4 times) — the same degenerate
repetition the #4850 loop gate catches on Latin and Han. Four full outputs read by eye: the
first 30–60 signs are plausible offering-formula openings (𓇓𓏏𓊵𓏙𓁹𓊨 for ḥtp-dj-nsw), then the
model recites. This is recitation, not reading (cf. paper #4916). Cost $0.90 on Hetzner.

**Design.** Pairs and scorer: `scripts/eval/hieroglyph-ocr/README.md`. Controls PASS: ground
truth against itself 0.0 on every pair; against its own shuffle 0.79–0.96 full / 0.54–0.83
anchored. So the instrument separates a page from noise, and the model scores at the noise
level. Sign-count ratio where measurable: 1.1–5.6× over-generation.

**Not shown.** Whether a lite or a Pro model does better; whether masking the printed
transliteration (Urk. I pages carry none; HTBM plates carry none either) matters; whether a
smaller `maxOutputTokens` plus the loop gate turns 0.78 into a usable number. One model,
one prompt. **Replicated?** No — one run, temperature 0.

**Artifact.** `scripts/eval/hieroglyph-ocr/results/flash3-preview-v1/` (38 raw outputs,
`scores.json`, `report.md`). Library findings surfaced by the alignment (mis-catalogued HTBM
volumes, a Helck volume filed as Sethe, an HTBM IV leaf shift) are in the README, not fixed.

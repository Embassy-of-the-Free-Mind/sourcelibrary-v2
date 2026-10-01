## 2026-09-29 — Round 2 of #5250: do tighter band crops help Yigdzin, and do the untested photometric arms help Yigdzin or Kraken? (#5250)

**Headline, bands: NO. Band crops do not beat the production leafcrop for Yigdzin.** Under the pre-registered merge rule
`leaf-3band` gains +3 matched Derge syllables (60–35, p 0.013, floor 1). That trips the literal decision rule. But
identity falls 9 pp (8–90) and 95/118 pages carry a duplicated line. The cause (read from the reads, shown on #5250):
the lower band's copy of the overlap line comes back **without its above-line vowel signs** (ད་ for དེ་). The cut
sits in the ink valley, and gigu/drengbu rise into it. So that copy scores 0.55–0.74 against the upper copy and the
0.8 merge keeps it. Post hoc (not pre-registered), dropping the overlap line unconditionally makes both band arms
null on identity AND matched (3band 49–39, median 0, p 0.34). The matched "gain" was the duplicate aligning to
repeated sutra formulae. `leaf-lines` was skipped per the pre-registration: BDRC PhotiLines matched the book's line
mode on only 2 of the first 17 pages, so ≥ 95/100 was unreachable.
**Headline, photometric: NULL for Yigdzin, POSITIVE for Kraken.** Yigdzin: unsharp, gamma 0.8/1.2, flatten, gray and
denoise are all within the floor on identity, matched syllables and lines. The 18 controls stay 18/18 at 14 lines.
Kraken (Sophro Mhiro, order-free line CER N2, lower is better) is a different story:
- **unsharp** helps both manuscripts: dark Jerusalem spreads 17–3 (−1.8 pp); clean ÖNB leaves 20–0 (−5.1 pp).
- **flatten** helps ÖNB: 20–0, 0.236 → 0.130. By eye, it strips the paper tint and the facing-page show-through, and it
  reads 13% more characters, toward the GT length.
- **denoise** helps Jerusalem: 18–2 (−1.8 pp).
- **gamma12** hurts slightly: 4–16.
- **sauvola** on the dark stratum: 20–0 (−4.2 pp). This is BYTE-IDENTICAL to round 1 (Kraken is deterministic, same
  20 pages), so it REPRODUCES the post-hoc finding and adds no independent evidence.
- **Design.** Pre-registered on #5250 ("Round 2", 2026-09-29).
  - Tibetan: the round-1 100 Derge-referenced pages (seed 5250, locus fixed) + 18 controls. Every arm is paired against
    `leafcrop`. The A/A floor is leafcrop vs leafcrop-repeat on 30 pages: p90 |Δ| = 0.002 identity, 1 syllable, 0
    lines.
  - Band geometry (tibetan-prep-r2.py): nominal cuts divide leafsplit's text extent; each cut sits in an ink-profile
    valley; one line is shared. Fixed BEFORE any read after an eye-check: detrend (16/118 pages found no pitch) and a
    cross-leaf octave fix (two-line overlaps).
  - Syriac: the round-1 40 pages as two pre-registered strata (jerusalem36 dark, onb-syr1 clean). A/A floor 0.
    Baseline `none` is byte-identical to round 1 (40/40).
- **Replicated?** The round-2 leafcrop control reproduces round 1: 87/118 byte-identical, paired identity 7–11–82,
  p 0.48. The Kraken photometric gains are one manuscript per stratum and external pages, so they are **exploratory**.
  The next step is a pre-registered run on library Syriac pages (unsharp everywhere; flatten on clean leaves;
  sauvola/denoise on dark captures) before any Syriac lane routing change.
- **Spend.** GPU: sl-mitra-1 L4 running 10:58–12:24Z = 1.44 h ≈ **€1.13**. It was API-stopped and confirmed `stopped`
  12:24:26Z. From 09:34Z the poweron got `out_of_stock` until the 12th retry, and nothing billed while it was stopped.
  Gemini: $0.
- **Artifact.** `scripts/eval/results/ocr-preprocessing-2026-09-29-r2.json` (+ `-r2/` texts, geometry, gate log). Store
  run_ids `5250r2-tibetan-yigdzin-2026-09-29` and `5250r2-syriac-kraken-2026-09-29`. Dashboard cells
  `image-arms/{tibetan-dbu-can,syriac-estrangela-dark,syriac-estrangela-clean}/…` on
  `/platform/admin/ocr-evidence#image-arms`.

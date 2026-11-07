---
stage: ocr
measure: [judged, judged_vs_reference]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 1
n_pages: 960
verdict: "NO-GO for writing the agy Flash-low correction over the Yigdzin read of Neyphug Kanjur rGyud Tsha (962 split leaves). The pre-registered gate was at most 2 of 40 pages worse at span level and controls at least 90%. Result: 10 of 40 pages worse and controls 67/80 (84%); both fail. Judge B saw the correction at 95 of 120 decided spans (79% [71, 85]). Whole page, the correction moves leaves toward Derge: +0.0054 identity on 907 leaves with a parallel (486 better, 147 worse). This is the second tantra volume to fail the span gate by the same margin (Thadrak rGyud 'bum Kha, 2026-10-15: 10/40)."
status: rejected
decision: "Nothing written to pages; the volume keeps its Yigdzin read (#6740, #6560 gate)"
superseded_by: null
issue: [6740, 6560]
---
## 2026-10-26 · Flash-low correction, one split-leaf Kangyur volume, gated write (#6740)

PRIOR ART: `2026-10-15-tibetan-flash-pass-gate-6560.md` is the same gate on Thadrak rGyud 'bum Kha, and it was NO-GO. The
router's whole-page result is `2026-10-27-tibetan-router-30-6740.md` (PR #7465): Flash-low was accepted on 53/60 folios
and the router switched the Tibetan cell to it. Derek asked for a one-volume gated write of that route the same day. The
pipeline and the bar are #6560's, unchanged: `cli-ocr.mjs read --correct-prompt` (the CORR request), the ya-btags guard,
and `leafcheck.mjs audit-req` + `tiles-req` (judge B).

**Volume.** Neyphug Kanjur rGyud Tsha, `69e7abec5f1a22ab19aa0707`. It is the only one of 226 visible Kangyur volumes
already split one page per leaf (#5771). It is public and `complete`, with no hold, and none of its pages were in the
router draws. The frame is the 962 split leaves (Yigdzin, SERVE, not human-edited). The 39 photos the split kept whole
are two-leaf frames and are left out. Like the 10-15 gate volume, it is a tantra.

**Read.** 960 of 962 leaves were corrected ($0). agy on l7a was not signed in, so the reads ran on main and cloudlayer
and came back through R2 kept reads (#7075). On the way: `images.sourcelibrary.org` serves the same URL as a
Cloudflare-Polished file (589 KB) or as the original (1.0 MB), depending on cache state. The #7075 reuse key hashes the
image bytes, so it missed for 589 of 960 pages across boxes. `pass/import-kept-reads.mjs` matches on the exact prompt
sent instead, and all 589 matched. Both readers walked the same Mongo order (`cli-ocr read` ignores the order of the
id file), so about 490 leaves were read twice.

**Dry apply.** All 960 pass the guards. None changes more than 25% of syllables, none was cut before END, and there
were **0 ya-btags hits**. 781 leaves changed; the median change is 1.4% of syllables and the maximum 23.5%.

**Gate.** 40 changed leaves, drawn with `--seed=6740-vol1`. 138 changed spans and 80 known-answer controls went to
judge B: sealed Opus, A/B blind, the leaf plus 4 full-resolution tiles.

| | worse / same / better (of 40) | leaf shows the correction (decided spans) | unclear | controls right |
|---|---|---|---|---|
| judge B | **10** / 10 / 20 | 95 of 120, 79% [71, 85] | 18 of 138 | **67/80 (84%)** |

The bar was at most 2 worse and controls at least 90%. Both fail, so nothing was written.

- **Where the leaf contradicts the correction.**
  - Real misreads: སྤྱོད written with Latin letters (`spy`ོད, p.751); ཁྲག→ཕྲག (p.345); བླ→སློབ (p.805); བཞི→གཞི (p.510); ཅི→ཉིད (p.709); a ལ dropped (p.632) or added (p.663).
  - Normalisation: the non-breaking tsheg ༌ for ་ (p.510); a tsheg inserted where the scribe wrote none (ལྕུགམ→ལྕུག་མ, p.378); a final ས for the leaf's subjoined ྶ (p.991); དྲང→དྲངས (p.792).
  
  The guard set does not catch these. The foreign-script guard needs 3+ letters, and `spy` is exactly 3.
- **Judge.** Controls at 84% are under the judge's own bar. On p.812 the judge answered "none of the spots appear; the
  image may not match". I opened that leaf. It matches its text: line 1 reads ཚེས་ལྔ་དང་ནི་ཚེས་བདུན་དང་།, and line 4
  shows ཚེ་གྲངས་སམ, the correction's reading. The judge failed to find the spots; this is not a wrong-leaf page.
- **Whole page against Derge.** OpenPecha P000001, `tib-derge.py` from PR #7465. All 962 leaves were placed; the drafts'
  median identity is 0.953.

| leaves | draft | Flash-low | Δ [95%, by page; one book] | better / worse / tied |
|---|---|---|---|---|
| with a parallel (draft ≥ 0.85), 907 | 0.9466 | 0.9520 | +0.0054 [0.0045, 0.0062] | 486 / 147 / 274 |
| all placed, 960 | 0.9373 | 0.9434 | +0.0061 [0.0053, 0.0071] | 529 / 155 / 276 |

**The 10 worse pages by defect** (judge B's worse spans; none is a ya-btags change, because there were 0 hits; none is
a seam, because the leaves are split):

| defect | pages |
|---|---|
| letter misread (a real error) | 345 ཁྲག→ཕྲག · 510 བཞི→གཞི · 805 བླ→སློབ · 709 ཅི→ཉིད |
| particle dropped or added | 632 ལ→∅ · 663 ∅→ལ |
| garbage: Latin letters inside a syllable | 751 སྤྱོད→`spy`ོད |
| orthographic normalisation | 378 ལྕུགམ→ལྕུག་མ (tsheg) · 510 ༌→་ ×2 · 792 དྲང→དྲངས · 991 བསྲེགྶ→བསྲེགས |
| mantra | none among the worse spans |

**By eye (leaf images opened, full-resolution crops).** These four leaves show what the correction does when it is
right. They are NOT written: the gate failed. Before/after are from the read files.
- **p.128**: the draft has 8 lines and one sentence three times (ཁུ་ཚུར་སོ་སོར་བཅངས་ཏེ…). The leaf has 7 lines and the
  sentence twice. Yigdzin had repeated a line that is not on the leaf; Flash removed it (Derge identity 0.794→0.920).
- **p.990**, line 3: draft ཇི་ལྟར་བཅོལ་ལྡན་འདས་དེ་བཞིན་གཤེས་པ. The leaf reads བཅོམ་ལྡན་འདས་དེ་བཞིན་གཤེགས་པ, as Flash has it.
  Also ལྔན→ལྡན and ཁམསམངོན→ཁམས་མངོན (0.890→0.975).
- **p.389** (a list of nāga kings): the draft's ཆེནཔོ / ཆེན:པོ / ཆེན(པོ) / ཆེནབོ become ཆེན་པོ throughout. The leaf
  has a clean tsheg, and ཧུ་ལ→ཧུ་ལུ matches it too (0.882→0.969).
- **p.955**, line 5: the draft drops ལྡན་འདས་དང་བྱང་ཆུབ་སེམས (སངས་རྒྱས་བཅོམ་དཔའ). The leaf has the full phrase, and Flash
  restores it. But the leaf writes a single shad (གསོལ། སངས) where Flash wrote ། ། throughout. That is the
  normalisation the span gate counts against it.
- p.812 is the judge-error page above: the leaf matches its text.

**Reading.** The whole-page and span-level instruments agree on direction and disagree on the decision, as the router
write-up predicted. Most leaves get better, and the median page gains. But a written page carries about one changed span
in five that the leaf contradicts, and the apply gate counts any page with more of those than of fixes as a regression.
On two tantra volumes the rate is the same (10/40). Whether it holds outside the tantras is wave 2 (20 volumes across
Thadrak, Neyphug and the EAP310 set, 2 pages each); it is reported separately.

Artifacts: `scripts/eval/results/tibetan-correct-6560/pass-gate-neyphug-tsha-6740/`. They hold the reads with
provenance, the audit key, requests and replies, the score, the per-leaf change sizes, and the Derge placement and
scores. Cost: $0 paid. About 1,450 agy Flash-low calls (960 leaves, about 490 read twice) and 40 Opus judge calls on the
l7a subscription.

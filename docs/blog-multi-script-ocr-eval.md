# The Confident Hallucinator: What We Learned Evaluating AI OCR Across Four Scripts

*Derek Lomas, Source Library — April 2026*

---

We built a quality evaluation framework for our OCR and translation pipeline, then ran it across four script families: Latin (printed), Tibetan (manuscript), Hebrew (mixed), and Arabic (manuscript). The central finding is that consistency alone is a dangerous quality signal — a model can be perfectly consistent and completely wrong.

## The Framework

We measure five things, three of which require no ground truth:

**From the literature (established metrics):**
- **CER** (Character Error Rate) and **BLEU-4/ROUGE-L** — standard OCR and translation benchmarks. We implement them but can't use them at scale because we don't have proofread reference texts for most of our 17,000+ books.

**What we're measuring that's new:**
- **Modal Consistency Rate (MCR):** Run the same page through a model N times at temperature=0. MCR = fraction of runs producing the majority output. Adapted from Wang and Wang (2025, [arXiv:2503.16974](https://arxiv.org/abs/2503.16974)), who showed 3-5 run aggregation improves LLM consistency, and Lopresti and Zhou (1996), whose consensus voting reduced OCR errors 20-50%.
- **Output Length Ratio:** Compare character counts across models on the same page. If one model produces 12x more text than another, the longer one is probably generating text that isn't on the page.
- **Embedding-Space Distance:** Embed the original-language OCR and the English translation with the same model (Gemini `embedding-2-preview`, 768 dimensions), then measure cosine distance. High distance = the translation diverged semantically from the source. This requires no reference translation.

## Results: The Cross-Script Matrix

| Script | Model | Temp | MCR | Char Sim | Length Ratio | Emb Distance |
|--------|-------|------|-----|----------|-------------|-------------|
| **Latin** | Flash | 0 | 83% | 99% | 1.0x | 0.110 |
| **Tibetan** | Flash | 0 | 89% | 84% | 1.0x | 0.054 |
| **Tibetan** | Lite | 0 | 100% | 100% | ~1x | — |
| **Arabic** | Flash | 0 | 44% | 45% | 1.0x | 0.120 |
| **Arabic** | Lite | 0 | 100% | 100% | 1.8x | — |
| **Hebrew** | Flash | 0 | 56% | 43% | 1.0x | 0.148 |
| **Hebrew** | Lite | 0 | 100% | 100% | **12.7x** | — |

### Latin: The Baseline

Latin printed text is easy. Gemini Flash 3 achieves 83% MCR (2 of 3 pages fully consistent, one page with minor variation: 904 vs 919 chars). Character similarity is 99.4% even across inconsistent runs — the model is reading the same text with minor punctuation differences. Embedding distance is tight at 0.110 ± 0.016. This is what healthy OCR looks like.

### Tibetan: Surprisingly Good

Both Flash and Lite achieve near-perfect consistency on these particular Tibetan pages (Bardo Thodol, Life of the Buddha — formal printed editions, not the cursive manuscripts from our earlier Bhutan experiment). Embedding distance is remarkably low at 0.054, suggesting the translations are semantically very close to the originals. The cross-model agreement is 74% — the models read similar but not identical text.

Note: these results are on printed editions, not handwritten dbu med manuscripts. Our earlier experiment on Gangtey cursive manuscripts ([blog post](blog-tibetan-ocr-benchmark.md)) found Flash at 80% MCR with complete mode-switching on the 5th run. Cursive manuscripts remain harder.

### Arabic: Unstable but Not Delusional

Flash is remarkably inconsistent on Arabic — 44% MCR at temp=0, meaning no two of three runs agree. The Picatrix page produced three completely different readings (17% character similarity). But the output lengths are reasonable (Flash 1,284 chars, Lite 2,349 chars — a 1.8x ratio, elevated but not alarming). Flash's problem is instability, not hallucination.

The Alchemical Compendium from Herat (1499) is a useful case: Flash achieves 67% MCR, Lite achieves 100% MCR, and their outputs are 1:1 in length. This is a page where both models can read the text; they just disagree on some characters.

At temp=0.3, Lite's length ratio spikes to 3.4x (max 19,439 chars on one page), indicating temperature-induced hallucination. Arabic Lite should stay at temp=0.

Embedding distance for Arabic translation is 0.120 ± 0.008 — similar to Latin, suggesting the existing translations are semantically faithful despite the OCR instability.

### Hebrew: The Confident Hallucinator

This is the most important finding. Flash Lite achieves **100% MCR** on all three Hebrew pages at temperature=0. By the MCR metric alone, it looks perfect. But look at the output lengths:

| Book | Flash chars | Lite chars | Ratio |
|------|-----------|-----------|-------|
| Asis rimonim p39 | 640 | 2,859 | **4.5x** |
| Sefer ha-bahir p20 | 621 | 4,735 | **7.6x** |
| Sepher Maphteah Shelomo p96 | 587 | 15,957 | **27.2x** |

Flash Lite is generating **4-27x more text** than Flash on the same Hebrew pages. On the Key of Solomon manuscript (p96), it produces nearly 16,000 characters from a single manuscript page that Flash reads as ~587 characters. That's not OCR — that's generation. The model is writing plausible Hebrew text that has nothing to do with what's on the page.

And it does this with perfect consistency. Every run, the same hallucination. **MCR = 100%, accuracy ≈ 0%.**

Cross-model agreement confirms the problem: **10.2% character similarity** between Flash and Lite, with essentially zero syllable agreement (0.1%). They're reading completely different texts.

The embedding eval adds another signal: the Sefer ha-bahir (p20) has an OCR→translation embedding distance of **0.348**, versus a corpus mean of 0.094–0.108 for the other Hebrew pages. The translation of that page is semantically distant from its source — a signal that either the OCR or the translation (or both) went wrong.

## Temperature Effects

| Script | Model | MCR@t=0 | MCR@t=0.3 | Change |
|--------|-------|---------|-----------|--------|
| Latin | Flash | 83% | — | — |
| Tibetan | Flash | 89% | 100% | +11% (!) |
| Tibetan | Lite | 100% | 100% | 0% |
| Arabic | Flash | 44% | 33% | -11% |
| Arabic | Lite | 100% | 33% | **-67%** |
| Hebrew | Flash | 56% | 39% | -17% |
| Hebrew | Lite | 100% | 33% | **-67%** |

Temperature=0.3 devastates Flash Lite's consistency on Arabic and Hebrew (100% → 33%), while barely touching Tibetan. This suggests Lite's Hebrew/Arabic "consistency" at temp=0 is a fragile deterministic lock-in that shatters with any noise — exactly what you'd expect from a model that has memorized a generation pattern rather than learned to read the script.

The Tibetan result is counterintuitive: Flash actually gets *more* consistent at temp=0.3 (89% → 100%). One possible explanation: the temp=0 mode-switching we observed might occur at a decision boundary that slight temperature noise pushes past, stabilizing into one interpretation.

## The Triangulation Principle

No single metric is sufficient. You need at least three signals:

1. **MCR** tells you if the model is stable — but a hallucinating model can be perfectly stable (Hebrew Lite at 100%).
2. **Output length ratio** tells you if one model is generating far more text than another — suggesting hallucination. But similar lengths don't guarantee similar content.
3. **Embedding distance** tells you if the translation is semantically close to the source — catching cases where the OCR looks fine but the translation diverged.

Together, they triangulate quality without requiring any ground truth. For our pipeline of 17,000+ books across dozens of scripts, this is the difference between scalable quality assurance and manual review of every page.

## Implications for Our Pipeline

Based on these results:

- **Hebrew should not use Flash Lite.** It confidently hallucinates. Use Flash only, with multi-run consensus.
- **Arabic should use multi-run voting** at temp=0 (Flash MCR is only 44% — 3 runs with majority vote would improve significantly).
- **Tibetan printed text** is handled well by both models. Cursive manuscripts need further evaluation.
- **Latin** is reliable. Single-run Flash is sufficient.
- **Embedding-based translation monitoring** should be deployed pipeline-wide. Pages with OCR→translation distance > 2σ from their corpus mean should be flagged for review.

## What We're Measuring vs. What's Known

| Metric | Source | Novel aspect |
|--------|--------|-------------|
| Multi-run consistency (MCR) | Wang & Wang 2025, Lopresti & Zhou 1996 | Applied to VLM OCR on historical manuscripts |
| Output length ratio | This work | Simple hallucination detector, no ground truth |
| Embedding distance | This work | Translation quality proxy without reference |
| Temperature × model × script | This work | Mapped interaction effects across 4 scripts |
| "Confident hallucinator" pattern | This work | High MCR + high length ratio = systematic hallucination |
| CER, BLEU-4, ROUGE-L | Standard NLP | Implemented but limited by ground truth availability |

## Cost

All evaluations in this post cost a total of **$0.15 USD** — 107 API calls across two Gemini models, four scripts, two temperatures. The embedding evaluations added ~$0.01 each. Quality evaluation at this price point is practically free relative to the cost of running the OCR pipeline itself.

## Reproducibility

All evaluation code is open source:

```bash
# Install: clone the repo, then:
set -a; source .env.production.local; set +a

# Run any evaluation
node scripts/eval/qa-eval.mjs consistency --corpus=hebrew --sample=3 --models=flash,lite --runs=3 --temp=0,0.3
node scripts/eval/qa-eval.mjs embedding --corpus=hebrew --sample=5
node scripts/eval/qa-eval.mjs report --corpus=hebrew --format=blog
```

Raw results are in `scripts/eval/results/`. The framework supports 11 corpora across every major script family in our collection.

## References

- Wang, Y. & Wang, H. (2025). "Improving LLM Consistency via Multi-Run Aggregation." [arXiv:2503.16974](https://arxiv.org/abs/2503.16974)
- Lopresti, D. & Zhou, J. (1996). "Using Consensus Sequence Voting to Correct OCR Errors." *Computer Vision and Image Understanding*, 67(1), 39-47.
- Kargaran, A. H. et al. (2026). "GlotOCR Bench: A Cross-Script OCR Benchmark for 200+ Scripts."
- "Seeing is Believing? A Critical Examination of VLM Hallucination in OCR." [arXiv:2506.20168](https://arxiv.org/abs/2506.20168)
- "Conformal Risk Control for VLM-based OCR." [arXiv:2603.19790](https://arxiv.org/abs/2603.19790)
- "OCR Post-Correction with LLMs: No Free Lunches." [arXiv:2502.01205](https://arxiv.org/abs/2502.01205)

---

*This post was generated from structured evaluation data using the [qa-eval framework](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1329). Total evaluation cost: $0.15.*

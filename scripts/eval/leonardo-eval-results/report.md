# Leonardo Mirror-Script OCR Evaluation Report

**Date:** 2026-04-12
**Book:** *Etudes sur la chevelure et le traite de peinture* — Leonardo da Vinci (`6991ead72f801130a473e94e`)
**Source:** Internet Archive, Windsor Royal Library facsimiles
**GitHub Issue:** #990

## Summary

**Gemini is not reliably reading Leonardo's mirror script.** The OCR output is a mixture of partial genuine reading and extensive training-data reconstruction. The text is topically correct (optics text on optics pages, water dynamics on water pages) but is not a faithful transcription of the specific folio content.

## Evidence

### 1. Cross-Model Comparison

Three models given the same full-resolution images with identical prompts:

| Page | Flash chars | Lite chars | Claude chars | Flash↔Lite | Flash↔Claude | Lite↔Claude |
|------|-----------|-----------|-------------|-----------|-------------|-------------|
| 49 | 4,359 | 1,975 | 1,134 | 12.5% | 3.3% | 2.3% |
| 53 | 5,748 | 2,824 | 1,138 | 12.3% | 2.8% | 2.6% |
| 17 | 2,515 | 1,162 | 834 | 9.0% | 5.2% | 4.3% |

*Word overlap measured by Jaccard similarity on words >2 characters.*

**Key finding:** Models produce fundamentally different text. Gemini Flash generates 2-5x more text than Claude and 1.5-2.5x more than Gemini Lite.

**Claude's response** (all three pages): Honestly declines to transcribe, saying "I cannot reliably transcribe the specific Italian text from this image" and describes the diagrams instead.

**Gemini Flash vs Gemini Lite** produce different Italian passages on the same page — both topically appropriate but referring to different optical/physical concepts.

### 2. Run-to-Run Consistency (Production OCR vs Fresh Run)

Same model (`gemini-3-flash-preview`), same image, different runs:

| Page | DB OCR (production) | Fresh eval run | Word overlap |
|------|-------------------|----------------|-------------|
| 49 | "Ogn' azione ne' nostri sensi è fatta per via d'alcuna linia..." | "ed a tal modo perchè la intercisione fia d'ogni spetie che si move p'un buso..." | **7.3%** |
| 53 | "si la superfitie d'una palla fussi di cristallo e fussi piena d'acqua..." | "li quali mandino le similitudine de' sua colori e forme per riga piramidale..." | **7.9%** |
| 17 | "l'acqua che per de medesimo fondo della caduta si divide..." | "l'acqua che chade p̄ una medesima lina fia di tanta più uolocità..." | **2.5%** |

**This is the smoking gun.** The same model on the same image produces completely different text across runs. If it were genuinely reading, it would produce the same words. Instead, it is sampling from a distribution of "plausible Leonardo-style Italian text about [topic]".

### 3. Resolution Sensitivity

| Page | Resolution | Image KB | Chars | Unclear tags |
|------|-----------|----------|-------|-------------|
| 49 | max (full) | 1,149 | 3,163 | 5 |
| 49 | 1024px | 190 | 1,533 | 24 |
| 49 | 512px | 52 | **2,971** | **0** |
| 53 | max (full) | 1,058 | 5,393 | 13 |
| 53 | 512px | 55 | 1,386 | 14 |

**Page 49 at 512px is anomalous:** nearly as much text as full resolution (2,971 vs 3,163 chars) but with ZERO unclear tags. At 52KB, the mirror script is essentially unreadable, yet the model produces fluent Italian with no uncertainty. This is pure reconstruction from training data.

Cross-resolution word overlap: only 8.8-13.5% (max vs lower), with CER ~78-83%.

### 4. Hallucination Controls

**Blank pages:** Both blank pages (30, 50) correctly identified as blank. PASS.

**Cross-folio contamination:** Three well-known Leonardo quotes from other manuscripts were NOT found in the OCR for this book. PASS — the model doesn't insert famous quotes from unrelated works.

**Illustration pages:** Pages 37 and 45 (illustration-heavy) produced appropriately short text (~45-54 words). PASS.

### 5. Translation Quality

Translations track the OCR content well:

| Page | OCR→Trans ratio | Italian word overlap | Flags |
|------|----------------|---------------------|-------|
| 17 | 1.05 | 0% | OK |
| 21 | 1.02 | 3% | OK |
| 29 | 1.22 | 0% | OK |
| 49 | 1.40 | 0% | OK |
| 53 | 1.01 | 1% | OK |

Translations are faithful to whatever OCR produced. The problem is upstream in the OCR, not in translation.

## Interpretation

The model's behavior on Leonardo mirror script is best described as **"informed confabulation"**:

1. **Topic detection is accurate.** The model correctly identifies water dynamics pages vs optics pages and produces text about the right subject.
2. **Some genuine reading occurs.** Numbers ("70", "120"), labels ("15 bon cole"), and simple repeated words appear consistently across runs.
3. **Most of the fluent Italian text is reconstructed.** The model draws on its training data (which includes published Leonardo transcriptions from Richter, Pedretti, etc.) to generate topically appropriate text.
4. **The reconstruction is non-deterministic.** Different runs produce different passages, proving the text is not being read from the image but sampled from a learned distribution.
5. **The model does not know what it doesn't know.** At low resolution (512px), where reading is impossible, the model produces MORE text with FEWER uncertainty markers — the opposite of what genuine OCR would show.

## Verdict

**Do NOT batch re-OCR Leonardo mirror-script manuscripts** and present the results as reliable transcriptions.

## Recommendations

1. **Label existing OCR honestly.** Add a quality flag or warning to mirror-script pages indicating the transcription is AI-approximate, not verified.

2. **Do not re-OCR the other 8 Leonardo facsimiles** with the current pipeline. The output looks impressively fluent but is unreliable.

3. **For scholarly use:** The translation is useful as a rough topical guide ("this page discusses optics/water/anatomy") but should not be cited as a transcription.

4. **Future approach options:**
   - **Ground truth comparison** (Issue #990 §1): Compare against Richter's *Literary Works of Leonardo* for specific folios to measure what fraction of the OCR text actually appears on each page.
   - **Conservative prompt:** A specialized mirror-script prompt that instructs the model to only transcribe words it can clearly identify, outputting `<unclear>` for everything else. This would produce less text but more honest text.
   - **Human-in-the-loop:** Use the AI output as a starting draft for expert correction, similar to how HTR (handwritten text recognition) models are used in digital humanities.

5. **The 30-page blank hallucination fix (03e92f79) was correct** — blank pages are now properly handled. The remaining concern is content pages where the model hallucinates *plausible* text instead of admitting uncertainty.

## Raw Data

All test outputs saved in `scripts/eval/leonardo-eval-results/`:
- `cross-model.json` — full OCR outputs from 3 models on 3 pages
- `resolution.json` — OCR at 3 resolutions on 2 pages
- `hallucination.json` — blank page, illustration, and cross-folio tests
- `translation.json` — translation quality metrics

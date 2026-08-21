# Bibliographic exposure vs OCR agreement (2026-07-20)

Applies the prior half of the `/blog/did-the-ai-read-this` method (bibliographic
propagation as a proxy for training-data exposure) to the revision-agreement
corpus. Free: Mongo reads + local compute, no model calls. The behavioural-probe
half of that method is NOT applied here — it costs model calls.

**If models recite, agreement should RISE with exposure** — two runs over a widely
propagated work agree by recalling the same passage rather than by reading the page.

## Distribution (and why the corpus report's mean misleads)

n = 107,871 eligible transcription pairs

| statistic | value |
|---|---:|
| mean | 88.1% |
| **median** | **98.3%** |
| p25 | 86.6% |
| p75 | 100.0% |

The distribution is heavily left-tailed: the mean is dragged down by a minority of
catastrophic pairs while the typical pair agrees almost perfectly. Quote the median.

### Agreement by exposure tier

Uncontrolled — exposure is confounded with era, script and language, all of which
independently drive agreement. Read the controlled tables below, not this one.

| stratum | n | mean | median | p25 | p75 |
|---|---:|---:|---:|---:|---:|
| 0 unidentified work | 2,217 | 80.2% | 88.5% | 69.0% | 100.0% |
| 1 single edition | 64,312 | 91.1% | 98.8% | 90.9% | 100.0% |
| 2 some propagation (2-3 editions) | 20,551 | 88.3% | 97.5% | 86.1% | 100.0% |
| 3 well propagated (4-9 editions / translated) | 14,890 | 84.1% | 97.8% | 75.8% | 100.0% |
| 4 heavily propagated (10+ editions) | 4,840 | 76.7% | 90.0% | 64.5% | 99.2% |

### Control: Latin, 1600-1699 only

One language, one century, one script — the cleanest control the corpus affords.

| stratum | n | mean | median | p25 | p75 |
|---|---:|---:|---:|---:|---:|
| 1 single edition | 7,017 | 89.0% | 95.5% | 83.8% | 99.4% |
| 2 some propagation (2-3 editions) | 4,426 | 87.4% | 95.6% | 84.4% | 99.1% |
| 3 well propagated (4-9 editions / translated) | 3,602 | 65.6% | 69.9% | 47.8% | 89.1% |

### Control: same model AND same prompt, spaced scripts

Removes model and prompt-version transitions, so only the text differs.

| stratum | n | mean | median | p25 | p75 |
|---|---:|---:|---:|---:|---:|
| 0 unidentified work | 2,124 | 81.1% | 89.9% | 70.2% | 100.0% |
| 1 single edition | 56,868 | 93.5% | 99.2% | 93.6% | 100.0% |
| 2 some propagation (2-3 editions) | 15,863 | 93.9% | 99.0% | 94.1% | 100.0% |
| 3 well propagated (4-9 editions / translated) | 10,244 | 94.1% | 99.7% | 96.4% | 100.0% |
| 4 heavily propagated (10+ editions) | 2,419 | 93.3% | 99.2% | 93.1% | 100.0% |

### Prompt held constant vs prompt changed (same model, spaced scripts)

How much of measured disagreement is the prompt rather than the page? Same model,
same page, spaced scripts — the only difference is which prompt version ran.

| stratum | n | mean | median | p25 | p75 |
|---|---:|---:|---:|---:|---:|
| prompt CHANGED | 3,589 | 81.3% | 89.0% | 75.1% | 96.1% |
| prompt held | 98,786 | 89.6% | 98.7% | 88.5% | 100.0% |

### By prompt transition (same model, spaced, n>=MIN)

Which specific prompt moves cost agreement. Not an accuracy claim — a prompt that
legitimately changes annotation policy will disagree with its predecessor by design.

| stratum | n | mean | median | p25 | p75 |
|---|---:|---:|---:|---:|---:|
| v4.2026-02→spread-v2+ocr-v10 | 676 | 73.3% | 84.5% | 47.5% | 94.7% |
| v5.1.2026-03→12 | 515 | 91.1% | 93.4% | 89.4% | 96.4% |
| v5.1.2026-03→spread-v2+ocr-v10 | 1,612 | 83.5% | 88.6% | 76.4% | 96.7% |
| v5.2026-02→spread-v2+ocr-v10 | 453 | 83.9% | 89.4% | 77.4% | 96.0% |

### Author prominence (books held by the same author)

A second, independent exposure proxy: prolific/heavily-collected authors are the ones
whose texts propagate.

| stratum | n | mean | median | p25 | p75 |
|---|---:|---:|---:|---:|---:|
| a 1-2 books | 22,258 | 92.1% | 99.1% | 92.9% | 100.0% |
| b 3-9 books | 26,713 | 91.5% | 99.1% | 92.0% | 100.0% |
| c 10-49 books | 22,220 | 89.9% | 99.0% | 90.4% | 100.0% |
| d 50+ books | 9,198 | 76.8% | 86.5% | 65.3% | 97.6% |

## Reading this

A monotone rise across tiers that SURVIVES the controlled tables is evidence of
recitation at corpus scale. A rise only in the uncontrolled table means exposure was
standing in for era and language. A flat profile means the corpus carries no usable
recitation signal and the anchor rows remain the only evidence — a negative result
worth stating, since it bounds what reference-free agreement can ever show.

Caveat: `work_id` coverage is partial, so `0 unidentified work` mixes genuinely
obscure texts with merely unresolved ones. Treat it as "unknown", not "low exposure".

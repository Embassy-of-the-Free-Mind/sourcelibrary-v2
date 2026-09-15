<!-- PRIOR ART: scripts/eval/PREREGISTRATION-translation-prompt-v15.md — pre-registers a PAID prompt A/B; this is the write-up of a free observational read whose harness is translation-model-observational.mjs, and it reuses that A/B's scorer rather than a second one. -->
# Translation on flash-lite vs full flash for non-Latin scripts — the free read (#4759)

**Date:** 2026-09-12 · **Cost:** $0 in model calls (the judge is Claude on subscription)
**Harness:** `scripts/eval/translation-model-observational.mjs` · **Data:** `translation-model-obs-{candidates.json, report.json, judge-packet.jsonl, judge-key.json, judge-verdicts.jsonl}` (the 18 MB `pairs.jsonl` is not committed; the draw is seeded, so `--draw --books 400 --per-book 3` against the committed candidates file reproduces it)

## The question and the verdict

Should TRANSLATION of non-Latin-script books move from `gemini-3-flash-preview` to `gemini-3.1-flash-lite`, as OCR-independent text work, worth ~$12K over 5.4M untranslated pages? The direction was set by Derek; this read asks only whether anything **blocks** it.

**Nothing blocks it.** On the pages we already hold, lite is not worse than flash on any fabrication-shaped metric, and a blind Claude judge over 30 within-book pairs never flagged a lite translation for fabricated content. The residual risk named in the issue — that lite cannot *comprehend* a low-resource source language — did not appear on Tibetan, Syriac, Greek, Hebrew, Armenian, Arabic, Ge'ez, Japanese or Javanese pages.

This is observational and SUGGESTIVE, not decisive. The confounds are listed below and one of them (which pages each era got) is large. Read the numbers with that in mind.

## Design

- **Natural experiment.** 2026-03-27 (#467) put every non-BPH book on lite; 2026-05-12 (#1726) carved non-Latin scripts back out to flash. Between those dates 244,304 pages in the sampled slices were translated by `gemini-3.1-flash-lite-preview` (the retired preview id of the same model); flash pages on the same books come from before Mar 27 (41 pairs, old prompts) or after May 12 (260 pairs).
- **Within-book pairs.** 1,009 non-Latin, non-BPH books had lite translations in the window; 400 were drawn (seeded), 137 had a usable pair. Each lite page is matched to the nearest unused flash page of the **same book** with the **same `ocr.model`** — 303 pairs, mean 7 leaves apart. Unit of analysis is the book.
- **Metrics** are `scoreTranslation` from `translation-prompt-ab.mjs` (#4758), unchanged: verified-note rate (the quoted phrase inside `<note>original: …</note>` is really on the OCR page), note emission, inline terms, invented tags, housekeeping-tag leakage, glossary blocks, body length — plus body length **per OCR character**, added because the two sides are different pages.
- **Judge.** 30 pairs, one per book, spread across 17 language labels, `ocr_matched` only, labels stripped, sides flipped by seeded coin. Six Claude (Opus) subagents, five pairs each, asked which side is the more faithful piece of work against its own OCR and whether either side contains material with no basis in its source. Unblinded afterwards with the key.

## Reference-free metrics (137 books, 303 pairs, all OCR-matched)

| metric (per page, book-mean) | lite | flash | Δ flash−lite [95% CI] | books flash>lite / lite>flash |
|---|---:|---:|---:|---:|
| verified-note rate (pooled) | 0.375 [0.20, 0.61] (112 notes) | 0.269 [0.19, 0.35] (216 notes) | paired −0.21 [−0.43, +0.01], n=26 books | — |
| notes emitted | 0.48 | 0.68 | +0.20 [−0.16, +0.49] | 61 / 25 |
| inline `<term>`s | 4.45 | 10.36 | +5.9 [+0.2, +11.3] | 61 / 59 |
| invented tags | 0.07 | 0.05 | −0.02 [−0.16, +0.10] | 3 / 2 |
| housekeeping-tag leakage | 0.22 | 0.06 | −0.17 [−0.35, −0.02] | 6 / 16 |
| glossary blocks | 0 | 0 | 0 | 0 / 0 |
| body chars | 4,076 | 5,496 | +1,420 [−2,600, +3,530] | 98 / 39 |
| **OCR chars of the page** | **4,130** | **14,439** | **+10,309 [+8,600, +11,700]** | 114 / 23 |
| body chars per OCR char | 0.98 | 0.59 | −0.40 [−0.58, −0.26] | 39 / 98 |

Reading:

- **Fabrication-shaped metrics do not favour flash.** Invented tags are equal; the verified-note rate is *higher* on lite (not significantly). Lite's notes are as real as flash's.
- **Housekeeping leakage is worse on lite** (0.22 vs 0.06 tags/page), but the lite pages ran prompt v10/v11 and the flash pages v12, and item 4 of #3825 (which v15 finishes) is exactly this leak. It is a prompt effect as much as a model one.
- **The pages are not comparable in length.** The flash side of a pair has **3.5× more OCR characters**. The flash pages were translated later, and the judge explains why: they are disproportionately the pages whose OCR is a degenerate repetition loop (one syllable for 16–24K characters). Those are the pages the lite-era pipeline failed or skipped and a later pass redid on flash. So raw body length, terms and note counts all inherit that selection; body-per-OCR-char inverts it (a loop translated honestly is short). **Neither length number says anything about the model.**

Per-language tallies (Greek 28 books, Tibetan 69, Syriac 14, Hebrew 5, others ≤3) are in `report.json`; none reverses the picture above.

## Blind judge (30 pairs)

| | count |
|---|---:|
| lite side more faithful | 13 |
| flash side more faithful | 2 |
| equivalent | 15 |
| fabrication flagged — lite | **0** |
| fabrication flagged — flash | 5 |

Sign test on 13 vs 2: p = 0.007. **Do not read this as "lite is better."** The judges, blind, independently reported the same thing: the discriminating pages were the degenerate-OCR ones, and those fell on the flash side because of the selection above. What the judge read *does* establish:

- In **no** pair did the lite translation invent content, misidentify the genre, or paraphrase a page it could not read. On pages with real prose — Armenian preface, Arabic *Iḥyāʾ*, Greek *Phaedo*, Peshitta Romans 9, a Tibetan Prajñāpāramitā list, a Hebrew gematria page with five correct scripture loci — lite tracked the source clause by clause.
- The five flash fabrications are all *hallucination under empty input*: a page of the syllable म repeated 16,700 times rendered as Bṛhadāraṇyaka Upaniṣad 4.4.7–10 with Devanagari and glosses; a Hebrew page with zero Hebrew characters given psalm content; a runaway siman list given invented ranges. That is the #1726 mechanism (priors filling a vacuum) showing up on **flash**, on text input. It argues for a degenerate-OCR gate before translation (issue-worthy, out of scope here), not for either model.
- The judges also noted that the packet's `language` labels are unreliable (several "Hebrew" books are Syriac or Avestan in the OCR). That is a `books.language` data problem, not a routing one, and it does not change any verdict because the judge read the OCR, not the label.

## Confounds, stated

1. **Assignment by date, not by lot.** Lite = Mar 27–May 12 pages; flash = pages redone after (or translated before Mar 27 with prompts v2/v5). Which pages got redone is correlated with OCR failure (above).
2. **Prompt version.** Lite ran v10/v11; flash mostly v12. Housekeeping leakage and note emission are prompt-sensitive.
3. **OCR model** is controlled by construction (every pair shares one), and the OCR-model mix is identical across arms (107 flash-OCR'd, 196 lite-OCR'd pages per side).
4. **n for the judge is 30**, and half were equivalent. The judge answers "does lite fail at comprehension?" (no instance found), not "which model is better."

## What would change the answer

A pre-registered paired A/B with both arms translating the SAME non-Latin pages under the same prompt — the `--route` mode of `translation-prompt-ab.mjs` already draws that sample (five non-Latin strata, ~$2.64 routed). It is the right instrument if anyone wants a decisive number; this read says it is not needed to unblock the change.

## Decision taken

Translation routing drops the non-Latin branch (BPH stays on flash); OCR routing is untouched. See PR for #4759.

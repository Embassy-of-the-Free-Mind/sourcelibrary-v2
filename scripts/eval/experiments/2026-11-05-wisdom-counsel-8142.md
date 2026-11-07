---
stage: metadata
measure: [judged, preference]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "On 40 dilemmas, advice written with retrieved passages did not score higher than advice with random passages (C − B +0.005, 95% CI −0.12 to +0.125); a plain instruction outscored both."
status: rejected
decision: "Decision table row 'C does not beat B': stop; no counsel mode and no claim about improving judgment (#8142)"
feeds: surface
supersedes: []
superseded_by: null
issue: 8142
---

PRIOR ART: `scripts/eval/PREREGISTRATION-wisdom-counsel.md` (Amendment 1 governs) is the spec; `scripts/eval/wisdom-counsel-8142/FREEZE.md` holds its interpretations, hashes and addenda.

## 2026-11-05 · Does advice on a hard dilemma score better, as judgment, with passages retrieved from the library than with random ones?

**Result: no. The row that applies is "C does not beat B | Stop. Wisdom stays a subject we study; the library makes no claim about improving judgment."** No issue is opened and nothing changes for readers.

`stage: metadata` is the nearest valid header value; this study is about neither OCR nor translation. The writer was `gemini-3.8-flash-low`. Opus's scores are the score of record, and `gemini-3.8-flash-medium` gave the second read. All calls ran on subscription CLIs, with $0 on paid APIs and no human hours.

**What may be claimed:** on these 40 dilemmas, advice written with retrieved passages did not score higher for judgment as this rubric defines it, under these judges, than advice written with random passages. This does not show that the corpus lacks wisdom, that no author had it, or that readers would not be helped. Judges are models, not people, and the rubric measures its own idea of judgment, with no outside validation.

### The decision rule

Composite of the five retained facets, Opus, paired by dilemma, n = 40.

| Test | Bar | Measured | Met |
|---|---|---|---|
| C − B, 95% CI above 0 | above 0 | +0.005, CI −0.12 to +0.125 (C higher on 16, lower on 13, tied on 11) | no |
| C − B at least 0.3 | 0.3 | +0.005 | no |
| C − B exceeds the A-vs-A noise | 0.03 | +0.005 | no |
| C not below M: CI lower bound above −0.3 | −0.3 | −0.35, CI −0.485 to −0.225 | no |
| D beats C (secondary, exploratory) | same three | −0.15, CI −0.24 to −0.06 | no |

The interval excludes a gain of 0.3, the smallest the pre-registration would have counted, so as read by this instrument the null is informative rather than merely underpowered.

### Distribution by arm (Opus composite, five facets)

| Arm | Mean | SD | Min | Q1 | Median | Q3 | Max | Mean words |
|---|---|---|---|---|---|---|---|---|
| A, dilemma alone | 3.10 | 0.40 | 2.2 | 2.8 | 3.2 | 3.4 | 3.8 | 230 |
| A2, independent rerun | 3.14 | 0.48 | 2.2 | 2.8 | 3.0 | 3.4 | 4.4 | 226 |
| B, random passages | 3.12 | 0.45 | 2.2 | 2.8 | 3.2 | 3.4 | 4.2 | 225 |
| C, retrieved passages | 3.12 | 0.44 | 2.4 | 2.8 | 3.2 | 3.4 | 4.2 | 227 |
| D, retrieved from wisdom-teaching works | 2.98 | 0.44 | 2.0 | 2.8 | 3.0 | 3.2 | 4.0 | 222 |
| M, plain instruction, no passages | 3.47 | 0.44 | 2.6 | 3.2 | 3.4 | 3.8 | 4.4 | 230 |

Per-dilemma scores are in `wisdom-counsel-8142/results-full.json`.

### Instrument and size checks (run first, passed)

- **Plants:** reasoned beat empty hedge, reckless and fluent-both-ways, and short reasoned beat empty hedge, each on 10 of 10 dilemmas (bar: 9).
- **Agreement on the plants (Krippendorff's α, Opus–Gemini, n = 50):** f1 0.673, f2 0.710, f3 0.944, f4 0.858, f5 0.247, f6 0.919; composite 0.838.
- **Facet dropped:** f5, the values at stake (bar: 0.667). Five facets remain. On all six the result is the same: C − B +0.012, CI −0.10 to +0.125.
- **f1 retained narrowly:** its α of 0.673 has an interval reaching down to 0.583.
- **Noise floor:** A − A2 mean −0.03, paired SD 0.416, under the 1.1 that would have raised the study to 80 dilemmas.

### The instrument's weakness: read this before relying on the result

**The judges agreed on the plants, which are far apart, and much less on real answers, which are close together.** The pre-registered check covers only the plants, so the instrument passes and the result stands. If the same bar had applied to the real answers, the instrument would have failed.

| Composite α, Opus–Gemini | α | 95% CI | n |
|---|---|---|---|
| Plants | 0.838 | 0.795 to 0.875 | 50 |
| A and A2 | 0.058 | −0.163 to 0.231 | 80 |
| B, C, D, M | 0.163 | −0.049 to 0.326 | 160 |

Per facet on B, C, D, M: f1 0.133, f2 0.032, f3 0.488, f4 0.098, f5 −0.456, f6 0.059.

Unplanned checks (`post-checks.mjs`) show that much of this is a constant offset rather than opposite rankings. Over all 240 answers, Gemini averages 4.05 to Opus's 3.16, with 80 answers at 4.5 or above, and the two composites still rank-correlate at 0.82. The per-dilemma C − B differences correlate at 0.62 across judges.

Gemini's own read reaches the same conclusions, on a wider interval: C − B +0.05 (CI −0.19 to +0.275), C − M −0.315 (CI −0.555 to −0.08). Rank correlation is not the agreement the pre-registration specified, and these figures do not replace it. Both judges are models, so their agreement is not validity.

### Secondary results, all exploratory

**Forced choice, C against B.** Opus chose B on 30 of 40, Gemini on 28 of 40, and they made the same pick on 34.
- It points the other way from a tied composite, and this study does not explain why.
- The order was balanced (C first on 21) and the decoding checked. The judges' stated reasons mention concreteness or practicality in 14 of Opus's 30 B picks. Moralising or rhetoric comes up in only 4, so that is not the explanation.
- By type, Opus chose B on 6 of 10 personal, 6 of 10 work, 9 of 10 civic and 9 of 10 known-outcome.
- It does not support any claim that random passages improve advice: B against A on the composite is +0.015, CI −0.085 to +0.125.

**The plain instruction.** M − A is +0.37 (CI 0.27 to 0.475), with M higher on 34 of 40. About half of that gain is f3, limits of knowledge (M 2.63, A 1.73: 0.90 of 1.85 facet points). The instruction asks for much the same things the rubric scores, so this may be partly teaching to the rubric. It is a benchmark, not evidence that one sentence confers judgment.

**Known-outcome hits**, the one measure that does not depend on the rubric, out of 50 keyed risks on the 10 keyed dilemmas:

| Judge | A | A2 | B | C | D | M | C − B (CI) |
|---|---|---|---|---|---|---|---|
| Opus | 21 | 19 | 19 | 23 | 23 | 25 | +0.4 (−0.1 to 0.9) |
| Gemini | 6 | 11 | 8 | 10 | 9 | 12 | +0.2 (−0.3 to 0.6) |

Neither interval excludes zero, and the two judges counted hits very differently. The cases were transposed to new settings to pass the recognition check (Flash identified 15 of 15 with only the names removed), so each outcome belongs to the original case and the story is an analogy to it.

**Means check.** Answers flagged by Opus as recommending or permitting impermissible means: A 2, A2 2, B 1, C 2, D 2, M 0. C − B is 1, below the 3 that would block a product issue. **No answer in any arm was flagged on any of the 10 dilemmas written to tempt**, so the check was never tested where it was built to work. The flags fell on W04, W09 and W10.

**Harm veto.** No answer was marked in any arm.

**Blinding.** Judges named the true condition on 131 of 240.
- By arm: A 38 of 40, A2 38, B 1, C 10, D 33, M 11.
- B and C were not told apart: both were often guessed as "wisdom" (16 and 18). So the primary comparison looks blind in the way that matters, though passages in the context do leave a visible trace.
- D is easily spotted, so D − C could carry judge expectation as well as anything real.

**Length sensitivity.** Paired length difference +1.8 words; C − B adjusted for it is +0.009, CI −0.113 to +0.129. No change.

**Source detector.** One answer flagged in C and one in D, neither edited. Excluding them, C − B is −0.005, CI −0.133 to +0.118.

**Per facet (C − B, Opus).** None of these intervals excludes zero.

| Facet | A | A2 | B | C | D | M | C − B (CI) |
|---|---|---|---|---|---|---|---|
| f1 perspectives | 2.90 | 2.95 | 3.00 | 3.00 | 2.85 | 3.25 | 0.00 (−0.20 to 0.175) |
| f2 context and change | 3.23 | 3.28 | 3.33 | 3.25 | 3.10 | 3.63 | −0.075 (−0.25 to 0.10) |
| f3 limits of knowledge | 1.73 | 1.80 | 1.65 | 1.85 | 1.55 | 2.63 | +0.20 (−0.075 to 0.475) |
| f4 compromise | 3.60 | 3.58 | 3.65 | 3.50 | 3.33 | 3.78 | −0.15 (−0.35 to 0.05) |
| f5 values (dropped) | 2.78 | 2.68 | 2.80 | 2.85 | 2.88 | 2.80 | +0.05 (−0.075 to 0.20) |
| f6 commitment | 4.08 | 4.08 | 3.98 | 4.03 | 4.05 | 4.10 | +0.05 (−0.05 to 0.15) |

**Per dilemma type (n = 10 each).**

| Type | C − B (CI) | C − M (CI) |
|---|---|---|
| Personal | +0.04 (−0.20 to 0.26) | −0.26 (−0.42 to −0.10) |
| Work | +0.10 (−0.06 to 0.26) | −0.36 (−0.66 to −0.10) |
| Civic | −0.14 (−0.34 to 0.04) | −0.50 (−0.80 to −0.20) |
| Known-outcome | +0.02 (−0.30 to 0.36) | −0.28 (−0.52 to −0.06) |

**Genre prediction.** It predicted that passages which weigh would help more. D's gain over C was −0.075 on the 16 dilemmas with 0–1 weighing passages and −0.192 on the 24 with 2 or more, so the direction does not support it. Only 20 of C's 200 passages carry a genre tag, because 180 lie outside the inventory, so C cannot test it. This says nothing about the worth of any tradition, and it may not be reported as a ranking of them.

**C vs A** is +0.02 (CI −0.09 to +0.135). A and C were judged in separate batches, so it carries a batch effect, as does any comparison of the noise arms with the others.

### What this does not settle

- **The null is about one way of using the library.** One writer model was given five passages it was free to ignore, with no quoting allowed. This study did not measure how relevant the retrieved passages were (mean similarity 0.686 in C, 0.650 in D) or how far the writer used them.
- **The rubric was not shown to detect a small true gain from retrieval.** It separates plants and responds to M, and that is the extent of the evidence.
- **Retrieved text was not checked against page images.** No image was opened, so containment never arose, and this says nothing about the accuracy of those 600 passages.

### Departures from the plan

The first three are logged in `FREEZE.md`.

- **Short passage:** one arm B passage on V03 is 92 words, under the 100-word floor, because of a counting quirk in the frozen code. Kept as drawn.
- **Transport wrapper:** `agy` printed complete replies and then failed to exit on one packet, reproducibly, so `agy-exit-shim.mjs` returns once a reply is complete. Prompts, models and replies are unchanged and frozen files are byte-identical. It was added after the instrument's Opus read and during its Gemini read, so it applied to the last 2 of 8 Gemini packets there and to every later `agy` call.
- **Blocked reply:** Gemini's filter returned an error as the answer on C10 arm A. It was retried once under a rule written before any test answer was judged. It was the only one in any arm, so no cell was excluded.
- **Unplanned analyses:** everything in `post-checks.mjs` was written after the results were read, and it decides nothing.

### Files

Under `scripts/eval/wisdom-counsel-8142/`: `results-instrument.json`, `results-noise.json`, `results-full.json`, and in `results/` the answers, verdicts and keys. `passages-test.jsonl.gz` holds every passage with its book id and page.

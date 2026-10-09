# Preregistration: do temperature samples find OCR errors as well as a second model family? (#6184)

PRIOR ART: the #6184 tie-break (comments of 2026-10-07: 12/12 gate, then 9/10 add-direction vs 6/12
remove-direction by eye, files in `/root/tattva-6184/`) is the run this question comes from. It tested
majority-of-three across models, not samples from one model. `PREREGISTRATION-hidden-flash-5795.md` and
the A-vs-A floors in `EXPERIMENTS.md` measure engine *stability* at served temperature (≈ 0.1), never
at 1.0, and never per token against the print.

Written 2026-10-07. The ground truth was read by eye and committed (`results/reader-diversity-6184/gt-eye.jsonl`,
sha256 `94fef7ec…`) before this file and before any paid call. Nothing here changes after the first
call. Any deviation is reported as a deviation.

## Question (Derek, 2026-10-07)

"Temperature would have as much of a difference as model family — but that is an empirical question."

- **(a)** Is the typical error a *confident* one (the same wrong token in every sample) or an *uncertain*
  one (the token varies across temperature-1.0 samples)? If most errors are uncertain, disagreement among
  samples from ONE model is a cheap error flag (self-consistency).
- **(b)** Are errors less correlated across model families (Flash, lite, Pro) than across temperature
  samples of one model?

## Ground truth (sealed before this file)

Tattvasaṃgraha vols I/II (`6a308257675ed2bdbe36eddd`, `6a30825e675ed2bdbe36f107`), 30 pages, 63 token
slots. Each slot was read by eye against the scan (crops at 2× for vol I's 849 px scans). Slots whose
print reading was uncertain were dropped, not guessed.

- **36 disputed slots.** These are the 13 gate-table tokens and the 23 tokens from the tie-break's
  by-eye sample (lite ≠ Flash). Two were dropped: II p91 किञ्च(न) (an ill-defined pair) and I p233
  सिद्ध्यु/सिद्धयु (ligature not resolvable). One slot found while reading was added: II p300 line 2
  कारणभेदाप्रतिनि-|यमान्न, which Flash drops and the detector never paired. One slot is `likely`, not
  `sure`: I p155 …न्नसंस्कृते (worn type).
- **27 control slots.** One per page, chosen by a seeded draw (seed 6184) among words of 7–22 characters
  that carry ā, virāma, म or न, occur once on the page, and are identical in lite and Flash. Four were
  dropped (unreadable or crop missed). Two controls turned out wrong in BOTH stored reads: I p193
  कारित्रस्येव (print) vs …स्यैव, and I p403 गुणावयवभेदवान् vs …गुणाद्यवयव…. That is the "all agree but
  wrong" case the controls exist to measure.

**Selection bias, stated up front.** The disputed slots were chosen *because* lite and Flash disagreed on
them, which inflates cross-family disagreement there. Correlation (b) is therefore reported on all 63
slots and on the controls alone, never on the disputed slots alone.

## Scoring (fixed; `reader-diversity-6184/score-lib.mjs`)

Each read is normalised (NFC; tags, centring markers and spaces dropped; line-end hyphens joined; only
Devanagari letters, marks and avagraha kept). The slot is located in the stored Flash read and mapped
into the new read by a character diff. The read is **right** iff an 8-character-padded window around the
mapped span contains the print reading. If the window contains neither the print reading nor the known
wrong variant (the alignment lost the slot, as on index tables), the read is decided on the whole page:
right iff the print reading is present and the wrong variant absent. Fallbacks are counted and reported.
Validation on the stored lite/Flash reads reproduces all 63 slot labels.

## Arms (all realtime, `generateContent`, the page image `getPageSource` serves, nothing written to pages)

| arm | model | prompt | temperature | thinking | reads per page |
|---|---|---|---|---|---|
| F0 | `gemini-3-flash-preview` | production default OCR prompt (Standard OCR v19.1) + bulk-reocr's language instruction, safety BLOCK_NONE | **0.1** | budget 0 | 1 |
| F1 | `gemini-3-flash-preview` | same | 1.0 | budget 0 | 5 |
| L1 | `gemini-3.1-flash-lite` | same | 1.0 | budget 0 | 5 |
| P0 | `gemini-3.1-pro-preview` | the tie-break's plain "transcribe exactly" prompt | 0 (callGemini default) | budget 128 | 1, reused from `/root/tattva-6184/reads/` |
| P1 | `gemini-3.1-pro-preview` | same | 1.0 | budget 128 | 2 |

**Deviation from the brief, declared before running:** the brief says "Flash temperature 0 (served
config)". The served config is temperature **0.1** (`bulk-reocr-local.mjs` `OCR_GENERATION_CONFIG`, and
the stored `ocr.engine.generation` of every page in this set). F0 uses 0.1. The stored served Flash read
(Batch) is kept as a second F0-config read, which gives an A-vs-A floor.

Out of scope: a non-Gemini reader (the Hetzner Anthropic key returns 401). That is the missing arm, and
(b) can only speak to *within-Gemini* family diversity.

## Measures

Every rate is reported as k/n with an exact (Clopper–Pearson) 95 % CI, for the disputed set, the control
set and all slots.

1. **Accuracy** per arm: per read for F1/L1/P1 (pooled over samples), and for each single read.
2. **Within-arm disagreement** (F1, L1; P = P0 + 2×P1): a slot *varies* if the samples do not all give
   the same normalised token (all right, or all wrong with the same aligned span).
3. **(a) Confident vs uncertain.** Over the slots where the served read F0 is wrong: the share where all
   five F1 samples are wrong with the same span (*confident*) vs the share where F1 varies (*uncertain*).
   The same for L1 over lite's errors (a slot where the majority of L1 samples is wrong).
4. **Does disagreement predict error?** Flag = "any of the 5 samples differs". For F1 and L1: precision
   and recall of the flag for "F0 wrong" (for F1) and for "L1 majority wrong" (for L1), with AUC using
   the minority-sample share as the score.
5. **(b) Pairwise error correlation:** phi on per-slot wrong/right, plus P(B wrong | A wrong). The pairs
   are: F1 sample i vs F1 sample j (mean over the 10 pairs); F1_i vs L1_i (mean over i); F1_i vs P;
   L1_i vs P, with P taken as each of the 3 Pro reads. Computed on all slots and on controls.
6. **Direction:** each wrong read is classified as omission (the aligned span is shorter than the print),
   insertion (longer) or substitution (same length).
7. **Majority accuracy** (strict majority = print; a tie or a wrong plurality counts as not right):
   5×F1; F0+L(first sample)+P0 (one of each family); 3×F1 + P0 (four voters, so the print needs ≥ 3).

## Decision rules (fixed now)

- **(a)** "Errors are typically uncertain" iff the uncertain share of F0's errors is > 50 % and its 95 %
  CI excludes 25 %. "Typically confident" iff the confident share is > 50 %. Otherwise: undetermined at
  this n.
- **(b)** "Temperature decorrelates as well as family" iff the mean phi across F1 samples is ≤ the mean
  phi of F1 vs Pro + 0.10, on all slots. "Family is better" iff the within-Flash phi exceeds F1-vs-Pro by
  more than 0.10.
- **Recipe implication.** Recommend "k Flash samples at T = 1.0, flag disagreement" as the
  default way to *find* suspect tokens on a Sanskrit worklist only if the flag's recall for F0's errors is
  ≥ 70 % with precision ≥ 30 % on all slots. Recommend it as a *voter* (a replacement for a third
  family) only if 5×F1 majority accuracy is ≥ the one-of-each-family majority on the disputed slots.
  Neither changes production routing. This is a worklist and tie-break question only.

## Cost and stop

30 pages × (1 + 5 + 5 Flash/lite + 2 Pro) = 390 calls. Estimated ≈ $1.9 at list price (Flash ≈ $0.005,
lite ≈ $0.0024, Pro ≈ $0.01 per page, measured in the tie-break). **Cap $3.** The runner meters every
call from usageMetadata and stops issuing calls past $2.80. Usage is logged by
`gemini-script-client.mjs` under endpoint `reader-diversity-6184/*`.

## Output

`results/reader-diversity-6184/` (reads as JSONL, `results.json`, the table), one file in
`experiments/`, and a comment on #6184.

## Addendum 2026-10-07 (plain-prompt arm, written before its first call)

**Arms:** FP = `gemini-3-flash-preview` and LP = `gemini-3.1-flash-lite`, each with Pro's exact plain prompt (`PRO_PROMPT` in `run-arms.mjs`), T 0.1, thinking budget 0, BLOCK_NONE, ×3 per page on the same 30 pages; scored by the same `score-lib.mjs` on the same 63 slots; cap $0.50 (stop past $0.48). **Decision rule:** if FP's pooled per-read accuracy on all 63 slots is ≥ 85 % (the lower bound of Pro's 171/189 CI) the lever is the PROMPT; otherwise it is the MODEL and "Pro decides" stands. Also reported: FP vs F0 (prompt effect at fixed model), and phi of FP errors vs Pro errors against the 0.09 F1-vs-Pro baseline (does the prompt change also decorrelate?).

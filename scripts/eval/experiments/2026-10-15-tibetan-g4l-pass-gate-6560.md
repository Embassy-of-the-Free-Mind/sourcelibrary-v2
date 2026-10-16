---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 1
n_pages: 435
verdict: "NO-GO for a Gemini 4 Argon LOW correction pass, by the preregistered rule. On the Flash gate volume (435 pages), the tiled Opus judge finds 5 of 40 audited pages worse (bar: at most 2) and the leaf shows the correction at 233 of 297 decided spans, 78% [73, 83] (bar: at least 90% with the lower bound above 80%). Controls pass (72 of 80). G4L is better than Flash on the same gate (Flash: 10 worse, 74% [69, 80]) but not by enough: it substitutes words, splits contracted syllables, normalises particles and mantra, and wrote one Kannada sign into a Tibetan word."
status: rejected
decision: "No G4L correction pass; nothing written to pages (#6560 gate)"
superseded_by: null
issue: [6560]
---
## 2026-10-15 · Gemini 4 Argon low correction pass, the same gate volume (#6560)

PRIOR ART: `2026-10-15-tibetan-flash-pass-gate-6560.md` is the gate this repeats: 3.8 Flash low on the same volume,
NO-GO (judge B: 10 of 40 pages worse, the leaf shows the correction at 74% [69, 80] of decided spans).
`2026-10-15-tibetan-gemini4-argon-correct-6560.md` is the 30-folio arm where G4L topped identity against Derge
(0.972), with one plausible-word substitution seen by eye. Identity against Derge rewards normalising toward the
print; only the leaf audit decides. Derek, 2026-10-15: run G4L through the gate.

### Preregistration (committed before any G4L call)

- **Volume:** `69e7aaba80b52390feb199b8` (Thadrak Kanjur rGyud 'bum Kha, 435 pages), the same page list
  (`pass/volume-ids.mjs`).
- **Read:** `pass/run-volume.sh 69e7aaba80b52390feb199b8 --no-apply` with `MODEL=gemini-4-argon-low`
  `JOB=tib-g4-gate-6560`. The only change to the script is that the model and job name are parameters; the CORR
  request (`corr-prompt.txt`), lane, guard and dry apply are the Flash gate's. At most 2 agy calls in flight. A
  quota stop (exit 3) is resumed after the reset, at most 3 times. Transient agy errors are re-read, as Flash's 13
  were. **Nothing is written to `pages`.** $0 (agy and `claude -p` only).
- **Guard:** the ya-btags leaf check as in the pass (Opus via `claude -p`, sealed, Read only).
- **Audit:** `leafcheck.mjs audit-req --n=40 --seed=6560`: 40 pages drawn from the changed pages the dry apply
  would write (guard reverts applied, over-25% pages excluded), every changed span, 2 known-answer controls per
  page. Same READOFF request, A/B blind, context from the draft. The 40 pages are drawn from G4L's changed set, so
  they are not the same 40 pages as Flash's.
  - **Judge B (primary):** `tiles-req`, full frame + 4 full-resolution tiles, fresh `claude -p` Opus.
  - **Judge A (secondary):** the full frame only.
  - `audit-score` per judge, and `judges` for the pooled verdict and α.
- **Decision rule, fixed now, against Flash's judge-B numbers.** GO only if all three hold on judge B:
  1. the leaf shows the correction at **≥ 90%** of decided spans, **and** the Wilson 95% lower bound is **above
     80%** (Flash's upper bound, [69, 80]);
  2. pages worse **≤ 2 of 40** (Flash: 10);
  3. controls right **≥ Flash's rate**, 67 of 80 (84%), as a rate over the controls asked.
  
  Otherwise NO-GO. Judge A and the pooled verdict are reported beside it and do not decide.
- **Also reported:** seconds per page (median of the read's started→finished, beside Flash's on the same volume),
  the guard's hit rate, the kinds of change the leaf contradicts, and 3 pages read by eye where judge B says the
  leaf shows the draft (labelled read-from-image).

### Result (2026-10-16)

**Run.** 435 pages read with `gemini-4-argon-low` through `run-volume.sh --no-apply` (`MODEL`, `JOB` env). 35 calls
failed on agy 503/500 "eligibility check" errors and 1 timed out; all were re-read on a second run of the script. No
quota stop. $0. Nothing written to Mongo.
- **Dry apply:** 426 pages would be written. 3 were refused for changing 29%, 40% and 44% of the draft's syllables;
  5 were refused because the reply was cut before `<<<END>>>` (after the one re-read cli-ocr gives); 1 was held by the
  guard. Flash: 432 / 2 / 0 / 1. The median change is 1.36% of the draft's syllables (Flash 0.97%); 10 pages are
  unchanged (Flash 40).
- **ya-btags guard:** the same single hit as Flash, མོས→མྱོས on p. 415. Opus answered "unclear" again, so it would be put
  back.
- **Seconds per page** (median of the successful call, started→finished): **40 s** against Flash's 28 s on the same
  volume (quartiles 34–58 against 21–56). Wall time was longer: the 503s cost about a third of the first pass.

**Audit.** 417 changed pages apply would write; 40 drawn by seed 6560; 309 changed spans and 80 controls.

| arm (same volume, same rule) | judge | worse / same / better (of 40) | leaf shows the correction (decided spans) | spans unclear or other | controls right / wrong / unclear |
|---|---|---|---|---|---|
| Flash 3.8 low | B: frame + 4 tiles | **10** / 6 / 24 | 178 of 239, 74% [69, 80] | 41 of 280 | 67 / 3 / 10 |
| **G4 Argon low** | **B: frame + 4 tiles** | **5** / 6 / 29 | **233 of 297, 78% [73, 83]** | 12 of 309 | **72 / 1 / 7** |
| Flash 3.8 low | A: frame only | 2 / 16 / 22 | 133 of 149 (89%) | 131 of 280 | 43 / 0 / 37 |
| G4 Argon low | A: frame only | 0 / 15 / 25 | 168 of 185, 91% [86, 94] | 124 of 309 | 52 / 1 / 27 |
| G4 Argon low | pooled (A and B) | 3 / 7 / 30 | 230 of 282, 82% [77, 86] | 10 both unclear, 17 cancel | — |

- **Rule (judge B):** (1) 78% < 90%, and the lower bound 73% is not above 80%: **fails**. (2) 5 > 2 pages worse:
  **fails**. (3) controls 72 of 80 (90%) ≥ 84%: passes. **NO-GO.**
- **Judge agreement** (eval-design.md §2): span answer α 0.15, 309 spans; leaf side where both decided α 0.53, 183
  spans. Both **not settled**. Judge A abstained on 40% of spans and 27 of 80 controls, as it did for Flash; its
  0 worse is not a finding.
- The two arms' audits draw different 40 pages (each from its own changed set), so the side-by-side is not paired.

**What the leaf contradicts** (judge B's 64 draft-side spans, classified by hand):
- **Substituted words, 28.** Examples: བརྒྱད→བདུན (eight → seven, p. 331), མཐོ→མཆོག (p. 47), བསྐྱོད→བསྡུད,
  ཚེགས་ཆེན→ཚེ་ཟད, ཆོས→ཚེམས, སྨྱོན→སྐྱོན, གཞན→གཞག.
- **Syllables split or merged, 11.** G4L expands contractions the leaf writes as one syllable: ཆོག→ཆོ་ག twice,
  གེར→གེ་ར, པུར→པུ་ར, ལན→ལ་ན, མཎྜལ→མཎྜ་ལ, ཀཽར→ཀཽ་ར, པོའམ→པོ་འམ. Three go the other way (ན་ར→ནར).
- **Particles, 10:** པོ→པོའི, ཡ→ཡི, མོའི→མོའོ, ∅→ལ twice, ∅→དང, པ→∅.
- **Mantra and Sanskrit, 8:** ཨ→ཨཱ, ཀཱ→ཀ, ཀྵེ→ཀེ, དྲུ→དྷཱུ, ཧཱུྃ་ས་ཧཱུྃ→ཧྲཱིཿཧཱུྃ.
- **Spelling normalisation, 6:** འཀྱིལ→དཀྱིལ, ཅུ་ཀྲུང→ཆུ་ཀླུང, འཐོན→ཐོན, དགང→དགངས.
- **A non-Tibetan character, 1:** p. 47, སྐྱེད་སྡོམ→ས್ದོམ, with U+0CCD KANNADA SIGN VIRAMA inside a Tibetan stack. It is
  the only such character in the 435 reads. No guard catches it today.

**Checked by eye (read-from-image, full resolution crops):**
- **p. 331, line 4:** the leaf has །བརྒྱད་ན་འཆི་བར་ཤེས་པར་བྱ། (a tall r-g-y stack, then ད), as the draft does. G4L
  wrote བདུན, "seven" for "eight". Judge B was right.
- **p. 47, lower leaf line 6:** the leaf has རྡོ་རྗེ་རིགས་མཐོ་ཆེན་པོ་ལ, as the draft does. G4L wrote མཆོག, the stock
  phrase. Judge B was right.
- **p. 292, lower leaf line 6:** the leaf has །མཎྜལ་ནི with no tsheg inside མཎྜལ, as the draft does. G4L wrote
  མཎྜ་ལ. Judge B was right; this kind changes no word.

**Decision.** NO-GO: nothing applied, no G4L pass. G4L halves Flash's worse pages on this volume (5 against 10) and
its correction rate is 4 points higher with overlapping intervals; neither is enough for the bar. Both models make
the same kind of error: they move the leaf's reading toward a standard or canonical one (stock phrases, contraction
expansion, particle and mantra normalisation). That is what identity against Derge rewards and what the leaf
contradicts. What would change this is unchanged from the Flash entry: a corrector the leaf agrees with at ≥ 90–95%
of decided spans, e.g. a prompt that forbids normalisation, or correction limited to syllables the Yigdzin read marks
as low-confidence.

Artifacts: `scripts/eval/results/tibetan-correct-6560/pass-gate-g4l-69e7aaba80b52390feb199b8/` (the reads, guard and
audit requests and replies, both judges' scores, `audit-judges.json.gz`).

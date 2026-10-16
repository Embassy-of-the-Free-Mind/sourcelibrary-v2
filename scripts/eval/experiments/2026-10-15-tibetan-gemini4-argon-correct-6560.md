---
stage: ocr
measure: [accuracy, judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 30
n_pages: 30
verdict: "Gemini 4 Argon LOW corrects the Yigdzin read slightly better than 3.8 Flash low and meets all three preregistered criteria: 0.972 vs Derge, +0.004 [+0.0003, +0.009] over Flash low (18 / 10 folios), 0 of 30 planted errors left (Flash 3), 8 of 390 toward-Derge changes not on the leaf by Opus (2.1%; Flash 13 of 344, 3.8%). It is 1.7x slower (39 s vs 23 s a page) and made 3 folios slightly worse than the served read (Flash 0)."
status: undecided
decision: null
superseded_by: null
issue: [6560]
---
## 2026-10-15 · Does Gemini 4 Argon low correct the Yigdzin Tibetan better than 3.8 Flash low? (#6560)

PRIOR ART: `2026-10-13-tibetan-flash38-correct-6560.md` (3.8 Flash low and high, the arm the running pass uses),
`2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md` (Opus and 3.1 Pro), and `2026-10-14-gemini-4-argon-low-hard-panels-6707.md`
(G4L reads Tibetan from scratch at 0.912 against Derge). This entry adds one arm on the same harness.

**Why.** A $0 3.8 Flash low correction pass (job `tib-flash-pass-6560`) is running over about 676K pages, at about
23 s a page (about 90 days). Gemini 4 Argon appeared in `agy` on 2026-10-13. If it corrects better, the pass should
switch to it; if it is slower, the switch also changes how long the pass takes.

### Preregistration (committed before any G4L call)

- **Arm `g4l-corr`:** `agy -p --model gemini-4-argon-low`, through `scripts/eval/run-cli-arm.py --kind ocr`
  (plan mode, tool gate, sentinels), one page per call, at most 2 calls in flight, cap 200 calls including retries.
  The 30 folios with the served draft (`req/corr.jsonl`), then the 10 anchoring folios with the same 3 planted
  syllables each (`req/corr-anchor.jsonl`, arm `g4l-corr-anchor`). Requests are rebuilt by `prep.py --reuse-plants`
  from the committed `derge-windows.json.gz` and `plants.json`, so the prompt (CORR), images, drafts and plants are
  those of the 3.8 Flash arms.
- **Comparators** (committed outputs, not re-run): stored served Yigdzin, Flash 3.8 low correct (`flash-low-corr`),
  Opus correct (`opus-corr`).
- **Scorer:** `score.py` unchanged apart from registering the new arm. Syllable identity against the fixed Derge
  window per folio; 95% bootstrap over books (4,000 draws, seed 6560); Δ paired on folios both arms read.
- **Recitation:** every span where G4L moved from the draft toward Derge goes to Opus with the image (`claude -p`,
  never `agy`), in its own read-off key `opus-settles-g4l`, with the same READOFF prompt and 2 known-answer controls
  per call. "Toward Derge, NOT supported by the image" = Opus sees the draft's reading or something else.
- **Did not read** (empty, timeout, refusal, no Tibetan): counted, not scored. On quota: sleep to the quoted reset
  and resume, at most 3 times.
- **Decision rule, fixed now.** Recommend switching the running pass to G4L only if, against `flash-low-corr`, all
  three hold:
  1. Δ identity vs Derge (G4L − Flash low, paired) has a by-book 95% CI entirely above 0;
  2. planted errors left are no worse (G4L survivors ≤ Flash low's 3 of 30);
  3. the **rate** of toward-Derge changes NOT supported by the image is no worse (G4L ≤ Flash low's 13 / 344 = 3.8%).

  Otherwise keep 3.8 Flash. Seconds per page are reported (median, and the pass duration at that rate scaled from
  Flash's 23 s ≈ 90 days) but are not part of the rule.

### Result (2026-10-15, job `tib-g4-6560`)

All 40 arm reads and all 29 read-off calls returned text. Did-not-read is 0. The arm used 43 `agy` calls (3 retries),
with no quota events, no nudges and 1 refused tool call. The read-off used 29 `claude -p` calls; one folio had no
toward-Derge span, so it had no call.

| arm | identity vs Derge [95%] | Δ vs served [95%] | Δ vs Opus correct [95%] | folios better / worse | planted errors left (10 folios) | moved toward Derge / not supported by image | s per page (median) |
|---|---|---|---|---|---|---|---|
| served Yigdzin | 0.945 [0.939, 0.951] | — | — | — | — | — | — |
| Opus correct | 0.960 [0.952, 0.967] | +0.015 [+0.008, +0.022] | — | 23 / 0 | 14 / 30 (47%) | 197 / 25 (Pro settles) | 32 |
| Flash 3.8 low correct | 0.968 [0.962, 0.974] | +0.023 [+0.016, +0.030] | +0.008 [+0.002, +0.015] (20 / 9) | 30 / 0 | 3 / 30 (10%) | 344 / 13 (Opus settles) | 23 |
| **G4 Argon low correct** | **0.972 [0.966, 0.979]** | **+0.027 [+0.020, +0.035]** | **+0.013 [+0.007, +0.019] (24 / 3)** | **26 / 3** | **0 / 30 (0%)** | **390 / 8 (Opus settles)** | **39** |

**Against the decision rule (G4L vs Flash 3.8 low, paired):**
1. Δ identity +0.004 [+0.0003, +0.009], better on 18 folios and worse on 10. **Met, by a thin margin.**
2. Planted errors left: 0 of 30 against 3 of 30. 29 were fixed; on seq 14 the plant བྱ became སྤྱན, where the draft had སྤུན. **Met.**
3. Not supported by the image: 8 of 390 (2.1%) against 13 of 344 (3.8%). **Met.** The settler got 53 of 56 controls
   right, 0 wrong and 3 unclear.

**By the preregistered rule: switch the pass to G4L.**

- **Anchoring folios, scored alone:** G4L 0.975, +0.003 [+0.0004, +0.006] over Flash low (8 / 2 folios).
- **ya-btags:** G4L made 9 toward-Derge ya-btags changes, and Opus sees all 9 on the leaf. The 8 unsupported spans
  are single letters, particles or tshegs: ཕྱི→ཕ, དོ→དེ, ཆགས→ཆག, ར→རཱ, a joined པའམ split, and a stray O dropped. On
  seq 28 G4L folds the interlinear མཛོད into the line, as Flash did.

**What the rule does not see.** The read-off settles only changes TOWARD Derge. On 3 folios (seq 15, 27 and 30) G4L
ends below the served read: −0.006, −0.005 and −0.003. Flash low made no folio worse. Most of those edits sit in
transliterated Sanskrit (སིནྡྷ→སིནྡྷུ, ཙནྡྲཱི→ཙནྡྲི, གནྡྷི→གནྡྷཱ), where the scorer cannot say which reading the leaf has.
One was checked by eye at full resolution. Seq 30, line 2: the leaf has two syllables before ནི་ན་རྒྱུ་བའི (the
draft's རཱ་ཛ is close), and G4L wrote one, རྫིང "pond", which fits the context and is neither on the leaf nor in
Derge. **That is a plausible-word substitution, and it is the risk this protocol under-counts.** On the same folio
G4L also added a རྣམས (line 7) and changed བ→པོ (line 13); neither was checked by eye.

**Duration.** At the median 39 s a page against Flash's 23 s, the pass would take about 1.7 times as long:
about **150 days** where Flash takes about 90. This assumes the pass is bound by call latency at the same
concurrency.

**Recommendation (decision owed by Derek).** The preregistered rule says switch, but only just: +0.4 points of
identity, at the cost of about 60 more days, with one plausible-word substitution seen by eye that the read-off
cannot catch. If the switch is made, keep the ya-btags guard and the served read as the prior revision. Add an
away-from-Derge spot check on the first volume, because that is the one place where G4L did worse than Flash here.
**Confidence:** low to moderate. This is one run on 30 folios with a model settler, and the CI lower bound is
+0.0003.

*Replicated?* No. Artifacts: `scripts/eval/results/tibetan-correct-6560/out/g4l-*`, `out/readoff-opus-settles-g4l.jsonl.gz`,
`readoff-key-opus-settles-g4l.json.gz`, `scores-g4l.json.gz`. Re-scoring from the committed files reproduces every
number above.

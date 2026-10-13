---
stage: ocr
measure: [accuracy, judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 30
n_pages: 30
verdict: "Gemini 3.8 Flash LOW corrects the Yigdzin read better than Opus: 0.968 vs Derge (+0.023 [0.016, 0.030] over the served read; +0.008 [0.002, 0.015] over Opus correct), 30 of 30 folios better, 0 worse, 3 of 30 planted errors left (Opus 14). Opus finds 13 of its 344 toward-Derge changes not on the leaf (Opus correct: 25 of 197). The mi→myi recitation that disqualified Pro appears once: 2 changes on seq 23, checked by eye (Pro: 21). Flash HIGH is worse than LOW: +0.008, 4 folios returned unchanged, 17 of 30 plants left."
status: undecided
decision: null
superseded_by: null
issue: [6560]
---
## 2026-10-13 · Can Gemini 3.8 Flash correct the Yigdzin OCR of the BL Kangyurs? (#6560)

PRIOR ART: `2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md` (Opus and 3.1 Pro, correct and redo, on the same
set) and `2026-10-13-sonnet-haiku-correct-vs-opus-6667.md` (Sonnet and Haiku, same set). This entry adds two arms.
The harness, folios, drafts, plants, prompt and scorer are unchanged. The Opus and Pro rows below are the committed
outputs of the first run; they were not re-run.

**Why.** Pro is withdrawn as a corrector because it recites the edition's spelling. Opus cannot cover about 800K
pages on the subscription. A $0 Flash pass through `agy` is the remaining way to correct Tibetan at scale.

**Design.**
- **Arms:** `agy -p --model gemini-3.8-flash-low` and `gemini-3.8-flash-high`, low first. Each arm read the 30
  folios with the served draft, then the 10 anchoring folios with 3 planted syllables each. The prompt is the
  same CORR prompt as Opus and Pro (`prep.py --reuse-plants` rebuilds it from the committed files). The runner is
  `scripts/eval/run-cli-arm.py` (plan mode, tool gate, sentinels): one page per call, 2 calls in flight, $0, no Mongo
  writes.
- **Score:** syllable identity against the fixed Derge window per folio, with a 95% bootstrap over books. Δ is
  paired on the same folios.
- **Recitation:** every span where a Flash arm moved from the draft toward Derge was read off the image by Opus
  (`claude -p`, the other family). Each call showed both readings in random order with no word of which one is
  Derge, plus 2 known-answer controls. Both Flash arms share one call per folio (key `opus-settles-flash`).

**Result.** All 80 arm calls and all 30 read-off calls returned a read (did-not-read 0 everywhere, no nudges, no
wrapper problems).

| arm | identity vs Derge [95%] | Δ vs served [95%] | Δ vs Opus correct [95%] | folios better / worse | planted errors left (10 folios) | moved toward Derge / not supported by image | s per page (median) |
|---|---|---|---|---|---|---|---|
| served Yigdzin | 0.945 [0.939, 0.951] | — | — | — | — | — | — |
| Opus correct | 0.960 [0.952, 0.967] | +0.015 [+0.008, +0.022] | — | 23 / 0 | 14 / 30 (47%) | 197 / 25 (Pro settles) | 32 |
| Pro correct | 0.965 [0.957, 0.972] | +0.020 [+0.011, +0.029] | +0.005 [−0.004, +0.015] | 25 / 5 | 3 / 30 (10%) | 431 / 26 (Opus settles) | 135 |
| **Flash 3.8 low correct** | **0.968 [0.962, 0.974]** | **+0.023 [+0.016, +0.030]** | **+0.008 [+0.002, +0.015]** (20 / 9 folios) | **30 / 0** | **3 / 30 (10%)** | 344 / 13 (Opus settles) | 23 |
| Flash 3.8 high correct | 0.953 [0.946, 0.959] | +0.008 [+0.004, +0.013] | −0.007 [−0.012, −0.002] (10 / 17) | 23 / 1 | 17 / 30 (57%) | 121 / 3 (Opus settles) | 135 |

- **Flash low minus Pro correct:** +0.003 [−0.002, +0.009]. **Flash high minus Flash low:** −0.015 [−0.022, −0.008];
  high is worse on 24 of 30 folios.
- **Anchoring folios, scored separately:** Flash low 0.972 (+0.025 [+0.013, +0.037]; +0.021 [+0.011, +0.031] over
  Opus on the same 10, better on all 10). Flash high 0.952 (+0.004 [−0.001, +0.011]).
- **Settler:** Opus got 57 of 60 controls right, 0 wrong, and 3 unclear.

**What the numbers are made of.**
- **Flash low edits every folio, and the edits are repairs.** Seq 28 is an example: བུང→དྲུང, ད་གའ→དགའ, འཚམ→འཚལ, ཁྱོ→ཁྱོད,
  with the same syllable count as the draft. On 2 folios its recall against Derge falls while its identity rises: seq 28
  goes from 0.951 to 0.765, and seq 25 from 0.796 to 0.254. That fall comes from the alignment of a two-leaf frame,
  not from dropped text: on seq 28 the line and syllable counts equal the draft's. Opus correct falls the same way on
  seq 25 (0.402).
- **Recitation of ya-btags spelling is small and local.** The test is whether Flash writes the e-text's
  མྱི/མྱེད over the leaf's མི/མེད, as Pro did.
  - Flash low made 7 such changes and Pro made 26.
  - On seq 8, where Pro made 14, Flash low made none.
  - On seq 20, Flash low and Pro make the same 3 changes, and Opus sees མྱི/མྱེད on the leaf for all 3.
  - On seq 23, Flash low changed 4 of the draft's 10 མེད and Pro changed 9. Opus supports 2 of Flash's 4.
  - **Checked by eye at full resolution:** line 2 reads མཚན་མ་མྱེད་པ, so Flash is right there. Line 3 reads
    མཚན་མ་མེད་པ་དང་ ། སྨོན་པ་མེད་པ, and Flash wrote མྱེད in both places. Those 2 changes are recitation.
  - In the other direction, Flash removed a ya-btags once (seq 4, མྱེད→མེད), and Opus agrees with that change.
- **Flash low's other 11 unsupported spans** are single particles or letters, where Opus sees the draft's reading:
  ཀྱི/ཀྱིས, དུས→ངུས, དང→དག, སྐྱོད→བསྐྱོད, ཆགས→ཆག, རྩོལ→སྩོལ, པོས→པས, and one tsheg. On seq 28 Flash folded an
  interlinear addition (མཛོད written above the line) into the line. Opus sees the addition. This is an editorial
  choice, not an error on the leaf.
- **Flash high behaves like Opus.** It is selective: it returned 4 folios unchanged, and its surviving plants sit
  mostly on the folios where Opus's survive (6, 8, 14, 19, 20, 29; plus 9 and 24). It makes few toward-Derge changes and few unsupported ones (121
  and 3). At high thinking, the model keeps the draft where low thinking repairs it.
- **Identity against Derge rewards recitation.** The read-off is a model, not a reader, and its controls cannot
  show that the settler does not itself recite. The one pattern that matters, ya-btags, was checked by eye on the
  folio where it appeared.

**Recommendation (decision owed by Derek).** Run a $0 Gemini 3.8 Flash correction pass at **low** thinking over the
Yigdzin Tibetan, with two guards:
- keep the served read as the prior revision;
- hold any change that only adds or removes a ya-btags on མ (མི/མེད ↔ མྱི/མྱེད) for an Opus settle, or drop it. That
  is the one systematic recitation pattern seen on this set, and it is cheap to detect.

Do not use high thinking: it is slower (135 s vs 23 s per page) and corrects less. **Confidence:** moderate. Flash
low is ahead of Opus correct on every measure here, but this is one run on 30 folios with a model settler, and
identity against Derge partly rewards normalisation.

*Replicated?* No. One run, 30 folios. Artifacts: `scripts/eval/results/tibetan-correct-6560/out/flash-*`,
`readoff-*-flash*`, `scores-flash.json.gz`.

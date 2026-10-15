---
stage: ocr
measure: [accuracy, judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 30
n_pages: 30
verdict: "Preregistered; not yet run."
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

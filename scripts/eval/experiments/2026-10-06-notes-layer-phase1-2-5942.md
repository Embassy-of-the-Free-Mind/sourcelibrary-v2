## 2026-10-06 · Notes as their own layer, phases 1–2: is the note-free prompt safe on Flash-Lite, and can stored markup be parsed into text + annotations? (#5942)
<!-- PRIOR ART: 2026-10-06-translation-notes-free-5919.md (PR #5926) ran v13 twice against v13-plain on 40 pages, 12 of them on Lite; its runner, scorer and rule are reused here on 40 other pages, all Lite. The #5695 fidelity harness (translation-vs-reference/) is used unchanged. For the parser: src/lib/term-definitions.ts and src/lib/notes-off.ts are called, not rebuilt. -->

**Question.** (1) On pages whose book ships on `gemini-3.1-flash-lite`, is the note-free prompt (`v13-plain`, the in-memory edit of #5919) no less faithful to a human reference than v13? #5919 left this open: its 12 Lite pages scored 0.25 lower. (2) Can a pure function split today's stored translation markup into the book's words and a list of annotations, so that rendering the two reproduces what the reader shows now?

**Preregistered rule for phase 1 (written and pushed before any model output existed; the same P1 and P2 as #5919).**
- **Pages.** 40 pages from 40 books that route to Lite today, with a public published English translation, from the #5695 sets T1 (Latin) and T3 (vernaculars): Latin 16, German 8, French 5, Italian 5, Dutch 3, Spanish 3. Seed 5942. No book that #5919 used. No Tibetan. `scripts/eval/notes-layer/build-lite-sample.mjs`; the pinned draw is `results/notes-layer-2026-10/lite/sample.jsonl`.
- **Arms.** `v13-a`, `v13-b` (the live default row run twice: the noise floor) and `v13-plain` (hash `655488d8ecd524d7f3139fe9aeec50f5`, asserted before spending). Production door, Lite, temperature 1, thinking off, one page per request, no previous-page translation. Runner: `translation-notes-free/run-arms.mjs`, pointed at this sample by environment variables and otherwise unchanged.
- **Instrument.** The #5695 harness unchanged: two blind Opus judges, controls first; the run stops if the gate fails.
- **P1 fidelity (non-inferiority).** Pass when mean(plain) − mean(v13-a) ≥ −max(|v13-b − v13-a|, 0.15) AND the paired bootstrap CI's lower bound is above −0.30.
- **P2 reversals.** Pass when pages with a reversal quoted by either judge in plain ≤ the same count in v13-a + 1.
- **Decision.** P1 and P2 pass → the note-free prompt is cleared for Lite as well as Flash (the switch itself still waits for the notes step, #5942 phase 5). Either fails → the switch is Flash-only, or waits.
- **Reported, not in the rule.** Cost and tokens, tags left in plain, definitions in brackets, text hidden in `<meta>`, by language; and the 12 Lite pages of #5919 beside these 40, never pooled into the rule.
- **Replacement.** A page that fails in any arm after four attempts is dropped from all three arms and named; no redraw.
- **Spend.** Envelope `notes-layer-5942`, cap $2, expected under $1; removed after the run.

**Result.** (pending)

---
stage: pipeline
measure: [judged, preference]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Rewriting the Librarian's four closing citation lines (link only the page that states the claim; background with no link; one-page blockquotes; captions from the image record) does not cut wrong-page links: 26 → 30 of 168 / 182 judged links on 40 readers' questions (two Opus judges, a third on splits). Gate not met."
status: rejected
decision: "Arm B lands behind LIBRARIAN_CITE_PAGES=1, off; the default prompt is unchanged (#6946)"
superseded_by: null
issue: [6946]
---
PRIOR ART: `scripts/eval/librarian-speed-6904/` (harness, the 40 frozen questions, the blind preference judge and its rule); `scripts/eval/librarian-citations-6946/` (the per-link instrument `packet.ts` + `JUDGE-PROMPT.md`, shared with the weekly gauge, and `load-support.ts`). Registered rule: `scripts/eval/librarian-cite-prompt-6946/PREREGISTRATION.md`, committed before any main-run turn (`27d56fb2b`).

## 2026-10-18 · Can the answer model's own instructions put links on the page that says it? (#6946)

**Who it is for.** A reader clicking a Librarian page link. The weekly gauge's first live run found 18.1% of page links land on a page that does not say the thing (19 of 105), and #6956's quote re-pointing fixes only a few.

**Design.**
- **A** is today's request: the #6909/#6956 shipped state. Its system prompt is byte-identical to `main` at 5327f847f (checked for en and es, both thinking settings).
- **B** replaces the four closing Formatting lines with `CITE_PAGES_LINES` in `src/lib/embassy/librarian.ts`. It keeps the same slot and the same number of lines:
  - link a sentence only when the page's text states it, and link the page where the words are;
  - state background plainly, with no link;
  - quote only words from a tool result, and give each blockquote one page and that page's link;
  - write captions only from the image record.
- **A2** is A run again on 8 questions, for the noise floor.
- The model, thinking, search, grounding passes and router (off) are the same in every arm.
- 40 readers' questions (`librarian-speed-6904/questions.json`), run in-process on Hetzner, interleaved.
- **Instruments:**
  1. Every page link in the text the reader sees is labelled by the gauge's instrument: two Opus judges on whole pages, and a third on the 12 answers where they split.
  2. #6904's blind X/Y preference judge: two Opus judges, and a third on the 10 split pairs.

**Results** (40 questions; wrong-page = `other` + `none`; `missing` left out):

| arm | judged links | cited | other | none | wrong fact | **wrong-page** | answers with one |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 168 | 130 | 10 | 16 | 12 (7.1%) | **26 (15.5%)** | 16 / 40 |
| B | 182 | 144 | 15 | 15 | 8 (4.4%) | **30 (16.5%)** | 22 / 40 |
| A, control 8 | 38 | 29 | 3 | 3 | 3 | 6 | 4 / 8 |
| A2, control 8 | 36 | 31 | 1 | 3 | 1 | 4 | 3 / 8 |

- J1 and J2 agree on 0.97 of labels (wrong-page κ 0.90, 385 links).
- Per question, B has fewer wrong-page links on 10, more on 15, and the same number on 15.
- The wrong-page links differ from arm to arm. 9 questions have some in both arms, but only q37's two (Waite p.297, Hall p.1) are the same link in both. No new kind of failure stands out in B's 30 labels.
- B writes more links (182 vs 168) and more correct ones (144 vs 130). The extra links come with no fewer errors.

**Gate** (registered):

| | measured | needed | |
|---|---|---|---|
| G1 wrong-page drop | −15% (26 → 30) | ≥ 30% + noise 33% (A 6 vs A2 4 on 8) | **fail** |
| G2 wrong fact | 4.4% vs 7.1% | ≤ A + 5.1 pts | pass |
| G3 preference | B 18, A 20, tie 2; net loss 0.05 ≤ floor 0.125; grounding failures only-B 13 vs only-A 11 | only-B ≤ only-A | **fail** |
| G4 time to done p50 | 10.2 s vs 9.8 s (+4%) | ≤ +10% | pass |
| G5 cited links kept | 144 vs 130 | ≥ 80% of A | pass |

- **B does not ship as the default.** It lands behind `LIBRARIAN_CITE_PAGES=1`, off.
- The fall in wrong-fact labels (12 → 8) is inside the A-vs-A2 spread on 8 questions (3 vs 1), so it is not a finding.
- Preference judge α 0.67 and grounding α 0.65: both **not settled**. Read the counts as the judges' preferences.

**What it says about the lever.** It matches `lesson_prompt_is_the_small_lever`: four precise lines aimed at the exact failure kinds moved nothing measurable. A hypothesis, not measured here: the wrong links come from what the model was shown more than what it was told, for example:
- a passage near the page boundary;
- a neighbour page that search handed over (`retrievedPages`);
- background it remembers and attaches to the nearest book.

A next lever should change the tool results (for example, mark each passage's own page more plainly than its neighbours), not the instructions.

**Spend.** 90 Librarian turns (2 smoke + 88 main) on `gemini-3-flash-preview`. They cost **$1.42** by the turns' own usage numbers, within the approved 100 turns and $4. No other Gemini was used. The judges ran as Opus on the subscription: 166 + 12 per-link calls and 96 + 10 preference calls.

**Replicated?** No. n = 40 questions, and the A-vs-A2 control (8 questions) varies by a third. A 30% effect would have needed a much larger sample to show. Even so, the observed direction is the wrong way.

**Artifacts.** `scripts/eval/librarian-cite-prompt-6946/`:
- `run.ts` (the arm switch is `citePages`), `score-links.mjs` (J1/J2/J3 merge and the gate), `PREREGISTRATION.md`;
- `results/`: `main.jsonl.gz` (all 88 turns: raw, final, sources, timings, usage), `links/` (link lists and per-link labels J1/J2/J3), `pref/` (key and X/Y verdicts), `links-scored.json.gz`.

To rebuild the packets, run `load-support.ts --arms=A,B,A2` and `build-packets.ts --tag=<arm>`.

Re-score: `node scripts/eval/librarian-cite-prompt-6946/score-links.mjs <results>/links <main.jsonl, gunzipped>` and `node scripts/eval/librarian-speed-6904/score.mjs <results>/pref`.

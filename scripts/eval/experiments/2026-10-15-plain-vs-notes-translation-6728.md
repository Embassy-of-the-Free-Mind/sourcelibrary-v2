---
stage: translation
measure: judged_vs_reference
languages: [fa, sa, lzh, grc, he]
scripts: [Arab, Deva, Hani, Grek, Hebr]
canons: []
n_books: 132
n_pages: 132
verdict: "Asking for notes, summary, keywords, terms and meta does not help the translation body and costs some of it. PLAIN − CURRENT is +0.11 [0.00, +0.21] for 3.8 Flash (Opus judge) and +0.30 [+0.13, +0.47] for Opus (3.8 Flash high judge), 132 pages, beside A-vs-A floors of −0.12 and −0.02. Pages with an omission fall by half in both lanes."
status: undecided
decision: "Recommend PLAIN for new translation plus a separate, on-demand notes/summary pass; the default prompt is not changed by this test (#6728)"
superseded_by: null
issue: 6728
---
## 2026-10-15 · Plain translation vs translation with notes, through both subscription lanes (#6728)

PRIOR ART: `2026-10-06-translation-notes-free-5919.md`. It removed only the `<note>` and definition instructions from v13, on 40 pages via the API with no seed. Plain was non-inferior there: +0.10 [−0.09, +0.29]. The panel, references, judge prompt, plant controls and bootstrap are #6545's (`2026-10-12-pro-opus-correction-hardest-languages-6545.md`, `scripts/eval/pro-translate-6545/`). Scripts: `scripts/eval/plain-6728/`. Numbers: `scripts/eval/results/plain-6728/scores.json`.

### Question

**Should translation be straight, with notes and interpretation in a separate pass?** The test asks whether removing the interpretive instructions changes the fidelity of the translation body.

### Design

- **Pages:** the #6545 panel, one page per work, each with a published English translation. Persian 23, Sanskrit 30, Chinese 25, Greek 25, Hebrew 29: 132 pages.
- **CURRENT:** the live default, Standard Translation v13 (`51651014`). It is built exactly as `scripts/batch/cli-translate.mjs read` builds it: translate-core `buildTranslationPrompt`, page-break devices scoped, agy-cli `TRANSLATE_SUFFIX`. The seed is the stored previous page (127 of 132 pages have one).
- **PLAIN:** the same text with 13 anchored edits in memory (`prompts.mjs` `PLAIN_EDITS`; `10151f1b…`; 7,233 → 4,920 characters).
  - **Removed:** `<note>`, `<term>`, definition `<gloss>`, `<meta>`, "original:" notes, the annotated examples, "warm museum label", summary, keywords, and the summary/notes style section.
  - **Kept:** `<margin>`, `<insert>`, `<unclear>`, `<column-break/>`, `<leaf-break/>`, `<warning>` (for an untranslatable page only), `<gloss>` for a gloss printed in the source, and the OCR's own `<image-desc>`, translated literally.
  - **Seed:** the stored previous page with its interpretive blocks removed (`plainSeed`), as a PLAIN pipeline would hold it.
- **Translators,** one page per call, at most 3 calls in flight:
  - `gemini-3.8-flash-low` via `agy -p`: agy-cli `gatedTextCall`, i.e. plan mode, tool gate and markers.
  - Opus via sealed `claude -p` (`--restricted --tools ""`, API keys stripped from the environment).
- **Noise floor:** CURRENT run a second time (CUR2) on 50 pages, 10 per language.
- **Judges:** blind and cross-family, using #6545's inline judge prompt (`JUDGE-PROMPT-PRO.md`), one item per call.
  - Opus judged the Gemini arms.
  - `gemini-3.8-flash-high` judged the Opus arms.
  - Controls: 10 planted meaning errors per family (9 in G; one page had no plant site), located by span.
- **What is scored:** the BODY, through one function for every arm (`bodyOf`).
  - **Dropped with their content:** `<note>`, summary, keywords, `<meta>`, `<vocab>`, `<warning>`, `<image-desc>`, OCR metadata tags, and a `<gloss>` straight after `</term>` (CURRENT's definition of a term).
  - **Unwrapped, words kept:** every other tag, including the other `<gloss>` uses, which are printed interlinear text in both arms.
- **Intervals:** 95%, 2,000 draws by work (one page per work).
- **Cost:** $0. No API key, no OpenRouter, no production write.

### Result

**Fidelity of the body, 1–5:**

| panel | n | 3.8 Flash CUR | PLAIN | PLAIN − CUR | floor CUR2 − CUR (n) | Opus CUR | PLAIN | PLAIN − CUR | floor (n) |
|---|---|---|---|---|---|---|---|---|---|
| Persian | 23 / 22 | 3.96 | 3.83 | −0.13 [−0.39, +0.13] | −0.20 [−0.70, +0.30] (10) | 3.91 | 4.36 | **+0.46 [0.00, +0.91]** | −0.33 (9) |
| Sanskrit | 30 | 3.83 | 4.00 | +0.17 [−0.13, +0.47] | −0.20 [−0.50, 0.00] (10) | 4.13 | 4.40 | +0.27 [−0.07, +0.63] | −0.10 (10) |
| Chinese | 25 | 4.08 | 4.16 | +0.08 [−0.12, +0.28] | 0.00 [−0.50, +0.50] (10) | 4.12 | 4.36 | +0.24 [−0.08, +0.56] | +0.10 (10) |
| Greek | 25 | 3.96 | 4.24 | **+0.28 [+0.08, +0.48]** | −0.30 [−0.60, −0.10] (10) | 4.20 | 4.44 | +0.24 [−0.16, +0.60] | +0.30 (10) |
| Hebrew | 29 | 4.21 | 4.31 | +0.10 [−0.07, +0.28] | +0.10 [−0.20, +0.40] (10) | 4.00 | 4.34 | **+0.34 [0.00, +0.69]** | −0.10 (10) |
| **pooled** | 132 / 131 | 4.01 | 4.11 | **+0.11 [0.00, +0.21]** | −0.12 [−0.28, +0.06] (50) | 4.08 | 4.38 | **+0.30 [+0.13, +0.47]** | −0.02 [−0.25, +0.22] (49) |

Wins / losses / ties, PLAIN against CUR: 31 / 19 / 82 for 3.8 Flash, 57 / 28 / 46 for Opus. One Opus-family item did not parse and is left out (131).

**Errors, pages out of 132** (CUR / PLAIN, CUR2 on its 50 pages):

| | 3.8 Flash | Opus |
|---|---|---|
| pages with an omission | **37 / 17** | **35 / 15** |
| pages with a reversal | 11 / 13 (CUR2: 7 of 50) | 6 / 6 (2 of 50) |
| pages with an invention | 64 / 31 | 16 / 7 |
| invention entries, by kind: unreadable_fill | 54 / 33 | 1 / 2 |
| gloss (bracketed or parenthetical explanation in the text) | 53 / 20 | 7 / 0 |
| added_fact | 14 / 3 | 8 / 1 |
| boundary | 8 / 3 | 7 / 4 |
| accuracy spans per page | 2.77 / 2.12 | 1.46 / 0.96 |
| major accuracy spans per page | 0.49 / 0.44 | 0.24 / 0.18 |

**Output and cost:**

| | 3.8 Flash CUR | 3.8 Flash PLAIN | Opus CUR | Opus PLAIN |
|---|---|---|---|---|
| reads / did not read | 132 / 0 | 132 / 0 | 132 / 0 | 132 / 0 |
| visible output tokens per page (mean) | 867 | 691 (−20%) | — | — |
| thinking tokens per page (mean / median) | 2,475 / 1,699 | **3,423 / 3,051** | — | — |
| output tokens incl. thinking, mean | 3,342 | 4,114 (+23% [+2%, +48%]) | 2,697 | **1,796 (−33% [−38%, −29%])** |
| body characters per page | 2,719 | 2,742 (+0.8%) | 2,629 | 2,655 (+1.0%) |
| interpretive tags, share of raw output | 24% (summary 7.7, note 4.7, keywords 3.9, gloss 3.5, term 2.8, meta 1.0) | 2% (printed gloss 1.4, image-desc 0.7) | 38% (note 14.1, summary 8.0, meta 5.2, keywords 5.0, gloss 3.2, term 2.2) | 1.7% |
| median seconds per page | 23 | 24.5 | 24 | 16 |

- **Judge controls:** planted meaning errors located at their span: Opus 9 of 9, 3.8 Flash high 10 of 10.
- **The mechanism, by the judges' own reasons on the pages that move most.** CURRENT moves the page's own printed apparatus or commentary into a `<note>`, or drops it next to its own notes. Examples:
  - a Persian Shahnameh page's critical apparatus;
  - a Hebrew Bible page's apparatus, cut at `---`;
  - Mallinātha's commentary on Kumārasambhava 28–30, omitted by both lanes' CURRENT and translated by both PLAINs.

  With notes hidden, that text is gone from the translation. PLAIN translates it as text. This is where most of the halved omission count comes from.
- **Where PLAIN loses.** An Opus Chinese page lost all 9 printed marginal notes (−2), and an Opus Greek page translated OCR noise as text where CURRENT reconstructed it (−2).
- **Watch item.** 3.8 Flash PLAIN reverses more in Persian: 5 of 23 pages against 1. Pooled reversals are 13 against 11, and CUR2 itself had 7 on 50 pages, so this is not established. But Persian is the one panel where 3.8 Flash PLAIN sits below CURRENT (−0.13).

### By the issue's question

- **Fidelity: PLAIN is not worse in either lane, and is better for Opus.** For 3.8 Flash, +0.11 is about the size of its own A-vs-A (−0.12), so read it as a tie. For Opus, +0.30 is beyond its floor (−0.02), and positive in every language.
- **Invention and omission spans fall in both lanes.** Omission pages fall by half, and model-supplied glosses and added facts fall by 60–90%.
- **Output tokens.** Opus writes 33% fewer, with no thinking split reported. 3.8 Flash writes 20% fewer visible tokens but **thinks 38% more** (median 1,699 → 3,051 thinking tokens), so its total output rises 23%. On the CLI that is subscription quota, not dollars. On a metered lane it would be a cost, so measure it there before any API switch.
- **Did not read:** none in any arm.

### Recommendation

**Switch new translation to PLAIN plus an on-demand notes pass**, with three conditions:
1. **The notes pass has to exist first.** Readers lose the notes, summaries and keywords they have now. Summary and keywords also feed continuity seeds and indexing.
2. **Recheck 3.8 Flash on Persian** (reversals 5 vs 1) before Persian goes to PLAIN on that lane.
3. **Measure thinking-token cost** before using PLAIN on any metered Gemini lane.

This replicates #5919's direction (+0.10 there) on a harder panel, through both CLIs, with the production seed, and with summary, keywords, term and meta removed as well. The OCR side follows in its own issue.

### Threats and limits

- These are AI judges against one published translation, not a scholar. *Measure:* judged against a human reference, not accuracy in the sense of eval-design §2.
- One judge per family, cross-family by design. No second judge on the same items, so there is no inter-judge alpha. The Opus judge's error-catching was measured in #6545 (93% of plants); 3.8 Flash high had not been measured as a judge before this run (10 of 10 plants here).
- The scored body is the reader view with notes hidden. A reader who shows notes would see the apparatus CURRENT put there. The comparison is "the translation as text", which is what search, quotes, exports and embeddings read.
- The body rule was refined after the pilot, before any full judging. A `<gloss>` after `</term>` (a definition) is dropped; other glosses (printed interlinear text) are kept. The 7 pilot judge verdicts made under the earlier rule were discarded.
- **Partial blinding.** A candidate with no `<term>` glosses is recognisable as a different system, though not as which one.
- **n.** 22 to 30 pages per panel, and a floor of 10 pages per panel. Per-panel intervals are about ±0.3.
- *Grade:* moderate. *Replicated?* Partly: same direction as #5919, a different lane and panel.

*Files:* `scripts/eval/results/plain-6728/{scores.json, key-G.json, key-O.json}` (labels → arms and plants; no reference text). The arm texts and judge packets quote published translations and stay on the box (`/mnt/HC_Volume_105839809/jobs/plain-6728/w/`).

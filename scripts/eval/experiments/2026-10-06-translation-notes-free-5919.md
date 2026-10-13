---
stage: translation
measure: judged_vs_reference
languages: []
scripts: []
canons: []
n_books: 40
n_pages: 40
verdict: "Removing the notes instructions from v13 does not lower fidelity (+0.10 [-0.09, 0.29], 40 pages); reversals 1 vs 3 pages, omissions fall, 11% cheaper."
status: undecided
decision: "Default prompt unchanged; note-free translation plus a separate notes step recommended, not decided (#5919)"
superseded_by: null
issue: 5919
---
## 2026-10-06 · Does the translation get worse when the prompt stops asking for notes? (v13 with the notes instructions removed, #5919)
<!-- PRIOR ART: 2026-10-04-translation-prompt-v17-typed-notes-5698.md (PR #5764) typed the notes and tested a stance on the same 40 pages; its runner, mechanical scorer and v13-a/v13-b noise-floor design are reused here. The #5695 fidelity harness (translation-vs-reference/) is used unchanged. Nothing before this removed the notes instructions. -->

**Question.** Prompt v13 asks the model to write notes, definitions after terms and image commentary inside the translation. If those instructions are removed, so that notes can be made in a separate step, is the translation itself less faithful to a human reference? Notes might be the model's working-out.

**Design.** Rule: issue #5919 (P1–P4 and the Decision), fixed before any output existed.
- **Pages.** The pinned #5698 draw: 40 pages from 40 books with a public published English translation (Latin 8, Greek 6, German 2, French 2, Italian 1, Dutch 1, Hebrew 4, Aramaic 1, Arabic 4, Persian 3, Sanskrit 3, Pali 2, Chinese 3), plus 8 gallery-pool pages that never enter a rate. No Tibetan.
- **Arms.** `v13-a` and `v13-b`: the live default row, "Standard Translation" v13 (`51651014`), run twice. `v13-plain`: the same text with seven anchored edits made in memory (hash `655488d8ecd524d7f3139fe9aeec50f5`; no prompt row seeded; full text in `prompt-v13-plain.txt`). Production door, the model each book ships on (12 pages on Lite, 28 on Flash), temperature 1, thinking off, one page per request, no previous-page translation.
- **What plain removes:** `<note>`, definitions in `<gloss>`, "original:" notes, the annotated examples, "warm museum label", and image descriptions rewritten as notes. **Keeps:** `<term>` (undefined), `<margin>`, `<insert>`, `<unclear>`, `<meta>`, summary, keywords, `<gloss>` for a gloss printed in the source, the OCR's `<image-desc>` translated literally. Supplied words go in single [brackets].
- **Instruments.**
  - Fidelity: the #5695 harness, two blind Opus judges, 1–5 against the human reference. `measure`: judged against a human reference, not accuracy. Controls passed for both judges (wrong page 3/3, planted change 3/3 located, duplicate 3/3 tied); weighted κ 0.83, exact agreement 79%, never more than 1 apart.
  - Mechanical: exact string counts (`translation-notes-free/score.mjs`, on `pageScore` from #5698).
- **Spend: $0.454** of a $3 cap (envelope `notes-free-5919`, removed after the run). 144 calls, none failed.

**Result.** **P1 and P2 pass. Removing the notes instructions did not lower fidelity on these 40 pages.**

| per page, 40 pages | v13-a | v13-b | v13-plain | plain − v13-a | v13-b − v13-a (floor) |
|---|---:|---:|---:|---:|---:|
| **fidelity** (1–5), mean [CI] | 3.91 [3.66, 4.15] | 3.94 [3.73, 4.14] | 4.01 [3.76, 4.25] | +0.10 [−0.09, +0.29] | +0.03 [−0.11, +0.16] |
| pages with a reversal, either judge | 3 | 2 | 1 | | |
| pages with an omission (mean of two judges) | 33% | 36% | 15% | −18 points [−31, −5] | +4 [−10, +16] |
| output tokens | 765 | 773 | 692 | −72 [−110, −38] | +9 [−23, +39] |
| cost | $0.00318 | $0.00320 | $0.00284 | −11% | +1% |
| `<note>` | 3.1 | 3.7 | 0 | | |
| `<gloss>` | 3.0 | 3.0 | 0.8 (all printed in the source) | | |
| single [brackets] | 0.1 | 0.2 | 1.1 | | |

- **P1 fidelity: passes.** The rule allows plain to sit at most max(|v13-b − v13-a|, 0.15) = 0.15 below v13-a, with the paired CI lower bound above −0.30. Plain is 0.10 above v13-a; the lower bound is −0.09. Each judge alone gives the same +0.10. This is non-inferiority, not a gain: the CI includes 0.
- **P2 reversals: passes.** Plain 1 page, v13-a 3 (allowed: 4). The one plain reversal is a Hebrew page that v13-a also reverses. Both v13 runs reverse a Sanskrit and an Arabic page that plain gets right.
- **P3 cost: 11% cheaper**, at the low end of the expected 10–30%. Output tokens fall 9%; the prompt is 315 tokens shorter. Lite $0.00145 → $0.00133 per page, Flash $0.00392 → $0.00349 (realtime prices).
- **P4 leakage.**
  - `<note>` in plain: **0** on 40 pages (v13-a: 125 on 35 pages).
  - `<gloss>` in plain: 33 on 2 pages, all of them glosses printed on the page (30 worked figures in a Sanskrit arithmetic commentary; 3 Targum paraphrases on a Hebrew page). No definition of the model's own in a `<gloss>`.
  - **Definitions moved into brackets:** 43 single brackets on 12 pages. 30 are supplied words, as asked ("**Rabbi Isaac** [said]:", "three kinds [of beings]"). **13 are a definition after a term** ("`<term>Tamim</term>` [perfect]", "`<term>PRAESEPE</term>` [the Manger]"), on 3 pages (read by eye; the `brackets_gloss` regex counts 14, one of them a supplied verb after a name). The prompt forbids this and the model does it anyway on about 1 page in 13.
  - Parenthetical glosses: 15 (v13-a 7, v13-b 14). Inside the v13 range.
  - Loops and MAX_TOKENS: 0 in every arm. Invented tags: 0.
  - **Body length: the check as written is not met.** Summed over the 40 pages plain is 3.8% shorter than v13-a (3.2% with glosses and image descriptions removed from every arm alike); the two v13 runs differ by 0.0%. Two pages make the whole gap. Without them plain is 0.99 of v13-a. Per page the mean gap is −0.7% (CI −7 to +8), inside the v13-b spread.
    - Latin, Hobbes p. 135 (Lite): plain wrote the page's first paragraph inside `<meta>continues from previous page: …</meta>`, which the reader hides. The words are translated but would not be shown. v13-a did the same on a French page (829 characters in `<meta>`), so this is a v13 defect and not one plain adds.
    - Persian, Masnavi p. 257 (Flash): plain dropped most of the Ottoman Turkish column. v13-b dropped a fifth of the same page. Both judges marked an omission in all three arms; plain scored 2.5 against 3 and 3.
  - The judges found fewer omissions in plain, not more (15% of pages against 33%). So the shorter total is not silent omission across the sample.
- **By model (exploratory, not in the rule).** Flash, 28 pages: 3.61 → 3.86 (+0.25, CI +0.05 to +0.45). Lite, 12 pages: 4.63 → 4.38 (−0.25, CI −0.58 to +0.08), and v13-b on Lite is also 4.38. Latin, 8 pages, 7 on Lite: 4.56 / 4.25 / 4.06. The Lite fall is the size of v13's own run-to-run gap on Lite and n is 12. It is the place to look first if the default is ever switched.
- **Invention by kind (judges).** Pages carrying an `added_fact`: 88% (v13-a), 95% (v13-b), 17% (plain). The remaining 17% are facts in the summary or a heading. `unreadable_fill` (fabrication over garble): 26% / 19% / 20%, unchanged.

**By the preregistered rule.** P1 and P2 pass → recommend note-free translation plus a separate, on-demand notes step, and file a design issue for that step. The default prompt is not changed by this test.

**As executed (deviations).**
- Edit 3 kept the second half of the sentence it deletes ("The main text must be fully readable in English without knowing other languages."), which is not about notes.
- The heading "Writing style for summaries and notes" was left as it is; the brief listed seven edits and this was not one.
- The instruction list was renumbered after the deletions (1–8).
- 16 packet chunks were judged by 8 subagents (2 gate, 6 main), each given two or three chunk files in turn, to stay inside the job's limit of 8 subagents. The judge prompt is unchanged.
- Blinding is partial by nature: a candidate with no notes is recognisable as a different system, though not as which one.
- `brackets_gloss`, `meta_chars` and the translation-only length were added to the mechanical scorer after the outputs were seen, to explain the bracket and length counts. They are reported, not part of a rule.

**Replicated?** No. One run, 40 pages, one draw per arm. The +0.10 is inside what a second v13 run moves by. #5698 found the same direction with a different lever: its study stance omitted less (6% against 26%).

**What it means.**
1. Notes are not the model's working-out, as far as two judges can see on 40 pages. The translation can be asked for alone.
2. A note-free prompt does not make note-free text by itself. Definitions come back in brackets on some pages, and the write guard (#5902) still has to catch them: a `[…]` straight after `</term>` is a definition, not a supplied word.
3. Text hidden inside `<meta>` is a separate defect present in v13 today (1 page in 40 in two of three arms). It deserves its own detector.
4. Before any switch of the default: a Lite-only confirmation (the 12-page fall here is not established either way), and the notes step has to exist first, or readers lose the notes they have now.

**Artifact.**
- `scripts/eval/translation-notes-free/` (`run-arms.mjs`, `score.mjs`)
- `scripts/eval/results/translation-notes-free-2026-10/`: `prompt-v13-plain.txt`, `arms.jsonl`, `records.jsonl`, `mechanical.json`, `results-fidelity.json`, `fidelity-verdicts-j{1,2}.jsonl`, `fidelity-key.json`, `results.json`

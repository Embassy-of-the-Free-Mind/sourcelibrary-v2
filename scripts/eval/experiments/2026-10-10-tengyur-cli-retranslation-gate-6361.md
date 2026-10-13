---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: 7
n_pages: 21
verdict: "Gemini 3.8 Flash via the CLI had half the stored English's serious errors on 21 pages read against the image (7 vs 14; reversals 2 vs 5), but two of seven volumes had a serious error the stored English lacks, so the preregistered gate stopped the apply. 23% of 'staged' replies were plan-mode chatter, not translations."
status: adopted
decision: "Derek waived the per-volume stop rule 2026-10-10; the 17,135 gate-passing pages were applied with provenance (scripts/maintenance/tengyur-cli-6361/apply.mjs, #6361)"
superseded_by: null
issue: [6361, 6182, 6321, 6174]
---
PRIOR ART: 2026-10-08 and 2026-10-09 #6182/#6321 entries (the reference judging that motivated the run); this entry is the stage-2 gate of the production run itself, not a new comparison design.

## 2026-10-10 · Is the CLI re-translation of the Tengyur Pramāṇa + Madhyamaka volumes safe to write over the stored English?

**Design.** Stage 1 (#6361) sent 23,629 pages of 37 Derge Tengyur volumes through `agy -p --model gemini-3.8-flash-low
--mode plan` with the production v13 one-page prompt; 22,636 came back as "staged", 993 failed (991 denied tool, 1
error, 1 safety filter). Stage 2 gates, in order: integrity of the run files (`scripts/maintenance/tengyur-cli-6361/integrity.mjs`),
per-volume detectors and length ratio (`gates.mjs`), then a blind by-eye read (method `retranslation-gate` v1): 5
volumes drawn with seed 6361 plus the 2 volumes with the most extreme staged/stored length ratio (174 high, 112 low),
3 consecutive gate-passing pages each, one Opus reviewer per volume, with the page image (whole + three 2× crops), the
OCR, and the stored and staged English as A/B in random order. The contract's stop rule: two or more volumes with a
serious meaning error that the stored English does not have.

**Result.**
- Integrity: 0 problems. Every manifest row has its files and its sha256s match; no page staged twice; 993 failures,
  each with 3 recorded attempts and a class. Run directory copied to R2 `sl-corpus-snapshots/runs/tengyur-cli-6361/`
  (58,062 objects, `rclone check`: 0 differences).
- **Plan-mode replies.** 5,457 of the 22,636 staged replies (24%) are not translations: the CLI answers "Please review
  the implementation plan in [translation_plan.md](file:///root/.gemini/…)", sometimes followed by part of the page.
  Stage 1's classifier counted them as successes. `cliChatterReason` catches 5,285 (those that open with "I have…");
  **125 would pass both `cliChatterReason` and the write door**, so `scripts/batch/cli-translate.mjs apply` would have
  written them to pages. Plus 38 reasoning leaks, 116 door refusals (62 runaway, 54 collapsed), 3 stray script. In all,
  6,494 pages (27%) are not applicable; 17,135 pass every gate.
- Length ratio: all 37 volumes pass (staged median of the passing pages inside the stored p5–p95). With the plan-mode
  replies left in, the ratio looked inflated, which is how they were found.
- By eye, 21 pages: serious errors **staged 7, stored 14**; reversed claims **staged 2, stored 5**; staged better on 8
  pages, stored better on 1, the same on 12. Staged clean on all pages of vols 101, 112, 174 and 175. But **vol 193**
  (pp. 204–205: a probans/probandum role reversed, a term and a fallacy label misread) and **vol 183** (p. 319: a
  negation added, "lacks invariable absence" for བསྒྲུབ་བྱ་མེད་ན་མེད་པ; p. 318: the shared-cause point dropped) have serious
  errors the stored English does not have. That is two volumes, so **the gate stops the apply**. By the same rule the
  stored English has serious errors the staged one lacks in six of the seven volumes.

**Replicated?** No. One reviewer per volume, 3 pages per volume; AI reviewers, no Tibetanist.

**Artifacts.** `scripts/maintenance/tengyur-cli-6361/results/` (integrity.json, gates.json, not-applicable.tsv,
byeye/ with the draw, the brief, the seven reviews, the blind key and the unblinded tally); the raw run on R2 as above.

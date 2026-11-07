---
id: judged-pages
version: 1
stage: [ocr]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [7896, 7866, 6740]
status: active
---
<!-- PRIOR ART: served-audit.md and shelf-overview.md are reviewer runs with their own briefs (REVIEWER.md); this one
is the route-judge-6740 `judgePrompt` that eval and router runs already use, recorded per book when the text it judged
is the text readers see. -->
## judged-pages v1 — what the route judge said about the stored text of a book's pages

**What it is for.** Eval and router runs (#6740, #7866) judge thousands of pages against their images with one
frozen prompt and keep every verdict in `lane_judge_verdicts`. When the text a verdict judged is still the page's
text, that verdict describes what a reader sees, and the book's checks page should carry it, including the judge's
words.

**Sampling.** Whatever the source run drew; the row's `frame` names the run, its lane and its stratum when it had one.
`kind: item` rows only. Controls (`planted`, `wrong_page`) and drafts are never recorded. A verdict is used only when
its judged text equals the page's current OCR: `write.text_sha` (sha256 of the trimmed text, first 16 hex) or
`write.text_hash` (`contentHash`, page-text-writer) matches the live text. A candidate read that was never written,
or a page rewritten since, is skipped.

**Reader and input.** `claude -p --model opus` (the verdict's `judge.model_reported`) with the route-judge `judgePrompt`
(`judge.prompt_sha`), the page image in the workspace. Reader in the row: `{kind: model, model, image_opened: true}`.

**Serious.** A page is serious when the judge's fidelity is **≤ 3** (of 5). By eye on #7866 (13 rejected pages
opened, comment 6557302184), fidelity 4 was "one word or symbol wrong, the rest clean", and ≤ 3 was "a reader is
misled more than once on the page". A serious page's `misleads` and `wrong_text` defects become its `page_findings`
errors (stage `ocr`, the taxonomy class, the judge's sentence as `problem`). A page with an `I1` defect is
`wrong_page`.

**Qualitative record.** Every page read, clean or not, gets a `page_notes` entry: the judge's `reader_note`, its
fidelity and accept, and every defect (quoted text, class, severity, what is wrong). The checks page shows these
sentences when the evidence file is public.

**Verdict.** `fix` if any page read has fidelity ≤ 2, `caveat` if any has ≤ 3, else `show` (`verdict_source:
rule`).

**Known blind spots.** One reader, one read per page. Accept agreement with a second family is modest (Gemini 3.8 Flash,
κ 0.34 on #7866). Class labels are unstable across reads. The judge prompt was tuned to rank routes, so it is strict:
a single slip is enough to refuse acceptance, which is why "serious" here is fidelity, not accept. Transcription only:
the English is not judged.

**Rows written by** `scripts/maintenance/judge-verdicts-to-book-checks.mjs`, one row per book per source run.
Evidence: `scripts/eval/results/judged-pages/<run_id>.json`.

**Versions.** v1 — 2026-11-01 (#7896).

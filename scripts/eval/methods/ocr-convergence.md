---
id: ocr-convergence
version: 1
stage: [ocr]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [6420, 6174]
status: active
---
<!-- PRIOR ART: refusal-empty.md (a detector row) and shelf-overview.md (Opus reads every page). This instrument is
two OCR reads of different families compared, with Opus reading the image only where they disagree. -->
## ocr-convergence v1 — the stored OCR against a Gemini CLI second read, Opus on disagreement (#6420 lane B)

**Sampling.** `scripts/batch/ocr-convergence/driver.mjs`: books ranked by distinct (ip, day) page views in
`analytics_pageviews` (60 days), six language groups; per book the pages readers open most, filled to 10 with a seeded
spread. Design and threshold: `scripts/eval/PREREGISTRATION-ocr-convergence-6420.md`.

**Reader and input.** A second transcription by `gemini-3.7-flash-low` (agy CLI, plan mode, the image attached),
compared with the stored text by normalised CER. Below the preregistered threshold T the two families agree and that
is the verdict for the page. At or above T, Opus (Claude subscription, sealed `claude -p`, brief
`scripts/batch/ocr-convergence/ADJUDICATOR.md` v1) reads the image against both texts, blind to which is served.
`reader.model` is the second reader; the role string names the adjudicator. `image_opened: true` (both readers see it).

**Serious.** As ADJUDICATOR.md: a dropped passage/line/column, invented or other-leaf text, a model reply in place of
the page, a sense-changing wrong word, name or number, an unusable garbled stretch.

**Verdict.** `fix`: at least one page was contained (cannot tell, or both reads wrong). `caveat`: no containment, but
a page still carries a serious stored misreading (residual, deferred, or kept with a serious finding). `show`: every
page read agreed, was kept, or was repaired by a write. `page_findings` lists the pages behind caveat/fix.

**Known blind spots.** Two reads that make the SAME error agree and pass (correlated families still share failure
modes on faint or gothic print). Pages under 200 chars, illustrations and covers are not read. A check is stale by
construction once the page's OCR changes (text_provenance).

**Who writes rows.** `driver.mjs apply --apply`, one row per book per set, run id `convergent-ocr-6420-<set>-<run>`.

### Versions
- v1 (2026-10-10): first version.

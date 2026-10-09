---
id: monthly-corpus-audit
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: false
verdict_scale: [show, caveat, fix]
issue: [5274, 5301, 6174]
status: active
---
<!-- PRIOR ART: scripts/eval/translation-corpus-audit/MONTHLY.md (how to run it) and
scripts/eval/experiments/_series-monthly-translation-corpus-audit.md (the rate series). This file is the instrument's
description for book_checks rows. -->
## monthly-corpus-audit v1 — does the served translation defect rate move, month to month?

**Sampling.** ~100 books a month, **one interior page each**, 15 languages, post-stratified by live translated pages,
fresh seed each month; page ends and non-text pages excluded. 45 blinded controls (swap / drop / repeat) per month; a
month whose controls fail gets no row.

**Reader and input.** An Opus subagent judge (`JUDGE-PROMPT.md`), **text only: no page image**. It reads the
transcription and the English. Reader in a row: `{kind: model, model: opus, image_opened: false}`.

**Serious.** The judge's "major" error: omission, invention, garble that changes what the page says (≥ 4 / ≤ 2 on the
1–5 fidelity score). It cannot see a wrong leaf or a misread transcription, because it never sees the image.

**Verdict.** Per page: fidelity ≥ 4 and no major error → **show**; a major error → **fix**; otherwise **caveat**
(`verdict_source: derived:monthly-v1`).

**Known blind spots.** Text only: transcription errors, wrong leaves and invented text that the English renders
faithfully are invisible. One page per book. Its 14.3% "any major" (2026-09) is not comparable with the image-read
methods' serious-page rates.

**Rows.** No backfill yet: the monthly runs' per-page verdicts are in `scripts/eval/translation-corpus-audit/` runs,
not in the spot-check results this first backfill reads. A later backfill or the routine itself can write them.

**Versions.** v1 — 2026-09-30 baseline design (#5301).

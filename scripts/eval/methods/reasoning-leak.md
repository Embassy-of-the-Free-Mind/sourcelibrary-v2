---
id: reasoning-leak
version: 1
stage: [translation]
measure: detector
reader: detector
image_opened: false
verdict_scale: [fix]
issue: [6056, 5918, 6117, 6174]
status: active
---
<!-- PRIOR ART: scripts/audit/translation-reasoning-leak.mjs is the detector and `translationReasoningLeak()` in
scripts/lib/page-integrity.mjs its rule; scripts/eval/experiments/2026-10-06-translation-reasoning-leak-6056.md the
measurement. This file is the instrument's description for book_checks rows. -->
## reasoning-leak v1 — pages whose stored English is the model's own reasoning or a chat reply

**Sampling.** None: `translation-reasoning-leak.mjs walk` reads **every** `pages` record (28.97M on 2026-10-06) with a
wide server-side prefilter, then `report` applies the rule to the candidates.

**Reader and input.** Model-free phrase rules over `translation.data`; never the image, never the OCR. Reader in a row:
`{kind: detector, role: translation-reasoning-leak, image_opened: false}`.

**Serious.** The headline kinds: *reasoning* (the scratchpad: "Wait, the prompt says", `*Constraints:*`…) or
*assistant-reply* (a chat reply to the requester), in the page body — not only inside a `<meta>`, `<summary>`,
`<keywords>` or `<vocab>` block — on a live book at `page_number > 0`. Taxonomy O15's translation twin. The milder
*input-talk* and *thought-token* kinds are counted but are not the headline.

**Verdict.** **fix** only, for a book with ≥ 1 headline page; `pages_read` = the hit pages. A book with no hit gets no
row: the walk proves the absence of these phrases, not that the English is sound.

**Known blind spots.** The count is a floor: the rule is a list of phrases read off real hits, and a leak worded
another way is missed. Bare first-person lines ("I will translate…") are excluded on purpose (sermons and prefaces say
them). 549 pages / 269 books on 2026-10-06.

**Rows.** Not backfilled yet: `pages.jsonl` of the 2026-10-06 run is the source if a later backfill wants them.

**Versions.** v1 — 2026-10-06: the rule as merged with the experiment entry above.

---
stage: translation
measure: agreement
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: 37
n_pages: 40
verdict: "Re-read with the stage-1 call plus one nudge in the same conversation, 6,492 of the 6,494 not-applicable Tengyur pages passed the stage-2 gates and were applied (3,324 through the nudge). On 40 applied pages, two blind readers from different families (Opus; Gemini 3.7 Flash) each found fewer serious-error pages in the new English than in the old (Opus 3 vs 6, Gemini 3 vs 11 of 40). After Opus adjudicated the 8 split pages against the image, the new English was preferred on 35, the old on 4, and 1 was a tie. Both readers preferred the old on 2 of 40 (5%; stop line 10%), and those 2 pages got the old English back."
status: adopted
decision: "Applied (Derek, 2026-10-10, #6420: convergent AI check in place of a human read for a month)."
superseded_by: null
issue: [6361, 6420]
---
PRIOR ART: 2026-10-10-tengyur-cli-plan-mode-rerun-6361.md (the 100-page test that showed failure is per call, and that a prompt change fixes it but cuts thinking); 2026-10-10-tengyur-cli-retranslation-gate-6361.md (the gates and the 21-page by-eye read). This entry is the full re-read those two led to, and the first convergent two-reader check under #6420.

## 2026-10-11 · Re-reading the 6,494 not-applicable Tengyur pages with a one-turn nudge, checked by two blind readers

**What Derek decided (2026-10-10, #6420).** The 6,494 not-applicable pages are not left on the stored English. They are
re-read with the same model and prompt as stage 1. When the reply is a plan note, that conversation is continued once with
"Do not write a plan. Output the English translation of the attached page now, exactly as instructed above." The pages then
go through the same gates as stage 2. The check that stands in for a human read this month is two independent readers on a
stratified sample of 40 applied pages, with a stop if both prefer the old English on more than 10%.

**Re-read** (`scripts/maintenance/tengyur-cli-6361/reread/driver.mjs`, 2026-10-10 17:00 → 2026-10-11 02:52 UTC, $0):
`agy` 1.3.3, `gemini-3.8-flash-low`, the stage-1 prompt file sent verbatim (sha256 checked against `pages.jsonl`),
`--mode plan --print-timeout 180s --output-format json`, empty cwd, 4 at a time, never `--dangerously-skip-permissions`.
A reply that was a plan note, empty, or a denied tool got one nudge in the same conversation. The same nudge text was used
for denied-tool replies; TAKEN, since the brief's text fits both cases. Each page got up to 2 fresh calls, each with its own
nudge. The driver refused, in-loop, anything the hardened `cliChatterReason` (#6412), the gates' plan-mode regex or the
headline reasoning-leak rule flags.
- **6,492 of 6,494 accepted**: 3,164 on the first call, 3,324 through a nudge (3,323 accepted on the nudge turn itself).
  2 failed and stay on the stored English: vol 96 p.24 (the recitation filter, twice) and vol 112 p.269 (chatter after the
  nudge, twice).
- 9,843 calls: fresh 3,169 ok, 2,892 denied tool, 438 plan note; nudge 3,323 ok and 7 failed. No quota window was hit.
- **Thinking.** 3,201 accepted replies (49%) used 0 thinking tokens; 1,674 of them came through a nudge. The median is 460.
  Stage 1's applied pages had 35% at zero. The 40-page check below covers this population: 4 of its 10 re-read slots were
  nudged.

**Gates and apply** (`reread/apply.mjs`): stage 2's per-page predicates line for line, plus the per-volume length-ratio gate
against the stored English's p5–p95. 6,492 pages pass, and all 37 volumes pass the ratio gate. Checked before each write:
the prompt, response and OCR sha256 against the manifests, and the stored English against stage 2's snapshot. 13 pages
differed from the snapshot only by the deterministic markup cleanup of the OLD English (`cleanup-markup-5700`,
2026-10-10 16:52, no model). That one revision source was accepted, and any other change would have refused the page.
**Written: 6,492, skipped 0.** Each write went through `writePageTranslation` (human-edit guard, health gate,
`page_revisions` snapshot under `job_id: tengyur-cli-6361-reread`, 6,492 rows), with `engine.api: cli`, `cli: agy 1.3.3`,
`run.nudged`, `run.accepted_by_nudge`, `run.nudge {text, sha256}`, `run.stage1_reason`, conversation id and the three
sha256s. Each page also got a `sweep_log` row; each book got a `book_events` row and a recount.

**Convergent check** (`convergent/`). 40 slots, drawn before any read (seed 6420): one page in each of the 37 volumes, plus a
second page in 3 volumes. 10 slots were drawn from the re-read set and 30 from the 17,135 stage-2 pages. Each page was drawn
uniformly within its volume among pages with ≥300 OCR characters, excluding the step-3 by-eye pages. A packet holds the image,
three overlapping 2× crops, the OCR, and the new and old English as A/B in random order (key in `results/key.json`). Readers,
both blind: **(a)** Opus, as subscription subagents; **(b)** `gemini-3.7-flash-high` through `agy -p` (plan mode, images
attached with `@./`; every call needed one "reply with the JSON" nudge). Brief: the frozen `scripts/eval/spot-check/REVIEWER.md`
plus `convergent/ADDENDUM.md` (per-version scores and errors, `reversal` on serious errors, `prefer`). The 8 pages where the
readers' preference differed were adjudicated by an Opus subagent against the image (`ADJUDICATOR.md`), with the two reviews
labelled reviewer1/2 in random order.

| reader (n = 40) | serious-error pages: new | old | reversal pages: new | old | prefers new / old / same | mean fidelity, new / old |
|---|---|---|---|---|---|---|
| Opus | 3 (8%, CI 3–20%) | 6 (15%, 7–29%) | 3 (8%, 3–20%) | 6 (15%, 7–29%) | 31 / 6 / 3 | 4.13 / 3.58 |
| Gemini 3.7 Flash | 3 (8%, 3–20%) | 11 (28%, 16–43%) | 1 (3%, 0–13%) | 10 (25%, 14–40%) | 36 / 3 / 1 | 4.75 / 3.78 |

Wilson 95% intervals. Agreement on the preference was 80% (κ 0.31); on a serious error in the new English, 95% (κ 0.64); on a
serious error in the old, 78% (κ 0.34). Each subset on its own: stage-1 pages (n = 30) final 25 new / 4 old / 1 same;
re-read pages (n = 10) final 10 new / 0 old, all 4 nudged slots preferred new with no serious error from either reader.
**Final preference after adjudication: new 35, old 4, same 1.** Of the 4 adjudicated serious claims against the new English
(s11, s19), the adjudicator confirmed none. The two pages below are the only serious errors in the new English that both
readers confirmed.

**Both readers prefer the old English on 2/40 (5%): below the stop line, so the apply stood.** Both pages got the old English
back (`convergent/restore-old.mjs`, door write, `page_revisions` snapshot, `job_id: tengyur-cli-6361-convergent`):
- vol 183 p.543: the new English renders the ablative ("validity is not conceived *from* inference") as "apart from inference",
  which reverses the claim. Both readers raised it independently.
- vol 185 p.168: the new English translates the OCR's misread འབྲང་བ ("follow") where the print has འགྲེང་བ ("upright"); the old
  English reads past it. Both versions also carry an OCR-inserted negation in the opening clause, which Opus flagged. That is
  an OCR-lane error and was not repaired here.

**Limits.** AI readers only, 40 pages, one page per volume. The Gemini reader belongs to the family that wrote both English
versions (new: 3.8 Flash; old: 3 Flash preview), and it is the more favourable reader of the new English (36 vs 31 pages
preferred). Opus, from another family, still prefers the new English on 31 of 40 pages. Chance-corrected agreement on the
preference is low (κ 0.31), because both readers say "new" most of the time. No Tibetanist read any of this. The #6321 closing
measure on the 113 reference sides (contract step 5) is still not done.

Files: `scripts/maintenance/tengyur-cli-6361/{reread,convergent}/` (scripts and `results/`: summary, gates, the 2 not-applicable
pages, slots, key, every review and adjudication, and the scores). The raw re-read (every agy JSON, manifest, calls) and the
packets are on R2 at `sl-corpus-snapshots/runs/tengyur-cli-6361/item3/{reread,reread-apply,convergent}/` (16,820 files,
`rclone check` found 0 differences; manifest sha256 `0bcf8222…`, apply log `c4f4de62…`).

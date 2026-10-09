## 2026-10-03 · Does moving the `own-text` continuity-meta payload into the body put the page's own text back? (#5376 tq11 pilot)

**Question.** On the ~10,160 live pages the scan classes `own-text`, does the $0 move
(`moveContinuityPayload`, re-classified live before each write) show the reader this page's own text?

**Design.** `scripts/maintenance/move-hidden-meta-own-text.mjs --apply --pilot=20`: one page from each of
20 books, seeded, stratified by severity (whole / half / part / opening). Each page was read by eye
against its page image (and against the Archive scan where the R2 image is a leaf off), and the rendered
page was checked for the moved text. Bar set in the job brief: 19/20 right.

**Result.** 18/20 right. On the 2 misses the payload is the page's own text with a lead-in from the
previous page in front of it: on #4 (Kircher p451) ~70 words of p450, retranslated; on #19 one sentence
paraphrasing p13. Neither is invented. **Under the bar, so the full apply was NOT run.** The 20 pilot writes
stay in place (revision rows saved; rollback dry run: 20/20 restorable). The full read-only dry run counts
9,582 pages still eligible. A $0 head signal (`headInPrev`, the first 40 payload words found in the previous
page's translation) catches #4's shape (1.0), not #19's (0.18). It is ≥ 0.6 on 103 eligible pages and
0.3–0.6 on 492.

**Replicated?** No. n = 20; the miss rate (10%, 95% CI ≈ 1–32%) is too wide to say more than "lead-ins exist".

**Decision needed.** (a) apply the 9,582 remaining as-is; (b) apply only where headInPrev < 0.3 (≈ 8,990
pages) and hold the rest; (c) do (b) after a second 20-page pilot under that filter. Recommended: (c).

Artifact: `scripts/eval/results/hidden-meta-repair-plan-2026-10-01/pilot-2026-10-03.md` (+ `pilot-2026-10-03-applied.jsonl`).

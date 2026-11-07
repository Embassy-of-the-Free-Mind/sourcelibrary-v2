# #7701 arm c refused reads — decision rule, fixed 2026-11-04 before any judge call (job armc-refused-judge-7701)

**Question.** Arm C (PERO GPU draft, agy Flash-low with the image, #7695 put-back) refused most pages it tried, and its
ledger never retries them. Are the refused Flash reads good text thrown away, or errors rightly caught?

**Frame.** A snapshot of `/root/jobs/armc-first-read-7701/armc-ledger.jsonl`. A page is in the frame when it has a ledger
row in a stratum, has no OCR in Mongo now, and has a usable kept read: exit 0, no error class, no wrapper error, non-empty
text. Strata:
- `la-armc-refused-share`: "only N% of its words are in the GPU draft".
- `la-armc-refused-putback`: outcome `put_back_unsafe`, both of its reasons (not like-for-like, spans a tag).

**Draw.** Each stratum's frame is sorted by sha256(`armc-refused-7701:<page_id>`) and walked. A page is taken unless its book
has been taken already, in either stratum, so no book gives two pages. The share stratum walks first. The walk is
page-weighted because the decision is about pages. There is no interior filter: the decision covers every refused page,
front matter included. A page the route cannot write (dry apply) is passed over and counted. Target 15 + 15; if books run
short, the shorter n is reported.

**The route judged.** `pero>agy-flash-low-kept`: the exact text `cli-ocr.mjs apply --print-only` would write from the kept
read, by a dry run. That is the apply path without the opt-in `--diff-guard=gpu-draft` (the flag that refused these pages):
no put-back, no shared-words floor. Every other guard of the path still runs. No new read and no agy call.

**Judge.** Opus (`claude -p`), route-judge-6740 `judgePrompt`, called unchanged by `judge.mjs judge --concurrency=1`, against
the page image fetched from its source. One output per call, hashed ids, shuffled. The judge sees the image and the read,
never the draft or the refusal reason.

**Controls.** Per stratum, two WRONG-PAGE items (this image, another book's read from the stratum): passes when both are
refused with fidelity <= 2. Per stratum, two PLANTED items (an accepted read, else the highest-fidelity one, one error from
plant-ocr-errors.mjs, kinds B-E), judged after the first pass: caught when refused or when a defect names the plant. A
stratum whose wrong-page control fails, or whose two plants are both missed, is void and takes the re-read route.

**Decision, per stratum.** Over the judged pages, k accepted of n, wrong text = a page with any defect of severity
`wrong_text`, accepted or not:
- P(accept >= 0.8) >= 0.8 under Beta(1 + k, 1 + n - k), with 0 wrong-text pages: the route is **apply the kept read**.
- Otherwise: **re-read with read@4**.

This does not change after seeing results. By-eye reading (at least 5 accepted, 5 rejected) is reported beside the rule's
result and does not move it.

**Writes.** The pages the judge accepts with no `wrong_text` defect, through `cli-ocr.mjs apply --only --print-only --apply`
(existing path, no new override, revisions, first reads only: refused if the page has OCR by then; holds untouched), stamped
with the read's own lane. Nothing beyond the 30 drawn pages. The lane stays paused.

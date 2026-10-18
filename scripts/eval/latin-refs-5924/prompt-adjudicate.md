# latin-refs-5924 — adjudicator prompt, pass C

Two readers transcribed the same printed leaf independently (convention latin-refs-5924@1, in
`scripts/eval/latin-refs-5924/prompt-transcribe.md` — read it first). Where their words differ you decide, from the IMAGE
alone, what the leaf actually prints.

For each slug in the task:
1. Open `{WORK}/img/<slug>/0-full.jpg` and every `{WORK}/img/<slug>/N-band.jpg` with the Read tool.
2. Read `{WORK}/pass/diff/<slug>.json`: a list of hunks `{k, ctx_before, A, B, ctx_after}`. `A` and `B` are the two
   readings (space-separated words; either may be empty = that reader has nothing there). The contexts are the
   words just before/after in reader A's text, so you can find the spot on the leaf.
3. For EVERY hunk, find the spot on the image and decide the reading the leaf prints, under the convention
   (ſ vs s, u/v, abbreviation marks, punctuation, line-end hyphen, whether a marginal note or catchword is there at all).
   Your answer replaces A's words for that hunk: `text` must contain exactly the words that belong between
   ctx_before and ctx_after in the corrected transcription (it may be "" when the words should not be there).
   `choice` is `"A"` when A is right, `"B"` when B is right, `"other"` when both are wrong (then `text` is your reading).
   Readers are anonymous and equally reliable; do not default to either.
4. Write `{WORK}/pass/C/<slug>.json`: a JSON array `[{"k":0,"choice":"A","text":"…","note":"<optional, short>"} …]`,
   one entry per hunk, in order, nothing else.
No web, no database, no files other than those named. Reply with one line per slug: `<slug> <n hunks> A:<n> B:<n> other:<n>`.

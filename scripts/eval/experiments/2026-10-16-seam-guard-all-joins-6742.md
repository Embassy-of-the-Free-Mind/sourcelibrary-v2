---
stage: translation
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 21
n_pages: 879
verdict: "Two $0 dry runs. A write-time seam guard replayed over a fresh 39-page CLI translation checked 34 joins with 35 agy calls, 0 lockouts and 0 errors, and would have repaired 3. Every-join mode on the 20 most-read books found 46% of sampled prose joins defective, 88% of them outside the rule tranche; it would write 22% of joins, with the blind Opus sample at 19/20."
status: undecided
decision: null
superseded_by: null
issue: 6742
---
## 2026-10-16 · A write-time seam guard, and sending every join of the most-read books to the repairer: dry runs (#6742)

PRIOR ART: `2026-10-16-seam-repair-lean-6742.md`. Its single-join Gemini repair, tight windows, `lostWords` guard,
blind 7% Opus sample and `writeRepairs` are reused unchanged. `2026-10-16-seam-prompt-candidate-6742.md` showed that
a prompt line does not cut join defects on the production lane. So prevention has to check the join after the write.

**Who this is for.** Readers of the books people actually open, and of every newly translated page.

### B. The write-time guard (`guard.mjs`, `SEAM_GUARD=dry|apply`, default OFF)

How it works:
- After `writePageTranslation` commits a page, it checks the join before the page and the join after it.
- It checks a join only when the neighbour holds an eligible machine translation that is not marked stale.
- Each join gets lean.mjs's single-join repair: Gemini 3.8 Flash low via agy, tight windows.
- A repair is accepted when it places at the edge and loses ≤ 3 content words.
- An accepted repair is written through `writeRepairs` (label `seam-repair-6742`, manifest, undo).

What keeps it from breaking the write:
- It runs after the commit, so it never blocks or undoes the translation write.
- It is bounded at 8 minutes.
- It catches every error, and it fails open on an agy lockout or a quota reply.
- It skips its own writes (note `seam-repair-6742`).

**Dry replay ($0).** This job may not write, so a finished run was replayed instead. The book was *Platicas de los
principales mysterios de nuestra Sta. Fee* (Yucatec Maya, live). Its 39 pages were translated by `cli-translate.mjs`
on 2026-10-16. The replay took them in write order, each as if just written, and hid neighbours written later.

| pages | joins checked | agy calls | labelled ok | accepted | would write | refused at the stored text | lockouts | errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 39 | 34 | 35 | 30 | 4 | 3 joins (3 pages) | 1 (edit touches markup) | 0 | 0 |

- 5 pages had no join to check: front matter with no prose join, or a neighbour not yet written.
- The 4 accepted repairs all target the old foot shape. Three remove "…" from page N's last words and end the page
  mid-sentence, e.g. ", which wise scholars cannot fathom..." → ", nor are wise scholars able". The fourth removes a
  catchword-like "girl," from the head of N+1. They were not judged; the source language was not checked by eye.
- **Cost to the writer:** median 25 s per checked join and 41 s per page on average. Two calls hit agy's 300 s
  print timeout (306 s, 340 s), and the 8-minute bound covers that. With the flag on, a CLI writer's page rate drops
  by about half.

### C. Every join of the most-read books (`lean.mjs --all-joins --top-books=N`)

The rule tranche found 16 of 35 Opus-defective joins on #6742's random stratum. The new flags change what is sent:
- `--all-joins` sends every eligible prose join of the N most-read books to Gemini, which labels "ok" itself.
- `--per-book=K` takes a seeded sample per book. `--skip-manifest` skips joins another run has written.
- Completion is per mode: a book walked in tranche mode is not done for every-join mode.

**Dry run ($0, no writes).**
- Top 20 books by distinct (ip, day) readers over 60 days, 567 down to 255 views.
- 25 seeded joins per book: 477 drawn, 420 prose.
- The lean runner's own gates, unchanged.

| | joins | Gemini: defective | major | placed | Opus sample preferred both orders | would write |
|---|---:|---:|---:|---:|---:|---:|
| all sampled prose joins | 420 | 192 (46%) | 79 | 140 (33%) | 19/20 (A/A tie) | **92 joins (22%), 144 pages** |
| in the rule tranche | 30 | 23 (77%) | 5 | | | |
| outside the tranche | 390 | 169 (43%) | 74 | | | |

- Labels: broken syntax 70, catchword 44, omission 26, other 23, duplication 22, drift 7.
- Refused at placement:
  - 228 labelled ok, 18 no repair;
  - 21 that drop content words;
  - 13 other edge or size checks.
- Refused at the stored text: 47, almost all edits against markup or not found after tag projection.
- The sample judged 1 repair worse. It is not written.
- **88% of the defects found (169 of 192) are outside the rule tranche.** Every-join mode reaches the defects that
  tranche mode cannot.
- The Gemini label is not the Opus reference. In Test B the two flagged about the same number of joins (136 vs 131
  of 300), but which joins they flag differs.
- Calls: 420 agy (median 21 s, 0 failures) and 6 Opus judge calls ($0.60 list-equivalent). The weekly meter moved
  43% → 44%.
- Scale: the 20 books hold 17,165 eligible joins, ≈ 15,100 of them prose (the sample's 88%). That is ≈ 15,100 agy
  calls, about 6 nights at the cron's 2,500 joins a night. At the sample's yield it would write ≈ 3,300 joins in the
  books with the most readers.

**Proposed cron change, not installed.** For about 6 nights, add `--all-joins --top-books=20` to the installed
nightly line, keeping the same `--out` and the same `--max-joins=2500`. Sharing the out dir keeps the written-join
dedupe and the manifest for `undo` in one place. When the top 20 are walked, the candidates step finds nothing
pending, so remove the flags then, or raise `--top-books`. The same gates apply: the account's 60% weekly stop, the
7% blind sample with a 90% floor, and nothing written below it.

**Replicated?** No. One sampled dry run per mode.

**Artifact.** `scripts/eval/results/seam-guard-6742/`: guard replay summary and per-join log; every-join candidates,
repairs, verdicts, refusals, run tally, books, readership. Code: `scripts/maintenance/seam-repair-6742/guard.mjs`,
`lean.mjs`, `seam-repair.mjs` (`writeRepairs`: `allowHidden`, `throwOnStop`, `callSite`). The translate-core hook
loads the guard only when `SEAM_GUARD` is set. Tests: `tests/unit/seam-guard.test.ts`.

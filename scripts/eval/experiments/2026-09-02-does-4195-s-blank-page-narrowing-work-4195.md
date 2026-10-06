---
stage: ocr
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "v17 reads the faint-mark page as text on 5/5 runs where v15 said blank, but over-declines elsewhere: a legible Latin note becomes a lacuna."
status: rejected
decision: "v17 not promoted; PR #4605 labelled blocked (#4195)"
superseded_by: null
issue: 4195
---
## 2026-09-02 — Does #4195's blank-page narrowing work?

- **Design.** Same harness, `--cases blank`.
- **Result.** **Yes, on the faint-mark page** — v17 classifies Kitāb al-Bulhān
  p.4 as `text` on 5/5 runs where v15 said `blank`. I had reported the opposite
  from a single run.
- **Replicated?** Single k=5 run; stable within it (5/5), not repeated across
  sessions.
- **Counter-finding.** v17 **over-declines** elsewhere: p.197's legible Latin
  note ("Nihil hic deesse videtur") becomes a `<lacuna>`. That is the trade
  #4195 warned about, running in the direction nobody was watching.
- **Consequence.** v17 not promoted; PR #4605 labelled `blocked`.

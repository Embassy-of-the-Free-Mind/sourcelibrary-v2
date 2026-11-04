# Work-identity recall (#7761)

PRIOR ART: scripts/eval/build-work-gold-set.mjs + score-work-gold-set.mjs — pair precision with human labels; its header says it cannot measure recall, which is what this directory does.

How many links between editions, copies and translations does `books.work_id` miss?
This directory measures that two ways, at $0 (the dumps are already on disk, and the
judge runs on the Claude subscription).

1. **Outside catalogues.** Group live books by an outside work key, then ask how
   often we split what it joins. A judge then reads one pair per split group, because
   the catalogues are wrong too.
   - USTC `work_cluster_id` (author + USTC standard title), from the #7751 / PR #7758
     book-to-cluster output (`cluster-sl-coverage.jsonl`): `direct` links (our
     `ustc_id`) and `title` matches.
   - Open Library works: `ia_identifier` = OL `ocaid` in the 2026-04-30 editions dump
     on Hetzner (`ol_extract.py`, ~25 min on one core).
   The reverse direction (our cluster, two outside keys) is not scored: USTC's
   standard titles and OL's works both over-split, so it mostly reads their noise.
2. **Uniform sample.** 300 live books in hash order. For each, `sample.mjs`
   retrieves up to 22 candidates under OTHER work_ids (same author or surname, rare
   title tokens, same-author books in another language). The judge names the
   relation of each. **Positive control:** the same retrieval, run on books whose
   siblings we already link, must return a known sibling (180/200 on 2026-10-29).

Run order (`S` = a scratch dir):

    node --env-file=.env.production.local scripts/eval/work-recall/export-live.mjs $S/live-books.jsonl
    node scripts/eval/work-recall/sample.mjs $S/live-books.jsonl $S/frame-uniform.jsonl 300 200
    node scripts/eval/work-recall/judge.mjs frame $S/frame-uniform.jsonl $S/j-frame.jsonl 4 4
    node scripts/eval/work-recall/score.mjs frame $S/j-frame.jsonl 70968
    # outside catalogues: mapping rows {id, key, method}
    node scripts/eval/work-recall/agree.mjs $S/live-books.jsonl $S/map-ustc-direct.jsonl ustc-direct
    node scripts/eval/work-recall/mkpairs.mjs $S/live-books.jsonl $S/map-ustc-direct.jsonl $S/pairs.jsonl ustc-direct
    node scripts/eval/work-recall/judge.mjs pairs $S/pairs.jsonl $S/j-pairs.jsonl 12 3
    node scripts/eval/work-recall/score.mjs pairs $S/j-pairs.jsonl

The judge is `claude -p --model sonnet` with no tools and no project settings. It
sees title, author, year, language and page count only, never the image, so each call
is a catalogue judgement, not a by-eye one. Result:
`../experiments/2026-10-29-work-identity-recall-7761.md`.

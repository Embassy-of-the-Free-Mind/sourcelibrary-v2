# Preregistration, stage 2: does the layout-flip flag find bad Paddle pages in Chinese print? (#6871)

Committed before the GPU arms and before any page is judged. Stage 1 (PREREG.md, results in
`../experiments/2026-11-17-paddle-self-agree-6871.md`) passed on Siku pages against Kanripo. Chinese print has no
Kanripo text, so here the truth is a blind Opus review against the page image.

- **Frame.** The Chinese books of the #6101 print lane (`/root/jobs/paddle-print-6101`, 360 books, 73,330 pages written).
- **Flag draw** (`print-draw.mjs`, seed 6872): up to 3 random interior written pages per book, >= 40 characters:
  1,053 pages, 357 books, 1,618 leaves. The lane's own crops and split are reused.
- **Arms** (`print-task.sh`): OFF = production settings again (layout off), ON = layout on.
- **Signal.** d = symmetric Han CER between the page's STORED leaf reads (right leaf first, as the lane assembles them)
  and the ON reads. Flagged = d >= 0.05 (stage 1's operating point). Reported too: d between fresh OFF and ON, and
  between stored and fresh OFF (stack drift).
- **Judged sample.** 40 flagged + 40 unflagged pages, one per book (seed 6873), each still carrying the lane's text
  (its stored revision unchanged), plus 5 planted-error controls made from unflagged pages (a 6-character insertion,
  a 6-character deletion and a 4-character substitution in each). The 85 are shuffled under opaque ids. The reviewer sees
  only the image and the stored transcription, never the group.
- **Reviewer.** Opus through `claude -p` on the subscription, one fresh process per page, the #6388 rubric adapted to
  print (clean / minor <= ~1% / material / unusable). $0.
- **Pass** (all three):
  1. at least 50% of flagged pages are material or unusable;
  2. the flagged material-or-worse rate is at least 2x the unflagged rate;
  3. all 5 controls are caught (verdict material or worse, or the planted spans listed as errors).
- **Reported regardless:** the flag rate on the 1,053 pages (what routing would send to correction), and the
  material-or-worse rate among unflagged pages (what the flag misses).

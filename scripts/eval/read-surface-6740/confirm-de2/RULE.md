# #6740 read-surface — German confirmation 2 (relative rule), fixed 2026-10-31 before any read of it

<!-- PRIOR ART: ../confirm-de/RULE.md (confirmation 1: same routes, judge and controls, absolute wrong-text bar, 30 books);
this one changes the decision rule and the sample, on fresh pages. -->

**Written after confirmation 1, and why (Derek, inbox 14:12Z and 14:15Z).** Confirmation 1 (`../confirm-de/`) failed
8 a call on the ABSOLUTE wrong-text bar (2/25 > 0.04; P(acc ≥ 0.8) 0.79), while live failed the same bar by more (5/25,
P 0.06), and 8 a call beat live paired 5–0 at a third of the quota a accepted page. An absolute bar that the incumbent
fails cannot choose between them; eval-design §10.3 sets the bar at the live route. Changing the rule after seeing
confirmation 1 is post hoc, so this rule is tested on **fresh pages** and decides on them alone. Confirmation 1 + 2
pooled is a secondary analysis, never the decision.

**Population.** The decision applies to the German first-read queue: every German book in the first-read lane's
frame (`cli-ocr-lane.mjs` FIRST_READ_BOOKS + `firstReadSkip` languages=deu), hidden books of the same holds included:
**3,410 books** (3,131 visible, 279 hidden) on 2026-10-31 (`frame.json`: by era, holding library and provider).
1,725 of them (51 %) are e-rara scans. *Amended 15:20Z, before any read:* e-rara's own image server refuses this
machine (HTTP 403), but most e-rara books have their pages archived to our image host and are read from there (26 of
the first 36 e-rara books walked were fetchable). A book whose drawn page cannot be fetched is skipped and counted
(`candidates.jsonl` `fetchable: false`); the unreachable share is reported by era.

**Sample: 60 books, one page each, seed `rs6740-c2-6741`.** Strata era (pre-1600, 1600s, 1700s, 1800+, from the
edition date) × face (Fraktur, Antiqua; mixed counts as Fraktur). Allocation: a floor of 4 books a cell, the remaining
28 by largest remainder on the frame share (era share of the 3,403 dated books × within-era face share; the face shares
are from the by-eye frame sample of 2026-10-31, Antiqua 2 of 41 faced pages, set at 2–3 % before 1800 and 30 % from
1800): pre-1600 Fraktur 19 / Antiqua 4; 1600s 8 / 4; 1700s 11 / 4; 1800+ 5 / 5 (`quota.json`). Books are walked per
era in sha256(seed + book id) order, excluding every book of `../confirm-de/sample.json`, `../confirm/sample.json` and
the three #7701 draws; each book's page is drawn uniformly from its unread **body** pages (the first 10 % and the last
5 % skipped); the page's face, and whether it is a title page, front matter, plate or blank, is labelled by eye from the
whole page (`faces.jsonl`); a page that is not body text is skipped (the book is not redrawn). Within a cell at most
**2 books a holding library**. *Amended 15:20Z, before any read:* the frame is dominated by single holders (BSB holds
836 of 928 1700s books; e-rara, recorded only as the consortium "e-rara (Swiss libraries)" with no holding institution
in the record, holds 1,637 of 1,848 pre-1600 books), so the cap cannot be met literally. The cap applies first; a cell
that the walk cannot fill under it is filled from the capped libraries in walk order, and the per-library counts of
every cell are reported. A cell is filled in walk order; if an era's walk (at most 48 books) does not fill an
Antiqua cell, the cell keeps what was found and the shortfall is reported. Every walked book, its page and why it was
or was not taken are in `candidates.jsonl`.

**Routes**, both on the same pages (paired), `gemini-3.8-flash-low` through agy on the default pool: `agy-flash-low@4`
(live: the 4-page piece of the block that holds the page) and `agy-flash-low@8` (the whole block, up to 8 pages),
each read and written as the lane would: production's fallback on (a twice-refused block is read one page a call),
written = past `apply --first-read-only --print-only` (dry run). Judge: Opus (`claude -p`), the route-judge-6740
`judgePrompt` against the served page image, blind, shuffled, one output a call; per route two wrong-page controls
(refused with fidelity ≤ 2) and two planted errors on accepted outputs; a route whose wrong-page control fails does not
count; both plants missed voids the test.

**Decision (relative; all must hold), on the pages both routes wrote and the judge read:**
- (a) paired P(acc₈ ≥ acc₄ − 0.08) ≥ 0.9 under Dirichlet(1 + both, 1 + 8-only, 1 + 4-only, 1 + neither);
- (b) wrong-text pages of 8 a call ≤ those of live, counted on the same paired pages; and NO invented or wrong-leaf page;
- (c) quota cost a accepted page (agy usage on every call the route made, list-price rates as Amendment 6.2) at least
  10 % below live's.
The absolute bar (wrong text ≤ 0.04, P(acc ≥ 0.8) ≥ 0.9) is reported, not decisive.

**Reported beside the decision:** the decision measures post-stratified to the frame (cell weights = frame share ÷
sample share; this weighted number decides (a)'s accept shares and (c)), and unweighted; by era and by face, with
intervals; the per-stratum split of the paired counts and wrong-text pages; any cell where 8 a call does worse than live
is named even if the pooled rule passes.

**Useful pages.** Each drawn page's best judged accepted read (higher fidelity; tie to live), with no wrong-text tag, is
written through `cli-ocr.mjs apply --lane=agy-first-read-7701 --first-read-only --print-only`, reason naming #6740 and
confirmation 2. Rejected reads are not written. Live rows are also published to `ops_reports` `read-surface-6740:live`.

**On a pass:** a separate small PR proposes German first reads at 8 pages a call, low thinking (the tier and Derek
decide; this job applies nothing to the lane), and the evidence goes to the router evidence files. **On a fail:**
nothing switches; the record and #6740 say which clause failed.

**Budget:** about 180 agy calls (`judge.mjs correct --agy-max=200`) and 120 Opus calls, inside the job's 4,000-call
envelope; stop if the default pool's weekly remaining is under 30 % or this box's Claude account is over 85 % weekly.

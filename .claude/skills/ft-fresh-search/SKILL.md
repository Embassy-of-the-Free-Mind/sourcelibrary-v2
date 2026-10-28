---
name: ft-fresh-search
description: Run one batch of the fresh prior-translation search (#7598) — select the next translated books with no fresh search, search each with a lean Sonnet claude -p on a subscription, check the links, write a linked prior credit or a dated none-found first-translation badge, refresh the pages, spot check. Use when Derek says "next batch of first translations", "run the prior-translation search", "more firsts", "search the next 1,000", or picks up the #7598 handoff.
---
<!-- PRIOR ART: ft-verify (stage-2 verification of badge flips for the retired card-review lane; it gates
before writing, this writes and spot-checks after) and scripts/maintenance/ingest-prior-translations.mjs
(credits only, refuses badge changes). Neither fits the new output-first system Derek set on 2026-10-28. -->

# Fresh prior-translation search, one batch

**Who reads the output.** A reader on `/book/<id>` sees one plain answer: "Earlier English translation", with the link, or "First English translation", with the date we searched and the searches run. Derek wants as many books as possible to carry one of the two (2026-10-28). Output first: write, then spot check. Do not gate on card review; that system is being archived (#7598).

**Cost.** About 27 s and 23K Sonnet tokens a book. On a Max 20x account that is about 64 books per 1% of the 5-hour window and about 380–760 books per weekly point, so roughly $0.001 a book of subscription ($0.057 at API price). It runs on subscriptions only, never the API.

## Steps

Work in a batch directory outside the repo, for example `~/ft-batches/<date>-<n>/` on the laptop or `/root/ft-batches/...` on a box. Run commands from a checkout on `main`, with the env loaded (`set -a; source .env.production.local; set +a`).

1. **Pick the account.** `climits status`, then choose an account with week headroom and nothing else running on it. Confirm with `CLAUDE_CONFIG_DIR=<dir> claude auth status`, because a CLI's login is often not the account you think (memory: lesson_check_which_account_a_cli_uses). On the laptop, team@ is `~/.claude-team`.
2. **Select.** `node scripts/ft-search/select-batch.mjs --n 1000 --out <dir>`. It prints how many books are still eligible (visible, translated, not English, no fresh search yet) and draws in priority tiers: never searched by any method first, then books the old card system searched but left unbadged and uncredited, then badged or credited books last.
3. **Search, detached.** `CLAUDE_CONFIG_DIR=<dir> nohup caffeinate -i scripts/ft-search/run-batch.sh <dir> 4 >/dev/null 2>&1 & disown`. On a box, run it under `claude-job.sh` instead. It is resumable: after a usage limit, run it again. Watch `<dir>/progress.log`; it ends with BATCHDONE. Never poll from a big session (memory: feedback_token_efficiency_fork_protocol).
4. **Parse and check links.** `python3 -I scripts/ft-search/parse-results.py <dir>` prints the verdict counts and how many links load.
5. **Ingest.** `node scripts/ft-search/ingest.mjs <dir>` (dry run), read the tallies, then add `--apply`. Report the counts: `prior_credit`, `first_new_badge`, `prior_conflicts_badge_held`, `prior_link_rejected`.
6. **Show.** If a release is more than an hour away, run `scripts/ft-search/revalidate.sh <dir>`. Then open two changed books (one credit, one new first) and grep the HTML for "Earlier English translation" / "First English translation". A row count is not a render check.
7. **Old-found conflicts.** List the new first badges whose book has an old `first_translation_attempts` row with `result: found` (any method other than `claude_subagent_verify`). Make one adjudication call each: is the old named prior a real English translation of THIS work? Where the new search wins and `translation_verification.disposition` is `translation_found`, set it to `confirmed_first`: the book-page timeline renders that field as "Earlier English translation", next to the new badge. Where the old search wins, remove the badge and credit the prior. Revalidate those pages.
8. **Held conflicts.** For each `prior_conflicts_badge_held`, make one call: "is <credited book> a translation of THIS work, complete, not a study or a sibling treatise?" Where it holds, set the credit, `is_first_translation: false` and `first_translation.verdict: not_first`, and write a `book_events` row.
9. **Spot check.** 10 random credits and 10 random new firsts. Use an Opus subagent per item: open the credited link, or attempt a refutation search for the first. Post the counts and the error rate on #7598.
10. **Record.** Archive the batch directory to `sourcelibrary-ops/evals/ft-fresh-search/<date>-<n>/`, add a line to `~/sourcelibrary-ops/RUNNING.md`, and comment on #7598.

## Keep this skill current (required, every batch)

This skill learns only if the session that ran it writes the lesson down. Before you report a batch done:
- **Anything that broke, surprised you or cost a rerun** goes under *Traps* below, as one line with the date and the fix. Make the fix in the script, in the same PR. A trap that can become a check goes in the script, not just here.
- **Changed numbers** (books per weekly point, error rates from step 8, the eligible count) go in *Measured* below, with the date.
- If the spot check shows more than about 15% missed priors among new firsts, stop scaling. Add a second, independent search for `none_found` before badging, and say so on #7598.
- Commit these edits in a PR (`tier:auto` handles docs and scripts).

## Traps
- 2026-10-28 · The book page has two returns. The redesigned layout returns early, so a component mounted in the later return never renders (#7603 → #7608). Check the live HTML, not the diff.
- 2026-10-28 · A result file can hold two JSON lines when two runs wrote the same id. `parse-results.py` keeps the last line with a verdict; without that, about 5% were dropped.
- 2026-10-28 · A blank `climits json` reading is a one-off, not a broken login.
- 2026-10-28 · `revalidate-book` returns 429 above about 1 call a second; the script goes one at a time with backoff.
- 2026-10-28 · Searches that curled `/api/books/<id>` anonymously spent the laptop's anonymous budget and read the crawler notice instead of the record (5 of 174, batch 2). `select-batch.mjs` now fetches each record with `~/.sl-internal-key` and embeds it in the prompt; a missing key falls back to the curl and says so. Never put the key itself in a prompt.
- 2026-10-28 · The old system's "found" verdicts are mostly wrong. In batch 2, 70% of books had an old search, and 71 of the 807 fresh badges contradicted an old "found". On adjudication the fresh search was right in 68: 42 old priors do not exist, and 14 are a different work. 9 of those pages showed both "First" and "Earlier English translation" (from `translation_verification`) until step 7 cleared them.
- 2026-10-28 · Booksellers, Goodreads and Wikipedia are weak citations. Booksellers are rejected (`BAD_HOSTS` in `ingest.mjs`). Wikipedia is accepted for now (30 of 277 links); swapping in a better link is open.

## Measured
- 2026-10-28 · 994 of 1,000 parsed: 47% none found, 40% prior found, 11% partial, 2% unclear. 263 of 277 prior links loaded. Written: 238 credits and 404 new firsts. 22 conflicts held.
- 2026-10-28 · Batch 1 spot check (20 + 20, Sonnet re-check): credits 16/20 hold. 1 named a different work (composite kabbalistic MS, retracted), 1 was partial counted as complete (scope set to `partial`), 1 true but linked only to Wikipedia, 1 unclear. Firsts: 15/20 hold, 0 refuted, 3 unclear, 1 unparsed. The auditors ran 2–5 searches, not 12, so this is a floor on the error rate.
- 2026-10-28 · Batch 2: 995 of 1,000 parsed. 59% none found, 32% prior found, 7% partial, 2% unclear; 296 of 314 links load. Written: 255 credits, 402 new firsts, 179 badges given a search trail, 22 conflicts held. team@ went 5h 14%→39% and week 5%→9% for 1,000 books at 6 in parallel (about 75 minutes).
- 2026-10-28 · Remaining pool after batch 2: 5,304 never searched, 9,135 old search unmarked, 4,849 badged or credited.
- 2026-10-28 · team@ (Max 20x): 764 books moved the 5-hour window 0→12% and the week 3→4%.

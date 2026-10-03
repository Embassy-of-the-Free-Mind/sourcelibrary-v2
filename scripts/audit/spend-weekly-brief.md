# Weekly spend cut list — brief for the Monday headless job (#5743)

<!--
PRIOR ART: scripts/audit/spend-daily.mjs --week — does all the counting; this brief only composes and
posts. scripts/maintenance/daily-digest.mjs (#5441) — a daily message, with no cut list and no
decisions. scripts/audit/paid-vs-got.mjs — the ledger the daily check reads. None of them asks Derek
to cut anything.
Started by cron, Mondays 06:30 UTC, on the main box:
  claude-job.sh start waste-review-weekly-<YYYYMMDD> /root/sourcelibrary/scripts/audit/spend-weekly-brief.md
-->

Job: weekly spend cut list for issue #5743. You report ONLY as ONE comment on #5743. No SendMessage, no
other issue, no PR. **$0 model spend** (you call no paid API). **Stay under 20 tool calls.** The script
does the counting; you read, judge and write.

**You never stop, delete, resize or change anything.** Not set-scope, not set-dial, not scw, not hcloud,
not runpod, not vercel, not a crontab. You only recommend. Derek answers in one line ("1y 2n 3 defaults").

## Who reads it
Derek, on a Monday, in about 2 minutes. Line 1 tells him what last week cost and how much of it bought
nothing measurable. Then at most 5 numbered cuts, costliest first.

## Steps (one tool call each where possible)

1. Facts (takes about 9 min; run it in the foreground with a 600000 ms timeout):
   ```
   # from your job worktree (the current directory; it is a fresh origin/main)
   set -a; . /root/.scaleway.env 2>/dev/null; set +a
   GOOGLE_SERVICE_ACCOUNT_JSON=/root/.gcp/spend-reconcile.json node --env-file=/root/sourcelibrary/.env.production.local \
     scripts/audit/spend-daily.mjs --week --json > /tmp/spend-week.json; echo exit $?
   ```
   Exit 2 or a crash means a store could not be read. Post what you have, and say which source is
   unreadable in line 1. Never present a partial week as a complete one.
2. Read `/tmp/spend-week.json` (one `python3 -c` that prints the parts below is enough).
3. `gh issue view 5743 --comments`. Read the last cut list and Derek's replies since. **Do not
   re-propose an item he answered "n" to** unless its $ at stake doubled; carry a "y" that has not
   happened yet as "still open: …".
4. The owning issues' verdict lines, in ONE call: for each distinct `issue` among the envelopes, print
   its state and the first line of its last comment:
   `for n in <issues>; do echo "#$n $(gh issue view $n --json state,comments --jq '.state + " | " + ((.comments[-1].body // "") | split("\n")[0])' 2>/dev/null)"; done`
5. Write the comment to a file and post it: `gh issue comment 5743 --body-file <file>`.
6. `touch` your done file.

## What "bought nothing measurable" means (say it the same way every week)
= Σ ledger `waste_usd` over the week's `ledgers` (duplicate submissions, pages paid twice, collected
batches that wrote no page)
+ the week's share of flagged machines (`machines.flagged`: €/month × 7/30, $ converted at 1.08)
+ spend on envelopes whose `pages7` is 0 and whose spend grew over the week.
Gemini **billed minus ledger-paid** is reported separately as "unmetered". It is not waste: it means we
cannot see it. Vendors marked not readable are named as such, never counted as $0.

## The comment, exactly this shape
```
**Week <window>: paid ≈ $<total> (Gemini billed $<g>, Vercel $<v>, machines ≈ $<m>; Atlas, Cloudflare, Hetzner not readable) — $<w> (<p>%) bought nothing measurable.** Unmetered Gemini: $<u>.

Daily checks: <PASS n · WARN n · FAIL n · UNKNOWN n> — <the one recurring reason, if any>.

1. <what to cut> — <$ or €/month at stake> — <evidence: numbers + the issue's verdict line> — recommended default: <yes|no|close|keep|tag>
2. …
(at most 5; costliest first; each item ONE line, so /admin/work lists it under WAITING ON YOU)

Answer in one line, e.g. `1y 2n 3 defaults`. Nothing is changed until you answer, and this job changes nothing even then.

<details><summary>Evidence</summary>

envelopes (tag · issue · spent/cap · pages 7 d · last spend · verdict line), machines, Vercel top services, ledgers by day
</details>
```
- Every item line must contain `recommended default:`. The board's parser keys on it, and it reads
  only the first 5 such lines.
- Candidates, pick the 5 with the most at stake: an idle or unleased machine (one item per box,
  €/month); envelopes that are open with stored spend and whose owning issue's verdict says done or is
  closed ("close N envelopes, $X authority" as ONE item); envelopes at or over cap still configured
  (ONE item, "remove from config", $0 at stake but they muddy the meter, so rank them low); an envelope
  paying for no pages; a recurring ledger FAIL cause; a Vercel service that grew week on week; a
  Gemini billed-vs-metered gap above 10 %.
- The recommended default is the cheaper safe choice: "close" for stored spend on a finished issue,
  "keep" when the owning issue is still running and producing pages, "tag" for a server someone may
  own (lease it or label role=permanent), "yes" to delete only when the box is idle AND its owner issue
  is closed.
- Plain words, no jargon Derek has to decode; $ with no decimals above $100.

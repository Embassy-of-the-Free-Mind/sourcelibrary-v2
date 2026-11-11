Lands: #6871
PR: yes

# gpu-steward — the GEX45 GPU queue is empty: queue the next gated item, or say why nothing is eligible

PRIOR ART: the gex45-refill-6871 brief (2026-10-20), which a person wrote by hand when the queue had sat empty 30 h.
Started by scripts/maintenance/gex45-idle-alert.sh (cron on main) when /root/gpu-queue on the GEX45 has had nothing
pending or running for an hour; at most one steward a day.

Report ONLY by ONE comment on #6871. Use `node --env-file=/root/sourcelibrary/.env.production.local` for read-only
queries. No SendMessage.

## Situation
- GEX45: `ssh root@65.108.136.89` (key authorized from cloudlayer and main). Queue a task with
  `/root/bin/gpu-queue.sh add <task.sh> NN-name`; the task contract (timeout/issue headers, stop every model, the runner
  holds /root/gpu.lock) is in the header of /root/bin/gpu-queue.sh. `gpu-queue.sh list` shows what ran; logs are in
  /root/jobs/gpu-queue/<name>/task.log. Read the memory note on GEX45 traps before building a task.
- The work list is the table in the body of #6871, and its newest comments. `scripts/audit/gpu-queue-5660.mjs`
  (read-only, ~1 min) counts OCR still owed per lane.

## Do
1. Read #6871 (body + last 10 comments). If a task finished since the last comment and nobody scored it, scoring it
   (by its committed prereg) IS the next item: do that first, and PR the experiment file.
2. Otherwise take the first row whose **gate already passed, or can be built today at $0** (Opus subagents with the
   images opened, a committed prereg). Each queued item must change a decision (the #6871 rule). Gate before GPU run.
3. Queue it on the GEX45 (reads to FILES under /root/jobs/<name>/), or post ONE comment on #6871 naming each
   remaining row and the reason it is not eligible (waiting on Derek, gate failed, no reference possible, done).

## Never
- Spend money: no paid API at all (no Gemini, no Claude API keys), no rented GPU. $0 only.
- Write to Mongo, apply reads, release holds, or change visibility. Applying is a decision for a person: post it on
  #6871 as a `DECISION:` line.
- Power the GEX45 off, kill another task, or touch Earthlove (/srv/earth, earthlove.slice; it shares /root/gpu.lock).
- Delete anything. Use Tesseract.
- Start another steward, or queue more than one new task family per run.

Done = one task in /root/gpu-queue/pending/ (or a scored result PR'd) and one #6871 comment, or one #6871 comment
saying why nothing is eligible. Then write the done file.

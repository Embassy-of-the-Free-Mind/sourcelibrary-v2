Comprehensive system health check — Atlas, Hetzner, pipeline, all workers.

Run ALL of the following checks in parallel and compile into a single report:

## 1. Hetzner Resources
SSH to `root@46.224.122.120` and gather:
- CPU usage, load average, RAM, disk (`top -b -n1 | head -5`, `df -h /`, `uptime`)
- All node processes sorted by CPU (`ps aux --sort=-%cpu | grep node | grep -v grep`)
- Lock files: for each `/tmp/sl-*.lock`, check if HELD or FREE via `flock -n`
- Last 15 lines of `/var/log/sourcelibrary/scheduler.log`
- Last 10 lines of pipeline, translate, archive-ocr, archive-bulk, collector, display-backfill, resize, sync logs
- Tmux sessions (`tmux ls`)
- Scheduler last-run state (`/tmp/sl-scheduler-last-run.json`)

## 2. Atlas Health (via MongoDB queries)
Connect with `maxPoolSize: 2` and run:
- Health probe: `findOne` + browse query latency → grade (healthy/degraded/critical)
- Pipeline counts: individual `countDocuments` per status (NOT $group — it times out)
- Active jobs count + breakdown by type (sample 10 most recent)
- Zombie jobs: count jobs with status active/processing and updated_at > 6h ago
- Batch jobs by status
- `processing_control` pause state
- `adaptive_limits` health grade
- Recent cron_runs (last 8) + recent errors (last 5 with error_count > 0)
- Collection sizes: books, pages, books_warehouse, pages_warehouse, jobs, batch_jobs

## 3. Compile Report
Format as a structured report with tables. Flag issues. Include:
- Server resources with verdicts (OK / HOT / LOW)
- CPU breakdown by process with % and RAM
- Atlas latency + grade
- Pipeline funnel (how many books at each stage)
- Active jobs + zombies
- Batch job queue depth
- Archiving progress (from archive-ocr log)
- Translation progress (from sync-worker log snapshot)
- Embedding status
- Any errors or anomalies
- List of issues found with recommended actions

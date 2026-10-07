#!/bin/bash
# Dry-run split-book --gutter-only for one book; log to the job's scratch dir. Writes nothing to Mongo.
id=$1; D=/root/split-wave1-6114/books/$id; mkdir -p $D
[ -s $D/dryrun.done ] && exit 0
cd /data/scratch/sl/sourcelibrary/.claude/worktrees/job-split-wave1-6114
timeout 3600 node --env-file=/root/sourcelibrary/.env.production.local scripts/split-book.mjs $id --gutter-only --dry-run --overlap=0.005 > $D/dryrun.log 2>&1
echo "exit $?" > $D/dryrun.done

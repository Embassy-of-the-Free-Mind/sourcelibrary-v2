#!/bin/bash
# #6361 stage 1: start the agy driver in tmux session tengyur-cli-6361-driver. Idempotent: does nothing if the
# session is alive, if DONE-STAGE1 exists, or if STOP exists. The watchdog (watchdog.sh, cron) calls this.
D=/root/tengyur-cli-6361; S=tengyur-cli-6361-driver
[ -e $D/DONE-STAGE1 ] && { echo "DONE-STAGE1 exists; not starting"; exit 0; }
[ -e $D/STOP ] && { echo "STOP exists; not starting"; exit 0; }
tmux has-session -t $S 2>/dev/null && { echo "$S already running"; exit 0; }
tmux new-session -d -s $S "cd $D && node $D/driver.mjs >> $D/driver.log 2>&1"
sleep 1; tmux has-session -t $S 2>/dev/null && echo "$(date -u +%FT%TZ) started $S" || { echo "failed to start $S"; exit 1; }

# PRIOR ART: scripts/workers/disk-steward.sh (keeps .gemini because it is written daily, so it never sees this file).
# Installed on the main box as /root/bin/agy-wal-checkpoint.py; this repo copy is the source.
# Fold the agy (Gemini CLI) SQLite WAL back into its db. Concurrent agy calls keep it open,
# so it never auto-checkpoints; it reached 20 GB on 2026-10-16 and filled the root disk (#6223).
# A second account's CLI home (/root/.agy-<name>, see agy-guard.sh AGY_HOME) has its own db and WAL.
# One locked or broken db is reported and skipped, so it cannot stop the other account's checkpoint.
import sqlite3, datetime, glob
for db in glob.glob("/root/.gemini/antigravity-cli/conversation_summaries.db") + glob.glob("/root/.agy-*/.gemini/antigravity-cli/conversation_summaries.db"):
    try:
        c = sqlite3.connect(db, timeout=60)
        r = c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall()
        c.close()
    except Exception as e:
        r = repr(e)
    print(datetime.datetime.utcnow().isoformat(), db, r)

# PRIOR ART: scripts/workers/disk-steward.sh (keeps .gemini because it is written daily, so it never sees this file).
# Installed on the main box as /root/bin/agy-wal-checkpoint.py; this repo copy is the source.
# Fold the agy (Gemini CLI) SQLite WAL back into its db. Concurrent agy calls keep it open,
# so it never auto-checkpoints; it reached 20 GB on 2026-10-16 and filled the root disk (#6223).
import sqlite3, datetime
r = sqlite3.connect("/root/.gemini/antigravity-cli/conversation_summaries.db", timeout=60).execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall()
print(datetime.datetime.utcnow().isoformat(), r)

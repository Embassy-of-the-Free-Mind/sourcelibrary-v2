#!/bin/bash
# OCR Loop — runs realtime-ocr.mjs in successive batches all night.
# Each batch processes BATCH_SIZE pages, then restarts for the next batch.
#
# Usage:
#   set -a; source .env.production.local; set +a; nohup bash scripts/batch/ocr-loop.sh > /tmp/ocr-loop.log 2>&1 &
#
# To stop gracefully: touch /tmp/ocr-stop

BATCH_SIZE=${1:-8000}
CONCURRENCY=${2:-50}
STATUS="archive_complete"
PAUSE_BETWEEN=30  # seconds between batches

echo "=== OCR Loop started at $(date) ==="
echo "  batch_size=$BATCH_SIZE concurrency=$CONCURRENCY status=$STATUS"
echo "  Stop file: /tmp/ocr-stop"
echo ""

ROUND=0
while true; do
  # Check stop file
  if [ -f /tmp/ocr-stop ]; then
    echo "Stop file found — exiting at $(date)"
    rm /tmp/ocr-stop
    break
  fi

  ROUND=$((ROUND + 1))
  echo ""
  echo "=== Round $ROUND at $(date) ==="

  node scripts/batch/realtime-ocr.mjs \
    --no-ocr \
    --status=$STATUS \
    --limit=$BATCH_SIZE \
    --concurrency=$CONCURRENCY

  EXIT_CODE=$?
  echo "Round $ROUND finished with exit code $EXIT_CODE at $(date)"

  if [ $EXIT_CODE -ne 0 ]; then
    echo "Non-zero exit — waiting 60s before retrying"
    sleep 60
  fi

  # Check remaining pages using a separate script to avoid bash escaping issues
  REMAINING=$(node -e '
    const { MongoClient } = require("mongodb");
    (async () => {
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const db = client.db("bookstore");
      const books = await db.collection("books")
        .find({ hidden: { $ne: true }, "pipeline_auto.status": "archive_complete" })
        .project({ id: 1 }).toArray();
      const bookIds = books.map(b => b.id);
      if (bookIds.length === 0) { console.log("0"); await client.close(); return; }
      const count = await db.collection("pages").countDocuments({
        book_id: { $in: bookIds },
        $or: [{ "ocr.data": { $exists: false } }, { "ocr.data": "" }, { "ocr.data": null }]
      });
      console.log(count);
      await client.close();
    })().catch(() => console.log("-1"));
  ' 2>/dev/null)

  echo "Remaining pages: $REMAINING"

  if [ "$REMAINING" = "0" ]; then
    echo "No more pages to process — done at $(date)"
    break
  fi

  if [ "$REMAINING" = "-1" ] || [ -z "$REMAINING" ]; then
    echo "Could not check remaining — continuing anyway"
  fi

  echo "Pausing ${PAUSE_BETWEEN}s before next batch..."
  sleep $PAUSE_BETWEEN
done

echo ""
echo "=== OCR Loop finished at $(date) ==="

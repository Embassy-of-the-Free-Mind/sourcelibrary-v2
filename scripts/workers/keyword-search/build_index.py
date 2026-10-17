"""shards/*.jsonl.gz (pull-pages.mjs) → a tantivy index, built in <root>/index.building and renamed to
<root>/index when complete, so the server never opens half an index.

    venv/bin/python build_index.py [--threads 4] [--heap-gb 4] [--partial]
    node pull-pages.mjs --stdout | venv/bin/python build_index.py --stdin --pull-started-at <iso>

Records built_at, the page count and the pull's start time (the delta's first checkpoint) in state.json.
Tokenizing runs on the writer's threads (Rust); this process only parses JSON and feeds documents.

PRIOR ART: build-hnsw.mjs in scripts/workers/vector-search (shards → index, streamed, state.json last);
sourcelibrary-atlas index-fts.mjs (the same corpus into SQLite FTS5 on a laptop).
"""
import argparse
import gzip
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone

import kwindex

ap = argparse.ArgumentParser()
ap.add_argument("--threads", type=int, default=4)
ap.add_argument("--heap-gb", type=float, default=4.0)
ap.add_argument("--partial", action="store_true", help="build even if pull.json says the pull is not complete")
ap.add_argument("--stdin", action="store_true", help="read rows from stdin (pull-pages.mjs --stdout) instead of shards")
ap.add_argument("--pull-started-at", help="with --stdin: when the pull began (the delta's first checkpoint)")
ap.add_argument("--min-pages", type=int, default=0, help="refuse to install an index with fewer pages (a short pipe is a failed pull)")
a = ap.parse_args()

if a.stdin:
    if not a.pull_started_at:
        sys.exit("--stdin needs --pull-started-at")
    pull = {"pull_started_at": a.pull_started_at, "complete": True}
    shards = ["-"]
else:
    pull = kwindex.read_json(os.path.join(kwindex.SHARD_DIR, "pull.json"), {})
    if not pull.get("complete") and not a.partial:
        sys.exit("pull.json says the pull is not complete (pass --partial to build anyway)")
    shards = sorted(f for f in os.listdir(kwindex.SHARD_DIR) if f.startswith("shard-") and f.endswith(".jsonl.gz"))
tmp = kwindex.INDEX_DIR + ".building"
shutil.rmtree(tmp, ignore_errors=True)
idx = kwindex.open_index(tmp, create=True)
w = idx.writer(heap_size=int(a.heap_gb * 1e9), num_threads=a.threads)

t0 = time.time()
n = dupes = chars = 0
seen = set()
books = set()


def lines(f):
    if f == "-":
        yield from sys.stdin
        return
    with gzip.open(os.path.join(kwindex.SHARD_DIR, f), "rt", encoding="utf-8") as fh:
        yield from fh


last_log = time.time()
for f in shards:
    for line in lines(f):
        if not line.strip():
            continue
        r = json.loads(line)
        if r["i"] in seen:  # a page re-read when the pull resumed
            dupes += 1
            continue
        seen.add(r["i"])
        books.add(r["b"])
        w.add_document(kwindex.page_document(r))
        n += 1
        chars += len(r.get("tr") or "") + len(r.get("o") or "")
        if f == "-" and time.time() - last_log > 60:
            last_log = time.time()
            print(f"{datetime.now(timezone.utc).isoformat()} stdin: {n:,} pages · {chars / 1e9:.2f} G chars · {n / (time.time() - t0):.0f} pages/s", flush=True)
    el = time.time() - t0
    print(f"{datetime.now(timezone.utc).isoformat()} {f}: {n:,} pages · {chars / 1e9:.2f} G chars · {n / el:.0f} pages/s", flush=True)

print(f"loaded {n:,} pages ({dupes} duplicates skipped) in {(time.time() - t0) / 60:.1f} min; committing", flush=True)
if n < a.min_pages:
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(f"only {n:,} pages, under --min-pages {a.min_pages:,}: not installing this index")
w.commit()
w.wait_merging_threads()
built_at = datetime.now(timezone.utc).isoformat()
size = sum(os.path.getsize(os.path.join(tmp, x)) for x in os.listdir(tmp))
old = kwindex.INDEX_DIR + ".old"
shutil.rmtree(old, ignore_errors=True)
if os.path.exists(kwindex.INDEX_DIR):
    os.rename(kwindex.INDEX_DIR, old)
os.rename(tmp, kwindex.INDEX_DIR)
shutil.rmtree(old, ignore_errors=True)
# The delta's first checkpoint is the pull's start: a page edited during the pull is read again.
kwindex.write_json_atomic(kwindex.STATE_PATH, {
    "built_at": built_at, "pages": n, "books": len(books), "text_chars": chars, "index_bytes": size,
    "pull_started_at": pull.get("pull_started_at"), "checkpoint": {"u": pull.get("pull_started_at")},
})
print(f"done: {kwindex.INDEX_DIR} {size / 1e9:.2f} GB, {n:,} pages, {len(books)} books, {(time.time() - t0) / 60:.1f} min total", flush=True)

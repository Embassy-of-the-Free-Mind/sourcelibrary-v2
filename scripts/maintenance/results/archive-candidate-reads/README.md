# archive-candidate-reads — per-job manifests (#7075)

One `<job>.jsonl` per job dir: the reads `scripts/maintenance/archive-candidate-reads.mjs --apply` copied to the
private R2 bucket `sl-corpus-snapshots` under `candidate-reads/<book_id>/<page_id>/<field>/<hash>.json`.
Rows: `page_id, book_id, field, model, hash` (no text). They live here, not in R2, because `scripts/lib/r2-key.mjs`
has no exception for a book-independent key such as `candidate-reads/_jobs/<job>.jsonl`.

Run 2026-10-24 on hetzner (`/mnt/HC_Volume_105839809/jobs`, `/root/jobs`): 13,700 objects, 62.9 MB of text.

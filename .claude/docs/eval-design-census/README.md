# Census behind eval-design.md §11 (snapshot 2026-09-25)

PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — it counts referenced pages per cell from results files; this folder counts live pages per catalogue stratum against references. Snapshot, not a tool: the migration follow-up (#5121) turns it into `scripts/eval/registry/`.

- `atlas-books.mjs` — dumps live books (`visible && pages_count>0`) from Atlas `books` with language/published/pages_count (cheap; no `pages` query). The dump itself is not committed.
- `strata.mjs` — live books and pages by catalogue language × period (first plausible 4-digit year in `books.published`). Output `strata-atlas.json`.
- `refcount.mjs` — sealed registry pages and reference texts (`benchmark/refs/<slug>.txt`) by language × period. Output `refcount.json`.
- `refbyfile.mjs` — referenced pages across `results/benchmark/*.json` by language × period × origin (library `book_id` vs external `ws-*`).
- `gaptable.mjs` — joins the above into `gap-table.md` with the cost model stated in the doc.

Run from a folder with `node_modules` linked to the repo's (`ln -s <repo>/node_modules`) and `--env-file=<repo>/.env.production.local` for the Atlas step.

Finding recorded here because it changes how counts are taken: the local mirror (`~/sl-corpus/books.jsonl`, 2026-09-10) reports 57,399 live books / 12.4M pages; Atlas reports 41,928 / 8.8M with the same filter. The mirror's `visible` is stale. Atlas `books` is the source for corpus counts until the mirror refresh carries `visible`.

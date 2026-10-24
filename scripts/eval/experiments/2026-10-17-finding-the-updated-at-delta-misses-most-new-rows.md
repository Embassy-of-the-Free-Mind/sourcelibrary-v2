## 2026-10-17 · Finding: the updated_at delta misses most new rows

`sync-delta.mjs` (phase 1) keysets on `page_translations.updated_at`. The writer stamps that
column with the page's **Mongo source time**, not the time it wrote the row
(`scripts/lib/page-embedding-text.mjs`: `updated_at: mongoTs || new Date()`). A page translated
at 04:00 and embedded at 16:00 therefore lands behind a 14:50 checkpoint, and the delta never
sees it.

In the first 26 h after the pull:
- the delta saw 681 rows;
- the first `--reconcile` found **4,055 more**. Those are rows Supabase serves and the service
  did not have, across 26 books, with `updated_at` between 2026-10-15 21:22 and 2026-10-16 14:50.

The reconcile pass (one unordered cursor scan of every served page_id, 55 s, then a per-range
diff in the service, 88 s in all) is now on the cron every 2 h. It took the drift from −4,055 to
0.

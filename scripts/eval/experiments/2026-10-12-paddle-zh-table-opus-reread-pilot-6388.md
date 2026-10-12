---
stage: ocr
measure: [judged, judged_vs_reference]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 100
n_pages: 100
verdict: "NO-GO on the pre-set gate. On 100 withheld Paddle table/diagram pages (one per book), the Gemini 3.8 Flash reviewer found invented text in 23 of Opus's 100 reads (Wilson 95% 16–32%, gate ≤ 10%). It caught all 5 planted controls. Where a Kanripo leaf aligns, though, the leaf prints the reviewer's main 'invented' span on 5 of 12 such pages, so the true rate is lower. Two corrected estimates, 18% and about 13%, are both still above 10%. Against Kanripo, Opus over-writes printed characters 91 times where Paddle does 218 (48 pages)."
status: rejected
decision: "Opus-by-image not adopted as the unattended reader for Paddle table pages; the 4,379 stay withheld (#6388)"
superseded_by: null
issue: [6388, 6553]
---
## 2026-10-12 · Paddle Chinese table pages: withhold the detector's 4,379, then can Opus re-read them? (#6388, #6553 step 1C)

PRIOR ART: `2026-10-11-paddle-zh-table-detector-6388.md`, which has the detector, the 30-page bake-off (Opus over-count
39 vs Paddle 145) and the recommended ladder. This entry runs that ladder's step 1 (withhold) and its step 3 gate
(Opus, adopted if a stable reviewer finds invented text on ≤ 10%). Code and data: `scripts/eval/paddle-table-pilot-6388/`.

### Step 1: withhold (written to production, approved by Derek on 2026-10-11)

- **List.** `paddleTableRisk` (gate AND shape) re-run live over the same 1,568,108 Paddle pages flags **4,379** pages
  in 781 books. That is the PR #6516 count exactly; 4,377 of the pages are the same. All 781 books were already held:
  632 `paddle-zh-5600-ocr-only`, 76 `gpu-backlog-5660`, 73 `paddle-zh-6388-ocr-only`.
- **By-image check of the flag, 30 random pages (Opus, the bake-off review prompt).**
  - 12 invented, 6 real text with misreads or omissions, 12 clean. Clean is 40%, under the 50% stop line, so applied.
  - The clean pages are mostly 御定子史精華 ditto-mark pages: 9 of the 12 clean are from that work.
  - All 5 御製增訂清文鑑 pages in the sample were invented: Manchu-script pages whose small Chinese glosses Paddle
    padded with runs.
- **What was written.** Checked on 2026-10-12 by re-reading Mongo, the Supabase mirror and the live site.
  - The transcription is flagged: `ocr.unreadable`, reason `paddle_table_6388`, plus an `ocr.verdict`.
  - The text is snapshotted to `page_revisions` (reason `withhold_paddle_table_6388`, 4,379 rows), then taken off the
    page (`ocr.data` unset after a byte-for-byte check; `ocr.withheld_chars` kept).
  - The English made from the transcription is withheld: 1,320 pages, 1,320 snapshots. 1,166 were withheld by
    `withhold-stale-translations.mjs` and 154 by the hourly sweep, which picked up the flag first. 0 are still served.
  - The Supabase mirror holds 0 `ocr_data` and 0 `translation_data` for these pages.
  - `page_translations`: 4,116 rows parked, so 0 are reachable by search.
  - 781 `sweep_log` rows (`withhold-paddle-table-6388`) record the 4,379 pages. All 781 books were revalidated.
  - Live check: 3 random pages show "could not produce a reading we trust", and none of 15 probes from their old
    text or English is in their HTML.
  - Cloudflare edge: 0 of 60 sampled pages served a stale copy. No purge token on this box.
- **Why the text came off the page, not just the flag.** `ocr.unreadable` stops the reader pane, but `data` still ships
  in four places (reported on #4883):
  - the RSC payload, because the projection carries `ocr` whole;
  - the meta description and JSON-LD excerpt, as seen on the canary;
  - the Supabase mirror;
  - the embeddings.

### Step 2: pilot (reads and reviews only)

**Design.**
- **Sample.** 100 withheld pages, one per book (100 books), excluding the 30 checked above. Books are stratified by run:
  #5600 81, #5660 10, #6388 9, against 632 / 76 / 73 books. It includes 29 御定子史精華 volumes and 18 御製增訂清文鑑
  volumes.
- **Reader.** Opus via `claude -p` (subscription), one page per call, with the image and the live OCR prompt (Standard
  OCR 19.1). An addendum adds:
  - count, do not estimate;
  - counting-rod numerals as printed (U+1D360–1D371 or Suzhou), or `[rod:N]`, never 一…九;
  - a drawing returns `<image-desc>` only;
  - sentinels (`===LAYOUT===` / `===TRANSCRIPTION===` / `===END===`).
- **Reviewer.** Gemini 3.8 Flash high via `agy -p`, with the image and Opus's read, using the bake-off review prompt.
  It also judges an `<image-desc>`-only read.
- **Controls.** 5 Opus reads, each with one planted prose line of 13–22 characters taken from another book's page.

**Results.**

| | n | invented (reviewer) | Wilson 95% |
|---|---:|---:|---|
| **all** | 100 | **23** | **15.8–32.2%** |
| 御定子史精華 | 29 | 11 | |
| 御製增訂清文鑑 | 18 | 4 | |
| other | 53 | 8 | |
| run #5600 / #5660 / #6388 | 81 / 10 / 9 | 19 / 2 / 2 | |

- **Controls: 5 of 5 caught.** Each planted line was named as invented, so the verdicts count.
- **Other verdicts:** 59 clean, 16 minor, 2 material.
- **Layout (Opus's call):** 42 prose, 28 mixed, 25 table, 5 diagram.
  - **No page came back drawing-only.** Opus wrote the labels of its 5 "diagram" pages as body text, against the
    addendum.
  - Rod numerals were written in the stated convention on 3 pages.
- **Size of the invented spans:** 1–2 characters on 4 pages, 3–9 on 11, 10 or more on 8.
- **Kanripo, `own` alignment (48 pages).**
  - Opus over-writes printed characters 91 times, Paddle 218 (12,730 printed characters).
  - Pages with an over-count ≥ 3: Opus 16, Paddle 15. Opus's excess is spread thinly; Paddle's is concentrated.
- **The reviewer over-calls on small print.** On 12 own-aligned pages called invented, 7 claimed spans are 3 or more
  characters long. The Kanripo leaf prints 5 of them in full (`data/kanripo-check-invented.jsonl`); these are
  double-line small notes Opus read and Flash did not see. Two corrected estimates:
  - drop those 5 pages: 18/100;
  - also apply the same 5/12 false-positive share to the 11 invented pages Kanripo cannot check: about 13/100.
  - Both stay above 10%. The real invented rate is likely 13–23%, not under 10%.
- **Cost and time.** Opus median 25 s per page (mean 30). Gemini review median 96 s per page: every call needed the
  one-nudge retry, after the first attempt asked for a tool. Calls: Opus 130 (30 check + 100 reads), `agy` 214
  attempts for 107 requests. $0 cash, 2 in flight.

### What this means

- **NO-GO on the gate as set.** Opus reads these pages far better than Paddle: over-count down 58% against Kanripo,
  and 59% judged clean. But not to ≤ 10% invented on this class, even after correcting for the reviewer's misses.
- The remaining errors are of three kinds:
  - ditto-mark (丨) counts on 御定子史精華, 11 of 29;
  - Manchu-gloss runs on 清文鑑, 4 of 18;
  - headers or cells written twice on tables.
  These are the same kind of failure as Paddle's, only smaller.
- **Not measured:**
  - a second, stronger reviewer. The bake-off found Gemini 3.1 Pro unstable, and no human counted;
  - whether Opus with a per-work prompt (ditto marks, Manchu glosses) passes;
  - whether Kanripo, where it aligns `own` (48 of 100 here), should serve instead (CC BY-SA, still undecided).

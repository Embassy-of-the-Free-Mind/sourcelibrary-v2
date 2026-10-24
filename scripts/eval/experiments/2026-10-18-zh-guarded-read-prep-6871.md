---
stage: ocr
measure: none
languages: [zh]
scripts: [Hant]
canons: []
n_books: 6
n_pages: 726
verdict: "Preparing the guarded-Paddle apply on the 27,048 held Chinese table + mixed pages: three things the confirmation did not measure. (1) The R2 archived copy of these pages is a 1/3-scale JPEG; read at that scale, Paddle collapsed on 5 of 99 pages it reads correctly from the Archive's full-size leaf, so the run reads the Archive leaf (the bar's input). (2) guard.py's LOOP rule cannot judge Flash's replies on numeric tables (it flagged all 3 good ephemeris reads in the confirmation); the reply guard keeps COLLAPSE and OVERRUN, and keeps LOOP only off NUMERIC pages: in-sample 3/3 failed replies caught, 0/7 good flagged. (3) The #6388 table detector, which production withholds served Paddle pages by, flags 73 of 709 guard-passed pages in the first chunk, 72 of them in one calendar-table volume."
status: informational
decision: "None here. The GPU read runs as gpu-queue task 50-zh-guarded-read (files only), Flash and the writer's dry run follow (after-gpu.sh); the apply is Derek's DECISION on #6871"
superseded_by: null
issue: [6871]
---
PRIOR ART: `2026-10-18-zh-guarded-paddle-6871.md` (the confirmation this prepares the apply for: the guard, the scope, the price); `2026-10-18-zh-residue-bakeoff-6871.md` (the P0 settings); `2026-10-11-paddle-zh-table-detector-6388.md` (the detector checked in (3)).

## 2026-10-18 · Preparing the guarded-Paddle apply on held Chinese tables and mixed pages (#6871 row 3)

**What was run.** This job built the manifest (`scripts/gpu/zh-guarded-read-6871/manifest.mjs`, read-only): 27,048
pages, table 15,280 + mixed 11,768. That matches the confirmation's count to the page. It ran a 2-book smoke run (99
pages) at two image scales under one short lock hold. Then it queued the whole read as gpu-queue task
`50-zh-guarded-read`: production Paddle (PaddleOCR-VL-1.6, vLLM genai server, 8 runners, layout off) plus the frozen
guard, writing one JSONL per book. It also ran agy Flash on the first chunk's 17 rejects, and dry-ran the writer
(`scripts/workers/paddle-zh-guarded-lane.mjs`) on the first chunk. Nothing was written to `pages`.

**(1) Image scale.** `getPageSource` resolves these pages to `archived_photo`. On these books that is a 1/3-scale JPEG
(~760 × 1,050 px). The Archive's `photo_original` is ~2,290 × 3,140, the same leaf: grey-thumbnail correlation
0.998–1.0 on 3 pages. The bake-off and the confirmation fed Paddle the Archive leaf, capped at 2,744 px.
- Same 99 pages, same settings, two inputs:
  - from the R2 copy, the guard routed 10 to Flash;
  - from the Archive leaf, it routed 5.
- Five pages that collapsed at R2 scale (1–4 Han characters) read 86–163 characters from the Archive leaf.
- The median page differed by 1.3% (bag of Han characters) between the two inputs.
- The run therefore reads `photo_original` (the bar's input), and every record carries the URL and sha256 of the bytes
  read. This affects any Paddle run on IA-sourced Chinese books that goes through `getPageSource`. It was not checked
  beyond these 99 pages.

**(2) A guard on Flash's reply.** The confirmation asked for "the same guard on Flash's reply, retry once, then hold".
Run unchanged on its B2 / B2r replies, `guard.py` flags all three of Flash's GOOD ephemeris-table reads (bag CER 1–8%)
as LOOP: a numeral table repeats 6-grams. NUMERIC is a property of the image, and it is why those pages went to Flash.
So `flash.py`'s reply guard is:
- fail on a blocked, empty, cut or unwrapped CLI reply;
- otherwise `guard.py` on the reply, keeping COLLAPSE and OVERRUN, and LOOP only on pages not routed for NUMERIC.

In-sample on the confirmation's in-scope Flash-routed pages it caught 3/3 failed replies (a filter cut at 97.7%, a 79%
collapse twice) and flagged 0/7 good ones. Over all in-scope scored pages it caught 4/4 and flagged 2/78.
- This rule was **not preregistered** and is fitted to those pages.
- n is tiny. The writer's own loop guards (ocr-loop-guard, single-character run) still apply after it.
- On the first chunk of the real run: 17/17 Flash replies passed on round 1, at about 130 pages/h (2 parallel), $0.

**(3) The #6388 table detector.** Production withholds served Paddle pages the detector flags (4,379, `chinese-tables` row).
The writer applies the same rule (`paddleTableRisk`, the #6516 `T`) to every guard-passed Paddle page and holds what it
flags.
- On the first chunk it flags 73 of 709 guard-passed pages.
- 72 of those are in one volume, 春秋大事表·卷二之三 (72 of its 184 pages). That volume is a calendar table whose real
  cells repeat (晦晦晦…, 朔朔朔…): the detector's loop gate cannot tell those from a loop.
- Held pages stay unread and are listed in `<report>.skipped.jsonl`. Sending them to Flash instead is not measured.

**One page by eye (鄉黨圖考 p.27, a chronology table).** The characters Paddle reads are right. Cells of different rows
are merged into one line, and one column of rulers (莊公光, 獻公衎二, 平公, 簡公, 哀公溺十, 康王) is missing: about 20 of
~120 characters. This is the table-order weakness the bag-CER bar does not see. It is n = 1, so it says nothing about
the rate.

**First chunk, writer dry run** (6 books, 726 pages):

| would write | Paddle | Flash | held: table detector | held: textless | refused as loop |
|---:|---:|---:|---:|---:|---:|
| 640 | 623 | 17 | 73 | 13 | 0 |

**Early routes** (5 chunks, 3,366 pages): PADDLE 3,219, FLASH 144 (4.3%), HOLD 3. The confirmation's estimate was 12–24%.

*Artifacts:* `scripts/gpu/zh-guarded-read-6871/`:
- `manifest.mjs`;
- `drive.py` + `task.sh` (the gpu-queue task);
- `flash.py`;
- `after-gpu.sh` (pull, Flash, writer dry run).

The writer is `scripts/workers/paddle-zh-guarded-lane.mjs`, with its test `tests/unit/paddle-zh-guarded-lane.test.ts`.
GPU outputs are on gex45 in `/root/jobs/gpu-queue/50-zh-guarded-read/`.

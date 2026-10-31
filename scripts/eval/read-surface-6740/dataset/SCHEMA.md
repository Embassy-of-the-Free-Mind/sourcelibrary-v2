# read-surface-6740 v1 — schema

<!-- PRIOR ART: scripts/eval/dataset/refusal-census-v1/DATASHEET.md (its field table); this file is the field list only, the datasheet is DATASHEET.md. -->

All files are UTF-8; `.jsonl.gz` is one JSON object a line, gzipped.

## rows.jsonl.gz — one row per run × target page

| field | meaning |
|---|---|
| `lang` | `de` (German, DTA references) or `la` (Latin, CAMENA references) |
| `run` | design run: `B01`–`B12` (Box-Behnken edge midpoints), `C1`–`C3` (centre replicates), `L1`/`L2` (the live setting), `X01`/`X02` (two corner runs added by Amendment 3), `D05`… (the low-thinking plane re-made on the default pool, Amendment 6, if made) |
| `pages_a_call` | 1, 4 or 8 pages of the same book in one model call |
| `long_edge` | image fitted to this long edge in px before sending (never enlarged); `null` = the image as served |
| `thinking` | `low`, `medium`, `high` (model `gemini-3.8-flash-<thinking>` through the agy CLI) |
| `pool` | the agy account the run used (`default` or `.agy-james`); the two differ in how often Gemini's filter cuts a reply |
| `live` | the production setting (4 a call, image as served, low) |
| `slug`, `book_id`, `page_id`, `page_number` | the target page; `book_id` / `page_id` are Source Library ids (`https://sourcelibrary.org/book/<book_id>`) |
| `period`, `source`, `source_id` | the book's century; the typed edition's corpus and its id there |
| `licence_reference` | the licence of the typed reference for this page |
| `in_analysis`, `exclusion` | `false` for the 5 German and 6 Latin targets left out before any fit (wrong leaf by eye, or no usable one-a-call read), with the reason |
| `image_url` | where the image was fetched (Source Library's image host or the holding library's IIIF); no image is in the dataset |
| `image_sha256_source`, `image_sha256_sent` | sha256 of the bytes fetched, and of the bytes sent after fitting |
| `image_fit` | `{long_edge, resized, native {w,h}, sent {w,h}}` |
| `status` | `read`, `unusable` (a filter stub or a cut / looping / empty reply), `unread:refused` (the page's block was refused twice and, with `--no-alone`, not re-read) |
| `refusal`, `chatter`, `write_guard` | the CLI's error class, the chatter guard's reason, the write guard's verdict |
| `read_text` | the model's reading of the target page, as returned |
| `cer` | windowed character error rate against the typed page (1 − `charAccuracyWindowed`, `scripts/eval/lib/metrics.mjs`), letters and digits only, after the read's header tags are removed; capped at 1 |
| `cer_unwindowed` | 1 − the plain character accuracy |
| `identity_aligned`, `identity_guard` | the identity guard (word overlap); `wrong_text` = guard failed where most runs pass it |
| `loop`, `cut` | letters > 2× or < 0.5× the page's median over runs |
| `call_id`, `call_pages`, `call_position` | the block call that read the page |
| `calls`, `usage_of_call` | calls the page's read took, and agy's usage for them: `input`, `output` (INCLUDES thinking), `thinking`, `cache_read`, `total` tokens |
| `wall_secs_of_call` | seconds the call took, at the box's load at the time |

## calls.jsonl.gz — every agy call of every run

`lang, run, call_id, ts, book_id, pages, page_ids, model, secs, refusal, calls, nudged, usage`. Refused and cut calls
are here: they are paid for. Quota cost a page = Σ priced usage ÷ pages in the run (rates in `runs.json`).

## runs.json

One object per run (settings, pool, start time, pages, calls, tokens by type, cuts) and `rates_usd_per_token`
(gemini-3.8-flash list rates: input, cached input, output).

## panel.json

The draw (seed 6740): per language the eligible books, the 40 targets (with their 8-page windows `window8`, the
4-page window `window4`, the reference's source id, letters and sha256) and spares.

## references/<licence>/refs.jsonl.gz

`slug, source, source_id, typed_facs, typed_page, ref_letters, ref_sha256, licence, ref_text`: the typed page each
target was scored against, under its own licence (see LICENSES.md).

## frame/

`table.json` (panel against the first-read lane's frame: century, face, long edge, letters), `sample-<lang>.json`
(the seeded 60-page frame sample), `faces-de.jsonl` (faces by eye), `weights.json` (post-stratification weights).

## confirmation/<name>/

`sample.json` (the draw), `written.json` (the text each route would write), `packet.json` (the blind items),
`key.json` (item → route, controls), `verdicts-opus.jsonl` (the judge's verdicts), `score.json` (the rule's measures).

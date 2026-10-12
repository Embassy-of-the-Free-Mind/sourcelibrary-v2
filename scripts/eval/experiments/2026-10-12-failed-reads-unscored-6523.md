---
stage: ocr
measure: accuracy
languages: [Latin, English, German, French, Greek, Chinese, Armenian]
scripts: [latin, greek, han, armenian]
canons: []
n_books: null
n_pages: null
verdict: "A read that failed (the copy filter cut it, another refusal, an empty reply, a timeout) is now counted as 'did not read' and not scored, for every engine. On Latin print, 3.7 and 3.8 Flash through the CLI lose 3 of 44 pages to the copy filter; on the 41 they read they are 2.6 to 2.7 points a page better than Flash-Lite. Two rows are flagged partly measured (CLI 3.7/3.8 on German/French, 7 of 22 unread), and DeepSeek-OCR on Greek (41 of 109 empty)."
status: informational
decision: null
superseded_by: null
issue: [6523, 6576]
---
## 2026-10-12 · Failed reads are counted, not scored (#6523): the OCR Pareto measures quality only where an engine read

Job `cli-recitation-6523`, stacked on #6571 (6523c's route fix). $0 except step 8's 10 CLI calls (subscription) and
one Opus judging pass (subscription). The only database access was read-only.

**The rule (Derek, 2026-10-11).** "It shouldn't even score when it fails due to memorization", and later: "Count them
but don't score them. We only want to know quality when it works." Until now `build-ocr-pareto.mjs` scored a refused,
empty or unplaceable read as 100% error, for every engine alike (#6386).

### The detector: `scripts/lib/read-failure.mjs`
One pure function, `readFailure()`, shared by every engine. It returns null (scored) or one kind:

| kind | fires on |
|---|---|
| `copy_filter` | finishReason `RECITATION`; the CLI's "This request was blocked by Gemini's filters" (meter `SAFETY` on a CLI row); a `<warning>` naming verbatim/recitation/filter; a first-person decline ("I am unable to provide / output / reproduce …") whose sentence names a copy reason (verbatim, recitation, copyright, filter, protected or published work) |
| `refusal` | any other refusal finishReason (`SAFETY` on the API, `PROHIBITED_CONTENT` …), or a decline with no copy reason ("I cannot provide a direct transcription of this text. However, I can provide a summary") |
| `empty` | no text, or fewer than 5 letters; an API page with zero bytes and no meter row (refusals.mjs `inferred`) |
| `timeout` | the runner's error says timeout (agy's print timeout returns a partial reply with exit 0) |
| `other` | text came back but the extractor leaves no transcription in it: a plan note or chat only |

A partial read that the filter cut mid-page is `copy_filter`, not a scored page.

- **Positive control:** 6523c's by-eye catalogue (`causes.json`, issue #6523, 2026-10-11) gives these counts:
  - 35 of 35 recitation cuts, 4 of 4 filter blocks, and 1 of 1 filter-naming prose refusal fire as `copy_filter`;
  - all 5 timeouts fire as `timeout`, and all 34 tool-denied empties as `empty`.
  - It is pinned in `tests/unit/read-failure.test.ts` on `tests/fixtures/copy-filter-6523.json`. Each fixture is the reply cut to a window around its filter sentence.
  - The paid-API 3.8 Flash `RECITATION` rows (25 `ref-ws`, 11 EEBO in the #6293 bench meters) fire on finishReason.
- **Negative controls:**
  - The 3 catalogued real misreads stay scored, and so do the 5 doubled/restarted replies, which carry no filter wording.
  - The detector finds 0 copy-filter or decline sentences in the 10,460 stored reads of 25 engines on the #6293 bench. That includes 908 lite reads, 850 3 Flash, 741 Sonnet, 84 Opus, and every self-hosted engine.
  - It also finds 0 in the 2,004 reference transcriptions in `ground-truth-ws/` and `ground-truth/`. Those are real printed text, which says "I cannot" too. The test re-runs this one in CI.

**One departure from the brief: an unplaceable read stays scored, as a 100% error.** The brief listed "an unalignable reply" among the failures. Read as a rule, that would drop:
- Tesseract's 9 of 9 Armenian pages, whose output is too garbled to place against the reference;
- the invented page 6523c's R2 wrote from memory.

Those are the worst misreads, and unscored they would vanish: the Armenian panel failed to build. Text the engine produced for the page is a read, so it stays scored. The data counts these reads as `unplaced` beside `did_not_read`. A copy-filter stub too short to place is caught by its wording or its finishReason first.

### What the build does now (`build-ocr-pareto.mjs`)
- **Panel pages:** unchanged. A panel keeps every page every engine was run on.
- **Per engine:**
  - `accuracy` and its works-bootstrap interval cover the pages it read;
  - `fail_share` ("over half wrong") covers those same pages;
  - `did_not_read: {k, n, kinds}` and `unplaced` are new;
  - `partly_measured` (with the reason) is set when k/n > 0.2.
- **"vs in use"** pairs only pages both engines read. The noise band pairs only pages both runs read.
- **How each read is judged:**
  - **CLI reads** by their own committed reply and meter (`outputs-*.jsonl`, `meter-*.jsonl`).
  - **Every other engine** by its scored cell: `finish_reason` (now carried by `lib/benchmark-rows.mjs`), the refusal flag, and the content length.

`benchmark-dashboard-data.mjs` output is unchanged.

### Before → after (primary panels; `src/data/ocr-pareto.json`)
Accuracy is 1 − mean CER; "vs in use" is in points a page. **Partly measured** = the engine did not read more than one page in five.

| chart | engine | accuracy | over half wrong | did not read | vs in use |
|---|---|---|---|---|---|
| Latin (44) | 3.8 Flash CLI | 94.2 → 98.8 | 4.5% → 0% | 3 (copy filter 3) | −2.1 same → +2.6 better (n 41) |
| Latin (44) | 3.7 Flash CLI | 92.0 → 98.7 | 6.8% → 0% | 3 (copy filter 3) | −4.3 same → +2.7 better (n 41) |
| Early English (44) | 3.8 / 3.8 high / 3.7 / 3.6 CLI | 92.8 / 92.6 / 92.3 / 92.0 → 94.8 / 94.7 / 94.5 / 92.9 | | 1 each (copy filter) | −1.2 … −2.1 → +0.6 … −1.1 |
| German/French (22) | 3.8 Flash CLI | 71.6 → 99.7 | 27.3% → 0% | 7 (copy filter 2, empty 5), **partly measured** | −27.4 worse → +0.3 same (n 15) |
| German/French (22) | 3.7 Flash CLI | 70.6 → 92.2 | 27.3% → 6.7% | 7 (copy filter 6, refusal 1), **partly measured** | −28.5 worse → −7.3 same (n 15) |
| Greek (24) | 3 Flash (in use) / lite | 87.0 / 82.5 → 90.8 / 86.1 | | 1 each (copy filter) | lite −4.5 → −4.7 same |
| Chinese manuscript (498) | 3.8 Flash CLI | 70.4 → 76.0 | 11.2% → 3.9% | 38 (copy filter 22, timeout 9, empty 7) | +0.4 same → +4.8 better (n 460) |
| Chinese print (12) | 3.8 Flash CLI | 75.9 → 82.8 | | 1 (empty) | −6.2 → +1.4 (not fit) |
| Armenian (5) | 3.8 / 3.7 CLI | 78.3 → 97.9 / 97.8 | | 1 each (copy filter) | (not fit) |

Secondary panels with a partly-measured row: Greek editions (109 pages), where DeepSeek-OCR returned nothing on 41 pages. Its accuracy goes 26.2 → 42.0, with the verdict still worse, −48.8. The full per-panel table is in the #6523 comment.

**What a reader should take from it:**
- On Latin print, 3.7 and 3.8 Flash read the pages they agree to read better than Flash-Lite, by 2.6 to 2.7 points a page, on 41 paired pages.
- They decline 3 of 44: the famous Wikisource texts.
- The German/French row still carries #6293's route config. Five of its seven unread pages are tool-denied empties that #6571's gate fixes. Those 22 pages need a re-read before that row means much; 6523c estimated about 70 calls.
- Copy-filter counts per engine × panel: 3.8 CLI hits it most (22 of 498 Chinese manuscript pages, 6 of 109 Greek editions); lite and 3 Flash 1 each on Greek (API `RECITATION`).

### Translation runner forward fix (step 8)
`scripts/batch/cli-translate.mjs` now uses the OCR runner's #6523 config, through one shared module, not a copy:
- `scripts/lib/agy-cli.mjs` holds `agyCall`, `installToolGate`, `gateCalls`, `unwrapRead`, `gatedTextCall` and `TRANSLATE_SUFFIX`, moved out of `cli-ocr.mjs`;
- the gate takes `AGY_GATE_TASK=translate`, whose denial reason says no tool is needed;
- the reply is asked for between `<<<BEGIN>>>`/`<<<END>>>`; `.raw.txt` keeps the reply and `.txt` the inside;
- `apply` refuses a wrapper problem or an error class, and the chatter guard stays as the backstop.

**Check:** 10 pages of the #6182 xl panel, one per language stratum across 10 languages, seed 6523. The frozen #6182 prompt plus the suffix, 3.8 Flash low through `agy -p`.
- Markers on 10 of 10, 0 text outside them, 0 empties, 0 retries, 0 tool requests.
- One blind Opus pass (#5695 xl prompt) saw the new read, the stored C38 read and the stored G38 read in shuffled labels. Fidelity:
  - new 4.5, stored C38 4.4, G38 4.4;
  - **new − stored C38: +0.1, 95% [−0.2, +0.4]**, 3 of 10 pages differ;
  - the judge's own retest (stored C38 re-judged against its stored J1 score) moves by a mean of 0.2 in absolute terms, on 2 of 10 pages;
  - 0 reversals in the new reads.
- Within noise. `results/cli-translate-check-6523/`.

The running Tengyur driver (`tengyur-cli-6361`) was not touched.

### The paid translation prompt (step 9)
- **Where it is built:** all paid lanes (realtime `realtime-translate.mjs`, batch `translate-batch-chained.mjs`, `translate-batch-seam.mjs`) build the prompt with `translate-core.mjs buildTranslationPrompt` from the DB default `translation` prompt (v13, "Standard Translation").
- **What it asks:** its "Output contract (CRITICAL)" forbids introductions by name ("no introductions ('Here is the translation…')"), so output-only is already asked for.
- **Pages written in the last 30 days:** 1,010,545 by `translation.updated_at`.
  - A server-side prefilter found 104 that say "here is … translation".
  - 0 match #6539's rule. 2 match the broad announcing-line shape:
    - a Flash-Lite batch page whose book says it: *Mission Tilho* p494, "Voici la traduction de ce document…" (not a leak);
    - one **CLI** Tengyur page, Derge Tengyur vol. 101 (`6abeb2b4896ea18127c8331f`) p160. It opens by quoting the output contract and then says "Here is the exact translation:". It is a leak that #6539's narrowed rule misses, because the echo is on the lines before. It was reported, not repaired.
- **Paid pipeline: 0 pages. No prompt change proposed.**

---
stage: ocr
measure: accuracy
languages: [la, en, de, el, zh, hy, syc]
scripts: [Latn, Grek, Hani, Armn, Syrc]
canons: []
n_books: null
n_pages: 919
verdict: "No chart point and no route test. DeepSeek V4.1 Flash (Wafer endpoint) reads Latin print at 0.916 [0.907, 0.928], below Flash (0.947 [0.937, 0.955]) and Flash-Lite (0.933); Greek 0.821 against Flash 0.932; Chinese manuscript 0.782 against the leader 0.817. Its one decent cell is Chinese manuscript, where it beats Flash-Lite (0.742) but not Flash. On Syriac 22 of 40 pages run to the token cap (accuracy 0), and 94 of 151 repair-queue pages read worse than their stored text by a blind Opus audit."
status: informational
decision: "None: a measurement. The DeepSeek-hosted endpoint was not usable from this account, so this is the Wafer deployment of the model (#224)."
feeds: none
defect_rates: "none — CER against typed references; the repair-queue read was judged by one blind Opus pass, no controls (see that section)"
superseded_by: null
issue: 224
---
<!-- PRIOR ART: 2026-11-11-cheap-vlm-latin-pennies-6011.md (the same runner, scorer, generic prompt, temperature 0, one pinned endpoint, failed-read and unaligned rules, applied to Latin only; this adds one arm and the other seven wave-2 sets) and 2026-10-07-ocr-engines-full-sets-wave2-6011.md (the sets and the engines it is compared with). -->
## 2026-11-13 · DeepSeek V4.1 Flash as an OCR reader on the sealed panels (#224)

- **Question.** DeepSeek's new vision model, `deepseek/deepseek-v4.1-flash-1017` (OpenRouter, 17 October snapshot, image input), costs about $0.04 per million input tokens. Does it read the wave-2 panels as well as the engines we already scored?
- **Answer: no, on every set but one.** It is below Gemini 3 Flash on Latin, English, other Latin-script, Greek and Armenian; level with it on Chinese print; and on Chinese manuscript it is above Flash-Lite and below Flash and the leader. Its Syriac read is unusable.
- **The endpoint is not the one the brief named.** The DeepSeek-hosted endpoint is removed from every request by this OpenRouter account's privacy setting ("Paid model training violation (account settings)"), so `--provider=deepseek` returns 404. I did not change the account setting. The run is pinned to **Wafer `wafer/us`** (mxfp4, $0.038/M in, $0.50/M out), the endpoint behind the brief's price, with no fallback. The 11 November lesson applies: the same model on another endpoint can read differently, and this result is Wafer's deployment, not DeepSeek's own.

### Design

- **Pages.** Wave 2's eight most-pages sets (`/root/engine-wave2-6011/sets.json`): Latin 158, early English 44, other Latin-script 23, Greek 127, Chinese manuscript 503, Chinese print 19, Armenian 5, Syriac 40. That is **919 pages**; the brief's "661" is the number of pages each wave-2 engine had to read, because wave 1 had read the rest. DeepSeek read all 919.
- **Arm.** `openrouter/deepseek/deepseek-v4.1-flash-1017` through `benchmark-run-api.mjs`, unchanged: generic transcription prompt, `temperature: 0`, `max_tokens` 16,000, `reasoning: {enabled: false}`. Wafer accepts reasoning disabled and metered **0 reasoning tokens** on all 919 pages. Every call was served by Wafer.
- **Bench and scorer.** `cheap-vlm-latin-6011/build-bench.mjs` covers Latin only, so `deepseek-vision-224/build-bench.mjs` is the same builder over all eight sets. Scoring is `benchmark-score.mjs` unchanged, with the references from the repo and the Chinese cohort references unpacked from their bundle (left packed, the scorer silently scores all 432 cohort pages against a proxy engine; wave 2 recorded the same trap). Syriac is scored by `benchmark/syriac-retest/score-syriac-retest.py` against the published PAGE-XML ground truth, fetched from Zenodo (records 18157525 and 14714089) because it was not on this box; only DeepSeek and Flash were re-scored there, the other Syriac engines are the committed cells. `deepseek-vision-224/panel.mjs` is the 6011 panel over eight sets.
- **Shared pages.** Per set, a page stays where Flash, Flash-Lite and each wave-2 reader that covers at least half the set (Sonnet or Opus, Qwen3-VL 8B, Chandra, Mistral, DeepSeek-OCR) aligned and none failed. For Latin this reproduces the 11 November panel exactly (145 pages; Flash 0.947 [0.937, 0.955]). The new arm is not in the rule: its unaligned read is a scored 100% error, a failed read is counted and not scored (none failed, except one Chinese print page). **Armenian and Syriac use a relaxed rule** (a cell that exists and did not fail is shared) because in both a committed CER of 1 is a real scored result, and the strict rule leaves 0 pages.
- **Measure.** Accuracy = 1 − median CER, page bootstrap of the median (B = 2,000, seed 6011), paired against Flash on shared pages. One run per arm.

### Probe (stage 1)

- 3 Latin pages (Copernicus, Newton's *Principia*, a botanical preface): Wafer returns the pages' own text, so the image was taken. Not the 11 November Wafer failure.
- Reasoning disabled accepted; 0 reasoning tokens. About 1,000 input tokens per page (Wafer downsizes the image; GLM on 11 November billed about 5,100) and 650–1,460 output.
- **Not deterministic at temperature 0:** three reads of one page returned three different texts (same length, 2,053 characters; the checksums differ). One run per arm therefore moves a little on a repeat; it would not close a gap this size.

### Result by set (accuracy = 1 − median CER, shared pages)

| set | n shared | DeepSeek V4.1 Flash [95% CI] | Gemini 3 Flash | Flash-Lite | DeepSeek-OCR | best engine on the set | worse / better vs Flash, median ΔCER [CI] | failed | unaligned |
|---|---|---|---|---|---|---|---|---|---|
| Latin | 145 | **0.916** [0.907, 0.928] | 0.947 [0.937, 0.955] | 0.933 | 0.904 | Flash 0.947 | 124 / 12, +0.019 [0.014, 0.025] | 0 | 2 |
| Early English | 43 | **0.952** [0.940, 0.964] | 0.964 [0.957, 0.972] | 0.947 | 0.937 | Sonnet 0.968 | 29 / 8, +0.003 [0.001, 0.017] | 0 | 0 |
| Other Latin-script | 23 | **0.989** [0.986, 0.990] | 0.998 | 0.995 | 0.952 | Flash 0.998 | 23 / 0, +0.011 [0.005, 0.012] | 0 | 0 |
| Greek | 86 | **0.821** [0.742, 0.861] | 0.932 [0.912, 0.941] | 0.885 | 0.525 | agy Flash 3.7 0.935 (Flash 0.932) | 81 / 4, +0.071 [0.042, 0.109] | 0 | 0 |
| Chinese manuscript | 503 | **0.782** [0.761, 0.799] | 0.798 [0.781, 0.816] | 0.742 | 0.571 | PaddleOCR-VL 0.817 | 248 / 170, 0 [0, 0.005] | 0 | 0 |
| Chinese print | 19 (18 paired) | **0.725** [0.632, 0.850] | 0.753 [0.636, 0.886] | 0.724 | 0.593 | Flash / Opus 0.753 | 7 / 6, 0 [−0.010, 0.006] | 1 | 0 |
| Armenian | 5 | **0.975** [0, 0.985] | 0.993 | 0.971 | 0.889 | Flash 0.993 | 5 / 0, +0.018 [0.011, 0.971] | 0 | 2 |
| Syriac | 40 | **0** [0, 0] | 0.233 [0.146, 0.332] | 0.009 | 0 | Sophro 0.624 | 27 / 1, +0.220 [0.052, 0.310] | 0 | 0 |

Notes on reading the table:
- The shared set for Greek is 86 of 127 and for Chinese print 19 of 19 because Chinese print has Flash cells on 12 pages; the two sets that shrank do so under the rule above, as in wave 2.
- **Armenian is 5 pages.** The interval is a bootstrap of 5 numbers and means nothing; two of its five reads are scored at 100% error (mean accuracy 0.587).
- **Chinese print is 12–19 pages**; the interval spans Flash and the engines above it.
- "Best engine" is the highest accuracy among engines with a cell on at least 90% of the shared pages, agy (subscription CLI) arms included.
- Comparators are the committed wave-1/2 outputs re-scored on this bench where they are on this box, and the committed per-page cells otherwise (Flash's EEBO texts, and Syriac); the Latin re-score reproduces wave 2.

**Against the two outcomes in #224.**
- *Inside or above Flash's interval on Latin:* no (0.916; Flash's lower bound is 0.937).
- *Above the best engine on a script where Gemini is not the leader:* no. Chinese manuscript is the one such set that DeepSeek reads decently (0.782, upper bound 0.799), and the leader is PaddleOCR-VL / Qwen3-VL at 0.817.
- *Below Flash-Lite everywhere:* nearly, not exactly. It is below Flash-Lite on Latin, other Latin-script and Greek, level on English, Chinese print and Armenian (n = 5), and **above Flash-Lite on Chinese manuscript** (0.782 [0.761, 0.799] against 0.742 [0.720, 0.761]). That is the only cell where it is a candidate for anything, and Flash already beats it there.

So this is the second outcome: one experiment file, no chart point, no route test.

### What the errors are (by eye, read by the job session with the page image open)

Ten pages: the five with the highest CER across all 919 (all five are Chinese manuscript, CER capped at 1, raw CER 8.8 to 24), and five drawn at random with seed 224. Page images opened for all ten.

| # | page | CER | what it is |
|---|---|---|---|
| 1 | `chinese-cohort-5547-e32226-p107` (worst) | 1 (raw 24.5) | Reads the first ten columns roughly right, then collapses to `人 人 人 …` until the 16,000-token cap (12,774 characters for a page of about 250). Looping. |
| 2 | `chinese-cohort-5547-e25c68-p73` (worst) | 1 (raw 17.7) | Reads the two opening lines correctly (the page quotes the *Zuozhuan* under 斬), then keeps writing *Zuozhuan* from memory, text that is not on the leaf, to the cap. Invented continuation. |
| 3 | `chinese-cohort-5547-213ec8-p79` (worst) | 1 (raw 17.6) | A dictionary page with large head-words and small notes. Reads part, mixes the column order, loops to the cap. |
| 4 | `chinese-cohort-5547-9cfca4-p58` (worst) | 1 (raw 15.3) | Starts on the real header (欽定四庫全書 卷四十二), then repeats a made-up sentence about 旄 ("旄 音 毛 又 音 髳 下 云 旄 牛 尾 本 或 作 旄…") that is not on the page. Invented and looping. |
| 5 | `chinese-ext-2006a1-p13` (worst) | 1 (raw 11.2) | Misreads the running header (欽定四庫全書 as 金 寅 四 月 全 書), then reads the columns with a space between every character and recycles them past the page's end until the cap. |
| 6 | `ed-6a48d782…-p21` (Latin, random) | 0.161 | A good read of a 1654 pamphlet. Long s read as `f` throughout (`funt`, `pofuit`, `Auftriacæ`), which the reference, in modern spelling, counts as errors; the page number 7 read as 9. The reference window starts with words from the previous leaf, so part of the 0.161 is the reference, not the engine. |
| 7 | `chinese-15f73d-p10` (random) | 0.352 | A modern typeset page of the *Amitabha Sutra*. The read is correct, punctuation included. The reference window opens with the east-quarter paragraph that is not on this leaf, so the 0.352 is a reference misfit. **A scoring artefact; no engine error.** |
| 8 | `ed-6a08fd63…-p27` (English, random) | 0.090 | *The Jew of Malta*, a negative-print scan. Mostly right; `sit so sadly` read as `sit to fady`, `sleepe` as `fleepe`, `walke` as `wake`, and a header the reference lacks. |
| 9 | `chinese-cohort-5547-1ef65d-p130` (random) | 0.142 | An accurate read. It adds the printed header (欽定四庫全書 卷六), which the reference leaves out, and reads 王泌 as 王沿 (a variant). |
| 10 | `ed-6a90675c…-p9` (Latin, random) | 0.094 | An accurate read of a Latin treatise page. Long s as `f`, `&` where the reference has `et`, hyphenated line ends kept. The reference window starts a sentence before the page. |

What the ten show:
- **The failure that moves the score is runaway output, not misread letters.** On the three sets where DeepSeek is poor (Chinese manuscript, Greek, Syriac) it keeps generating after the page is read: repetition (`人 人 人`, a repeated sentence), or fluent text from memory that is not on the leaf. The token cap (16,000) was hit on 14 of 127 Greek pages, 6 of 503 Chinese manuscript pages and **22 of 40 Syriac pages** (median 70 s per Syriac page, $4.57 per 1,000). A further 10 reads across the sets were cut short by the endpoint with finish `error` (they are scored as misreads, the shared rule). No refusal on any page.
- **On Latin and English the reads are faithful and the loss is small and systematic:** long s read as `f` (a real misread, not the reference's modernisation), which is what pulls Latin to 0.916; hyphenation and abbreviations are kept. It does not invent text on those pages.
- **Three of the five random pages are scoring artefacts of the reference window**, not DeepSeek errors (#6, #7, #10). The 11 November pennies test saw the same on its Latin set; it applies to every engine alike.
- Not seen in these ten: modernised spelling, a refusal.

### The repair queue (Derek's note, 2026-11-13)

Derek added, inside the same cap: read the 151 kept rows of `error-zoo/repair-queue-2026-11-12.json` (status queued 42, needs-second-read 75, not-confirmed 34; each has a serious OCR finding on text that is unchanged) with the same call, no write, and audit them with the blind Opus instrument of `repair-8632/README.md`.

- **Reads.** The same Wafer call on each page's image (read-only from Mongo; the stored text is untouched). 151 pages, $0.107. 5 hit the token cap and 4 were cut by the endpoint; 1 returned no text.
- **Audit.** `deepseek-vision-224/repair-audit.mjs` builds the same items as `driver.mjs audit-packets` (stored text against the new read, X/Y drawn per page by hash, no diff hint) and runs the same sealed Opus (`claude -p --model opus --restricted`, `AUDITOR.md`, Read and Write only, image opened per item) in 16 chunks of up to 10: **150 Opus verdicts, well under 400**, so no sampling. The Opus calls are subscription quota, not an API bill (their list value is about $13). The auditor picks the more faithful text and says whether the other would mislead a reader. I map it to Derek's three columns: **finding fixed** = Opus prefers DeepSeek's text and says the stored text would mislead; **new serious error** = Opus prefers the stored text and says DeepSeek's would mislead; **did not read** = no text came back. The rest is `same` or a preference with no serious flag.
- **This is one judge with no controls.** No wrong-page or planted-change control and no A-vs-A arm ran, and a second judge (Gemini Flash) did not; the #6694 rule wants both. Read it as a screen. It also cannot say whether the *particular* finding on the queue row is the one that was fixed: the queue keeps the finding's class, not its quote, so "fixed" means "the stored text misled and DeepSeek's did not".

| group | n | finding fixed | new serious error | did not read | same / minor |
|---|---|---|---|---|---|
| **all** | 151 | 17 / 151 | **94 / 151** | 1 / 151 | 39 / 151 |
| latin-lite/print | 86 | 10 / 86 | 58 / 86 | 1 / 86 | 17 / 86 |
| german-lite/print | 36 | 2 / 36 | 17 / 36 | 0 / 36 | 17 / 36 |
| german-flash3/print | 19 | 0 / 19 | 15 / 19 | 0 / 19 | 4 / 19 |
| french-lite/print | 8 | 5 / 8 | 3 / 8 | 0 / 8 | 0 / 8 |
| german-lite/unknown | 2 | 0 / 2 | 1 / 2 | 0 / 2 | 1 / 2 |

By language and half-century of the book (`year` from the book record; groups under 5 pages are shown but say little):

| language, half-century | n | finding fixed | new serious error | did not read | same / minor |
|---|---|---|---|---|---|
| Latin 1450–1499 | 47 | 5 | 35 | 1 | 6 |
| Latin 1500–1549 | 9 | 1 | 4 | 0 | 4 |
| Latin 1550–1599 | 9 | 2 | 3 | 0 | 4 |
| Latin 1600–1649 | 8 | 2 | 6 | 0 | 0 |
| Latin 1650–1699 | 5 | 0 | 5 | 0 | 0 |
| Latin 1700–1749 | 8 | 0 | 5 | 0 | 3 |
| German 1450–1499 | 4 | 0 | 4 | 0 | 0 |
| German 1550–1599 | 7 | 0 | 6 | 0 | 1 |
| German 1600–1649 | 15 | 0 | 11 | 0 | 4 |
| German 1650–1699 | 10 | 2 | 4 | 0 | 4 |
| German 1700–1749 | 5 | 0 | 2 | 0 | 3 |
| German 1750–1799 | 14 | 0 | 5 | 0 | 9 |
| German 1800–1899 | 2 | 0 | 1 | 0 | 1 |
| French 1500–1549 | 1 | 0 | 1 | 0 | 0 |
| French 1800–1849 | 1 | 0 | 1 | 0 | 0 |
| French 1850–1899 | 3 | 2 | 1 | 0 | 0 |
| French 1900–1949 | 3 | 3 | 0 | 0 | 0 |

- **Reading.** On pages already chosen for having a serious OCR finding, DeepSeek's read is the more faithful text on 17 of 151 and the *less* faithful on 94 of 151 (62%). Its fixes cluster in the French books of 1850 on and in a few Latin pages; its worst cells are Latin incunabula (35 of 47), 17th-century German in Fraktur, and the `german-flash3` cell (15 of 19). That matches the panels: this model is not a repair reader for hard early print. Opus's notes on the 94 name wrong words, dropped lines and, in a few, another leaf's text; the 15 pages where DeepSeek was cut or looped are among them.
- The queue's own rule stands: the stored text on these pages is already known to carry a serious finding, so "new serious error" is DeepSeek being worse than text that is itself flawed, not worse than a clean page.

### Cost and speed

- **OpenRouter billed `usage.cost`, summed from the meter files: $0.540 for the 919 panel pages** (**$0.59 per 1,000 pages** over the mix; **$0.36** per 1,000 Latin, $0.21 Chinese manuscript, $1.33 Greek, $4.57 Syriac, because the cost follows the output, and runaway output is billed). Plus $0.107 for the 151 repair pages and $0.003 for probes: **$0.65 total**, against an estimate of $0.40 and a cap of $3. The estimate used 661 pages and 5,000 input tokens a page; the pages were 919 and Wafer bills about 1,000 input tokens a page.
- **Median 3.9 s a page** over all 919, at concurrency 4: Chinese manuscript 2.4 s, Latin 6.5 s, Greek 9.8 s, Armenian 17.4 s, Syriac 70.2 s.
- For comparison, wave 2 measured Sonnet at $16.18 per 1,000 Latin pages, DeepSeek-OCR $0.85 GPU, Qwen3.7-Flash $0.15, GLM-5.3-Flash on Z.AI $1.09 (11 November).

### Caveats and what was not measured

- **Wafer, not DeepSeek's own endpoint** (see the top). On 11 November the same model scored 0.926 on its maker's endpoint and invented text on a cheap one. The DeepSeek-hosted deployment could be better or worse than this; it is untested because the account setting excludes it. Re-running there needs Derek to change that setting (a privacy choice about training on paid prompts), which I did not do.
- **One run per arm, and the model is not deterministic at temperature 0.** The Syriac and Chinese-manuscript loops would not repeat identically.
- **Not measured:** reasoning on (only "disabled" was run; the endpoint also lists `reasoning_effort`); a larger `max_tokens` or a stop sequence, which would cut the runaway output and is the first thing to try if anyone wants the Chinese manuscript number; the other quantised endpoints; Armenian beyond 5 pages; any translation use; the page-level repair claim at the finding's own quote.
- **Greek and Chinese print shared sets are 86 and 19 pages** and Chinese print is a 12-page comparison.
- **The panel's Syriac is the 40 pages of two manuscripts**; every engine is near 0 there, so "worse than Flash on 27, better on 1" carries the information, not the medians.
- **No production writes.** No page, book or Mongo write; no change to `src/data/ocr-pareto.json` or a routing table.

**Artifacts:** `scripts/eval/results/deepseek-vision-224/`: `outputs-deepseek-v4-1-flash.jsonl.gz` and `meter-deepseek-v4-1-flash.jsonl` (all 919 reads, every finish reason and route), `scored/` (the full re-score, comparators included, gzipped, plus the Syriac ground-truth score), `panel.json`, `meter-by-set.json`, and `repair-queue/` (reads, meter, the Opus audit result and key, page metadata). Scripts: `deepseek-vision-224/build-bench.mjs`, `panel.mjs`, `fetch-repair-pages.mjs`, `repair-audit.mjs`; the runner and scorer are unchanged.

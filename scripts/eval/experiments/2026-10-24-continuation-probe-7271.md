---
stage: ocr
measure: accuracy
languages: [English, French, Greek, Dutch, Sanskrit, Latin]
scripts: [Latn, Grek]
canons: []
n_books: 55
n_pages: 55
verdict: "A RECITATION refusal does not mean the models know the page: neither Opus nor Gemini 3.8 Flash can continue any of 20 lite-refused pages (longest shared run ≤ 14 words), while Opus continues 4 of 20 matched never-refused pages near-verbatim. The probe passed both control gates."
status: informational
decision: "Do not use Gemini RECITATION refusals as a per-book 'the models already know this text' score; read them as 'a long copy is in Google's citation index' only (#7271, #6740)"
superseded_by: null
issue: 7271
---
<!-- PRIOR ART: scripts/eval/experiments/2026-10-07-ai-exposure-run3-6038.md (crawl presence by exact passage and a content-knowledge test that failed its controls; no continuation probe); .claude/docs/ocr-memorization-paper.md (memorisation measured indirectly through OCR accuracy). Design: #7271's body, unchanged. -->
## 2026-10-24 · Continuation probe: do the models know the texts Gemini refuses as recitation? No (#7271)

**Question.** Gemini's OCR refuses some pages with `finishReason: RECITATION` (the #6740 census: 51,641 of 2.02M lite-attempted pages, concentrated in English and in 1600s print). Does a refusal mean the models have the text memorised, so that the census could serve as a per-book "the models already know this" score? Test it directly, with no image: give a model the first 60 words of the page and ask it to continue.

**Answer.**

| engine | group | n | median longest run [95% CI] | median 8-shingle share [95% CI] | mean 8-shingle share [95% CI] | pages with run ≥ 20 | max run |
|---|---|---|---|---|---|---|---|
| Opus | P famous passages | 5 | 200 [130–205] | 1.00 [0.96–1] | 0.98 | 5 | 205 |
| Opus | N our post-July text | 10 | 4 [2–13] | 0 [0–0.04] | 0.10 | 2 | 151 |
| Opus | **R lite-refused** | 20 | **3 [3–4]** | 0 [0–0] | **0.002** [0–0.006] | **0** | 14 |
| Opus | **M matched, never refused** | 20 | **3.5 [2–10]** | 0 [0–0.02] | **0.118** [0.014–0.247] | **4** | 133 |
| Gemini 3.8 Flash low | P | 5 | 200 [79–205] | 1.00 [0.75–1] | 0.94 | 5 | 205 |
| Gemini 3.8 Flash low | N | 10 | 3 [2–5] | 0 [0–0] | 0.001 | 0 | 8 |
| Gemini 3.8 Flash low | **R** | 20 | 3.5 [2.5–4] | 0 [0–0] | 0.003 | 0 | 14 |
| Gemini 3.8 Flash low | **M** | 20 | 3 [2–4] | 0 [0–0] | 0.001 | 0 | 11 |

Intervals are 95% percentile bootstraps over books (one page per book, 10,000 draws, seed 7271).

- **Controls passed (gates fixed in `score.mjs` before any reply was read).** Positives: median run ≥ 40 and median shingle share ≥ 0.50 — both engines reproduce Genesis 1, the Declaration, Bacon's *Of Truth*, *A Tale of Two Cities* and Caesar *BG* 1.1 near-verbatim (Gemini's weakest: Bacon, run 79). Negatives: median run ≤ 8 and median share ≤ 0.02 — both pass. So the probe measures something: a model that knows a text continues it word for word, and one that does not stops matching after 2–4 words.
- **Refused pages are not memorised.** Neither engine continues a single refused page for 20 words. The longest run, 14 on the same page for both engines, is the preamble Tesla's patents share ("subject of the Emperor of Austria-Hungary … residing at New York … have invented certain new and useful Improvements"), and the OCR's broken spacing ("certainnew", "partof") cuts the runs short. Both engines get the same nothing.
- **If anything, the contrast runs the other way.** Opus continues 4 of the 20 matched never-refused pages: Locke's *Essay* (133 words), Wirth's *Le serpent de la Genèse* (113), Burton's 1883 *Kama Sutra* (80) and *Oceanic Mythology* (20). R − M for Opus: mean 8-shingle share −0.115 [−0.245 to −0.014], mean longest run −16.7 [−35.6 to −1.8]; the medians do not differ (−0.5 [−7 to 1.5]). Gemini 3.8 Flash low continues none of the 40 (R − M mean share +0.001 [−0.003 to 0.007]).
- **Reading.** A refusal says a long copy of the page is in the index Google checks its outputs against. The page was published, scanned and is online (Google Books, HathiTrust, EEBO-TCP). It does not say a model can produce the text. A Gemini model cannot continue the pages Gemini refuses, and neither can Opus. The census is a map of *online presence*, not of *memorisation*, and must not be used as a per-book "already known" score. For #6740 that means: a refusal predicts that Gemini OCR will be refused again, not that a reader of that book is being served memorised text.

**One negative control failed by eye, and what it says.** Opus continued our own English translation of Meiderlin's *Tyrocinium Physico-Theologicum* (p. 10) for 151 words (shingle share 0.96), with the marginal note "Gen. 1. 14." in the right place. The book was imported 2026-07-05 (ObjectId and `created_at` agree), and the page's stored translation is dated 2026-10-01 (gemini-3.1-flash-lite; no `page_revisions` rows). A diagnostic call outside the sealed design gave Opus the page's *Latin* prefix: it invented a different continuation (longest run 2, `diag-opus-latin.json`). So Opus does not know the Latin; it has seen *our English*. The most likely explanation is that an earlier translation of this page, identical or nearly so, was public on sourcelibrary.org from July 2026, and that Opus 5.5's training data reaches into July 2026 for at least some of our pages. This is unverified: the Wayback CDX timed out, and the first translation date is not recorded. The other 9 negatives (same July import wave) score at chance, so exposure is partial. Consequences: (1) "first published after the cutoff" is not a safe negative-control rule for Opus at a July 2026 date; use a date clearly after any model's release; (2) **Source Library's own translations can be in a frontier model's training data**, which matters for the memorisation paper and for any "the model read it fresh" claim on our English. The George Fox *Margarita* (run 22) is benign: the Latin is a translation of Fox's English tract, and the English rendering drifts back toward Fox's own words.

**Design.** As #7271's body; nothing redesigned.
- **Draw** (`draw.mjs`, sealed and committed before any model call, commit 3884b3d0e): one page per book. Each page's cleaned text has ≥ 270 words, ≥ 80% of them with two or more letters, and its page type is running text (no index, title or table pages, and not Google's scan boilerplate). Prefix = words 1–60, truth = words 61–260.
  - **R**: a page with `ocr.recitation_count ≥ 1` and stored `ocr.data` from a model (not the Archive's own OCR), in a book with a `recitation_blocked` page. That is the indexed entry point; a scan on `recitation_count` times out. Text source: lite's own later read for 14, Gemini 3 Flash for 5, MinerU for 1. Recitation counts: 1 for 14 pages, 2–5 for 6.
  - **M**: for each R book, a book with the same `books.language` and century, no page with `recitation_count ≥ 1` anywhere, and a page read by flash-lite.
  - **N**: the English translation, by a non-Claude model, of a page in a book imported on or after 2026-07-01. Three canonical works were removed by eye before any call (the Derge Tengyur, the Ignatius letter, the Hess–Luther dialogue), with reasons in `draw.mjs`. Manuscript transcriptions were the brief's first choice. Of the post-July books the OCR calls handwritten, the two Latin ones with long enough pages turned out to be incunabula, so none qualified.
  - **P**: five famous passages from Gutenberg and The Latin Library.
- **Probe** (`probe.mjs`): one call per page per engine, 110 calls in all, no image, no tools, no retries. The prompt is identical for both engines and recorded in every raw row: "Continue this text exactly, word for word, from where it stops. Write the next 200 words of the original text as they appear in the source. Do not translate, summarise, modernise or comment. If you do not know the source, write your best guess at how it continues." The reply goes between `<<<BEGIN>>>`/`<<<END>>>` markers. Opus: `claude -p --model opus --tools ""` in an empty directory on l7a (derek@sourcelibrary.org subscription), median 12 s. Gemini: `agy -p --model gemini-3.8-flash-low` through `agy-cli.mjs gatedTextCall` (plan mode, tool gate, one attempt). It ran as a sub-job on main, because agy is not signed in on l7a; median 18 s, 0 tool calls. All 110 replies were clean (no error, nothing outside the markers). Neither CLI exposes temperature.
- **Score** (`text.mjs`, `score.mjs`): compared after NFC, ſ → s, lower case and removing punctuation and symbols (u/v and i/j are not folded). Two scores: the longest run of consecutive words shared with the 200-word truth, and the share of the truth's 8-word shingles that occur anywhere in the reply.

**What this does not cover.**
- n = 20 + 20. "Refused pages are not memorised" is strong: 0/40 engine-page pairs reach a 20-word run. The R − M difference for Opus rests on 4 pages and is directional only.
- Matching uses `books.language`, which is wrong for a few books (a French Damascius translation labelled Greek; a Tamil manuscript labelled Sanskrit). The pairs are matched on the catalogue label, not on the text.
- The R truth comes from a later read (mostly lite on retry), and the M truth from lite. Both are VLM transcriptions with some error, which lowers every score a little and equally.
- Exact continuation tests verbatim memory of *this edition's* wording. A model can know a work in another edition or translation and still score 0. Knowledge of content (as opposed to wording) is not tested here (#6038 run 3's content test failed its controls).
- One engine size each. Gemini 3.8 Flash low is a small tier; a larger Gemini might continue more of M, but R would have to rise above M for refusal to become a memorisation signal, and nothing here suggests it would.

*Grade.* Decision-grade for "a RECITATION refusal is not evidence that the models can reproduce the page". Pilot-grade for the R − M direction, and for the observation that Opus has seen some of our July 2026 translations. *Decision.* The #6740 census stays an online-presence measure. Do not turn it into a "models already know this text" score. Treat our own post-June-2026 translations as possibly in Opus 5.5's training data. *Replicated?* No. *Cost.* $0 marginal: 55 Opus calls on the l7a Claude subscription, 55 Gemini 3.8 Flash low calls on the shared agy account, plus 1 diagnostic Opus call and 2 smoke calls. No paid API. Mongo was read-only. *Artifacts:* `scripts/eval/continuation-probe-7271/` (`draw.mjs`, `probe.mjs`, `score.mjs`, `text.mjs`); `scripts/eval/results/continuation-probe-7271/` (`sealed.json` with prefixes and truths, `raw-opus.jsonl`, `raw-gemini.jsonl`, `scores.jsonl`, `report.json`, `report.md`, `diag-opus-latin.json`).

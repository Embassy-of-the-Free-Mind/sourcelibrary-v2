<!-- PRIOR ART: 2026-10-04-reocr-lift-5700.md (#5700 A5) measured the Flash re-read on the English and priced the plan, but never tried a non-Gemini engine. 2026-09-21-which-engine-should-read-greek-print-per-period-4925.md scored Kraken greek-cllg on the transcription (CER vs Perseus/First1K), not on the English. No earlier run scored an open OCR engine by the translation its read produces. -->
## 2026-10-05 · Can an open OCR engine replace the Flash re-read, judged on the English? (#5870)

- **Question.** A5 priced re-OCR of Lite-read pages on Flash at about $719 (re-OCR + Lite retranslation) for Greek, Persian, Sanskrit and Pali. Would a free engine (Kraken on our CPU) buy the same English? Kraken greek-cllg passed the cost-lane rule on Greek print 1450–1699 transcription (2026-09-21). OpenITI publishes Kraken models for printed Persian and Arabic. Google Vision reads Devanagari.
- **Answer.** **No script moves off Flash.** Greek print ≤ 1699 is **undecided**: the Kraken English scores at least as well as the Flash English, 3.50 against 3.27, Δ +0.23 [−0.32, 0.73]. The interval is wider than the registered margin of 0.25 at n = 11. Even if a larger draw cleared it, greek-cllg takes about 5 minutes a page on this box, so 123,511 pages would be about 440 single-process CPU-days. The OpenITI models **lose** on Persian and Arabic print: 2.30 against 3.63, Δ −1.33 [−1.80, −0.83]. On Persian lithographs (nastaʿlīq) their read is close to noise, and Lite then translates the noise into fluent invented English. They lose on typeset Persian too. **Sanskrit has no arm**: no existing credential reaches Cloud Vision (needs a key: Derek). The A5 plan stands at **$719** (Flash re-OCR + Lite retranslation, Batch).
- **measure:** judged against a human reference. Two blind Opus judges used the shared harness (`translation-vs-reference/`) with source = the by-eye corrected transcription. Gate passed for both judges: wrong page 2/2, planted change 2/2 caught and located, duplicate 2/2 tied. Exact agreement 83 %, within one point 100 %, weighted κ 0.91, 78 cells. Not accuracy in the eval-design §2 sense.

### Design (preregistered in commit ee9f87c34, pushed before any engine ran)

- **Pages.** The A5 judged pages that are print: Greek with a book year ≤ 1699 (11 pages: 4 Lite-read, 7 Flash-read), Persian (7) and Arabic (8). Manuscripts were excluded (#5619: greek-cllg reads minuscule worse than Flash), as were Rashi and Hebrew. One page per book.
- **Arms.** `kraken`: Kraken 7.1 on Hetzner CPU, `nice -n 19`, default blla segmenter.
  - Greek: greek-cllg (CC-BY-4.0, DOI 10.5281/zenodo.22232579).
  - Persian: OpenITI `persian_best` (B. Kiessling, CC0-1.0, DOI 10.5281/zenodo.7051644).
  - Arabic: OpenITI `arabic_best` (CC0-1.0, DOI 10.5281/zenodo.7050296).
  - Arabic script was run with `-d horizontal-rl … --base-dir R`, as the Syriac lane runs it. Model sha256 values are in the run file.

  `flash`: the A5 `gemini-3-flash-preview` re-read, stored, **reused and not re-run**. `served`: today's OCR, shown to the judges as a third candidate and kept out of the rule.
- **English.** Lite (`gemini-3.1-flash-lite`), prompt v13 (content hash asserted, the A5 prompt), one page per request, temperature 0, thinking off. The Kraken arm went through the **Batch API**. The other two arms are A5's stored Lite translations.
- **Rule** `routing-eval/rules/translation-lift-v1.json`, the new `translationLift` check in `lib/routing-rules.mjs`:
  - (a) the lower 95 % bound of mean(Kraken − Flash) fidelity, paired by page, must be ≥ −0.25. The margin is the A5 A-vs-A floor: the same Flash read twice, Lite +0.03 [−0.17, 0.22], 29 pages.
  - (b) catastrophic pages (no usable read, or either judge types an `unreadable_fill` invention) ≤ Flash's + 1.
  - Fewer than 10 pages → not applied. Applied by `routing-eval.mjs decide`.
- **Negative control** (routing-eval's planted arm, extended to fidelity): an arm never better than Flash on any page, with a fifth of the pages set to 1. The rule refused it in both groups: Greek Δ −0.96 [−1.73, −0.27]; Arabic script Δ −1.57 [−2.07, −1.03].
- **Image bytes.** Kraken read the A5 request image (getPageSource, 1500 px JPEG), sha256 pinned in `sealed.json`. The CDN serves this URL with ±3 % byte jitter between fetches, so the bytes are not A5's own. The leaf and the resolution are the same.

### Result

| group | n | today (served) | Flash re-read | Kraken | Kraken − Flash [95 %] | better / same / worse | catastrophic Flash / Kraken | rule |
|---|---:|---:|---:|---:|---|---|---|---|
| Greek print ≤ 1699 | 11 | 2.68 | 3.27 | **3.50** | +0.23 [−0.32, 0.73] | 7 / 1 / 3 | 5 / 3 | a ✗ (inconclusive) b ✓ → **undecided, Flash stays** |
| Persian + Arabic print | 15 | 3.03 | 3.63 | 2.30 | **−1.33 [−1.80, −0.83]** | 1 / 2 / 12 | 1 / 7 | a ✗ b ✗ → **Flash re-read** |

**By served engine and language** (lift = arm − today's English on the same page):

| cut | n | today | Flash | Kraken | Flash lift [95 %] | Kraken lift [95 %] |
|---|---:|---:|---:|---:|---|---|
| Greek, served Lite | 4 | 2.00 | 3.63 | 3.50 | +1.63 [1.25, 2.00] | +1.50 [1.00, 2.00] |
| Greek, served Flash | 7 | 3.07 | 3.07 | 3.50 | 0.00 [−0.50, 0.57] | +0.43 [−0.57, 1.29] |
| Persian print | 7 | 2.86 | 3.57 | 1.86 | +0.71 [0.14, 1.36] | −1.00 [−1.71, −0.29] |
| Arabic print (all served Lite) | 8 | 3.19 | 3.69 | 2.69 | +0.50 [−0.06, 1.13] | −0.50 [−1.25, 0.13] |

- **Greek.** Kraken reads 16th–17th c. Greek type well enough that the English is as good as Flash's or better on 8 of 11 pages. Of the 3 losses, judges' reasons say: one read drops the Latin facing column (Macarius 1698); one breaks the Horapollo page into fragments with invented scraps; one misreads a line of the 1544 Euripides ("praised life" for "begging his living"). On the 7 Flash-read pages, a second Flash read adds nothing (as in A5), while Kraken adds +0.43. That fits the idea that an *independent* engine is what helps a page Flash already read, but n = 7 and the interval crosses 0. It is a hypothesis for the next draw, not a finding.
- **Persian/Arabic.** `persian_best` and `arabic_best` are base models trained on typeset Arabic-script print. Checked by eye, 4 of the 7 Persian pages are nastaʿlīq lithographs (Kitáb-i-Íqán 1882, Shahnama 1907 Nawal Kishore, two Masnavī 1851 leaves). Kraken reads them as a stream of plausible-looking letters, and its English scores 1, 1, 2 and 2. On the 3 typeset Persian pages it still loses: 2.5, 2 and 2.5 against Flash's 3.5, 4 and 4. Lite turns noise into confident, invented English: judges typed `unreadable_fill` on 7 of the 15 Kraken pages, and 4 scored 1. On modern typeset Arabic (Kalīla wa-Dimna 1905, al-Khwārizmī) the Kraken English ties Flash, 4 against 4 on both pages. It fails on Pococke's 1671 Oxford type (1 against 4) and on a Maqāmāt page that Flash tagged as handwritten naskh (1 against 3.5). An OpenITI model fine-tuned per typeface might do better. It would have to be trained, which is a separate decision and not a Kraken-vs-Flash question.
- **Catastrophic on Flash's side.** Judges typed `unreadable_fill` in the Lite English of the *Flash* read on 5 of 11 Greek pages (Kraken 3). Lite bridges what a Flash read of 16th-c. Greek type gets wrong with invented English, just as it does for a Kraken read. A re-read does not remove the need for the OCR-trust gate.

### Lift per $1K pages and wall clock

Prices per page, Batch: Flash re-OCR $0.00283 + Lite retranslation $0.00102 = **$3.85 per 1K pages** (A5). Kraken: $0 marginal CPU + Lite translation **$0.95 per 1K pages** (measured here, $0.0247 for 26 pages). Page-points (one page gaining one fidelity point over today) per $1K:

| script | Flash lift | Flash page-points per $1K | Kraken lift | Kraken page-points per $1K |
|---|---:|---:|---:|---:|
| Greek print ≤ 1699 | +0.59 | 153K | +0.82 | 863K (if adopted; the rule did not pass it) |
| Persian print | +0.71 | 184K | −1.00 | negative |
| Arabic print | +0.50 | 130K | −0.50 | negative |

Kraken wall clock on this box: two Kraken processes side by side, `nice 19`, load average 8–13 on 8 cores shared with every worker.
- greek-cllg: **307 s per page** (median 227 s), about 854 h per 10K pages in one process. That is about 36 days per 10K pages, or about **440 CPU-days for the 123,511 Greek Lite-read pages**.
- OpenITI: 112 s per page, about 310 h per 10K pages.
- So even at $0 a page, Kraken on this box cannot carry the Greek stratum on a useful timescale. It would need rented CPU or GPU, which has a price this run did not measure.

### The A5 plan, repriced under the winning engines

| script | Lite-read pages | winning engine | re-OCR + Lite retranslation | if Kraken had won |
|---|---:|---|---:|---|
| Greek | 123,511 | Flash re-read (Kraken undecided) | $476 | $117 + about 440 CPU-days |
| Persian | 6,222 | Flash re-read | $24 | — (Kraken loses) |
| Sanskrit | 49,278 | Flash re-read (no Vision arm: needs a key) | $190 | — |
| Pali | 7,479 | Flash re-read (no open engine named) | $29 | — |
| **total** | 186,490 | | **$719** | |

The issue's "$930" is the same plan with Flash retranslation (A5: $618 + $31 + $247 + $37 = $933). The "$530 if Kraken matches on Greek" scenario does not open. Kraken did not clear the margin, and on this box it would take over a year.

### Limits

- **n.** Greek has 11 pages. To clear a 0.25 margin when the true difference is +0.2 needs about 20 pages with a reference (SD of the paired difference here 0.96); if the true difference is 0 it needs about 55. The A5 references are the pool, and Greek print ≤ 1699 has no more of them.
- **Reference pool chosen for low scores** (A5 selection): these pages are worse than a random page of the stratum. That favours any re-read over today's text, and favours neither arm against the other.
- **The Flash arm is A5's single read.** Its own read-to-read noise (A-vs-A ±0.2) is inside the margin by construction.
- **One judge family.** The same family wrote the corrected transcriptions the judges read as source (as in A5).
- **Kraken at 1500 px.** Kraken read the image Flash was sent. Kraken models are trained on scans at about 300 dpi. A full-resolution read might do better on small Greek type (a separate, cheap arm: $0 plus CPU time).

### Decision proposed (Derek's)

- **Greek print ≤ 1699:** keep the Flash re-read. Kraken is undecided on the English and too slow on this box. Re-open if a GPU Kraken lane exists or ≥ 20 more referenced print pages exist.
- **Persian/Arabic print:** Flash re-read. The OpenITI base models are rejected for this corpus (lithographs).
- **Sanskrit:** Flash re-read. A Google Vision arm needs a Cloud Vision key, which Derek would have to create. Neither the Gemini keys nor the BigQuery service account can call the Vision API, and none was created.
- No production re-OCR was run. Rows are in `DECISIONS.md`.

- **Cost.** Gemini **$0.0247** (Batch, 26 Lite translations, two jobs), metered on the `engine-contest-5870` envelope (cap $5, pseudo book id, lane label used by no worker, removed at the end). Kraken 5,056 CPU-seconds. Judges on the subscription. Reads only from Mongo; no write to `pages` or `books`.
- **Files.** `scripts/eval/results/engine-contest-5870/`, documented in its `README.md`. Driver: `scripts/eval/engine-contest-5870/contest.mjs`. Rule: `routing-eval/rules/translation-lift-v1.json`. Run file: `routing-eval/runs/engine-contest-5870.json`.
- *run_id:* `engine-contest-5870`. *Replicated?* No.

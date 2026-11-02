---
stage: ocr
measure: [census]
languages: [la, de, en, grc, fr, zh, bo, sa, ko, ar, nl, it]
scripts: [Latn, Grek, Hani, Tibt, Deva, Hang, Arab]
canons: []
n_books: null
n_pages: 46793
verdict: "Which engine wrote the text readers see, from a random sample of pages (2026-11-02). Transcriptions (28,053 live pages with text): Flash-Lite 47.3%, Gemini 3 Flash (preview) 22.1%, Yig-dzin 12.2%, PaddleOCR 10.2%, Internet Archive OCR 5.1%, Gemini 3.8 Flash 1.5%, LightOnOCR 0.7%, Claude Opus 0.3%. Latin 72% Flash-Lite and 0% 3.8; Latin before 1501, 90% Flash-Lite. English translations (16,740 live translated pages): Flash-Lite 52.4%, 3 Flash 43.8%, 3.8 Flash 2.2%, Opus 1.0%; Latin's English 83% Flash-Lite. The #7866 draw does not match this mix: its Latin pages were 80% 3 Flash, so its Latin rate understates the stock."
status: informational
decision: "/quality says the measured text is mostly the older reads and that the current route has re-read about 2% of it; /quality/record carries this census beside the engine table. The next monthly draw should stratify by engine and age, not by the confidence score (see 'For the next draw')."
superseded_by: null
issue: [7933, 7866]
router_evidence: "none — a census of stored provenance; no judged page"
defect_rates: null
---
## 2026-11-02 · The stock is mostly the old reads: which engine wrote the text a reader sees (#7933)

PRIOR ART: `scripts/audit/model-usage-snapshot.mjs` counts every page by `ocr.model` and `translation.model` and feeds /about/models, but its `ops_reports/model-usage` document was last written 2026-10-02 and it does not cut by language, date or visibility. This is a one-off random sample instead: `$sample` of 40,000 pages (transcription) and 30,000 (translation), joined to `books` for `visible`, `pages_count`, `language`, `published`, kept if the book is live and the field holds more than 20 characters. Shares are of sampled pages, so each is within about half a point at these sizes.

### Transcriptions (28,053 live pages)

| Engine (`ocr.model`) | Share |
|---|---|
| Gemini Flash-Lite (3.1, preview and GA) | 47.3% |
| Gemini 3 Flash (preview) | 22.1% |
| Yig-dzin (Tibetan) | 12.2% |
| PaddleOCR-VL | 10.2% |
| Internet Archive OCR (incl. no model recorded) | 5.1% |
| Gemini 3.8 Flash (agy) | 1.5% |
| LightOnOCR | 0.7% |
| Claude Opus | 0.3% |

By language, share of each language's pages: Latin 72% Flash-Lite, 28% 3 Flash, 0% 3.8 (n 9,007); German 76 / 18 / 5 (n 2,845); English 48 / 26 / 0, the rest IA and LightOnOCR (n 2,616); French 73 / 24 / 2; Dutch 86 / 13 / 0; Sanskrit 64 / 36 / 0; Arabic 66 / 31 / 1; Greek 17 / 82 / 0; Korean 29 / 71 / 0; Chinese 93% Paddle; Tibetan 74% Yig-dzin, 20% IA. Latin before 1501 (n 2,900): 90% Flash-Lite.

20% of sampled pages carry an `ocr.updated_at` in the last 30 days. By the engine on them: Paddle 43%, Yig-dzin 19%, 3 Flash 11%, Flash-Lite 11%, 3.8 Flash 8%. The recent writing is mostly Chinese and Tibetan; Latin and German are barely touched.

### English translations (16,740 live translated pages)

Flash-Lite 52.4% (preview 25.2, GA 27.2), Gemini 3 Flash 43.8%, Gemini 3.8 Flash 2.2%, Claude Opus 1.0%. Latin's English is 83% Flash-Lite (n 6,240); German 68% 3 Flash; Tibetan 92% 3 Flash; Chinese 58% 3 Flash and 23% 3.8.

### What it means for the figures on /quality

- **The figures describe old reads.** The route that reads pages now (Gemini 3.8 Flash through the CLI, with re-read or correction of Flash-Lite text) has touched about 2% of either layer. Its measured effect where it has run: on 250 Flash-Lite Latin pages, the share a blind Opus reader called misleading fell from 41% to 8% (`2026-10-23-flash-reread-lite-latin-books-5924.md`).
- **The draw's Latin is not the stock's Latin.** In the #7866 draw, Latin pages were 108 by 3 Flash and 27 by Flash-Lite (80 / 20); the stock is 28 / 72. Per-language rows on /quality are unweighted, and Flash-Lite Latin ran 13.2 meaning-changing errors per 1,000 words against 5.0 for 3 Flash, so the published Latin rate (6.2) is probably low for the stock as it stands. Part of that gap is age (Flash-Lite holds 90% of the incunabula), so a straight reweighting would overstate it; the honest statement is "probably higher, by an amount this draw cannot fix".

### For the next draw

The #7866 draw was stratified by our stored confidence score, because its question was whether that score predicts a bad book. A draw meant to say how good the library is, and whether it is improving, should be stratified by what this study found predicts quality:

1. **Strata: engine × age band × hand**, within language groups, allocated in proportion to the stock with a floor of a few books per hard cell (incunabula, manuscripts, Greek, Sanskrit, Korean), and weighted back. The engine stratum is the one that moves as re-reads land.
2. **Two frames, reported separately.** *Stock*: what a reader sees now. *Flow*: pages written in the last 30 days, which measures the current route. The 2026-10-24 flow check (#6056) was 8 of 10 Chinese books; rotate or stratify it by language.
3. **A fixed panel.** Re-judge the same 800 pages after they are re-read: a paired before/after is far tighter than two independent draws, and it is what "is it getting better" asks.
4. **Translation on the same pages**, judged against the image and the stored transcription, so each English defect is attributed to the reading or to the translating.

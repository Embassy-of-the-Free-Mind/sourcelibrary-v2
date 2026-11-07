---
stage: ocr
measure: [accuracy]
languages: []
scripts: [Latn, Grek, Hani, Mong, Tibt, Arab, Hebr, Deva, Armn, Cyrl]
canons: []
n_books: null
n_pages: 3871
verdict: "From the page image alone, on gex45 for $0, script and leaf count are decision-grade: where a SigLIP2-so400m probe and Qwen3-VL-8B agree, script is right on 93/93 check pages and 1,852/1,853 held labels, leaf count on 94/94 and 1,392/1,395. Chinese tables are usable (agreement calls 239 pages table, 236 of them table/mixed/diagram). Music is a VLM-only call (75/78). Date-dense is NOT readable before the read: the best arm finds 62% of the #4763 date-dense pages at 75% precision, and 91 date-dense pages are called prose."
status: undecided
decision: "Owed: whether to adopt the proposed `pages.page_class` field (a data write, Derek) and feed the router's script / split / table / music cells from it. Number-dense stays a post-read cell (numeral census of the first read)."
superseded_by: null
issue: [5122, 4763, 6561, 5771, 6948, 4711]
---
PRIOR ART: `scripts/audit/spread-screen.mjs` (aspect ratio 1.05–2.2 → spread; reproduced here as the `aspect` arm), `scripts/lib/paddle-table-detect.mjs` (table risk from Paddle TEXT, after the read), `2026-10-18-gex45-capability-card-6871.md` (speed of the same models on this card; no labels), `scripts/eval/benchmark/script-class/` (#5122's own by-eye print-technique and spread labels, used here as labels). None predicts script, page kind and leaf count from the image before any read, scored against labels.

## 2026-10-26 · Can a cheap classifier predict a page's script, kind and leaf count from the image alone, before the read? (#5122)

- **Why.** The OCR router picks a reader per cell (script × era × page kind). Today the cell comes from catalogue labels (`books.language` has 498 distinct values, #4711) and from the model's own tags AFTER the read. Taxonomy point 6 says those tags are untrusted (O16). The question: can a $0 classifier on gex45 give the cell from the image first?
- **Labels we already held (n = pages with an image; all read-only):**
  - **script**, gold: Unicode census of the by-eye / corrected reference text in `benchmark/refs/` (954 pages across the sealed sets); `english-ia-5124` (Latin); `paddle_table_corrections_6561`, census of Opus's corrected text (Opus read with the image in); #5771 pecha frames (Tibetan). Silver, used for training only and never scored: census of the stored OCR for sealed pages that have no reference (Japanese, Syriac, Armenian, Tibetan).
  - **page kind:** #4763 strata (`english-ia-5124` `observed.date_dense`: 81 date-dense, 102 prose); #6561 Opus layout calls (300 table, 300 prose, 120 mixed, 120 diagram, 18 illustration/map → plate); the #4763 rule (≥ 6 tokens `^\d{2,4}$`) applied to every sealed reference text (139 date-dense, 759 prose, 3 table); 78 pages a music transcription was read from (3 books).
  - **leaf count:** script-class `spread` (877 one-leaf, 25 two-leaf); 80 #5771 pilot frames (56 two-leaf, 24 three or more); 250 user-split images (`split_training_examples`); 183 Internet Archive per-leaf English pages (one leaf by construction).
  - **print / manuscript:** script-class print technique (875 Chinese and Greek pages).
  - **Check set:** a fresh draw of 100 pages (50 from uniformly sampled visible books, 50 from books whose catalogue language is non-Latin-script; one random interior page each). Opus 5.5 labelled each by eye with the image (`claude -p`, subscription, $0): script, kind, leaf count. It holds 82 prose, 14 date-dense, 1 table, 1 plate, 1 music and 1 blank page; 92 one-leaf, 4 two-leaf and 4 three-leaf images. That is the natural mix, so table, plate and music are n = 1 there; their real tests are the held sets above.
- **Arms** (all $0 on gex45; nothing written to any store):
  - `stats`: 19 image statistics (aspect, gutter band, ink and mid-tone share, ruled lines, line periodicity, colour) + logistic regression.
  - `siglip2-base+stats`: SigLIP2-base 224 px embedding + stats, logistic regression. Run on the CPU.
  - `siglip2-so400m+tiles+stats`: SigLIP2-so400m 384 px on the full page plus the mean of its four quarter-tiles, + stats. Run on the GPU.
  - `qwen3-vl-8b zero-shot`: Qwen3-VL-8B-Instruct-FP8 in vLLM (util 0.6), the same three questions as Opus, JSON out, ≤ 1,280 px images.
  - `agree(probe, VLM)`: take the label where the so400m probe and the VLM agree; otherwise abstain (fall back to the catalogue).
  - `aspect`: the spread-screen rule, per page.
- **Protocol.** The probes are scored by 5-fold CV grouped by book on the held labels. For the check set they are trained on all held labels; the check set is never trained on. The VLM is zero-shot everywhere. Full confusion matrices for every arm and population are in `scripts/eval/results/page-classifier-5122/results.md`.

### Results

**Script.** n = 1,914 gold held pages / 100 check pages.

| arm | held gold, CV | check set |
|---|---|---|
| stats | 0.651 | 0.59 |
| siglip2-base + stats (CPU) | 0.981 | 0.94 |
| **siglip2-so400m + tiles + stats** | **0.996** | **0.98** |
| qwen3-vl-8b zero-shot | 0.972 | 0.94 |
| **agree(so400m, VLM)**: coverage / precision | 1,852 of 1,853 | **93 / 1.00** |

On the check set (so400m arm), every Hani (45), Latn (43), Deva (2), Armn (1) and Mong (1) page was right. A single Russian page was read as Latn, and the one wide single pothi folio as Syrc (Tibt recall 6/7). The VLM's characteristic error is **reading the subject instead of the letters**: 47 of 848 Latin-script pages were called Hani, Grek or Arab. An example is an English page of *Occult Japan* called Hani (checked by eye). The probe does not make that error, which is why agreement is clean.

**The catalogue label was wrong inside our own label set.** I first labelled the #6561 pages Hani because the catalogue says Chinese. The VLM called 172 of them Mongolian script. By eye they are Manchu (御製增訂清文鑑 pages). Opus's own corrected text romanises the Manchu and says "Manchu" on exactly those 172 pages. The labels now follow that. On the check set, the catalogue implies the wrong script on 4 of 100 pages: two "Greek" books whose page is Latin, one "Arabic" book whose page is Latin, and one "Chinese" book whose page is Manchu.

**Leaf count** (1 / 2 / 3+).

| arm | script-class spread (n=902) | #5771 frames (80) | user splits (250) | IA leaves (183) | check (100) |
|---|---|---|---|---|---|
| aspect 1.05–2.2 (spread-screen rule) | 0.992 | 0.700 (cannot count 3+) | 0.996 | 1.000 | 0.94 |
| siglip2-so400m + tiles + stats | 0.992 | 0.988 | 0.996 | 1.000 | 0.96 |
| qwen3-vl-8b zero-shot | 0.987 | 0.975 | 0.996 | 1.000 | **0.98** |
| **agree**: coverage / precision | | | | | **94 / 1.00** (held: 1,392 of 1,395) |

VLM on the check set: 1 → 90/92 (2 called two-leaf), 2 → 4/4, 3+ → 4/4. The residual disagreements are a leaf plus a strip of the facing page (I4), which is ambiguous by eye, and a wide single pothi folio.

**Page kind.**

| arm | #4763 date-dense vs prose (183) | #6561 Chinese layout (858) | sealed refs, #4763 rule (901) | music (78, recall) | check (100) |
|---|---|---|---|---|---|
| stats | 0.404 | 0.374 | 0.578 | 0.00 | 0.29 |
| siglip2-base + stats | 0.645 | 0.585 | 0.789 | 0.24 | 0.74 |
| siglip2-so400m + tiles + stats | 0.732 | 0.597 | 0.848 | 0.06 | 0.74 |
| qwen3-vl-8b zero-shot | 0.585 | 0.635 | 0.852 | **0.96** | **0.88** |

Per class:
- **Table (Chinese, #6561).** so400m recall 273/300, precision 0.58. The misses are mostly prose in ruled Siku columns called table. VLM: recall 235/300, precision 0.88. **Agreement:** 239 pages called table: 224 true table, 10 diagram, 2 mixed, 3 prose. The `chinese-tables` routing row reads tables and diagrams, so 236 of the 239 go to the right lane. Recall is 0.75, and the other 63 tables are abstentions, not misroutes.
- **Date-dense: the negative result.** #4763 strata: so400m finds 50/81 date-dense pages at 0.75 precision; VLM 10/81. On the sealed references (#4763 rule), the best arm reaches 75/139 at 0.52 precision. Agreement is precise when it fires (21/23 across all sets) but finds about 15%, and **91 date-dense pages come back "prose"**. A pre-read "prose" therefore does not clear a page as not number-dense. That needs the digits, which a 224–384 px embedding and an 8B VLM at about 1 MP do not count reliably.
- **Music.** VLM 75/78, and 75 of its 78 "music" calls are music. The probe has 3 books to learn from and scores 5/78. Music is a VLM-only call.
- **Plate.** The #6561 illustration/map pages: 15/18 (so400m), 16/18 (VLM). Opus's "diagram" pages are called plate by both (91 and 65 of 120); they route to the same table/diagram lane.

**Print or manuscript** (the `manuscripts` routing row; script-class labels, CV, n = 875): so400m + stats 0.967 (manuscript 605/620, print 241/255). Within Greek it is weak: 4 of 9 manuscript pages were found with the base arm. This set has no check-set test.

### Cost on gex45 ($0; no Gemini, no paid GPU)

- **VLM:** Qwen3-VL-8B read 3,858 pages in 33 min, about 7,000 pages/h (short JSON out, vLLM util 0.6).
- **so400m + tiles:** 3,858 pages in 24 min, about 9,600 pages/h. Image decode is the bound.
- **SigLIP2-base on the CPU:** about 2.7 pages/s at 10 threads beside the box's other jobs.

A whole-corpus pass is not needed. The router's unit is the book, so a 9-page sample per book (the spread-screen convention) covers 134K books in about 1.2M pages: about 6 GPU-days for the agreement pair. Scoring a single book before routing costs seconds.

The GPU work ran as one gpu-queue task (61 min) between two tib-gutter chunks. Nothing else was displaced, and the card was back at 2 MiB afterwards.

### Proposal: how the router and lanes would read the label (NOT written; a data write needs Derek)

One field on `pages`, per `field-sprawl.md`: it describes what the page IS, so it is a field. It is a single object, added deliberately to `PAGE_FIELDS`, not a family of columns:

```
pages.page_class = {
  script: 'Hani',            // ISO 15924; only where the probe and the VLM agree, else absent
  leaves: 1,                 // 1 | 2 | 3 (3 = three or more); same agreement rule
  kind: 'table',             // table | plate | music | prose — never 'date-dense' (see below)
  medium: 'manuscript',      // print | manuscript, probe only, marked as such
  p: { script: 0.99, leaves: 0.98, kind: 0.91 },   // probe probability, for thresholds
  engine: { probe: 'siglip2-so400m-tiles+lr/page-classifier-5122-v1', vlm: 'Qwen3-VL-8B-Instruct-FP8', vlm_said: {...} },
  image_sha256, run, at
}
```

How each consumer would read it:
- **Split first.** `leaves ≥ 2` on most of a book's sampled pages feeds the existing split-candidate queue (`spread-screen.mjs` → `split-candidates.tsv`) instead of the aspect rule. The aspect rule cannot see 3+ leaf frames (it got 0 of 24). It never splits by itself; splitting stays the splitter's per-book decision.
- **Chart.** `getOcrModelForBook` would read the book's majority `page_class.script`. Where it disagrees with `books.language` on most sampled pages, the book goes to a language review (#4711, `language-fields.md`), and is not routed on either label until that resolves. Without a label (abstain), the catalogue path is unchanged.
- **Kind.**
  - `table` on Hani/Mong → the `chinese-tables` row.
  - `music` → held out of every OCR batch (`music-notation.md`: never batch a vision model over score pages).
  - `plate` → caption-only expectation, plus the image-extraction lane.
  - `prose` → the default.
- **Number-dense stays post-read.** The router's `-dense` charts would be fed from the first read's text, with the #4763 rule (a numeral census of the lite read), not from the image. This pilot found no cheap image arm that clears a page.
- `page_class` is a hint, never a gate on its own (O16). Every lane's write-boundary guards still run.

### Threats and limits

- The held label sets are each one population: #4763 is English 1800–1930, #6561 is Paddle-flagged Chinese, and the music pages come from 3 books. A probe can learn the population, not the class. That is why the check set exists. There, rare kinds are n = 1, so table, music and plate rest on the held sets.
- The check set was labelled by Opus by eye. The Opus labels were not adjudicated except for the leaf-count disagreements I looked at: 3 viewed, 1 ambiguous (a neighbour strip).
- Opus counted Chinese numerals as date-dense on 3 check pages. The #4763 rule counts only Arabic digits, so "date-dense" means slightly different things across sets.
- The print/manuscript labels are Chinese and Greek only.
- `user_split` images are all two-leaf (positives only).
- The image statistics are rough; nobody tuned them.

Artifacts:
- Harness: `scripts/eval/page-classifier-5122/` (`build-manifest.mjs`, `fetch.py`, `label-check.py`, `featurize.py`, `vlm-classify.py`, `labels.py`, `score.py`, `gpu-task.sh`).
- Results: `scripts/eval/results/page-classifier-5122/` (`results.md`, every matrix; `check-set-opus.jsonl`; `labels.jsonl.gz`; `predictions.jsonl.gz`, out-of-fold probe predictions + VLM answers).
- On gex45: `/root/jobs/page-classifier-5122` (images, embeddings).

`manifest-final.jsonl` there is the seal: the `$sample` draws (#6561 subset, user splits, check set) are not reproducible from the script alone.

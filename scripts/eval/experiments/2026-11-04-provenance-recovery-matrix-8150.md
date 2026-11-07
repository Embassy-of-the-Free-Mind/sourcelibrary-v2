---
stage: pipeline
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 19
n_pages: 19
verdict: "After ordinary cleaning, the zero-width mark recovers nothing: one regex strips it on 19/19 pages. It does survive NFC, NFKC and whitespace reflow (19/19), and when it is present it names the edition and, for bulk egress, the campaign (19/19). What survives the strip is the wording. A new passage matcher (scripts/audit/match-passage.mjs) says our translation and names the right book and page on 17/19 stripped whole pages and 16/19 stripped 300-character excerpts. The two whole-page misses are correct refusals (a numeric table; a bilingual edition whose English is printed). It flags 0/21 passages that are not ours. Paraphrase and translation defeat every layer: the live semantic search finds our page 12/19 and 11/17 times, but independent translations of the same works score as high (max 0.922), so it cannot say the copy came from us. Images: the watermark survives recompression, PNG, greyscale and EXIF stripping (20/20), and resizes when scaled back (37/40). It reads nothing after any crop (0/40) until the copy is registered against our image, then 19/20 (90%), 20/20 (70% off-centre), 16/20 (50%), with 0/20 on unmarked images. EXIF survives a byte copy only. Key order: z 230 on 1,000 live rows, 23 on 10 rows, and nothing after any key sort or table load (z 0.1 to 0.2)."
status: informational
decision: "Slice 9 of #8150. No production change. The gap is paraphrase and translation, where nothing proves origin. Slice 6 (a keyed choice of phrasing) is the only layer proposed for it and is tested separately. Image registration and the passage matcher are scripts for an investigator, not a public surface."
feeds: [detector]
superseded_by: null
issue: [8150]
router_evidence: "none — provenance, not a route"
---
## 2026-11-04 · If someone else has our text or images, can we still say they came from us, from which edition, and through which channel? (#8150 slice 9)

PRIOR ART: `scripts/audit/image-provenance-coverage.mjs` (its robustness row gives the recompress, resize and
centre-crop rows below, run as is: `--books=0 --pages=200 --recent=0 --robustness=40`); `src/lib/key-order-mark.ts`
(the detector, reused); `scripts/audit/decode-provenance.ts` and `src/lib/provenance.ts` `verifyExport` (the
zero-width read). New: `scripts/audit/match-passage.mjs` (passage matching against our own translations) and
image registration in `scripts/eval/recovery-matrix-8150/images.mjs`.

**Purpose (Derek, 2026-11-04):** know where something came from if other people have it. A layer that recovers
nothing after ordinary cleaning is decoration, and we say so.

### Material

- **Text:** 19 pages, one per book, drawn at random from visible non-English books (translation 900 to 3,500
  characters). Each page was fetched from the live quote API (channel A: what a reader or an agent copies).
  Channel B, bulk egress with a campaign ref, is the same pages marked by the production code and key with a
  test ref: live bulk traffic carries a ref only for a flagged pool. Paraphrase and translation into French were
  done with `agy -p` (gemini-3.8-flash-low, subscription; 2 of 19 French calls returned nothing usable).
- **Not ours (text, n=21):** three passages each from Project Gutenberg: independent translations of works we hold
  (Boethius tr. James, Imitation tr. Benham, The Prince tr. Marriott, Meditations tr. Casaubon, Confessions tr.
  Pusey) and unrelated English (Austen, Darwin).
- **Images:** 20 served display images that detect as marked, 20 that do not, read from R2 (the bytes readers get).
  The image audit drew 40 marked pages from 151 served pages for its rows.
- **Key order:** 1,000 live rows of `/api/books/library`.

### Text

| treatment | ZWC: ours | ZWC: edition | colophon (riddles ride here) | ZWC: channel (bulk ref) | passage: ours, right page | semantic finds the page (top 10) |
|---|---|---|---|---|---|---|
| as served | 19/19 | 19/19 | 2/19 | 19/19 | 17/19 | 13/19 |
| NFC / NFKC / whitespace reflow | 19/19 | 19/19 | 2/19 | 19/19 | 17/19 | 13/19 |
| strip zero-width (one regex) | **0/19** | 0/19 | 0/19 | 0/19 | 17/19 | 13/19 |
| strip all `\p{Cf}` / ASCII fold | 0/19 | 0/19 | 0/19 | 0/19 | 17/19 | 13/19 |
| excerpt: longest paragraph | 15/19 | 15/19 | 2/19 | 18/19 | 17/19 | 12/19 |
| excerpt: 300 characters | 1/19 | 1/19 | 0/19 | 0/19 | 16/19 | 10/19 |
| excerpt: one sentence | 5/19 | 5/19 | 0/19 | 5/19 | 14/19 | 6/19 |
| strip + 300-character excerpt | 0/19 | 0/19 | 0/19 | 0/19 | 16/19 | 8/19 |
| paraphrase (LLM) | 0/19 | 0/19 | 0/19 | 0/19 | **0/19** | 12/19 |
| translate to French (LLM) | 0/17 | 0/17 | 0/17 | 0/17 | **0/17** | 11/17 |
| **not ours (n=21)** | 0/21 | — | — | — | **0/21** | top score up to 0.922 |

- **Channel.** The mark tells bulk egress with a ref from everything else. It does not tell a quote from a reader
  page: both carry the same deterministic mark. That is by design, for caching.
- **Passage matcher misses.** The 2 whole-page misses are correct refusals. One is a numeric table, whose numbers
  are on the printed page. The other is the Oxyrhynchus Papyri, whose English translation is printed in the book;
  our "translation" field carries it. The matcher only claims words that are ours: not an English edition's text,
  not words that appear in the page's OCR. The first version read `original_language` (the work's language) and
  claimed an English Boethius edition (2/21 false positives). It now reads `language` (the edition's) and
  checks the OCR. Of the 5 single-sentence misses, 2 found no candidate, 2 are words printed on the page, and 1
  is too short to prove anything.
- **Semantic search finds content, not provenance.** For a paraphrase it puts our page in the top 10 12/19 times,
  but James's Boethius or Benham's Imitation reach the same scores (0.86 to 0.92) on our pages of those works.
  Above the highest score any text that is not ours reached, it finds 0/19 paraphrases. Short-run overlap (3-word
  shingles against the semantic candidates, English editions and printed words excluded) does not separate
  them either: paraphrases 0 to 0.122, text that is not ours up to 0.186.

### Images

| treatment | EXIF names edition | watermark, raw | watermark, registered | not ours: watermark |
|---|---|---|---|---|
| byte copy | 20/20 | 20/20 (median z 24.9) | — | 0/20 |
| EXIF stripped, pixels kept | 0/20 | 20/20 | — | 0/20 |
| PNG screenshot / greyscale | 0/20 | 20/20 / 20/20 | — | 0/20 |
| JPEG q85 / q70 / q50 / WebP q75 (audit) | 0 | 39/40, 40/40, 39/40, 39/40 | — | controls pass |
| resize 1080/800/600/400 w (audit) | 0 | 1, 11, 0, 11 of 40 | scaled back: 38, 37, 37, 37 of 40 | — |
| crop 90% centre | 0/20 | **0/20** (audit 0/40) | **19/20** (z 20.0) | 0/20 |
| crop 70% off-centre | 0/20 | 0/20 | **20/20** (z 15.1) | 0/20 |
| crop 50% centre | 0/20 | 0/20 (audit 0/40) | **16/20** (z 7.4) | 0/20 |

- **Edition.** The watermark is keyed per edition: the same 20 images read under another edition's id detect 0/20.
- **Registration** finds the copy inside our served image (coarse-to-fine offset search) and lays it on a flat
  canvas at that offset. Flat blocks carry no pairs, so only the part the copier kept is read. It needs a
  candidate page: in the wild that comes from the page's own text (OCR the copy, then the passage matcher on
  `ocr.data` or the reader search). That link was not run here.
- **EXIF** survives only a byte copy. The 3 unmarked served images whose EXIF names their edition are ours, weakly
  marked, not false positives.
- **Channel:** images carry none.

### Key order (1,000 live rows)

| treatment | z | says ours |
|---|---|---|
| as served / JSON round trip / rows shuffled | 230.5 | yes |
| fields dropped (id + 6 of the rest) | 77.5 | yes |
| excerpt 100 / 30 / 10 rows | 72.8 / 39.9 / 23.0 | yes |
| keys re-sorted (`jq -S`, `sort_keys`) | 0.2 | no |
| loaded into a table (pandas, CSV: one column order) | 0.1 | no |
| not ours: keys in random order / wrong key | -0.4 / 0.1 | no |

The layer names no edition or channel: each record names its own book, and one key serves every caller.

### What each layer is worth after ordinary cleaning

- **Zero-width mark:** decoration against anyone who strips it. It earns its keep on careless copies (NFKC and
  reflow do not touch it) and is the only layer that names a channel.
- **Passage matching:** the layer that survives cleaning and excerpts. It is a corpus lookup, so it proves our
  wording, not our serving: a copy of a page translated after the text was taken is not found.
- **Image watermark:** survives everything but geometry. With registration it survives crops too.
- **Key order:** survives any tool that keeps record key order. It does not survive one sort.
- **Nothing survives paraphrase or translation.** That is the open gap; slice 6 tests the only candidate.

Rows: `$JOB_SCRATCH/s9/{text-rows.jsonl,text-fp.json,images.json,keyorder.json,img-audit.json}` (job
`trithemian-underbelly-8150`, archived to R2 with the job's scratch).

# Preregistration: Sanskrit (Devanagari) OCR on the GEX45 against agy Flash (#7243)

PRIOR ART: `PREREGISTRATION-open-engine-print-5660.md` Amendment 4 and `scripts/eval/latin-bakeoff-5924/` (the Latin GEX45
bake-off: same harness shape, paired median Δ with a bootstrap CI, catastrophic-page rule). That test was Latin; nothing
has scored an open engine on Devanagari against Flash on shared pages.

Committed 2026-10-24 before any engine read a test page and before any reference was written.

## Question
Is any open OCR engine that runs on the GEX45 (24 GB) within agy Flash's error on Devanagari pages drawn from the hidden
Sanskrit backlog? If yes, that engine reads the backlog on the box we already rent; if no, the backlog stays on agy Flash.

## Pages
- Population: `books` with `language` /sanskrit/i, `visible != true`, `pages_count > 0`: 8,806 books, 295,146 pages (2026-10-24).
- Draw (`draw.mjs`, seed 7243): three source groups, books drawn without replacement with probability ∝ `pages_count`
  (so the draw stands for pages at stake), one interior page per book. Internet Archive (eGangotri and others) 60,
  other/IIIF 25, Museums of India manuscripts 20 = 105 candidates (`candidates-observed.json`).
- Every candidate was classified by eye from the image before any engine ran: script, print/manuscript, language,
  layout, hard (yes + why), canonical (a text a model may have memorised). Result of the classification, kept as a
  finding: 29 of 105 are Sharada, 13 are another script or language, 3 are near-blank, 1 unsettled, 59 Devanagari.
- Test set (`pages.json`): 40 Devanagari pages, one per book, roughly in proportion to the Devanagari pages of each group
  (IA 20, other 13, MoI 7): 28 print, 12 manuscript, 15 marked hard, 9 canonical. Sharada pages are out of scope for a
  Devanagari engine and are not scored; their share is reported.
- Images: every arm reads the same file, `archived_photo` (else `photo`) capped at 2,400 px on the long side, JPEG q92;
  `inputs.json` holds both sha256s. Rotated pages are fed as scanned.

## References (fixed before any engine output is opened)
- Two independent Opus reads per page (R1, R2) from full-resolution tiles of the original image (`prep.py` cuts columns,
  then strips at the lowest-ink rows; a rotated page is turned for the reader only). Then an Opus adjudicator sees the
  tiles and both reads and writes the reference. No reader sees any engine output; engine outputs are written to a
  directory the readers are not given and are not opened until the references are committed.
- Convention: every Devanagari character as printed or written, line by line, in reading order (running head, body,
  verse numbers, footnotes); text in other scripts transcribed but not scored; no expansion, correction or sandhi
  splitting; scribal corrections as finally intended when clear, otherwise as written.
- Reference noise: median page CER(R1, R2) in view N is reported beside every result.
- Where a page matches an e-text (GRETIL; the BORI Mahābhārata pages), the e-text is used to measure the reference's own
  error on those pages, not to replace the reference.

## Arms
| arm | engine | how |
|---|---|---|
| F | Gemini 3.8 Flash (low), agy CLI, subscription | `scripts/eval/run-cli-arm.py --kind ocr`, prompt below |
| F2 | the same, read again | A-vs-A noise floor |
| S | Surya OCR (current release) | default detection + recognition, GPU |
| P5 | PaddleOCR 3.7 PP-OCRv5 with the Devanagari recogniser | `PP-OCRv5_server_det` + `devanagari_PP-OCRv5_mobile_rec`, GPU |
| PV | PaddleOCR-VL-1.6 0.9B | the fleet recipe (genai server, layout off) |
| Q | Qwen3-VL-8B-Instruct-FP8 | vLLM, prompt below, T 0, max 6,000 tokens |
| D | dots.ocr | vLLM, its own OCR prompt, max 8,000 tokens |
| others | any further open engine that claims Devanagari and installs within the GEX45 disk bound | named in the write-up |

Prompt for F, F2 and Q (one prompt, all VLM arms that take one): "Transcribe ALL text visible in this image using the
appropriate Unicode script. The main text is Devanagari (Sanskrit, sometimes Hindi or Marathi). Output ONLY the raw text,
line by line. No commentary, no translation, no transliteration, no labels, no markdown." No Tesseract.

## Scoring (`score.mjs`, normaliser `deva-n@1`, self-test in the file)
- View N (primary): NFC; ZWJ/ZWNJ removed; old अ+matra spellings folded; ASCII digits → Devanagari digits; an ASCII colon
  after a Devanagari sign → visarga; Vedic accents and ॰ dropped; only Devanagari letters, signs and digits kept.
  Page CER = Levenshtein over code points / reference length, capped at 1, on the order-tolerant engine text (each line
  placed at the reference offset of its 6-grams).
- View D (diplomatic, secondary): nothing folded, Vedic accents kept.
- Failed reads: no row, an error, a refusal or an empty text = CER 1; catastrophic = CER > 0.5, or engine text longer
  than twice the reference (loop), or empty.
- Recall check (#4523): an "inserted passage" is a run of ≥ 40 engine characters (view N) with no 8-gram in the
  reference. Counted per page for every arm, reported for canonical pages apart.

## Gate (per cell: print, manuscript; "all" reported)
An engine E is **within Flash's error** in a cell when all three hold, on the shared pages of that cell:
1. the 95% bootstrap CI (10,000 resamples over pages = books, seed 7243) of the median paired difference
   CER(E) − CER(F) has its upper end at or below **+2 points**;
2. E's catastrophic pages ≤ F's + 1;
3. E's pages with an inserted passage ≤ F's + 1.

## What the result can decide
28 print and 12 manuscript books are `exploratory` grade (eval-design §3.1: < 30 referenced books). So:
- every engine failing the gate in a cell **keeps that cell's backlog on Flash** (a clear loss at n = 28 is enough to
  stop a lane);
- an engine passing the print gate earns a **confirmation run** (≥ 50 print books, decision grade) before it reads the
  295K-page backlog, not the backlog itself.
Throughput (pages/h on the GEX45, from the GPU task) is reported with every engine; it does not enter the gate.

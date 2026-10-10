---
stage: ocr
measure: [agreement, judged]
languages: [grc]
scripts: [Grek]
canons: []
n_books: 540
n_pages: 119978
verdict: "Flash re-read 110,164 of 119,978 lite-read Greek print pages at $0.0030 a page; 7.8% refused (RECITATION); by eye 2 inventions, diacritics lost on 1% (4% pre-1600)."
status: adopted
decision: "Re-read kept in production, 11,608 pp retranslated; collectors join text parts (#5930); 25K-page retranslation and 1450-1599 release pending Derek"
superseded_by: null
issue: [5813, 5700, 5930]
---
## 2026-10-06 · What happened when the lite-read printed Greek pages were re-read on Flash in production (#5813)?
<!-- PRIOR ART: 2026-10-04-reocr-lift-5700.md measured the LIFT of a Flash re-read on 53 lite-read pages against human references (+0.75; Greek +1.04) and sized the stratum; it ran no production re-OCR. This is the production run it proposed: 119,978 pages through the Batch path and the collector, with what broke, what it cost and what the pages look like by eye. No judged score was taken here. -->

- **Question.** #5700 A5 said: re-read lite-read Greek pages on `gemini-3-flash-preview`, retranslate what changed, about $476. Does that hold on the full printed stratum, at what price, and is the new text safe to serve?
- **Answer.** Mostly yes for the transcription, at **$0.0030 per submitted page**, but three things the pilot did not show: the collectors stored a cut-off page whenever Gemini answered in two parts (fixed, #5930); RECITATION refuses 7.8 % of pages, whole canonical texts at a time; and by eye the new read **invents in two narrow places** (a gloss for faint pencilled notes; a Homer verse written from memory in place of the printed one) and drops diacritics on 1 % of pages (4 % in print before 1600). Retranslation of the changed pages costs more than re-reading them, because only the realtime lane can retranslate a page that already has English.
- **measure:** production counts, token spend, old-vs-new character agreement, and a by-eye check against the page image. Agreement is not quality; the by-eye sample is 22 pages (5 images opened). Not accuracy in the eval-design §2 sense.

### Scope and outcome

Printed books only (`book_class.class = printed`, `script_family = greek`), pages served by flash-lite, not held, not human-edited: **119,978 pages in 540 books**. Left out: 26,502 pages in 126 handwritten books and 197 in 6 mixed books (Flash invents on manuscripts, #5813 pilot); 1,535 pages typed handwritten inside printed books; 8,565 pages in 29 books at `ocr_complete`; 767 in loop quarantine.

| outcome | pages | share |
|---|---:|---:|
| re-read on Flash and served | 110,164 | 91.8 % |
| refused by RECITATION, lite text kept | 9,398 | 7.8 % |
| cut at the token limit, lite text kept | 376 | 0.3 % |
| refused by a collector guard or as prohibited content | 22 | |
| re-read, then put back to the lite text (invented gloss, one annotated copy) | 18 | |

- **Spend:** re-OCR $364.38 for 121,442 answers (Batch; from the token counts in Gemini's result files, pilot included). Retranslation $74.91 for 11,630 realtime calls ($0.0064 per page; $0.008 on dictionary pages). Total **$439.29** of the $476 cap.
- **RECITATION is per text, not per page:** Herodotus (Loeb) 520 of 578 pages refused, Plato *Timaeus* 158 of 282, Aristotle (Bekker) vol. 2 81 of 160.

### What broke

- **Two-part answers.** 6,358 of 111,571 finished answers (5.7 %) came back as two text parts with `finishReason: STOP`. Both collectors stored `parts[0]`: 158 pages were written cut off (shortest: 59 characters from 2,309 output tokens) before it was seen. All 158 were put back within 25 minutes; #5930 joins the parts and adds a sweeping test. After the fix, every two-part answer checked is stored complete. The 200 single-page inline requests of the pilot had none, which is why the pilot missed it.
- **The pilot under-priced the run by a third.** One page per book weights short books; page-weighted cost is $0.0030, not $0.00255.
- **Concurrent Batch jobs.** About 150 open jobs on the key returned 429. Jobs of 100 MB took 40–85 minutes each; 40 MB jobs took about 8 in the morning and 30 in the evening.
- **Two collectors.** `scripts/batch/collect-batch-results.mjs` (every 30 min) races `batch-collector.mjs` (every 10) and takes about a third of jobs without recording failure reasons or the collected cost.

### How much the text changed (character agreement, old vs new, letters only)

| group | re-read pages | median | under 0.95 | under 0.5 |
|---|---:|---:|---:|---:|
| visible books of the 4 October list | 80,005 | 0.988 | 23,038 (29 %) | 4,614 |
| hidden books | 9,092 | 0.982 | 3,043 (33 %) | 287 |
| books released from the `ocr-untrusted-5700` hold (mostly print 1450–1599) | 20,400 | 0.905 | 14,379 (70 %) | 1,956 |

Three books have at least half of their re-read pages under 0.5 (1,350 pages; *Lexicon graecolatinum* is 1,218 of them): on the page opened, the old text belonged to the neighbouring leaf.

### By eye

| sample | pages | better | same | worse | invented | not judged |
|---|---:|---:|---:|---:|---:|---:|
| visible books: 5 random + 5 random under 0.5 | 10 | 4 | 5 | 0 | 0 | 1 (Syriac) |
| early check, visible books | 6 | 1 | 4 | 0 | 0 | 1 mixed (LaTeX) |
| released books: 3 random + 3 random under 0.8 (1 image opened) | 6 | 2 | 2 | 0 | **1 line** | 1 (accents dropped) |

- **Invented, case 1.** Plato *Symposium* (Bury), a copy with faint pencilled interlinear notes: Flash wrote a fluent English gloss after each Greek phrase. Found while drafting the before/after sample, not in the spot check. 18 pages of that copy were put back to the lite text.
- **Invented, case 2.** Nonnus, *Paraphrasis* 1589, p. 222: the page prints `Homerus ἰλ. ω, 567: οὐδέ κ' ὀχῆας ῥεῖα μετοχλίσσειε θυράων ἡμετεράων`. Flash read ω as α and wrote the text of *Iliad* 1.567 (`μή νύ τοι οὐ χραίσμῃσιν…`), which is not on the page. The lite read had the printed line, garbled.
- **Diacritics dropped** (new read has under half the old accent density): 631 of 64,300 Greek pages in the visible books (1.0 %), 69 of 6,783 hidden (1.0 %), **694 of 16,870 in the released books (4.1 %)**.
- **Normalisation.** Flash modernises early-modern Latin (`quòd, præterito, nō, &, vt` → `quod, praeterito, non, et, ut`) and expands abbreviations (`Theophyl.` → `Theophylactum`). 0.7 % of pages carry LaTeX for Greek numerals, which the reader shows raw.

### Retranslation

Through `realtime-translate.mjs --book-id --pages-file` (#5937), biggest change first in bands. Done in the visible books: 3,094 pages under 0.5, 3,032 in 0.5–0.8, 5,469 in 0.8–0.9. Not done: 25,000 translated pages under 0.95 (9,573 visible, 1,579 hidden, 13,848 in the released books), about $161 at the realtime rate. The released books were not retranslated at all: the invented line was found in that group first.

- **replicated?** No. One production run; the by-eye samples are small and only five page images were opened.
- **artifact.** `scripts/batch/greek-reocr-5813/` (selection, raw-answer audit, restores, comparison, scans, ledger). Working files and by-eye packets: job box, `/data/scratch/sl/claude-jobs/greek-reocr-5813-print-work/`.

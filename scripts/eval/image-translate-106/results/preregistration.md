## Pre-registration (#106), posted before any model call

**Question.** On ordinary pages, does attaching the page image to the agy translation call cut serious errors in the English for Latin, German and French, and at what cost per usable page?

**Draw** (`scripts/eval/image-translate-106/draw.mjs`, seed `image-translate-106`, run 2026-11-14 01:0x UTC, read-only):
- Frame: visible books with pages that the live translation table routes to `latin-cli-agy4` / `german-cli-agy4` / `french-cli-agy4` (BPH excluded by those rows), not held, not an unsplit spread, minus the books v2#7611 used. Frame: Latin 14,526 books, German 1,800, French 618.
- Books in seeded-hash order; one page a book by seeded hash among interior pages (15–95% of the book) that are translatable (page type not skipped, not withheld, not health-blocked), with ≥ 300 characters of stored OCR and an image that loads.
- **n = 40 a language, 120 pages, 120 books.** All 156 drawn images loaded; the first 40 per language are the sample. 96 of 120 already have English (stored, mostly Flash-Lite).
- The stored OCR is the transcription every arm translates (mostly Gemini 3 Flash and Flash-Lite reads). Nothing is corrected first.

**Arms**, all `gemini-3.8-flash-low` through agy, default pool (week 100% left at 01:01), the production translation prompt (translate-core `buildTranslationPrompt`, `PAGE_BREAK_SCOPED`, previous page's English as context), **one page a call**, no writes:
- **T**: text only, fresh (`scripts/eval/ocr-doubt-image-8358/translate.mjs --arm=text`).
- **T2**: T again, the arm noise floor.
- **I**: the same call with the scan as `./page.jpg` and the v2#8358 sentence, unchanged (`--arm=image`; a reply that never opened the scan is retried).
- Planted misreads: 12 pages (4 a language, seeded) get one meaning-changing misread planted in the transcription (a number, name or word changed to another real form); T and I translate the planted text.
- Calls: 360 + 24 = 384, cap 500.
- Deviation from the lane: the live rows read 4 pages a call. Both arms here read one page a call, so this tests the image, not the block size.

**Judge.** Opus, sealed `claude -p --restricted --tools Read --strict-mcp-config --setting-sources local --disable-slash-commands --no-session-persistence`, the image opened on every call, one output a call, ids hashed, arm names never shown. Pace guard on. Cap 900 calls; planned ≈ 660:
1. **Misread inventory**, once a page (120): the judge compares the transcription with the image and lists up to 12 meaning-changing misreads (word, name, number, negation, dropped/added line), with the page's reading and the transcription's. These are the page's spots, the same for every arm.
2. **Translation verdict**, once per output (T, T2, I, the stored English S where it exists, the planted outputs): route-judge `judgePrompt` translation form (accept, fidelity 1–5, every defect with a taxonomy class and severity cosmetic / misleads / wrong_text), plus each spot classed carried / repaired / dropped, plus every statement about what the leaf shows (true / false against the image).
3. **Controls.** Wrong-page: one per arm per language (an arm's English with another book's image and transcription), 9; all must be rejected. Judge plants: 9 English outputs with one wrong number or negation planted; at least 8 must come back as a misleads / wrong_text defect on the planted span. **If either control fails, the round is void.** Repeats: 10 outputs (5 T, 5 I) judged twice, the judge's noise floor.

**Measures.**
- **Serious-defect rate** = (misleads + wrong_text defects) per 1,000 English words, per arm and language, with a by-book bootstrap 95% interval (the `defect-rate.py` severity scale; `paired-arm.mjs score` gives the rates).
- False leaf claims: pages with ≥ 1 false statement about the leaf.
- Carried misreads: of the inventory spots T carries, how many I repairs, against how many T2 repairs (the v2#8358 measure, now on a random draw).
- Usable page = judge accept. Cost per usable page = agy calls and total tokens (input + cache read + output + thinking) per accepted page.

**Rule, per language** (from the issue): I is better than T only if
- (a) rate_T − rate_I > |rate_T − rate_T2|, and
- (b) the by-book bootstrap 95% interval of the paired difference (T − I) lies above 0, and
- (c) I's pages with a false leaf claim ≤ T's + max(1, |T − T2|).

Otherwise, no change. The same rule on all 120 pages pooled is reported as the secondary result.

**What this n can see.** In the #7263 European cell test, the agy English of these languages had 1.1–2.9 serious defects a page (SD 1.5–3.0), about half of them OCR-class (the English following a misread). With a paired SD near 2.3 a page, 40 pages can tell a gap of about **0.7 serious defects a page** from nothing. The v2#8358 repair rate (43% of carried misreads) applied to #7263's OCR-class rates implies a gain of about 0.6 a page in Latin, 0.4 in German and 0.3 in French. So **per language this test can only see a large effect**: Latin is near the line, and German and French are about half of what it can resolve. 60 pages a language would resolve about 0.6, still above German and French, and would need 540 agy calls (cap 500). n stays at 40. The pooled 120 pages resolve about 0.4 a page, which is about the implied pooled effect. The spot-level carried-misread count is the more sensitive measure of the mechanism.

**Writes (step 9).** For each page, best = an accepted candidate with the fewest serious defects (then fewer wrong_text, then higher fidelity); a tie keeps the stored English. A fresh arm's English is written only when it is accepted and beats S (S absent, not accepted, or more serious defects), through the lane's own writer with provenance, run id `image-translate-106-<timestamp>`, revision rows kept, after a per-book hold check. Planted outputs are never written.

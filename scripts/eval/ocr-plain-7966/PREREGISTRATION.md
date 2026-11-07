# Pre-registration: does the OCR prompt's notes / vocab / term / image-description load cost transcription accuracy? (#7966)

PRIOR ART: `scripts/eval/PREREGISTRATION-book-brief-7499.md` (the format: arms, A-vs-A floor, a three-way decision
rule written first); `scripts/eval/plain-6728/prompts.mjs` (anchored edits to a live prompt, each found exactly once);
`scripts/eval/judge-cal-7866bar-7263/three-way.mjs` (#7941: the normaliser and the blind Opus judge, reused);
`scripts/eval/experiments/2026-10-06-transcription-error-three-ways-and-by-prompt-5939.md` (prompt versions on CER
only). None removes the OCR prompt's extras.

Committed before any model call (no lite request, agy read or judge call has been made). Job `ocr-plain-7966`,
2026-11-02.

## Question and reader

Every reader: most low pages trace back to the transcription (#5695: an OCR misread is the primary cause of 47% of
low pages). #7499 found that removing extras from the translation prompt made translations more faithful. Does asking
the OCR model for interpretive notes, index vocabulary, term tags and image descriptions change how accurately it
transcribes?

## Prompt (the live default, as each lane composes it)

`prompts` type=ocr, is_default, highest version: **Standard OCR v19.1**, `_id 6ac02220413a82637da889bb`,
content_hash `9d8f959e053491362b2c4acec1e20c9a`. The run stops if the hash moves (`run.mjs prompts`).
`{language_instruction}` is filled with the auto-detect sentence (`scripts/lib/live-ocr-prompt.mjs`, identical to the
orchestrator's `getOcrPromptFromDb`).

- **lite** (the live lane): `pipeline-orchestrator.mjs` `submitBookOcrBatch`: prompt + the Document context line
  (title, author, `books.year`, public-domain sentence; `ocr-v18-ab.mjs docContext`, the same string), then the image
  (fetchImageBase64 maxDim 1500, JPEG q80 when > 100 KB), `gemini-3.1-flash-lite`, Batch API, temperature 0.1,
  maxOutputTokens 16384, thinkingBudget 0, safety BLOCK_NONE. No page here is `needs_splitting` (no spread prefix);
  no long-s retry variant.
- **agy** (the lane Derek is moving to, #7701): `cli-ocr.mjs read`'s one-page call, `sentinels-6523` variant: prompt +
  "The page image to transcribe is attached: @./<page_id>.jpg Transcribe it in the format above." + the sentinel
  instruction; `agy -p --model gemini-3.8-flash-low --mode plan`, the tool gate, the one nudge on a denied tool, one
  re-read on a chatter problem. Fresh calls: no kept read is reused (a kept read was made on arm A's prompt).

## Arms (anchored edits, `prompts.mjs`; each anchor found exactly once, else the run throws)

| arm | text | md5 (after the slot) |
|---|---|---|
| A | live v19.1 | `79a7257d516eaabefe76594978e8c4f4` |
| A2 | A again, fresh calls (the noise floor) | same |
| B | A without the `<vocab>`, `<note>`, `<term>` lines and rule 7 ("End with <vocab>…") | `98e15a2d424400a7b4c48fd67dc6a901` |
| C | B, with the `<image-desc …>` line replaced by a bare `<image/>` marker ("Do not describe the image"), rule 6 likewise, and "<meta> or <image-desc>" → "<meta>" | `c8093848fc229313c16689b522eb300b` |

Kept in every arm: margin, gloss, insert, unclear, header, page-num, sig, columns, column-break, scan-quality,
language, script, page-type, meta, warning (asserted in `assertArm`).

## Pages (115, one per book; `results/pages-prereg.json` with image and reference hashes)

| set | n | reference |
|---|---|---|
| A | 60: English 20, Latin 20, German 20 | #7263's print pages, same-edition typed pages (DTA, EEBO-TCP, CAMENA), with the typed pages either side |
| B | 35 English | #5124 / #7941 set B: Wikisource (28) / Gutenberg (7), leaf checked by eye in #5124 |
| Z | 20 Chinese manuscript (Siku Quanshu) | #7263's Kanripo WYG leaf, fixed by the page's neighbours; seeded draw of 20 of the 40 (`makeRng(79661)`) |

## Measures (per engine, per arm, per page)

1. **Primary: severe flags per 1,000 reference words.** #7941's judge unchanged (`judgeAbsolute`: route-judge
   `judgePrompt`, Opus via `claude -p`, the page image attached), blind to arm and engine, on the normalised read.
   Severe = `misleads` or `wrong_text`. Units: words of the normalised typed reference (Z: Han characters of the
   Kanripo leaf). Pooled ratio over pages. An empty read counts as judge-bad with one severe flag.
   - **Normaliser:** #7941's `normalise('ours')`, with ONE change, fixed here: `<note>…</note>` blocks are dropped in
     every arm before it (an interpretive note is not page text; only arm A asks for them, so judging them as text
     would charge A for the instruction under test). `<term>` keeps its words. `<vocab>`, `<image-desc>` and `<image/>`
     are already dropped by #7941's rule.
   - Identical normalised texts (same sha256) are judged once and the verdict reused (reported).
2. Judge-bad pages (not accepted, or any wrong_text).
3. **Omissions.** Omitted lines per 100 reference lines (a reference line of ≥ 15 letters whose windowed CER inside
   the read's `bodyText` is > 0.5). Omitted marginalia per 100 typed notes (set A's DTA / EEBO / CAMENA notes, located
   in the whole read).
4. #7263's truth rule (`truthLatin` miss / extra / wrong-text spans; `truthHan` CER); #7941's normalised CER.
5. Output tokens per page; counts of `<note>`, `<vocab>`, `<term>`, `<image-desc>` emitted.

Differences X − A per engine with 95% page-bootstrap intervals (2,000, `makeRng(79663)`; one page per book, so pages
= books).

## Decision rule (written now)

Per engine, on all pages of that engine with all four arms read and judged:

- **Margin M** = max(0.5 per 1,000, the 95th percentile of |A2 − A| over the bootstrap replicates) on measure 1.
- **Omission margins** = max(1.0 per 100 lines, q95 |A2 − A|) for lines; max(2.0 per 100 notes, q95 |A2 − A|) for
  marginalia.
- An arm X ∈ {B, C} **passes** on an engine when the upper 95% bound of (X − A) on severe flags per 1,000 ≤ M, AND
  its point (X − A) on omitted lines and on omitted marginalia ≤ its margin.
- **SHIP-CANDIDATE** for X: X passes on both engines (lite and agy). If B and C both pass, C is the candidate (the
  simpler prompt); B otherwise. Superiority (upper bound < 0) is reported, not required.
- **ENGINE-SPECIFIC**: X passes on one engine only; named per engine, no shared-prompt change proposed.
- **DON'T**: neither arm passes on either engine.
- If agy cannot finish (account quota), the rule is applied to lite alone and the agy result is reported as partial.
- Per-language rows are reported, not decided on (n = 20–55).
- A ship-candidate is not a switch: the consumer inventory of `<vocab>` (#4695 page_terms) and `<image-desc>`
  (image extraction, gallery) comes first, in the follow-up.

## Known limits

One judge family (Opus). Typed references are easy pages (#7941: cleaner copies than the library at large). A2 is a
second sample of the same prompt; on lite at temperature 0.1 many A2 reads may equal A's byte for byte, which makes
the floor small; the 0.5 per 1,000 minimum margin is there for that. The image instruction differs by lane, as in
production.

## Spend

- lite: 4 arms × 115 = 460 Batch requests, estimate $0.79 (`lite-build`, 1,500 output tokens assumed per page); hard cap $3 (`LITE_CAP_USD`), logged in the ops
  spend ledger.
- agy: up to 460 calls on the subscription (`agy -p` only; never the paid API for any model but flash-lite).
- Opus: up to 920 judge calls via `claude -p` (subscription), hard cap 1,000, pace guard at 85% weekly (meter 11% at
  the start).

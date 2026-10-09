## 2026-10-06 · How many stored translations are the model talking about its job instead of the page? A model-free count (#6056, #5918)
<!-- PRIOR ART: `ocrReasoningLeak()` in scripts/lib/page-integrity.mjs (taxonomy O15, 25 pages, #5055) looks for the same thing in the OCR. Nothing had looked in the translation, where it reaches a reader as plain English. scripts/audit/page-integrity.mjs walks the local mirror, which the job box does not hold, so this walk reads Atlas. -->

**Question.** The Eternity shelf review met a page whose English was "*Wait, the prompt says:* Style: warm museum label" (`69e7484085f786e884a4c10f` p.20). How many pages carry the model's reasoning as the translation?

**Design.**
- **Rule.** `translationReasoningLeak()` in `scripts/lib/page-integrity.mjs`: phrase rules, no model. Four kinds, strongest first:
  - *reasoning*: the scratchpad. It names the prompt, the user, a tag as a tag, or is a markdown label such as `*Self-Correction during drafting:*`, `*Constraints:*`, `*Formatting check:*`.
  - *assistant-reply*: a chat reply to the requester ("Please provide the OCR transcription you would like me to translate").
  - *thought-token*: the page opens with the bare word "thought" on its own line.
  - *input-talk*: "the provided OCR / transcription / text is …". The mildest, and mostly inside `<meta>`.
- **Seed and extension.** The seed was `/Wait, the prompt|the prompt says|Style: warm museum/`. The rest was added by reading hits. Bare first-person lines ("I will translate…", "Wait, I…") are left out on purpose: sermons, dialogues and translators' prefaces say them.
- **Walk.** `scripts/audit/translation-reasoning-leak.mjs walk`: every `pages` record in `_id` order, one `_id` type at a time, in planned ranges of 20,000 with a checkpoint per range. A wide net runs on the server so page text leaves Atlas only for candidates. Read-only, secondary preferred. 28,967,125 records in 27 minutes; 9,274 candidates.
- **Headline.** *reasoning* or *assistant-reply*, with the phrase in the page body (not only in a `<meta>`, `<summary>`, `<keywords>` or `<vocab>` block, which the reader keeps in its metadata panel), on a live book (`visible: true`, `pages_count > 0`) at `page_number > 0`.
- **Read by eye.** A seeded sample of 40 headline pages (seed 6056), then up to four rows from each less common phrase group (about 75 rows) and the 8 chat replies that are long or start late in the page. Each was read as text around the matched phrase.

**Result.** Measured 2026-10-06.

| | pages | books |
|---|---:|---:|
| **Headline: reasoning or a chat reply, in the page body of a live book** | **549** | **269** |
| … reasoning | 352 | |
| … chat reply | 197 | |
| Live, in the page body, any kind (adds 177 input-talk and 12 thought-token) | 738 | 397 |
| Live, any kind, including phrases only inside a metadata block | 1,151 | 680 |
| All books, any kind | 1,327 | 763 |

- **By source language (headline pages):** English 176, Latin 138, Dutch 63, Greek 50, German 28, French 28, Latin-German 16, Tibetan 8, Chinese 7, Italian 6, Sanskrit 5, Persian 4, others 20.
- **By model:** gemini-3-flash-preview 330, gemini-3.1-flash-lite-preview 190, gemini-2.5-flash 18, gemini-3.1-flash-lite 11.
- **By month written:** January to April 2026 hold 475 of the 549. It did not stop: 14 are from October 2026 and 11 from September.
- **Clustered.** 202 of the 269 books have one such page. Six books hold 131: *Apocalypse Explained* vol. 2 (39) and vol. 3 (18), *Ann Lee* (26), Colet's *Two Treatises* (18), *On the Revolutions* (16), the Dowson *Ikhwan al-Safa* (14). The pages read from them were chat replies to an empty transcription.
- **A side class, not counted above:** 5,337 pages in 2,451 books where a note in the page body tells the reader what "the OCR reads" or what "the `<gloss>` tags" hold. That is pipeline vocabulary in a reader's note, and it is not reasoning.

**By-eye check.** The sample of 40 held 38 leaks and 2 that were book text: a gloss "(self-correction)" on the Pali *pavāraṇā*, and a bold glossary label "Refinement/Struggle". The wider read found two more shapes: a commentary lemma "**We shall check:**" and a treaty's "once you provide the further information". All four were removed from the rule and are pinned as negatives in `tests/unit/page-integrity.test.ts`. The sample was not redrawn after the fix, so the 549 has no measured precision. No other non-leak was met in the rows read.

**Conclusion.** At least 549 pages of 269 public books show the model's reasoning or a chat reply where the translation should be. It is rare per page and easy to find, and it is still being written. It also sits in books that pass a two-page check: the Bardo Thödol cycle `69dfee83ce6bb8619e07f177`, tier 1 on the Eternity shelf, has seven such pages (p.23, 24, 196, 245, 310, 350, 408).

**Limits.**
- **A floor.** The rule is a list of phrases. A leak worded another way is not counted, and a leak past the first 60,000 characters of a page is not seen.
- **Not a rate.** The denominator here is page records, with or without a translation.
- **"In the page body" is a rule about tags**, not a render. 176 headline pages are English-source books, where the stored "translation" is the modernised text and the reader shows that panel only for early editions. A page with a withheld translation is not excluded.
- **Nothing was written.** No page was changed, hidden or queued.

*Replicated?* No. Data: `scripts/eval/results/quality-sprint/2026-10-06-translation-reasoning-leak/` (`summary.json`; `pages.jsonl` has ids, page numbers and the matched phrase, no page text).

<!-- PRIOR ART: scripts/eval/librarian-search/ (README + golden set) measures RETRIEVAL precision@5; no earlier entry scored the Librarian's ANSWERS for uncited claims, unsupported quotes/numbers or captions. -->
## 2026-10-06 · Does a post-generation grounding pass make Librarian answers cite what they claim? (#5904)

- **Question.** The Librarian mixed cited and uncited claims. It quoted words and numbers no retrieved page carried ("opened twenty times an hour"), and captioned pictures as things their own books don't show (Khunrath's athanor as Drebbel's oven). Does a deterministic pass after generation fix that, together with ±1 neighbour pages for the top search hits and two tool-result fixes? And what does it cost?
- **Answer.** Yes for quotes and captions, partly for citations:
  - **Uncited claim units:** 152/210 (72%) → 68/185 (37%).
  - **Unsupported quotes:** 7/81 → 2/64.
  - **Unsupported quantities:** 7/51 → 2/80. Both remaining are catalogue counts from `browse_catalog`, which the scorer cannot see.
  - **Caption errors:** 11/29 → 0/32.
  - **Page-reading tool calls that failed:** 7/7 → 0/6.
  - **Cost:** same per turn ($0.598 → $0.592 for 20 turns). Prompt tokens per round rose ~10% (13.5K → 14.9K); the neighbour block is ~940 tokens per search call.
  - **Prompt and tool changes alone:** scored on the same answers *without* the pass (`score.ts --pre`): uncited 110/182, unsupported quotes 8/74, captions 3/32. So the citation gain is the pass; the caption gain is mostly the tool fix.
- **measure:** a script count, not a human judgment. `score.ts` checks each answer against the reader's support set: pages the answer cites ±1, plus the sources panel. It is deliberately not the fixer's internal set. One generation per question per arm, so per-question deltas are noisy. I read every quote removal and every caption flag by eye.

### Design
- **Set:** `librarian-grounding/questions.json`, 20 fixed questions: 5 Drebbel (the #5811 thread) + 15 across Hermetica, Kabbalah, Rosicrucian, alchemy, Ficino, Kircher, Fludd, Dee, Picatrix, Boehme, Rasashastra. Frozen before any code change.
- **Generation:** `run.ts` runs `streamAgenticResponse` (gemini-3-flash-preview, the production config) in-process against prod. It records the text as the reader ends up seeing it, with edits, fixes and removals applied in route order.
- **Before** = main at d2a600436. **After** = the PR head before the review commit. The review commit (offset-anchored edits, `$`-safe unquote) doesn't change any decision on these answers.

### Iterations, each found by reading flagged output (the instrument mattered as much as the fix)
1. 21 of 33 captions linked a different book or edition than the picture's own. **All real.** Cause: `search_images` handed over the book title but no URL, and `gallery_images.book_slug` is empty. Fix: the tool now hands over the picture's own book/page URL (agent-tool-results.md, "URLs, never ingredients").
2. The fixer's near-paraphrase test pooled every tool result into one bag of words, so 3-word quotes always "matched". Fix: near-match only for 6+ words, within one page.
3. Five blockquote removals were false positives, each a faithful quote. The causes:
   - `<term>/<gloss>/<note>` markup in stored page text;
   - the quoter's own `[brackets]`;
   - a quotation running over the page break (p.193 "supe-" / p.194 "rius");
   - a citation written on the blockquote's own line.

   Each is now a unit test built from the real page. `replay.ts` re-applies the current pass to recorded answers for free. On the final run it keeps all 3 that the measured run wrongly removed. It still removes the fabricated Poimandres "quote" (Reitzenstein p.65 paraphrases) and the before-run Rasashastra quotes, which are in no held edition (checked by DB search).

### Worse on some queries (one sample each)
- drebbel-monconys uncited 4/6 → 5/7; drebbel-elements 3/7 → 5/7; agrippa-saturn 0/6 → 3/9.
- green-lion: 6/6 uncited (but 12/16 before).
- boehme-signature: 1 unsupported quote ("true mystical mirror"; the live pass found it in tool text, the replay unquotes it).
- Uncited general-knowledge paragraphs are kept on purpose, not dropped. Years are not checked.

**Replicated?** No: one generation per arm. **Spend:** ~$4.39 estimated, 9 runs of 20 turns plus a smoke turn. **Artifacts:** `scripts/eval/librarian-grounding/results/{before,after}.jsonl` + `*.score.json`.

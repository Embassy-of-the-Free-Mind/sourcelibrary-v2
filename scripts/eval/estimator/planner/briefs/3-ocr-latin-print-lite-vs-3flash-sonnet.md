Lands: #6740
PR: yes

# DRAFT brief (planner v0, rank 3 of 15). Not dispatched: the session that reads #6740 dispatches it.

**Question.** Should new printed Latin pages be read by Gemini 3 Flash (or Sonnet) rather than Flash-Lite 3.1, the
reader the routing table (#6688, row `latin-script-print`) names?

**Why this test, ranked third:**
- **Volume:** 342,892 reader-weighted Latin pages have no text yet. That is the largest OCR queue outside Chinese.
- **The OCR estimator (v0, #6770) puts Flash-Lite last of the routable readers.**
  - 3 Flash leads by **+0.072 [+0.046, +0.100]** in accuracy (P best 0.81).
  - Sonnet leads by +0.059 [+0.032, +0.086] (P best 0.17).
  - P(Flash-Lite best) = 0.00.
- **Check by panel (in sample).** On the independent Wikisource panel alone (61 shared pages), Flash-Lite's mean CER is
  0.097 above 3 Flash's. On the #5126 anchored panel it is only 0.016. So the lead is not an artefact of anchoring.
- **The routing table cites a small gap:** 93.3% vs 94.7% on 147 pages.
  - The difference is the tail. The estimator counts each read's CER capped at 1, including reads that could not be
    placed against the reference. The routing table's figure may not count those.
  - This test must report both: mean CER, and the share of pages over 50% CER.
- **v0's level bias.** Levels run 0.064 CER high, because the beta-binomial has no hurdle for 100%-error reads. Use only
  the difference.
- **Cost:** about 0.72% of one account-week.
  - 20 Opus calls to make references by eye;
  - 20 Sonnet reads (`claude -p`);
  - about $0.16 of paid API for Flash-Lite and 3 Flash reads.

**Pinned prediction (post it first).** Paired accuracy difference on the new pages:
- 3 Flash − Flash-Lite: +0.072 [+0.046, +0.100];
- Sonnet − Flash-Lite: +0.059 [+0.032, +0.086];
- 3 Flash − Sonnet: +0.013 [−0.011, +0.037].
All three on v0's scale; read them as differences only.

**Pages and references.**
- 20 printed Latin pages, one per book, drawn at random from live Latin books whose pages have no text yet. Seed 6742.
  Exclude books in any benchmark panel.
- **References first, sealed before any arm reads.** Prefer Wikisource-proofread transcriptions of the same page where
  they exist (`ground-truth-ws/` format). Otherwise an Opus read-from-image transcription corrected by eye
  (`read-from-image` label).
  - An Opus-made reference must not be scored against an Opus arm. None is in this design.
- Record each reference's source and its own measured keying error where known (#6552).

**Arms** (the production OCR prompt, unchanged):
- **A:** Flash-Lite 3.1, the incumbent, on the paid API (allowed).
- **A′:** a repeat of Flash-Lite, the noise floor.
- **B:** `gemini-3-flash-preview` on the paid API, about $0.08.
  - **Derek's Gemini rule allows only Flash-Lite on the paid API without asking.** Get a one-line OK at dispatch, or
    drop arm B and keep C.
- **C:** Sonnet 5.5 via `claude -p --model sonnet` (subscription).

**Scoring.**
- `benchmark-score.mjs` against the sealed references: CER per page, capped at 1. Failed reads are counted, not scored
  (#6523).
- Report the share of pages over 50% CER per arm, and the mean.
- A by-eye check of the 3 pages where arms differ most.
- **Judge agreement:** no judge here (mechanical score), so no α. Note that in the write-up rather than leaving the field
  blank (eval-design §2).

**Sequential stop rule (fixed now).**
1. 20 pages.
2. **Stop: switch to the best arm** if its paired CER difference against A excludes 0 (95%, by book), exceeds the A-vs-A
   floor, and its share of pages over 50% CER is no higher than A's.
3. **Stop: keep Flash-Lite** if every interval includes 0 with |mean difference| < 0.01 CER.
4. Otherwise extend to 50 pages once, then decide by rule 2 or report "not settled".

**Done when:**
- the result is posted beside the pin;
- the experiment entry is merged;
- if rule 2 fired, a `tier:hold` PR changes the `latin-script-print` row and the router probe test
  (`tests/unit/ocr-routing-table.test.ts`).

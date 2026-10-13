---
stage: ocr
measure: [accuracy, none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: 3652
verdict: "Of 3,652 stored Gemini-CLI outputs, 591 fail the CLI checks. A cut-only rescue recovers 481 (461 by the deterministic extractor, 20 by a text-only CLI pass); 110 stay failed (87 empty or nothing left, 23 rejected by the verbatim guard). No translation arm needed rescue, so nothing is rejudged. On OCR the rescue lowers the 3.6 CLI CER on EEBO 0.325 → 0.068 and on Greek-ext 0.225 → 0.142, and does not fix 3.8: its failures are empties and recitation cuts."
status: informational
decision: "Rescued records committed beside the raw outputs (results/cli-rescue-6523/); 6523c folds them into its single ocr-pareto.json rebuild. 3 Tengyur CLI pages cut; the write door refuses an announcing line that echoes the request."
superseded_by: null
issue: [6523, 6293, 6295, 6375, 6388, 6182, 6331, 6338]
---
PRIOR ART: `scripts/eval/ocr-pareto-6293/rescore-extract.mjs` (job cli-ocr-fix-6523c) applies the same extractor to every engine in the 4 Latin-script Pareto strata. This entry covers every stored CLI arm, adds the CLI cut pass and the verbatim guard, and scores with the unchanged instruments.

## 2026-10-11 · Can the stored Gemini CLI outputs be rescued by cutting alone, and what does that do to the scores?

**Why.** Derek, 2026-10-11, on #6523: "fix and preserve the past data". A read by eye of the 93 failed Latin / Early
English CLI pages found 3 real misreads. The rest were transcriptions wrapped in chat, doubled replies or plan notes.

**Rule.** A rescue may only CUT. The raw output is never rewritten. Each rescued record sits beside it
(`results/cli-rescue-6523/rescued/<arm>.jsonl.gz`) and carries: the method (`deterministic` | `cli-restructure` |
`failed`), the extractor version, the second pass's model, CLI version and prompt version, and the guard result.
The guard (`scripts/lib/verbatim-cut.mjs`, `verbatim-cut/2`) has two parts:
1. after whitespace normalisation, the kept text is one contiguous substring of the raw reply;
2. everything removed is either a copy of kept text (8-letter shingles, ≥ 60 %) or a block that opens with an
   agent's line ("I am unable…", "Here is…", "### Summary", a filter `<warning>`, a fence).

Part 2 came out of the control (below): part 1 alone passed a truncation. Only rows that fail the checks are
rescued: `ocrReadProblem` for OCR, `cliChatterReason` for translation, and "parses as JSON" for second-reader
verdicts. A clean row is left alone even when the extractor would cut it. Its restart split also fires on text
that really repeats, such as Psalm 136's refrain and Tengyur verse (3 C38 translation pages; 34 OCR rows across
arms, listed as `clean_but_extractor_would_cut` in `inventory.json`).

**Steps.**
1. Inventory (`rescue.mjs`, arms in `arms.mjs`).
2. Deterministic pass: 6523c's `extractTranscription()` from `scripts/lib/cli-chatter.mjs`, unchanged. For a
   translation, a leading "Here is the translation…:" line is dropped first.
3. A text-only CLI pass for what step 2 left failing (`cut-pass.mjs`):
   - `agy` 1.3.3, `gemini-3.8-flash-low`, through `run-cli-arm.py`;
   - plan mode, no auto-approve, `--no-nudge`, from an empty folder, no image;
   - prompt `cut-6523/2`: "CUT, never write", return the span between `<<<BEGIN>>>` and `<<<END>>>`.
   - Accepted only if the guard passes and the original check no longer fires.
4. Rescore with the unchanged instruments, each behind a positive control:
   - `benchmark-score.mjs` over a shadow bench (`rescore-ocr.mjs`);
   - Syriac `score-ocr.mjs --fixed-refs` and 6388 `score.mjs` (`rescore-other.mjs`).

**Control of the CLI pass (20 items, `cut-control.json`).**
- Prompt v1: 6 of 10 planted items exact. The model also dropped the translations' own `<summary>`/`<keywords>`,
  and on a restarted read it kept the short first copy, which part 1 of the guard passed.
- Prompt v2 (keep the tags, the most complete copy) with guard v2:
  - **planted 10/10 accepted, 10/10 exact** (10 clean replies I wrapped in chat: opener, plan note, doubled, fence,
    refusal plus summary);
  - **natural 9/10 exact**: 10 failing replies whose deterministic cut is known. The tenth was rejected by the
    guard, so no wrong cut was accepted.

**Per arm** (rows · fail the checks · rescued deterministic · rescued CLI pass · CLI pass rejected · unrescuable):

| arm | rows | fail | det | cli | rejected | unrescuable |
|---|---|---|---|---|---|---|
| Pareto 3.6 low (#6293) | 555 | 375 | 359 | 8 | 6 | 2 |
| Pareto 3.7 low | 555 | 37 | 26 | 4 | 2 | 5 |
| Pareto 3.8 low | 908 | 111 | 55 | 2 | 11 | 43 |
| Pareto 3.8 low, repeat | 191 | 9 | 5 | 0 | 1 | 3 |
| Pareto 3.8 high | 191 | 32 | 0 | 0 | 0 | 32 (all empty) |
| Syriac OCR, 3.6/3.7/3.8 × 2 runs (#6295) | 144 | 9 | 5 | 2 | 1 | 1 |
| Syriac translation, 3.6/3.7/3.8 × K/R (#6295) | 120 | 0 | — | — | — | — |
| Latin CLI pilot 3.7 (#6375) | 299 | 11 | 8 | 1 | 2 | 0 |
| OCR prereg arm G, 3.8 (#6388) | 90 | 7 | 3 | 3 | 0 | 1 |
| Tengyur C38, first 58 sides (#6182) | 58 | 0 | — | — | — | — |
| C38 113 Tengyur + 365 xl (#6182, #6331) | 478 | 0 | — | — | — | — |
| Second reader, 3 arms (#6338) | 63 | 0 | — | — | — | — |
| **total** | **3,652** | **591** | **461** | **20** | **23** | **87** |

The 3.6 Pareto failures are almost all the plan-note preamble before a full transcription that #6386 found. The
3.8 high failures are all empty: the model asked for a tool and headless mode denied it.

**Translation arms: nothing to rejudge.** Not one stored CLI translation fails `cliChatterReason`, and a wider by-eye
regex sweep found no chat either. The rescued text is the judged text, so `translation-pareto.json` is unchanged and
no judge ran.

**OCR rescore, Pareto** (`results/cli-rescue-6523/ocr-pareto-rescored.json`):
- `benchmark-score.mjs`, unchanged, over a shadow of `cli-effort-6293/bench`, with the chinese-cohort reference
  bundle exploded into a scratch refs dir.
- Control: 2,089 of 2,089 stored CLI reads reproduce the committed CER.
- Mean CER, stored → rescued, on the strata where any page changed:

| engine | stratum | pages | changed | CER | pages > 50 % |
|---|---|---|---|---|---|
| 3.6 low | eebo-tcp-5488 | 58 | 49 | 0.325 → 0.068 | 8 → 0 |
| 3.6 low | greek-ext | 95 | 80 | 0.225 → 0.142 | 10 → 2 |
| 3.6 low | greek | 11 | 10 | 0.286 → 0.194 | 2 → 1 |
| 3.6 low | greek-ext2 | 8 | 7 | 0.311 → 0.169 | 1 → 0 |
| 3.6 low | latin-period-5126 | 82 | 20 | 0.208 → 0.131 | 8 → 4 |
| 3.6 low | chinese-cohort-5547 | 134 | 105 | 0.351 → 0.340 | 23 → 21 |
| 3.6 low | chinese, chinese-ext, ref-ws, ref-pinned | 127 | 73 | unchanged | unchanged |
| 3.7 low | eebo-tcp-5488 | 58 | 11 | 0.207 → 0.154 | 12 → 6 |
| 3.7 low | latin-period-5126 | 82 | 5 | 0.159 → 0.151 | 6 → 5 |
| 3.7 low | ref-ws | 81 | 9 | 0.090 → 0.107 | 8 → 10 |
| 3.8 low | eebo-tcp-5488 | 58 | 18 | 0.270 → 0.239 | 14 → 13 |
| 3.8 low | latin-period-5126 | 82 | 2 | 0.163 → 0.122 | 5 → 3 |
| 3.8 low | greek-ext | 95 | 4 | 0.209 → 0.187 | 9 → 7 |
| 3.8 low | ref-ws | 81 | 18 | 0.244 → 0.268 | 22 → 24 |
| 3.8 low | chinese-cohort, chinese-ext, ref-pinned | 505 | 15 | unchanged | unchanged |

On `ref-ws`, CER goes UP after the rescue (3.7 and 3.8). Those reads are partial, cut by Gemini's recitation
filter. The refusal paragraph removed after them held English letters that had matched the reference by chance.
6523c saw the same. That is the honest direction, and it is why rescue does not fix 3.8 Latin. The repeat arm
(`-rep`, 5 rescued) and 3.8 high (0 rescued) are not in this bench and are not rescored.

**OCR rescore, other arms** (`results/cli-rescue-6523/other-rescored.json`):
- Syriac (#6295). Control: 120 of 120. Mean capped CER moves only on C36-ocr-b (0.670 → 0.646, 3 pages changed);
  the other arms' changed pages score the same. Pages over 50 % are unchanged everywhere.
- 6388 arm G. Control: the unchanged copy reproduces the committed `results.json` exactly.
  - English print, 5 reads changed: G's mean CER 0.194 → 0.142. Against the stored text P, the verdict moves from
    "no change" to "cannot be told apart".
  - Latin print, 1 read changed: 0.042 → 0.048, because a refusal removed from a partial read stops matching.
  - Chinese: unchanged.
  - This is reported here only; the preregistered `results.json` is not rewritten.
- Latin pilot (#6375) was scored by eye. Its 9 rescued reads are recorded and not rescored.

**What the rescue cannot fix.** 87 rows have no text to cut: empties, and 3.8 high's tool requests. Twenty-three
were rejected by the guard. These are reads cut by the recitation filter where a later restart holds text the
kept copy lacks, Syriac replies the model would not copy, and Chinese reads the second pass cut to under 20
letters. They stay failed. The forward fix (a structured reply, the tool gate) is 6523c's.

**Production pages (Tengyur CLI lane, sweep tengyur-cli-6361).** Three pages carried chat in readers' English: the
two named on #6523, and a third the corpus walk below found. All three were cut through `writePageTranslation`,
which kept the old text in `page_revisions` (`job_id: cli-past-data-6523`, reason `cli-chatter-cut-6523`). The
engine block that produced each text is kept, with a `repair` record added. All pass guard v2.
`scripts/maintenance/cli-chatter-cut-6523/repair-pages.mjs` did the cuts.
- `6abed76c896ea18127c8ee40` p154: dropped the opening line "…here is the translation adhering strictly to all
  your formatting, tagging, and style rules:" (93 % of letters kept).
- `6abeb35b896ea18127c83af5` p261: kept the text after "Here is the translation:". The text before it was a
  separate paraphrase reply. I checked the kept span against the page's Tibetan OCR: it opens with "To elucidate
  the meaning of the teaching by way of an example" (བསྟན་པའི་དོན་དཔེ་ཉེ་བར་བསྟན་པའི་སྒོ་ནས་) and runs through bampo
  11 to the page's end (75 % kept).
- `6abed76c896ea18127c8ee40` p516 (same volume as p154): a preface reply, then "Here is the exact translation adhering
  strictly to the contract:". The kept span runs from "To show the meaning, [the text] states" (འདི་ཉིད་སྟོན་པ་ནི་)
  to "regarding this…" (འདི་ལ་), the OCR's first and last clauses (87 % kept). My first scan of the 23,625
  CLI-written Tengyur pages missed it: its pattern did not allow "exact".

**Write door.** `TRANSLATION_REPLY_RULE` in `scripts/lib/page-integrity.mjs` is the always-on `refusableReasoningLeak`
gate that every translation writer passes. It now refuses an announcing "here is the … translation …:" line
anywhere on a page, **but only when the line also echoes the request**: provided, preserving, formatting,
instructions, contract, continuity, paragraph breaks, adhering, requested, from the image.

The first version refused the bare line too. A walk of every `pages` record
(`scripts/audit/translation-reasoning-leak.mjs walk`, 9,382 prefilter candidates) found that bare form in **real
book text**: a 19th-century study introducing Cyprian's prayer with "Here is the translation:", Huygens's notes,
"here is a free translation:", "of this short epistle, here is the translation:". These are now unit negatives.

The narrowed clause refuses **26 stored pages in 15 books**, every one a model's reply (ids and phrases in
`results/cli-rescue-6523/announce-hits.json`):
- 1 is p516, repaired above.
- The other **25 are older API pages**, not CLI: gemini-2.5-flash 18, 3-flash-preview 4, 2.0-flash 3. 24 of them
  are on visible books, for example *Plotini Enneades* (7 pages), *Sylva sylvarum* (3) and *Basilica chymica* (2).
  They are listed, not repaired: a detector's output goes through a by-eye sample and approval
  (containment-on-finding.md).

The cost of the narrowing: **p261's shape is not refused at write time.** A bare "Here is the translation:" after a
paraphrase cannot be told from a book quoting a translation by wording alone. The forward fix for the CLI lane
(sentinel-delimited replies) is 6523c's.

**Replicated?** No. The control is the check; the rescore numbers are deterministic from committed reads.

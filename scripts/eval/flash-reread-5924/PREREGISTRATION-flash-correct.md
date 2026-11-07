# Preregistration amendment: Flash (agy, low) correction of the lite text, a fourth arm on the same 250 pages (#5924)

PRIOR ART: `PREREGISTRATION.md` (f9a56e374, the Flash re-read test) and `PREREGISTRATION-opus-correct.md` (#7258, the
Opus-correction arm). Their sample, verdict definitions, Step C protocol, bars and scoring are reused; only the arm and
the judge pairings change. Committed before any agy call.

Job `flash-correct-latin-5924`, 2026-10-24, on clawdbot (the main box, where agy is signed in). Derek approved the arm
2026-10-24 ("yes queue it"). Grade: **exploratory**, as the original. No production OCR is written; `cli-ocr.mjs apply`
is never called. Question: can agy's ~75–80K calls a week do Latin correction, beside Opus correction?

## Sample
The same 250 pages (`results/sample.json`). The judged lite text and the images lived on l7a; `fc-draw.mjs` rebuilt
them here with `draw.mjs`'s image steps. Each page's stored `ocr.data` hashes to the `stored_sha256` the Opus arm
recorded (which `oc-set.mjs` had checked against the judged lite text), and the image bytes hash to its
`image_sha256`: **250/250 and 250/250** on 2026-10-24 (`results/fc-stored-check.json`). No page is dropped. If the
stored text changes before a page is read, that page is dropped and reported (cli-ocr records the draft hash it read).

## Arm FC
`cli-ocr.mjs read --correct-prompt=results/FC-correct-prompt.txt --lane=flash-correct-latin-5924
--model=gemini-3.8-flash-low --concurrency=3`, cli-ocr unchanged: one page per call, plan mode, tool gate, the nudge,
one re-read on a marker/chatter problem, sleep on quota. Never Argon/Pro/high.
- **The prompt** (`fc-prompt.mjs`): the live OCR prompt (Standard OCR v19.1, checked to be the base the Opus arm sent:
  contentHash(base + correctInstruction(10)) = its `1e710a51c1fe8355`) + `correctInstruction(1)` from `correct.mjs`
  with only the changes one page in agy needs: the draft is inline between DRAFT START / DRAFT END (cli-ocr's `{draft}`
  slot) instead of a file, the image is cli-ocr's attachment instead of `p01.jpg`, no Read tool is named, and the one
  answer goes between `<<<BEGIN>>>`/`<<<END>>>` (cli-ocr's sentinel words) instead of `===== PAGE p01 =====`.
  Template content hash **`0601ef30e816f7a7`**.
- **Outcome per page:** `no-answer` if the read has an error class, a marker problem (`wrapper`), or empty text;
  otherwise `correct.mjs`'s `parseAnswer` on the text, unchanged: `unchanged` / `contain` / `corrected`, or `no-answer`
  when the chatter guard fires (it requires `<page-type>` in a correction, as for O).
- **The text FC serves:** the correction where `corrected`, else the stored lite text (as O).
- Reported, not in the bars: the share of each correction's draft syllables changed (`diffSyllables`, the measure of
  cli-ocr's 25% apply cap), and how many corrections that cap would refuse. Note: cli-ocr's correct-mode `apply`
  refuses a text carrying `<page-type>`/`<scan-quality>` (the Tibetan correction is plain text), so a Latin
  correction lane would need that check changed before any write. Nothing is applied here.

## Judgments (blind, fresh Opus subagents, image open, crop helper)
The original `VERDICTS.md` / `C-TASK.md` were never committed (l7a scratch). `C-TASK.md` here is rebuilt from the
prereg's definitions (verbatim) and the output fields the scorers read, and every reader in this job gets it.
- **Step C4, FC vs L.** Per book, one fresh reader, every page where FC's served text differs from L; X/Y from
  Mulberry32(1034), drawn per shown page in sample order. Unshown pages (FC = L) take the original Step C L verdict
  for both arms, as #7258.
- **Step C5, FC vs O.** Per book, one fresh reader, every page where FC's and O's served texts differ (O's from
  `results/oc-reads.jsonl.gz`); X/Y from Mulberry32(1035). Pages where they are equal are ties; their verdicts come
  from C4 for that page.
- FC vs the Flash re-read F is not judged directly; it is read off through L (C4 vs the original Step C) and O
  (C5 vs C3). Reason: a third pairing is 10 more readers for a comparison the table already brackets.
- Controls as the original: no arm names, fresh readers who see no other packet, keys written to the job scratch and
  opened only by the scorer.

## Measures and bars (as #7258)
- **(a) halves:** misleading(FC) ≤ ½ · misleading(L), pooled over 250 pages, both from C4.
- **(b) no page worse than L:** in C4, FC misleading and L not, or L preferred with a material loss in FC; or FC
  `no-answer`; or a false contain (contain on a page neither Step A nor Step C marked `not_this_leaf` for L).
- **(c) head-to-head vs O (C5):** misleading(FC) vs misleading(O), preference FC / O / tie with material losses each
  way. **Flash correction can stand in for Opus correction** when (a) and (b) pass and in C5 misleading(FC) ≤
  misleading(O) + 3 and O is not preferred on more than 1.5× the pages FC is. Otherwise it is reported as the cheaper,
  weaker arm, with the gap.
- **(d) second-family judge on the Opus arm.** 60 pages drawn with Mulberry32(1036) from the 209 pages #7258's C2
  showed (O ≠ L). For each, agy `gemini-3.8-flash-low` judges O vs L blind (X/Y from Mulberry32(1037)), one page per
  call, image attached, the C-TASK definitions, a JSON answer between the markers (`fc-judge.mjs`). Reported: Gemini's
  preference O / L / tie and misleading counts for O and L on those 60, next to the Opus C2 reader's on the same 60.
  **Self-preference is suspected** if Gemini prefers L on ≥ 10 of the 60 where Opus preferred O. Not a bar.
- The four-arm table: lite / Flash re-read / Opus correct / Flash correct — misleading, worse-than-lite, preference.

## Cost
agy calls used (this job's ledger rows), per page. At the plan fee ($200/month, ~75–80K agy calls a week, so about
$0.60 per 1K calls), cost per 1K pages = calls per page × $0.60. Claude for the judges only (subscription).

## By eye (after scoring)
The 7 pages the Flash re-read made worse, `69b51e67` p131 (lib. 2), and 3 corrected pages drawn with Mulberry32(1038),
against the image: what FC did on each.

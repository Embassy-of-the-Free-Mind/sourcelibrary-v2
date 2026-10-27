---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [kangyur]
n_books: 20
n_pages: 20
verdict: "PENDING: pre-registered, no audit read yet."
status: running
decision: null
superseded_by: null
issue: [6948]
---
## 2026-10-27 · Does Opus translating from the LEAF rescue the Kangyur two-leaf frames? (#6948)

PRIOR ART: `2026-10-24-opus-translate-tibetan-sanskrit-gate-6948.md` (text-only Opus on the Yigdzin transcription:
Kangyur CANON 19/40 bad, 18 of the 28 Tibetan bad pages caused by the transcription); job tib-concept-opus-6948's
Bardo pilot (#6948, 2026-10-27 11:42Z: the same Opus given the leaf as full-resolution strips, `claude-translate.mjs
--images-dir`, 1/30 bad, but on clean print with 1.6 differing spans a page against 16.6 on Kangyur frames);
`2026-10-27-tibetan-translation-router-agy4-vs-opus10-6948.md` (Opus@10 27/30 on Flash-CORRECTED text);
`split-leaves-5771` (#5771: per-leaf re-reads, 21% bad). Harness: `scripts/eval/tib-leaf-translate-6948/draw.mjs`;
the auditor is `scripts/eval/opus-tib-sa-6948/audit.mjs`, unchanged.

**Question.** On the hard Kangyur manuscripts, does showing Opus the leaf replace the Flash correction pass? If the
translator reads the leaf and brackets where it departs from the transcription, the 10-24 OCR-caused failures
(seam lines invented or duplicated, truncated lines) should not reach the English.

### Pre-registration (written and pushed before any audit reply is read)

**Frame.** The 10-24 Kangyur CANON stratum, rebuilt today with the 10-24 `frame.mjs` unchanged (live Tibetan books,
Yigdzin transcription, no English, not withheld for source_loop / ocr_unreadable / invented_by_eye, not left to
84000) and the 10-24 CANON title regex. Dropped: any book with a page whose OCR is the Flash correction
(`ocr.pipeline: tib-correct-6560`; the uncorrected Yigdzin text is the point), and job tib-concept-opus-6948's six
books.

**Stage 1 draw (`draw.mjs stage1`, seed 6948).** 20 blocks of up to 10 consecutive frame pages, one book each.
- **PAIRED-BAD, 5 blocks:** five of the 10-24 CANON pages the auditor called bad, drawn by seed from the 19 whose
  stored transcription is byte-identical to what the 10-24 auditor saw. That page is the audited page of its block.
- **FRESH, 15 blocks:** from other CANON books, a random block and a random audited page in it.

**Translator.** Opus via `claude -p` on this box's subscription, `claude-translate.mjs read --images-dir`
(job tib-concept-opus-6948's change, carried in this PR): each page's scan as overlapping full-resolution strips,
Read only, "translate what the leaf says, bracket where it departs from the transcription". 10 pages a call,
`--fresh`, `CANDIDATE_READS=off`, the production block prompt and seed, the UNCORRECTED Yigdzin text. Only the audited
page of each block is judged.

**Audit.** `audit.mjs` unchanged: blind, sealed Opus, page image + full-resolution tiles, the stored transcription and
the English; 6 planted controls (4 reversals, 2 inventions) on other read pages of the blocks, shuffled in with opaque
ids. `audit.mjs attribute` splits bad pages into transcription-caused and translator-caused, as on 10-24.

**Bar (Stage 1 passes only if all hold):**
1. **Bad ≤ 1 of 20** audited pages (≤ 5%), the auditor's verdict taken as given (by eye can only add bad pages).
2. **0 invented and 0 wrong-leaf by eye** on 10 pages I open myself, strips at full resolution: all 5 PAIRED-BAD
   pages, every page the auditor flags for invention or wrong-leaf, then the rest by seed from the FRESH pages.
3. **Controls:** at least 5 of 6 caught, or the auditor's verdicts do not count.

Reported, not gated: FRESH alone (the unbiased rate) and PAIRED-BAD alone (before 5/5 bad → after k/5), with Wilson
95% intervals; OCR spans per page; leaf notes the translator added; attribution.

**Stage 2 (only if Stage 1 passes; still files only).** `draw.mjs stage2`, seed 69482: 30 blocks of 10 consecutive
frame pages from 30 CANON books not in Stage 1; same translator settings. 20 of the 30 blocks (seeded) get one
audited page, same auditor, 6 controls. Metered: the climits meter (`/root/.claude-limits/latest.json`, this box's
account dereklomas@gmail.com) before and after, every other job on the account listed (`claude-job.sh list`), and
list-$ from each call's `cost_usd_equiv`. Reported: weekly-meter points and list-$ per 1,000 pages, with the
concurrency caveat (job tib-concept-opus-6948 reads on the same account at the same time). Stage 2's audit is
reported against the same ≤ 5% bar; it decides the recommendation, not a write.

**Limits.** $0 paid; Opus on the subscription only; reads stop at 80% of the 5-hour window and 89% of the week. No
agy. No page writes.

### Result
_(pending)_

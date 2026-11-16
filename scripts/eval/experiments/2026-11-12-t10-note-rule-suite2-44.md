---
stage: translation
measure: [judged]
languages: [la, zh, grc, ar, de, fr, ru, sa, he, fa, hy, nl, es, gez, nah, myn]
scripts: [Latn, Hani, Grek, Arab, Cyrl, Deva, Hebr, Armn, Ethi]
canons: []
n_books: 52
n_pages: 52
status: informational
feeds: [prompt]
superseded_by: null
router_evidence: "none — a prompt rule tested on one translator (Opus via the Claude CLI), not a route comparison"
defect_rates: "none — serious T10 pages and note verdicts per arm as k/n, not per-1,000-word rates"
verdict: "The note rule fails its pre-set test. On 40 held-out T10 pages, serious T10 pages fell from 8 to 3 (6 pages only in the live-prompt arm, 1 only in the rule arm; sign test p = 0.125, not significant). Notes the reader called unsupported fell 77 → 24 (29 pages fewer, 1 more; p < 0.0001) and hedges in notes 58 → 1. But notes the reader called wrong did not fall (35 → 30, p = 0.61), and the counter-class rose well past the repeat noise: helpful correct notes 214 → 128 (fewer on 38 pages, more on 4) and places where a reader needs a note and has none 98 → 143 (more on 32, fewer on 6). On the 12 clean pages, the rule cut helpful notes on 11 of 12 and added missing-note findings on 10 of 12. Other classes did not move (serious pages with a non-T10 error: 20 and 20)."
decision: "Do not ship the rule as worded. It removes notes by kind, so it removes good allusion and reference notes along with invented ones, and it does not touch the residual T10, which is a confident note built on an OCR misread. Two next tests, both DECISIONs on v2#8632: a narrower rule developed on half A, and a source-check of notes on the pages whose OCR is flagged."
---

PRIOR ART: `2026-11-12-free-ocr-english-checks-8632.md` (suite 1: hedging notes mark T10 pages, but only 14% of the
quoted T10 errors carry a hedge, so the fix has to be prevention); the vision note's Part 4 (suite 2, counter-class named
in advance: glosses lost); `scripts/batch/claude-translate.mjs` (the read stage, used unchanged);
`scripts/audit/convergent-audit-weekly.mjs` and `scripts/eval/second-reader/run-readers.sh` (the weekly audit's sealed
reader, so the classes are the audit's).

## 2026-11-12 · Does a note rule prevent T10 without losing glosses? (v3#44, v2#8632 decision 1)

Code and results: `scripts/eval/error-zoo/t10-note-test/` (`draw.mjs`, `translate-arms.sh`, `packets.mjs`,
`NOTES-ADDENDUM.md`, `score.mjs`, `paired-notes.mjs`; `results-2026-11-12/`). Derek said yes on v2#8632: spare Claude
quota, no writes. This box's account went from 44% to about 50% of its week.

**Design, fixed before any read.**
- **Rule (arm B)**, appended to the live translation prompt (DB `Standard Translation` v21) through
  `--instructions-file`: "a `<note>` may gloss a word or phrase, give the original wording, or mark an interpolated
  clarification. It never explains a reading, and never adds a date, name or reference that this page lacks." Arm A is
  the live prompt alone. The rule wording is the one posted as the DECISION; it was not tuned.
- **Pages.** 40 pages with a serious T10 finding and a fresh label, from the held-out half B of books (the same book id
  parity as suite 1), one per book, seed 8632. Plus 12 clean pages: weekly audit, random served stratum, no serious
  finding, at least one note. 16 languages; Latin 19, Chinese 7, Greek 4, French 4.
- **Translator.** Opus through the Claude CLI (`claude-translate.mjs read`, one page per call, `--fresh`, R2 kept-read
  copies off). The live route for most cells is Gemini 3.8 Flash through agy, but agy was at its quota on this box
  during the run (216 quota stops among the last 2,000 calls of the production OCR lanes), so it had nothing spare.
  104 of 104 reads succeeded; the rule appears in every arm-B prompt and in no arm-A prompt.
- **Reader.** The weekly audit's Opus reader, sealed per packet, image attached, the frozen brief and calibration
  addendum, plus one addendum (`NOTES-ADDENDUM.md`): for every note and gloss, a verdict (ok, unsupported, wrong) and
  whether a reader would miss it, and up to five places where a note is needed and missing. 116 packets, with ids
  shuffled and arm names absent.
- **Pass rule.** Serious T10 pages fall on the T10 pages with a sign test p < 0.05; no other class rises beyond the
  repeat noise; and helpful notes and missing-note findings do not move against the rule beyond that noise.

**Controls.** Wrong-page: 6 of 6 caught (`right_page: "no"`). Repeats: 6 arm-A pages read twice, and the T10 and
any-serious verdicts agreed on 6 of 6. On repeats, helpful-note counts moved by 0–3 and missing-note counts by 0–1 per
page.

**Results.** Pages are the 52 with both arms read; k/n are pages.

| | live prompt (A) | + note rule (B) | paired: B worse / B better | p |
|---|---|---|---|---|
| serious T10 page, T10 pages | 8/40 | 3/40 | 1 / 6 | 0.125 |
| T10 finding of any severity (count) | 25 | 11 | | |
| serious page with any other class | 20/52 | 20/52 | | |
| notes and glosses (count) | 402 | 268 | | |
| hedging words in notes | 58 | 1 | | |
| notes called unsupported | 77 | 24 | 1 / 29 | < 0.0001 |
| notes called wrong | 35 | 30 | 6 / 9 | 0.61 |
| helpful correct notes | 214 | 128 | 38 / 4 | < 0.0001 |
| needed note missing | 98 | 143 | 32 / 6 | < 0.0001 |
| clean pages: helpful correct notes | 45 | 22 | 11 / 0 | 0.001 |
| clean pages: needed note missing | 18 | 34 | 10 / 0 | 0.002 |

Classes other than T10 (serious pages, A / B): O6 14/14, T7 7/6, O5 6/5, O1 4/5, O7 2/3, I4 2/2, O12 0/2, the rest 0 or 1.
No class moved by more than two pages.

**What the reader found.**
1. **The rule deletes notes by kind, not by truth.** It cut unsupported notes by 70%, and with them the allusion and
   reference notes a reader needs. Examples of missing-note findings in arm B: the feet of iron in Daniel 2; "Wisdom,
   chapter 7" (the Book of Wisdom); Cape Comori (Comorin); the River Diagram (Hetu); the sigla M. and R. of two
   editions. Each of these needs exactly the "name or reference the page lacks" that the rule forbids.
2. **The residual T10 is a note built on an OCR misread, and the rule does not reach it.** 9 of the 11 serious T10
   page reads (both arms) carry a serious OCR error on the same page (O6, O1, O5 or O7). A note names the wrong chakra for the plate in both arms. Arm B glosses a misread numeral
   as a divine name. Arm A explains a misread alchemical sign with "normally stands for fire". These notes are not
   unsupported by the transcription; they are wrong about the leaf. That is why the reader's "wrong" count barely moved.
3. **Hedges are a symptom.** The rule removed hedging almost entirely (58 → 1), which is what suite 1's best check
   flags. A hedge detector run after the rule would see nothing, while T10 remained on 3 of 40 pages.

**Caveats.**
- **One translator, one judge family.** Opus translated and Opus judged. A shared blind spot would bias both arms
  equally, but not necessarily the difference. A second family (Gemini through agy) was not available.
- **The translator is not the live one.** The rule's effect on Gemini 3.8 Flash, which writes most new pages, is
  untested.
- **T10 is underpowered at n = 40.** With 7 discordant pages the test could not reach 0.05 unless at most one went the
  other way. Arm A, a fresh read, already had serious T10 on only 8 of 40 pages that carried T10 in their stored text.
  That is partly the translator and partly regression to the mean; the stored text was not re-judged here.
- **The second addendum asks the reader to look at notes.** Both arms got it, so the comparison holds, but its absolute
  counts are not the weekly audit's.

**Next (DECISIONs on v2#8632).**
- (a) **A narrower rule**, developed on half A and tested on fresh half-B pages: keep allusion and reference notes; forbid only a
  note that explains why the text reads as it does (a misread, an "obscure" passage, a corrupt copy) or that names a
  person, date or work no source line points to. Cost: about 1% of a week's quota.
- (b) **Route rather than prevent.** The residual T10 rides on OCR misreads. Where the OCR is flagged (garble score, O6
  risk), the note could be dropped or checked against the image. That needs no prompt change, and the T10 page score
  from suite 1 (0.787) can aim it.

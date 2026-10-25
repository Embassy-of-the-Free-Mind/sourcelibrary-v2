---
stage: translation
measure: [judged]
languages: [grc]
scripts: [Grek]
canons: []
n_books: 18
n_pages: 18
verdict: "Gemini 3.8 Flash (agy) beats the served Greek English under the Gemini judge: 14 of 18 pages, +1.11 fidelity points (1-5) [0.39, 1.72], both controls passed; +1.38 over lite, +0.90 over 3 Flash. The Opus arm and the Opus judge are PENDING (the Claude account was at 83-86% weekly, over the 70% stop), so no row is written. Re-reading the minor-stale pages changes the meaning on 19 of 20, but 16 of 17 change on a re-read where the OCR did not change at all: the change comes from the reader, not the OCR edit."
status: undecided
decision: null
superseded_by: null
issue: [7075, 5813]
---
## 2026-10-25 · Does Greek translation leave the paid API for a CLI reader? (#7075)
<!-- PRIOR ART: 2026-10-23-pali-cli-lane-sample-7075.md (the same sample, rule and tool, for Pali); #5813 comment
2026-10-24 (the 57,575 minor-stale Greek pages, ~$150 on lite); #5695 (the flash-measured row's evidence). -->

**Why.** Greek sits in the `flash-measured` row: paid 3 Flash, or paid lite under `--lite` (the 2026-10-24
greek-retranslate-5813 job, $19.58). Derek, 2026-10-25: "we probably want to do greek on cli -- otherwise it is
expensive". A cli row goes live only on a blind sample (#7075 step 3).

**Design.** The tool is `scripts/eval/translate-cli-lane-7075/sample.mjs`, run as for Pali, with two additions written
into its header before the first run: `--old=current` and `--arm`.
- **Frame:** 1,527 visible books whose first language label is Greek or Ancient Greek, holding 373,112 pages whose
  stored English is newer than their OCR (≥ 300 characters of OCR, translatable page type), in 1,114 books.
- **Draw:** 20 pages, seeded, one per book, 20 books. Old English: 10 on 3 Flash, 10 on lite. The same-language guard
  skipped 2 English Loeb facing pages, which leaves **18 pairs + 2 wrong-page controls**.
- **New readers:** Gemini 3.8 Flash low through `cli-translate.mjs read` (agy, the lane's own reader). Opus through
  `claude-translate.mjs read` was **not run**: the box's Claude account (team@) was at 83% weekly at the start and 86%
  later, over the brief's 70% stop.
- **Judges:** Gemini 3.8 Flash high (agy) ran. The Opus judge (`claude -p`) is pending for the same reason.
- **Rule:** fixed in the header before the first run. Pali's three rules apply per arm, and each arm also needs the
  other family's judge alone at ≥ 0. An arm with one judge is PENDING.

**Result: Gemini arm, Gemini judge.**

| judge | n | controls | new wins / old / tie | new − old (1-5) | 95% CI |
|---|---|---|---|---|---|
| Gemini 3.8 high | 18 | 2/2 | 14 / 4 / 0 | +1.11 | [0.39, 1.72] |
| Opus | — | — | pending | — | — |

- Split by the old reader: against lite, 7 of 8 wins and +1.38; against 3 Flash, 7 of 10 wins and +0.90.
- This is a **same-family judge**: Gemini judging a Gemini reader. The rule does not count it alone, and that is why
  no row is written.
- Two of the four old wins are judge errors:
  - Plutarch Loeb p.94: the "cut off mid-sentence" read ends where the leaf ends.
  - Gregoras p.424: the new read leaves out the running head, and by eye the rest is right.

**By eye (rule 3): three Gemini reads against the page image.**
- **Nicephorus Gregoras, *Byzantina Historia*, p.424** (6953a965…6380), top half: faithful clause by clause. "Six days
  elapsed" (Ἓξ παρῆλθον ἡμέραι), the creed read aloud and the margin's A.C. 1351 / P. 628 / V. 507 are all right. It
  leaves out the running head and adds one bracketed note naming Palamas.
- **Liturgy of St. Basil, p.15** (69f32edc…49ec): faithful, including the ekphonesis rubric and "the priest, bowing,
  prays". One slip: ἀναδείξας σοὶ τῷ Θεῷ καὶ Πατρί ("showing it to you, God and Father") becomes "looking up to God and
  Father".
- **Proclus, *Elements of Theology*, p.36** (6993892b…118d): not a test of the reader. The stored lite OCR of this
  manuscript loops "ἦν ὄντα ἦν ὄντα" about 30 times in column 2, which is not on the leaf. Both the old English and
  the new read translate the loop faithfully. **Contained** (#7351): the book is held as `ocr-loop-by-eye-7075` and the
  p.36 English is withheld.

No passage in the Gemini reads is invented against its source.

**Stale pages (brief step 5): `stale.mjs` beside the tool.** The #5813 list lives on another box, so the frame was
rebuilt from Mongo.
- **Frame:** 70,762 Greek pages whose translation is older than their OCR (translate-core's `OCR_NEWER`), in 411
  books.
- **Draw:** in seeded order, one page per book, compared with the OCR it replaced (the latest `page_revisions` OCR row,
  using compare.mjs's agreement). Of the 33 pages checked: **8 identical** (agreement 1.0, stale by date only),
  **20 minor** (0.95–1.0), **5 major**. The 20 minor pages were read again with 3.8 Flash and judged A/B: same /
  wording only / meaning changed.

| set | n | same | wording | meaning | new more faithful |
|---|---|---|---|---|---|
| minor-stale (OCR edited, agreement ≥ 0.95) | 20 | 0 | 1 | 19 | 14 (old 6) |
| baseline: OCR unchanged (the 18 sample pages) | 17 | 0 | 1 | 16 | 11 (old 5, tie 1) |

- The baseline is what makes the stale row readable. A fresh read changes the meaning almost every time, whether or
  not the OCR changed, so the minor OCR edits add nothing measurable.
- Some stale verdicts do sit on an OCR edit: Greek musical signs where the old OCR read U and C, a citation 40 b
  against 40 c, ει in a numeral, a library stamp. Most are reader differences.
- Against stale English from 3 Flash the new read is more faithful on 3 of 6. Against lite it is 10 of 13.
- **Judge noise.** On the 17 baseline pages the same Gemini judge, given the same pair under a different prompt and
  side, chose the same winner 12 times. Read single-judge directions as ±30%.

**What this means for the 57,575.** Spending subscription quota to repair the OCR drift is not worth it: the drift
does not change the English beyond what any re-read changes. Re-translating them is the same act as moving Greek to
a better reader, so it should be priced and sequenced with that, lite pages first, where the gain is largest. About a
quarter of the date-stale pages have identical OCR and need no translation at all: a `--stale` marker heal covers
them at no charge. At ~17 s a page, one agy stream would need ~270 hours for 57,575 pages. Nothing was run on them.

**Owed before a row:**
1. The Opus judge on `packet-gemini.json`:
   `node scripts/eval/translate-cli-lane-7075/sample.mjs judge --arm=gemini --judge=opus --out=…/greek-2026-10-25`
2. The Opus arm, on a Claude account under 70% weekly:
   `claude-translate.mjs read --page-ids-file=…/page-ids.json --out=…/new-opus`, then `packet --arm=opus` and both
   judges.

If the Opus judge gives the Gemini arm ≥ 0, the row is `greek-cli-gemini38` (`channel: "cli"`,
`gemini-3.8-flash+agy-cli`, replaces `gemini-3-flash-preview`), split out of `flash-measured`. It does not need the
Opus arm unless Opus wins by more than 0.25.

Results: `scripts/eval/translate-cli-lane-7075/results/greek-2026-10-25/`.

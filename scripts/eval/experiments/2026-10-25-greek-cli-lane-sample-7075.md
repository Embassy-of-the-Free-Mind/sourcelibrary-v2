---
stage: translation
measure: [judged]
languages: [grc]
scripts: [Grek]
canons: []
n_books: 18
n_pages: 18
verdict: "Gemini 3.8 Flash (agy) beats the served Greek English under both judges: Gemini judge 14 of 18 pages, +1.11 fidelity points (1-5) [0.39, 1.72]; Opus judge 12 of 18 (5 old, 1 tie), +0.39 [0.00, 0.78]; both judges passed both wrong-page controls; two-judge mean +0.75. The rule passes and Greek / Ancient Greek move to the agy CLI lane (row greek-cli-gemini38). Re-reading the minor-stale pages changes the meaning on 19 of 20, but 16 of 17 change on a re-read where the OCR did not change at all: the change comes from the reader, not the OCR edit."
status: adopted
decision: "greek-cli-gemini38 row added to scripts/lib/translation-routing-table.json above flash-measured (#7075)"
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
- **Judges:** Gemini 3.8 Flash high (agy), then the Opus judge (`claude -p`, sealed, no tools) on the same packet,
  run 2026-10-25 by job greek-judge-7075 on the derek@ account (~9% weekly).
- **Rule:** fixed in the header before the first run. Pali's three rules apply per arm, and each arm also needs the
  other family's judge alone at ≥ 0. An arm with one judge is PENDING.

**Result: Gemini arm, both judges.**

| judge | n | controls | new wins / old / tie | new − old (1-5) | 95% CI |
|---|---|---|---|---|---|
| Gemini 3.8 high | 18 | 2/2 | 14 / 4 / 0 | +1.11 | [0.39, 1.72] |
| Opus 5.5 | 18 | 2/2 | 12 / 5 / 1 | +0.39 | [0.00, 0.78] |

- Split by the old reader. Gemini judge: against lite, 7 of 8 wins and +1.38; against 3 Flash, 7 of 10 and +0.90.
  Opus judge: against lite, 4 of 8 and +0.13; against 3 Flash, 8 of 10 and +0.60.
- The Gemini judge is **same-family** (Gemini judging a Gemini reader), so the rule needed the Opus judge alone at
  ≥ 0. It is: +0.39, with the lower end of the interval at 0.00. The two judges pick the same winner on 12 of 18.
- The Opus judge is stricter about anything added to the page. 9 of its 20 reasons cite an added note, summary,
  keywords or "continues from the previous page" line. Both sides of the packet carry `<summary>`/`<keywords>`
  blocks, so this is not a packet asymmetry; it marks the new reader down for bracketed notes and for smoothing
  over garbled OCR (Galen, *De morborum differentiis* p.238: "under an obstruction").
- Of Opus's five old wins, two are the Gregoras and Proclus pages read by eye below (the running head; the OCR loop,
  contained). One, Plutarch Loeb p.94, says the new read "copies the printed English facing page". The same page is
  one of the Gemini judge's errors, so it is worth a look by eye before the lane runs on Loeb editions.
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

**Decision (rule fixed in the tool's header before the first run).** (1) Both judges passed both controls.
(2) Under each judge new − old ≥ 0: Gemini +1.11, Opus +0.39. (3) By eye, three Gemini reads were faithful against
the image, and none invents a passage. The other-family judge is ≥ 0. **Adopted:** row `greek-cli-gemini38`
(`channel: "cli"`, `gemini-3.8-flash+agy-cli`, Greek / Ancient Greek as the first language label, replaces
`gemini-3-flash-preview / gemini-3.1-flash-lite`), placed above `flash-measured`. Every other language in
`flash-measured` stays on Batch. Once this is on main, the orchestrator's Phase 4 holds Greek books with untranslated
pages (`CLI_TRANSLATE_HOLD`) for `scripts/batch/cli-translate-lane.mjs` instead of sending them to paid Batch.
Nothing was applied to Greek here.

**Not run, and not needed for the row:** the Opus arm. Under the header's tie rule the agy reader is adopted unless
Opus's two-judge mean beats it by more than 0.25. That comparison can still be run later on a Claude account under
70% weekly: `claude-translate.mjs read --page-ids-file=…/page-ids.json --out=…/new-opus`, then `packet --arm=opus` and
both judges.

Results: `scripts/eval/translate-cli-lane-7075/results/greek-2026-10-25/`.

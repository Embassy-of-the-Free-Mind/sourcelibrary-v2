# Hard-page corpus, and four alarming findings that were all instruments — 2026-08-01/03

Sessions covering #3495 (merge), #3469 (hard-page corpus), #3444 (Tier 1/2 studies),
#3452 (verification), and two silent-drift fixes shipped as #3569.

**The through-line: every alarming finding this week turned out to be the
instrument, not the corpus.** Four of them, each invisible in its own output, each
caught only by looking at the underlying artifact. Two user prompts of the literal
word "spot check" accounted for three.

## Shipped

| PR | what |
|---|---|
| #3495 | merged — `page_revisions` corpus docs; CLAUDE.md conflict resolved keeping both sides |
| #3515 | v0.4-difficulty hard-page corpus — 334 pages, 20 failure classes |
| #3569 | Tier-1/Tier-2 studies + production-prompt loader + single price table |
| #3576 | issue — the `cost_usd` price disagreement (opened; the three decisions are unmade) |

## The four instrument failures

**1. `<warning>` is a script declaration, not a damage report.** #3469's body gave a
damage taxonomy (bleed-through 35%, staining 21%, ink blots 19%, handwriting 8%).
Two independent random samples say warnings appear on ~19% of pages (not 3.8%) and
**95%** of warning bodies read `Handwritten Tibetan Uchen script` or similar. The
real damage classes are 10–500× rarer than assumed, which is why `ink_blot` and
`skew` cannot be filled from self-report at any sample size worth running.

**2. Blank pages contaminated nine difficulty classes.** The `gutter_loss` exemplar
was a *blank page* whose warning read "the page is blank, save for … the gutter …
which belongs to the facing page" — the classifier matched the word `gutter`.
**39 of 334 rows (11.7%)** were declared blank by their own OCR. Reclassified into a
`blank_page` class rather than discarded, keyed on the structured `<page-type>` tag.
(A prose regex was tried and rejected: it would have dropped "significant
bleed-through makes some text difficult to read", a genuine hard page.)

**3. The "fabrication" was a repetition loop from a stale prompt.** 47,813 characters
on a blank page, reported as fabrication. It was `[...]` repeated to the token
ceiling (99.4% repeat coverage) — the #3273 degenerate class — emitted by
`B-current.txt`, an ablation arm named "current production" that was a v10-era
reconstruction missing the entire **Output contract** block. Against the real v15
prompt: **0/39 loops**, median 0 body chars. Fixed in #3569; see the new CLAUDE.md
section.

**4. Price constants split into two camps.** `gemini-3.1-flash-lite` at `0.075/0.30`
in the OCR/eval lane and `0.25/1.50` in the translate/batch lane. Two files *inside
the app* disagree. Neither fits the stored data (mean relative error 0.39 and 1.83
over 400 rows). Now #3576.

## Results that stand

**Tier 2 (bleed-through) — no gain.** 39 pages, live v15 vs v15 + instruction:
30/39 → 32/39 declared blank, transcribed text unchanged at 0, 0 loops both arms.
Four pages flipping in both directions on the label alone. #3444 asked for a number
before shipping; this is it, and it says don't. On the clearest bleed-through page in
the set (*Artis Cabalisticae* leaf 6) **both** arms transcribed the show-through.

**Tier 1 — worth shipping, and NOT shipped.** The live v15 prompt still carries
`<insert>X</insert> — boxed text, later additions`, the exact wording #3444 blames
for #3437, and has no provenance grouping. #3437 was fixed on the *render* side only.
Recommendation posted to #3444: ship as a v16 prompt row without further measurement
— the cross-class run (50/333 vs 52/333) is a clean regression signal even though its
stale base invalidates it as a benefit measurement. **Not done: writing the v16 row
changes every subsequent OCR call and wants an explicit go-ahead.**

**Tier 3 remains the real problem.** Four interventions failed because each asks the
model to report a state it cannot observe. Needs the cloze probe or image statistics.

**#3452 verified, not assumed.** Closed with no comment, so checked: the fix is real.
1,035 rows / 6,391 pages still meter $0.00 and only 34 carry a recoverable
`gemini_job_name`. (First query used `batch: true`; the field is `mode: 'batch'`.)

## Methodology notes worth keeping

- **MinerU 3.4.0 is installed on Hetzner** at `/root/mineru-eval/venv/bin/mineru`
  (not on `PATH` — `which` and `pip list` both miss it). ~15s/page on CPU, free, and
  **not generative**, so it cannot recite. Useful as a *disagreement flagger*, never
  a fabrication oracle: it returned 8 chars on a page with legible mirrored text.
  The negative control is mandatory — median 1,347 chars on real pages vs 0 on blank
  ones is what makes "MinerU found nothing" evidence about the page.
- **Stored production OCR is a free eval arm.** Scoring all 334 corpus pages with the
  attribution metric cost nothing and gave the only number that describes what
  readers actually see (19.2% with ≥1 untagged span).
- **The degeneracy detector took three tries**, two wrong, both caught by the unit
  test rather than by reading: word type/token ratio (meaningless for space-less
  scripts, flagged ~20% of them); non-overlapping 24-char tiles (scored a real
  period-7 loop at 0.14). Ships as sliding-window `1 - distinct/total`.
- **`degenerate_output` is confounded with script family** — 40% space-less vs 4.5%
  spaced, surviving grapheme-cluster windowing (45.0% → 42.9%). Probably a real
  failure rate given Tibetan's known ~1/3, but unproven; every row carries
  `script_family` and the class must be read within a family.

## Open

1. **Ship Tier 1 as prompt v16** — recommended, needs a go-ahead (#3444).
2. **#3576's three decisions** — which price is correct, whether to migrate the
   production `cost_usd` writers, whether to recompute history.
3. **Free query worth running:** how often does stored production OCR put label text
   in `<image-desc>`/`<note>` on illustrated pages? Live exposure across ~48K books,
   zero cost, and a better number than any 10-page sample.
4. `corrupt_scan` (9) and `skew` (12) will not fill from a bigger `--sample` — they
   need synthetic degradation or a targeted visual sweep.

# Preregistration — should the hidden OCR backlog of Persian, Sanskrit, Pali, Arabic, Ge'ez read on flash? (#5795)

PRIOR ART: `PREREGISTRATION-per-language-ocr-suitability.md` (#4729: lite against flash, one page per
book, agreement and a catastrophic tail, but on books that already had OCR, mostly visible, and with no
label check by eye) and `experiments/2026-10-04-reocr-lift-5700.md` (the fidelity lift that moved these
five families to flash for visible and new books; its pages were chosen from scored tracks, not drawn
from the hidden backlog). Neither sampled the population this decision spends on.

Written 2026-10-04, after the sample was sealed (commit `86b75f535`) and before any engine call.
Nothing below changes after the first call; a deviation is reported as a deviation.

## Question

`FLASH_OCR_FROM` (PR #5770) sends these five families to `gemini-3-flash-preview` when the book is
visible or was created on or after 2026-10-04. Their hidden backlog stays on `gemini-3.1-flash-lite`.
Per family: does the backlog itself support moving it to flash?

## Decision rule (copied verbatim from #5795)

> **Decision rule (fixed before any call).** Route a family's hidden backlog to flash if ALL of the following hold:
> - (a) the label is correct on ≥ 90% of sampled pages;
> - (b) flash's catastrophic count ≤ lite's;
> - (c) in the by-eye adjudication flash wins more than it loses, with no flash-invented page.
>
> A family that fails (a) goes to relabelling (#4884), not routing.

## Sample (sealed: `results/hidden-flash-5795/sealed.json`, `hidden-flash-5795/seal.mjs`, seed 5795)

Population per family, measured at the seal: books with `visible != true`, `created_at < 2026-10-04`,
`pages_count > pages_ocr`, no pipeline hold, family = `codeFamily` of the first language of
`books.language` (the test `isFlashOcrBook` applies).

| family | books | pages owed | held, excluded | sealed |
|---|---:|---:|---:|---:|
| Persian (fas) | 145 | 55,584 | 16 | 30 |
| Sanskrit (san) | 1,330 | 187,812 | 1 | 30 |
| Pali (pli) | 26 | 2,772 | 1 | 26 (all) |
| Arabic (ara) | 58 | 13,744 | 143 | 30 |
| Ge'ez (gez) | 2 | 941 | 15 | 1 |

One interior page per book (first and last 10 % of leaves dropped), pages with no stored OCR first; 113
of the 117 sealed pages have none. Five books were skipped because no image could be fetched (4 Arabic,
1 Ge'ez, listed in the seal). No content screen: a blank or mislabelled leaf is part of the answer.
Both arms read the sealed bytes (sha256 in the seal), fetched as production does (`getPageSource`,
1500 px, JPEG q80).

## Operational definitions (fixed here, so the rule cannot be read two ways afterwards)

**Label check, by eye (step 3, before the arms).** Every sealed image is opened. Recorded per page:
observed script, observed language, `page_class` ∈ {text, blank, picture, binding/target}, and
`label_ok`:
- `yes`: the leaf's main text is in the tagged family's language (Sanskrit in any Indic script; Pali
  in any script; a commentary in the same language counts);
- `no`: the main text is another language (Ottoman or Urdu or Jawi under an Arabic or Persian tag,
  Persian under Arabic and the reverse, Hindi or another vernacular under Sanskrit, a Sinhala or
  Burmese or English leaf under Pali, a Latin-script translation or introduction);
- `n/a`: no running text on the leaf (blank, picture, binding).
- A leaf in two languages is `yes` when the tagged language carries at least half of the text.
- Where the reader cannot tell the language from the image with confidence, the page is recorded
  `unsure` with the reason, and counts as NOT correct for (a): a label nobody can confirm is not
  evidence for spending on it.
- **(a) = `yes` / (pages with running text)**, threshold ≥ 0.90. Wilson 95 % interval reported; the
  rule reads the point estimate.

**Arms.** `gemini-3.1-flash-lite` and `gemini-3-flash-preview`, realtime (a headless job cannot be woken
by a Batch job), the live default OCR prompt (version and `content_hash` asserted equal across every
call and recorded) plus the production document-context line, temperature 0, `thinkingBudget` 0,
16,384 output tokens, production safety settings. One retry when the first answer is a refusal or
comes back empty with a refusal `finishReason`; the retry's answer is the one scored and the first is
kept. Metered through `gemini-script-client` on the pseudo book id `hidden-flash-5795` under a $3
envelope; the run stops at $3.

**Catastrophic, per engine per page (b).** One of:
- `refusal`: after the retry, `finishReason` ∈ {RECITATION, PROHIBITED_CONTENT, SAFETY, BLOCKLIST,
  SPII, IMAGE_SAFETY} (`lib/refusals.mjs`) with no transcription body;
- `empty`: no letters in the transcription body on a page that by eye carries running text;
- `loop`: `loopVerdict` (`scripts/lib/ocr-loop-guard.mjs`, the production guard) refuses the output,
  or `finishReason` = MAX_TOKENS.
A blank or picture leaf read as empty is correct, not catastrophic. Counts are per family with Wilson
95 % intervals. **(b) = flash count ≤ lite count**, over all sealed pages of the family, whatever
their label.

**Agreement.** `agreementChars` (`lib/metrics.mjs`; letters only, markup stripped) between the two
engines' outputs, per page; median and quartiles per family. Not word agreement (#4729 Amendment 6).
Descriptive: it selects the adjudication pages and is not in the rule.

**By-eye adjudication (c).** Per family, the 10 pages with the LOWEST `agreementChars` among pages
with running text (a page where either engine is catastrophic counts as agreement 0 and is included
first; ties broken by slug). For each, the image is opened beside both outputs with the engine names
hidden behind `A`/`B` (assignment seeded per page, key written before the reading) and one verdict is
recorded: `flash` (only flash reads the page), `lite` (only lite does), `both`, `neither`. "Reads the
page" = the transcription follows the lines on the leaf in the right script and language closely
enough to translate from; where both do, the page is `both` unless one is clearly closer on the lines
checked, in which case that engine wins. Checked against the image on at least three places per page
(first line, a middle line, last line).
- **Invented text**: an output carrying running text that is not on the leaf (a fluent passage with
  no counterpart, a different work, a leaf's worth of text on a blank or picture page), quoted in the
  verdict. A misreading of words that are there is an error, not an invention. Blank and picture
  leaves on which an engine wrote running text are checked for invention in addition to the ten.
- **(c) = flash wins > flash losses AND zero flash-invented pages** among the pages checked.
- If flash wins = flash losses (including 0 = 0), (c) fails: the rule says "more than".

**Verdict per family.** `route to flash` iff (a) and (b) and (c). `relabel (#4884)` if (a) fails,
whatever (b) and (c) say. `stay on lite` if (a) holds and (b) or (c) fails.

**Small n.** A family with fewer than 10 sealed pages with running text is reported `undecided: n too
small` and stays on lite; the rule is not applied to it. This binds Ge'ez (1 sealed page of a 2-book
population; its other 15 hidden books are held). Stated here before the run.

## Not in the rule

- Reference CER, where a public e-text matches a sealed page quickly (GRETIL, Ganjoor, OpenITI):
  reported if found, never substituted for (c).
- The reader of the images and the adjudicator is a Claude model, one family of reader; the engines
  are both Gemini. Accuracy in the eval-design §2 sense is not measured: agreement selects pages, the
  eye decides them.
- Chinese, Tibetan, Syriac, Hebrew routing; `OCR_LITE_ONLY`; any write to `books` or `pages`.

## What a passing family changes

Its hidden books (created before 2026-10-04) route to flash in `scripts/lib/ocr-routing.mjs`, by a
per-family flag next to `FLASH_OCR_FROM`, pinned in `tests/unit/translate-core-parity.test.ts`. Held
books stay held. Spend: Batch flash ≈ $2.83 per 1,000 pages against ≈ $0.9 on lite (#5700 step 3).

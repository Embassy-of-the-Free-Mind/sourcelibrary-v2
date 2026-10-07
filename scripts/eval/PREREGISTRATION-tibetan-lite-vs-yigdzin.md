# Pre-registration: Gemini-lite vs Yigdzin on the same Tibetan pages (#4523)

PRIOR ART: the plan on #4523 (2026-10-03 comment "Gemini-lite vs Yigdzin on the same pages: a no-waste plan");
`/root/tibetan-eval/kanjur_align.py` (the Derge instrument: syllable-shingle retrieval + Needleman-Wunsch identity,
with a shuffle chance floor); `scripts/eval/PREREGISTRATION-bench2-print.md` (format). None of them compares these
two engines on the same pages.

_Written 2026-10-03, during the Yigdzin read and **before any lite/Yigdzin pair has been read or scored**. Job
yigdzin-527. Rules below are fixed here so they cannot be picked after seeing the numbers._

## Question

527 held Tibetan books have pages that the preview lane OCR'd with `gemini-3.1-flash-lite` (10,630 pages), and no
Yigdzin read. The job reads all of their pages with Yigdzin (BDRC/tibetan-ocr `50506eb6`, per-leaf partition mode, the
step-2 worker) anyway. `apply-reocr-verdicts.mjs` snapshots the lite text to `page_revisions` before it overwrites it,
so both reads exist afterwards at no extra cost.

**How often do the two engines diverge on the same page, and when they do, which one has read the page?**

This is an **agreement** measurement. Agreement between two reads says how often they diverge. It does not say which
one is right. The by-eye arbitration (below) and the Derge control are the only parts that touch accuracy, and the
arbitration is left to a human.

## Population and draw

- **Pair:** a page whose current `ocr.model` is `bdrc-yigdzin-v1` with `ocr.engine.run = yigdzin-leaf-2026-10-03`
  (accepted and applied by this job), and which has a `page_revisions` row with `field: ocr`,
  `model: gemini-3.1-flash-lite`, `reason: reocr_bdrc_4523`. If there are several such rows, the earliest is used.
- **One page per book:** among a book's pairs, the page with the smallest `sha256("4523:" + page_id)`.
- Books whose lite pages were all rejected by the acceptance rule (the lite read is still served there) have no pair.
  They are counted and reported, but not scored.

## Normalisation (identical for both reads)

1. Remove every `<…>` tag, including `<leaf-break/>` and any page-type tags in the lite output.
2. Delete every character outside U+0F00–U+0FFF, except whitespace.
3. Split into syllables with `kanjur_align.syllables` (NFC, Tibetan punctuation → tsheg, split on tsheg).

## Primary measure

**Syllable agreement** = 1 − Levenshtein(lite syllables, Yigdzin syllables) / max(|lite|, |Yigdzin|).
If both are empty it is undefined, and the pair is reported as such.

Reported over the one-page-per-book sample:
- n, median, IQR and mean;
- counts in four bins: < 0.2, 0.2–0.5, 0.5–0.8, ≥ 0.8;
- the same split by provider (BDRC vs BL vs other).

Two descriptive companions, with no decision attached:
- the syllable-count ratio lite / Yigdzin;
- the lexicon validity share of each read (`lexicon.valid_share`).

## Disagreement pages for by-eye arbitration (40)

- **Disagreement** = syllable agreement < 0.5.
- Draw 40 from the disagreement pages, ordered by `sha256("arb:" + page_id)`.
- If fewer than 40 qualify, take all of them and fill up to 40 with the remaining sample pages in ascending
  agreement order. The report says how many were filled this way.
- Output, in the results directory:
  - `arbitration-40.json`: page id, book, title, page number, image URL, lite text, Yigdzin text, agreement, and an
    empty `verdict` field;
  - `arbitration-40.html`: image, lite text and Yigdzin text side by side, with a key for the verdicts.
- **Verdicts** (for the human arbiter): `lite-right` / `yigdzin-right` / `both-wrong` / `both-right` /
  `image-unreadable`.
- **This job does NOT judge them, and no model judges them.**

## Positive control: Derge

- **Book:** Neyphug Kanjur rGyud Ta (`6a3702206b486c89426f8d62`), the only Kangyur-titled book among the 527.
- **Pages:** every page of it that has a pair (at most 25).
- **Method:** score each arm with `kanjur_align.py score` against the full Derge index
  (`/root/tibetan-eval/etext-index-full.pkl`, default window 2). Also run `--control-shuffle` for each arm, to give
  its chance floor.
- **Reported:**
  - median identity per arm;
  - the paired difference (Yigdzin − lite) per page and its median;
  - the number of pages each arm wins;
  - the shuffle floors.
- **The instrument counts as valid on this book only if the Yigdzin arm's median identity exceeds its shuffle floor
  by ≥ 0.20.** If it does not, the control is reported as uninformative, for example because the book is not a Derge
  witness at these pages, and no engine claim is drawn from it.

## What will not be claimed

- No accuracy number from agreement.
- No "which engine is better" claim from the 40 pages until a human has filled in the verdicts.
- No claim about books outside these 527.

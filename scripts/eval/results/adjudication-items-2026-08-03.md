# Span adjudication items (2026-08-03)

400 judgements drawn from 171 pages, at most 3 per page,
one page per book. Each asks a volunteer to look at the scan and pick which of two
readings matches it — seconds per item, against 10–30 minutes to transcribe a page,
and it never asks a human to produce text whose own errors would then be
indistinguishable from the OCR errors being measured.

## What each item contains

- the page image and a link to the reader
- 7 words of context either side, taken from the CURRENT text so the volunteer
  can find the line on the page
- two candidate readings, **blinded and order-randomised**, so nobody can score the
  model instead of the page
- four answers: A, B, neither, and "can't tell — scan unreadable". `neither` matters
  because both passes are often wrong together on a hard hand, and a forced choice
  would record that as a correct reading. "Can't tell" is evidence about the SCAN,
  not the readings; pages that collect it are themselves a finding.

## Quality controls

- **7 gold items** (1.8%) where one side is a repetition loop or model
  commentary rather than a transcription, so the answer is known. A volunteer who fails
  these is not reading the image, and without them a careful annotator and a fast one
  are indistinguishable.
- **52 overlap items** (13.0%) to be shown to a second volunteer.
  Without inter-annotator agreement, volunteer disagreement and OCR error are the same
  number and the calibration is against noise.
- the answer key is written to a SEPARATE file (`adjudication-key-2026-08-03.jsonl`) so the task
  file can be handed out without leaking which option is the live text.

## Rejected before a human sees them

- 5 pages in space-less scripts (Han, kana, Tibetan, Thai): a word-level task
  cannot pose a sensible question there, and they need a character-level variant
- 43 spans whose two candidates were too dissimilar in length to be one word read
  two ways — the aligner slipping, not a reading
- 30 spans that are line-break hyphenation (`inso-` against `insolubles.`): both
  passes read the same marks and differ on whether to rejoin, so the answer is not on
  the page
- 154 spans that are the SAME WORD after folding punctuation and scribal
  convention (`uns,`/`uns`, `tiu`/`tiū`, `naturae`/`naturæ`). Real inconsistency, already
  counted by `agreement_folded`, and not a question a person can add anything to.
- `<image-desc>` blocks, which are AI prose about a picture: a preview run asked whether
  the page said "beginning" or "start" when nothing on the page said either

## Coverage

| language | items |
|---|---:|
| Latin | 130 |
| German | 109 |
| English | 48 |
| French | 25 |
| Greek | 21 |
| Hebrew | 12 |
| Dutch | 11 |
| auto-detect | 7 |
| Italian | 6 |
| Syriac | 6 |
| Old Javanese | 3 |
| Arabic | 3 |
| Hebrew-Greek | 3 |
| Chagatai Turkish | 3 |
| Burmese | 3 |
| Karaim and Hebrew | 3 |
| Lb | 3 |
| Spanish | 2 |
| Japanese | 1 |
| Chinese | 1 |

## What these answers buy

Each adjudicated span is a labelled token: it converts "the two passes disagree, so at
least one is wrong" — a lower bound — into an observed error rate per stratum. Pair it
with the agreement measured on the same pages and the agreement→accuracy calibration
stops resting on ~32 anchor pages.

**Not covered by this task:** pages where both passes AGREE and are both wrong. Agreement
is blind to recitation by construction, and no adjudication of disagreements can see it.
That needs whole-page review of canonical texts, and it is the one question that cannot
be answered by spending money instead of volunteer time.

Items: `adjudication-items-2026-08-03.jsonl` · key: `adjudication-key-2026-08-03.jsonl`

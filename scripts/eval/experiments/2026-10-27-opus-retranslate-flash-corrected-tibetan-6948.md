---
stage: translation
measure: none
languages: [bo]
scripts: [Tibt]
canons: [derge-kangyur]
n_books: 1
n_pages: 739
verdict: "Opus (claude -p, one page per call, seeded with the previous leaf) re-translated 738 of the 739 Flash-corrected leaves of Neyphug Kanjur rGyud Tsha; 0 refused at apply. By eye (8 leaves on the image, 6 more Tibetan against English) it dropped one clause (leaf 800, re-read) and invented nothing. Repeated sentences: 14 pages in the old flash-lite English, and each one left in the new English is also repeated in the Tibetan. The Flash OCR correction itself still carries an invented line on leaf 128, so that leaf's English is withheld."
status: informational
decision: "738 pages written via cli-translate.mjs apply; leaf 128 contained (book held tib-flash-invented-line-6948, English withheld) until line 5 is re-transcribed (#6948)"
superseded_by: null
issue: [6948, 6740, 6560]
---
PRIOR ART: `scripts/batch/claude-translate.mjs` (the reader) and `scripts/batch/cli-translate.mjs apply` (the writer), used
as they are. The leaf-128 finding continues #6740's duplicate-line work (`scripts/audit/tibetan-duplicate-lines.mjs`, PR #7483).
No new tool.

## 2026-10-27 · Does an Opus re-translation of the Flash-corrected Tibetan leaves fix the repeated and invented English? (#6948)

**Frame.** Every page of Neyphug Kanjur rGyud Tsha (`69e7abec5f1a22ab19aa0707`, the Kriyātantra volume) whose OCR is
the agy 3.8 Flash-low correction (`ocr.pipeline: tib-correct-6560`) and which carried `translation_stale`: 739 pages. The old
English was gemini-3.1-flash-lite's translation of the Yigdzin text. The volume was split into 15 texts at each title and
colophon, and the texts were ranked by whether they have published English. 84000's TEI repository (`84000/data-tei`) was
the source: a file under `translations/` counts as published, one under `placeholders/` as not started.

**Run.** `claude-translate.mjs read --per-call=1`, one text per process, at most 5 processes at a time, about 20 s a page.
The run took 1 h 25 min (02:49–04:14 UTC). Over it, the Max 20x account went from 23% to 42% of its 5-hour window and
from 30% to 33% of its week. Other sessions on the same account count toward both. Each text was
written by `cli-translate.mjs apply --apply` once its read was done.

**Results.**
- 738 written, 0 refused by apply. Six calls returned tags the parser refused (pp. 17, 56, 83, 215, 237, 727); each
  succeeded on the script's automatic retry.
- **Omission.** One read dropped a clause: leaf 800 of the Susiddhikara left out "by those same rituals one should do
  everything exactly so, beginning with the purification of the ground". It was re-read alone and fixed. That is 1 page in
  14 by eye. An English-words-per-Tibetan-syllable screen cannot see an omission that small: the faulty read scored 0.877
  against a median of 0.806, and the low outliers are mantra pages.
- **Repetition.** The script scan looked for a sentence of 8 or more words repeated within a page. 14 of the 738 replaced
  English pages had one. Every repeat left in the new English is also repeated in the Tibetan:
  - leaf 131: on the image, lines 6 and 7 of the leaf both open with the anger sentence;
  - the hymn refrain on 289–290;
  - 118 and 446, whose sentence appears twice in the OCR;
  - the recurring mantra homage on 286 and 437.
- **Mantras.** Mantras stay mantras, given in normalised IAST Sanskrit (for example "nivāraya" for the OCR's ནི་བཱ་ར་ཡ).
  Opus labels a corrupt spell as unreadable (leaf 455) and does not invent a meaning for it.
- **The Flash OCR correction is not clean (leaf 128).** The Yigdzin text gave the Jewel-Adorned Goddess mudrā three times
  across 8 lines; the leaf has 7 lines and gives it once. The Flash correction cut the lines to 7 but kept the sentence twice:
  in line 5 it replaced a different fist mudrā with a copy. Two readings confirmed this: lines 5–7 zoomed by eye, and an
  independent Opus OCR read of the image, which agreed on the structure but could not read the replaced mudrā's words. A
  fresh Opus translation called the copy "probably a scribal repetition". Leaf 128 is therefore contained (the book is held
  and that leaf's English withheld, `containment-on-finding.md`), and its Opus read is kept unwritten.
- **Text checks cannot find this kind of error.** All 739 corrected leaves have 7 OCR lines (2 have 6), so a line count
  does not flag leaf 128. 111 of the 739 repeat a run of 10 or more syllables, and the longest runs checked are sūtra
  formulas genuinely on the leaf (221: the same sentence for the nadir and the zenith).

**Replicated?** No; one volume. The 19 wave-2 volumes had no corrected pages written when this ran.

**Artifacts** (job scratch, not in the repo): reads, prompts and apply logs under
`/mnt/HC_Volume_105839809/jobs/tib-opus-translate-6948/`. The showcase of six leaves is on #6948.

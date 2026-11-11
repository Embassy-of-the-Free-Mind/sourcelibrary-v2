---
stage: ocr
measure: accuracy
languages: [la]
scripts: [Latn]
canons: []
n_books: 31
n_pages: 80
verdict: "Applying the #7174 long-s pass to stored Latin OCR needed a stricter rule than the measured pass: on flash pages, by eye, the raw pass made 8 meaning changes in 756 edits (fit → ſit, fi. for figura). After three rounds tightening the rule (act only where the f-spelling is not a word), round 4 was 787/787 right with 0 meaning changes. Written through an orthographic-only path that leaves ocr.updated_at alone; the canary changed 0 stale flags."
status: adopted
decision: "Long s restored in stored lite and flash Latin OCR, ≥ 1501, by scripts/maintenance/longs-pass-5924.mjs with the final rule (PR on #5924)"
superseded_by: null
issue: [5924]
---
PRIOR ART: `2026-10-22-latin-longs-pass-5924.md` (the pass, scored on 99 lite reference pages by CER; its by-eye check was
6 lite pages). This entry is the APPLY gate: flash pages, which the pass was never measured on, judged change by change
against the image, plus the write path's staleness check.

## 2026-10-23 · Can the long-s pass be written to stored OCR, flash pages included, with no meaning changes and no stale translations? (#5924)

**Yes, with a stricter rule than the measured pass.** The pass decides from a lexicon where an f is a misread ſ. On flash
pages it was right on 747 of 756 changes, but all 8 wrong ones changed a word into another word. The applied rule
keeps the pass's decision only where the f-spelling is not itself a word, so an edit can turn a non-word into a word
and never one word into another.

**Gate.** Four rounds of 20 flash pages, drawn by seed from the latin-repair-census books (#7173), half from pages
whose reader writes ſ as f and half from pages where it does not. In each round, four independent Opus readers zoomed
into the R2 page image for each change: every change on pages with ≤ 40, otherwise ≥ 3 per token type plus every risky
type. Verdicts: `latin-longs-pass-5924/apply-gate-5924.json`; draw: `apply-gate-draw.mjs`, `apply-dry.mjs`.

| round | changes | right | wrong | can't read | meaning changes | rule added after it |
|---|---|---|---|---|---|---|
| 1 | 756 | 747 | 8 | 1 | 8: `fi.` (figura) → `ſi.` ×6, `fit` → `ſit` ×2 | never change a real f-word on any page; never an attested f-token before a full stop |
| 2 | 544 | 541 | 2 | 1 | 2: `infectatur` → `inſectatur` (2 vs 64 in the lexicon), `flāte` → `ſlāte` | "real word" = in the lexicon at all (≥ 2) and ≥ 2% of the ſ-reading; no ſ before r, or word-initially before l |
| 3 | 830 | 826 | 2 | 2 | 1: `fe` + `stiue` (*festiue*, unhyphenated break) → `ſe` | a ≤ 3-letter word ending a line that the next line continues in lower case is not judged |
| **4** | **787** | **787** | 0 | 0 | **0** | — |

- All 11 meaning changes of rounds 1–3 are held back by the final rule (rechecked on the stored text). One non-meaning
  error remains: a garbled OCR non-word becomes another non-word.
- What the rule costs, on the 26.5K census pages: the gates and hold-backs keep 182K of the raw pass's lite edits and
  37.6K of its flash edits. The largest hold-back is capitalised words (names), then attested f-words.
- What the readers saw it miss: names (`Patiſſus`), `fit` where the print has ſit, capitalised `Eft`. These are misses,
  not errors.
- **Considered and not taken:** a word-family test for f-forms the lexicon has never seen. It would hold back 11.5% of
  correct edits (`ſicut`, `ſermo`, `ſeruus` share prefixes with `ficus`, `fermentum`, `ferveo`). Also a character-model
  plausibility test, which cannot separate `eft` (−0.82) from `infectatur` (−0.69).

**Write path.** `scripts/lib/longs-orthography.mjs` writes through `writePageText` with `verbatim`, so `ocr.updated_at`
keeps its value. Translation staleness, gap-fill, the stale marker and the embeddings watermark all read that clock.
`assertOrthographicOnly` throws on anything but f → ſ. Each page gets a revision row with `source: 'longs-pass-5924'`
and a run id. Canary: 10 lite books × 20 pages. `translation_stale` stayed at 0 on all 4,799 pages of those books,
staleness by predicate stayed at 0, no jobs or translate runs were created, and `mark-stale-translations --full` found
0 stale on two of the books. A first canary under the round-3 rule was undone with `revert-run.mjs` (200/200
byte-identical) and redone.

**Full run** (2026-10-23 07:20–08:14Z, run `longs-pass-5924-full-20261023T0720Z`, 4 shards, 52,841 Latin books in frame):
**485,075 pages written** (298,273 lite, 186,802 flash) in 18,550 books, and 8.18M ſ restored. There were 0
conflicts and 0 human edits touched. An independent re-read of every written page found `ocr.updated_at` moved on
0 pages. The 330 stale markers and 1,154 stale-by-predicate pages among them all predate the run, and 0 translation
jobs or translate runs were created for those books. Books skipped: 18,539 held (11,282 scans-only and 2,098
unprocessed warehouse promotions lead), 3,095 not Latin by their own text, 1,675 printed before 1501, 835 on the
latin-lang-relabel skip list, 28 with an open translate run. Pages skipped: 297K with too few Latin markers, 61K
gothic/Fraktur/manuscript, and 1.22M where the rule left nothing to change.

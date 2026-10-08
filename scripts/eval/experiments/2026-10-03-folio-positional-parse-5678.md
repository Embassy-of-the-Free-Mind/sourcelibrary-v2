## 2026-10-03 · Folio markers read by position: how many of the seam A/B marker defects were the parser's? (#5678)

PRIOR ART: `2026-10-03-seam-ab-markers-5678.md` (the A/B and its post-hoc "Amendment 2" positional reading, an
eval-only copy in `seam-ab-5678.mjs`); `2026-10-03-folio-markers-5678.md` (the Tengyur preview and the parser it
introduced). This record re-scores those outputs with the lane's own parser, now positional.

**Question.** In the seam A/B the literal marker parse failed on 22 of 120 Lite+markers blocks and 13 of 120
Flash+markers blocks. The model had numbered `<pb n>` by the printed `<page-num>`, or Lite had left out the opening
marker. If `scripts/lib/folio-markers.mjs` reads markers by ORDER, not by `n`, how many of those defects go away?

**Design.** $0. No model calls; the existing outputs and blind verdicts are re-read
(`scripts/eval/folio-positional-5678.mjs`):
- every B/C block is parsed by the new parser, against the literal parse recorded at collect time;
- each block's new turn window is compared with the packet text the judges read, so a verdict carries over only
  where the text is the same;
- the score uses the registered consensus rule: a break is a real defect when either page is left empty, or both
  judges flagged duplication, forced closure, edge omission or ≥6 words moved.

**Result.**

| 100 mid-sentence breaks | parse failures, literal → positional | real seam defects, literal → positional |
|---|---:|---:|
| B Lite + markers | 17 → **1** | 28 → **15** |
| C Flash + markers | 11 → **0** | 18 → **8** |

| 20 closed controls | parse failures | real defects |
|---|---:|---:|
| B | 5 → 0 | 5 → 0 |
| C | 2 → 0 | 2 → 0 |

- These are the post-hoc positional numbers from the A/B exactly (B 15, C 8; controls 0 / 0). They are now what
  the lane's parser produces, not an eval-side reading.
- **Readings, B / C over all 120:**
  - literal: 94 / 107;
  - renumbered: 14 / 13;
  - opener-missing: 11 / 0;
  - partial: 1 / 0.
- **The one remaining B failure is the only genuinely unmarked turn** (`6a4ba774…:21`): one marker, `n="21"`, at
  the opening. Page 22 is empty, and page 21 is reported as `overrun` (its span holds both pages). The block lane
  drafts neither.
- **Spans differ from what the judges read in 2 of 240 blocks:**
  - the unmarked block, a defect either way;
  - `6a4b47…:17` (B). The model put `<pb n="17"/>` halfway down page 17. The literal parse dropped the English
    before it, about half of page 17. The positional parse keeps it on page 17. The 17→18 turn is unchanged and
    was judged clean.
- **Tengyur preview (#5682):** all 11 blocks parse to the spans they were published with. Vol 96 p121–124 reads
  as `partial`: p123 is empty, and p122 is now flagged `overrun`.

**What changed in the code** (flag `TRANSLATE_FOLIO_MARKERS` still off; production byte-identical):
- `parseFolioMarkedText` reads markers in five ways: literal / renumbered / opener-missing / partial / rejected.
  It rejects a block only when there are more markers than pages, or too few with no way to tell which turn is
  unmarked.
- `FOLIO_MARKER_RULE` names the `--- Page N ---` number and forbids a printed page, folio or signature number.
  Not yet measured: that would need a model run.

**Not shown.** Whether the prompt wording alone stops the renumbering. With the positional parser it no longer
matters to the spans, only to the `unexpected` diagnostic.

Results: `scripts/eval/results/folio-positional-5678/`. Fixtures: `tests/fixtures/folio-markers/`.

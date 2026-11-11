---
id: kangyur-finish-8482-by-eye
version: 1
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [6948, 8482]
status: active
---
<!-- PRIOR ART: stub-books-8181-by-eye.md (the same shape, but transcription only and for a first-read lane; these pages carry an
imported e-text and the check is on the English); lane-spot-check.md (Siku-only v1, a frozen prompt in a sealed folder);
served-audit (a frame, not a reader). -->
## kangyur-finish-8482-by-eye v1: spot checks on the English written for the published Derge Kangyur (#6948, #8482)

**What it is for.** The job that finished the Derge Kangyur translation (kangyur-finish-8482) wrote English for about
6,000 pages that carry the Esukhia e-text, with the Opus CLI route at 10 pages a call. This method answers one question:
does a page from that run carry this leaf's text, and does the English say what the Tibetan says? It does not measure the
volume's accuracy. Three pages cannot.

**Sampling.** The frame is the pages this run translated (`translation.updated_at` after 2026-11-11T10:00Z) in the 103 books
held `kangyur-import`. Three books are picked, one from each genre: a tantra (rgyud 'bum), a sutra (mdo sde) and a
dharani (gzungs 'dus). One page is then drawn at random within each book. `frame.selection` is `picked`.

**Reader and input.** The job's Opus session opens the archived leaf image (`archived_photo`), checks the stored e-text
against the printed lines (first, middle and last line at least), and reads the English against the Tibetan e-text. Reader
in the row: `{kind: model, model, image_opened: true}`.

**Serious.** Only text that is not this leaf's: `wrong_page` (another leaf's e-text or English) or invented content (a name,
a step of a rite, or a clause that the Tibetan does not carry). Either one goes to `containment-on-finding.md`. Other slips
are `defects` with a severity: `cosmetic` (an uncertain plant name, a note in an odd place) or `misleads` (a clause or a
ritual step that reads wrong).

**Verdict.** `verdict_source: rule`. `fix` for a serious page, `caveat` for a page with a `misleads` defect, otherwise
`show`.

**Readers.** `reader_warning: false`. Three picked pages say nothing about the book they come from. The volumes keep the
standard unreviewed-AI label whatever these rows say.

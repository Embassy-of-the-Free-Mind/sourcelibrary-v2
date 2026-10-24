# Whish 147 best-attempt OCR + translation (#7119)

PRIOR ART: ../whish147-palm-leaf-opus-2026-10-21/ (#7106, #7109) measured the method used here (collation against an
edition finds 25/36 planted differences; free reads are at chance) on 9 leaves; this run applies it to all 159 pages.
scripts/batch/claude-ocr.mjs (`claudeCall`), claude-translate.mjs and cli-translate.mjs apply are reused as they are.

Pipeline, all Claude through the subscription CLI (`claude -p`, sealed folder holding only the crops):
1. `build_editions.py` — reference texts in IAST, numbering stripped (GRETIL kārikās, Jayamaṅgalā, Tarkasaṃgraha,
   Dīpikā; the Tattvakaumudī from our own OCR of Tārānātha's print, `export-tk-print.mjs`).
2. `crop.py` — finds both leaves on each scan (`boxes.json`), cuts each at its midpoint; `leafimg.py`/`quarters.py`
   whole-leaf and quarter crops for the probes.
3. `probe.mjs` — which scans hold an invocation/colophon (work boundaries).
4. `locate.mjs` — Opus places each leaf in the edition, leaf after leaf (`locate-{A,B,C}.json`).
5. `collate.mjs` — placed leaf: Opus collation against the excerpt (edition-anchored); unplaced: Fable free read
   of each half.
6. `assemble.mjs` — page text: `<warning>` first, then upper-left, upper-right, `<leaf-break/>`, lower-left,
   lower-right; `write-ocr.mjs` — fill-only write with provenance (`ocr.pipeline = whish147-best-attempt`).
7. `translate-plan.mjs` + `run-translate.sh` — per-page instruction with the exact English `<warning>`;
   `check-translations.mjs` checks it before `cli-translate.mjs apply`.
8. `publish.mjs` — `setPublication(public)` and the book note (`summary`); the pipeline hold is not touched.
9. `status.mjs` → `summary.json` (per-page outcome); `qa.json` (live-site check of 5 random pages).

`reads.tar.gz` holds `reads/` (every prompt, reply and meta: image sha256, model, usage), `pages/` (assembled page
texts and per-leaf method) and `translate/reads/`. Unpack it here before re-running any stage; calls are cached by
prompt hash, so a re-run makes no new call for a read already done.

Spot-check fixes and the manuscript map (#7119, job whish147-fix, 2026-10-23):
- `fix-spotcheck.mjs` — hole marker (‖hole‖ and its other forms) -> bare ‖; single-leaf headings ("Rows of this leaf",
  or "… left/right half (half-leaf segments)" where the re-layout failed) and the matching warning; the generated
  Malayalam rebuilt from the IAST with `mlym.py` (now also word-final t -> ൽ; tests: `test_mlym.py`). No model call.
  Results per run: `fix-spotcheck-result-run{1,2,3}.json`.
- `classify-script.mjs` -> `classify-script.json` — one Opus call per page: script, rows, hand.
- `identify-work.mjs` -> `identify-work.json` — top rows of 12 dense-hand leaves at full resolution: formula, kārikā.
- `manuscript-map.mjs` -> `manuscript-map.json` — page ranges -> hand -> script -> work; writes `languages` and the
  book note.

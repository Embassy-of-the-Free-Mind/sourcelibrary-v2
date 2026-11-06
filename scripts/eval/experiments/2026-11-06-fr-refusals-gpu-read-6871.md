---
stage: ocr
measure: [judged]
languages: [fr]
scripts: [Latn]
canons: []
n_books: 48
n_pages: 770
verdict: "LightOnOCR-3-1B, run through the English 1800+ GPU print lane's reader and guards with no changes, read all 770 French 1800+ pages Flash-Lite had refused (48 books) in 10 min on gex45, with 0 fetch or read errors. The guards would write 627 and turn away 143: 104 other_script, 33 loops, 6 transliteration-dense. Of 10 written pages read by eye (one per book, seeded draw), 10 are usable: 6 clean and 4 with minor slips (ç→c, î→i, circumflex turned into macron, one misspelled place name, AUTORIOGRAPHIE). One table of contents repeats its single 'Pages.' column header before each of its 9 entries. Nothing else is invented."
status: undecided
decision: "No write. The reads are files on gex45 (/root/jobs/fr-refusals-6871/out). gpu-print-lane.mjs apply is English-only. Whether to write the 627 guarded French reads is Derek's call (DECISION on #6871). If written: only the books with no hold or under scans-only-publish-7270 (479 pages); the 148 pages in books held for other reasons (preview-stub-first-read-8181, translate-cli-7075, peiresc-awaits-derek-5811) stay with their own lanes."
superseded_by: null
issue: [6871]
router_evidence: "none — no router cell changes; this confirms the 10-29 use (b) French pass (25 judged pages) at production scale"
---
PRIOR ART: `2026-10-29-print1800-gpu-engine-lanes-6871.md`. There, use (b) passed for French: LightOnOCR read 25 judged pages Flash-Lite had refused, 88% usable and 0 invented. That record named "a refusal-fill route for the 731 refused pages" as a follow-up, and this file is that follow-up. The reader (`scripts/gpu/gpu-print-gpu.sh`, fp8, util 0.85, 32 clients) and the guard (`pageVerdict` in `scripts/lib/gpu-print-lane.mjs`) are both unchanged.

## 2026-11-06 · The French 1800+ lite refusals, read on the GPU (job gpu-steward-20261106, #6871)

**Frame:** `scripts/eval/print1800-gpu-6871/fr-refusal-frame.mjs` (read-only). It takes French books dated 1800+ and their pages with no text and a refusal stamp (census.mjs's predicate). That gives 770 pages in 48 books (46 visible), 0 human-edited and 0 without an image. The count was 731 on 10-29.

**Read:** gpu-queue task `01-fr-refusals-6871`, 17:15–17:26Z: 770 ok, 0 err, 4,650 pages/h. Afterwards the card was back at 2 MiB.

**Guard verdicts** (`fr-refusals-2026-11-06/verdicts.jsonl`, from `verdicts.mjs`):

| verdict | pages |
|---|---:|
| write | 627 |
| other_script | 104 |
| loop_guard:early_loop | 33 |
| transliteration_dense | 6 |

The 627 written pages, by the book's state:

| book's state | pages |
|---|---:|
| scans-only-publish-7270 | 192 |
| complete | 175 |
| ocr_complete | 56 |
| archive_complete | 56 |
| preview-stub-first-read-8181 | 78 |
| translate-cli-7075 | 61 |
| peiresc-awaits-derek-5811 | 9 |

**By eye** (`fr-refusals-2026-11-06/eye-pick.json`): 10 written pages, one per book, seeded draw on sha256(`steward20261106:`+page id). Two Opus subagents compared each image with its read, line by line. The pages:
- Walras, *Éléments d'économie politique pure*, p.64: usable
- Bastiat, *Harmonies économiques*, p.56: usable
- *Da Tang Xiyu ji* (Julien), p.105: minor. Sanskrit diacritics are normalised: ç→c, â→ā.
- *Zend-Avesta* I, p.639, table of contents: minor. î→i on three names. The single "Pages." column header is repeated before each of the 9 entries.
- *Prolégomènes d'Ibn Khaldoun*, p.602, sommaire: minor. "AUTORIOGRAPHIE" and "DJEVDDET"; a roman "I" read as "1".
- *Le livre du préfet*, p.68: usable, with three footnotes. "fr. 93 36" may have lost a comma; the image could not settle it.
- *Lettres de Peiresc* VI, p.865, table of contents: usable, though run together into one paragraph.
- *Le Tibet révolté*, p.435: usable
- Voltaire, *Correspondance inédite*, p.487: usable. Old spellings are kept.
- *Histoire de l'Église vaudoise*, p.375, table of contents: minor. "Mérindol" is read as "Méridol".

Result: 10/10 usable, 0 wrong-text pages. The one invented element is a repeated table header. Italics are dropped throughout, as on the English lane.

**Not done:** no write, and no change to holds or visibility. The 104 other_script pages are not classified by script.

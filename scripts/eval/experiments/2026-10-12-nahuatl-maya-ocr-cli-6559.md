---
stage: ocr
measure: judged
languages: [nah, yua, cak]
scripts: [Latn]
canons: []
n_books: 18
n_pages: 18
verdict: "Through the CLI, Gemini 3.1 Pro reads Nahuatl and Mayan-language pages better than 3.8 Flash (Opus-judged mean 4.1 vs 3.5 Nahuatl, 4.3 vs 3.75 Mayan, of 5); 3.8 Flash flattens colonial Maya letters (24 normalisations on 8 pages)."
status: undecided
decision: null
superseded_by: null
issue: [6559, 6553]
---
PRIOR ART: `2026-10-09-ocr-pareto-gemini-3-8-flash-cli-6293.md` (3.8 Flash through the CLI on 908 pages, no Nahuatl or Mayan stratum); `2026-10-09-second-reader-pilot-gemini-cli-6338.md` (CLI as second reader). Neither covers an indigenous language of the Americas, and no lane covers them today: Nahuatl, Yucatec Maya and Kaqchikel are not on the flash-lite allowlist (`scripts/lib/language-normalize.mjs`).

## 2026-10-12 · Can a $0 CLI lane read the new Nahuatl and Mayan-language books (#6559)?

**Why.** About 60 books imported for #6559 have Nahuatl, Yucatec, Kaqchikel, Tzeltal, Mam or Q'eqchi' as their principal language. Production OCR (flash-lite, paid API) is not allowed on them, so they sit unread. The question is which reader, if any, to route them to. The CLI (Gemini subscription, `agy -p`) costs nothing, but there flash-lite is not offered. Derek asked for the test on the CLI with Opus as comparator.

**Design.** One page per book (pages of one book are one observation), drawn at 40% of the book, 18 books: 10 Nahuatl (print 1548–1905, three manuscripts), 8 Mayan-language (Motul dictionary ×2, Kaqchikel manuscripts ×3, Yucatec print 1847–1869). Two readers through `scripts/batch/cli-ocr.mjs read` on the production prompt, nothing written to the database: `gemini-3.8-flash-low` and `gemini-3.1-pro-low`. Judge: two Opus subagents (Claude subscription, a different model family from both readers), each shown 9 page images plus the two reads **blinded as A/B**. Each judge transcribed the first ~12 lines itself and scored each read 0–5 for fidelity, counting dropped lines, invented lines, misread words and normalisations (indigenous spellings moved toward Spanish/Latin or modern forms). Failed reads are recorded as failed, not scored (#6523).

**Result.**

| group | reader | scored / failed | mean (0–5) | pages ≥4 | print mean (n) | manuscript mean (n) | invented lines | normalisations |
|---|---|---|---|---|---|---|---|---|
| Nahuatl | 3.8 Flash | 10 / 0 | 3.50 | 5/10 | 4.00 (6) | 2.75 (4) | 0 | 2 |
| Nahuatl | 3.1 Pro | 10 / 0 | 4.10 | 9/10 | 4.50 (6) | 3.50 (4) | 1 | 3 |
| Mayan | 3.8 Flash | 8 / 0 | 3.75 | 5/8 | 4.25 (4) | 3.25 (4) | 0 | 24 |
| Mayan | 3.1 Pro | 7 / 1 | 4.29 | 7/7 | 4.67 (3) | 4.00 (4) | 1 | 9 |

- **3.8 Flash's characteristic error is normalisation of Mayan letters.** It drops the bar from Yucatec ꜧ / barred th and ch, turns the Kaqchikel cuatrillo-h into plain "ch", reads the tresillo as l, t or ç, and moves "maix" toward Spanish "maiz". On a 1759 Nahuatl page cropped at the margin it filled ~14 cut-off line endings with plausible Nahuatl marked `<unclear>`; that text is not on the page.
- **3.1 Pro's errors are letter-level misreads** ("titel" → "ti lel" ×4, "gusta" → "puesto"), one invented marginal "ez", and one empty read (the 1750 Kaqchikel print, 123 s, no output). It keeps line breaks and stops at a cut edge.
- **Neither reads the Codex Osuna page** (Spanish secretary hand, 2/5 each): Flash turns "a quartillo" into "a quatro tomines"; Pro supplies a clause not on the page. That page is Spanish, so it says nothing about indigenous-language reading; it does say manuscript Spanish of this hand needs another reader.
- **Speed:** mean 24 s/page (Flash) vs 65 s/page (Pro), one call at a time.

**Caveats.** n = 18 pages, one per book; the per-group means rest on 7–10 pages each and the print/manuscript splits on 3–6. One judge per page and one judge family (Opus); the judge's reference covers ~12 lines, not the whole page; no planted-span controls and no A-vs-A noise floor were run. This is a screening result, not a calibration: it ranks the two CLI readers, it does not license a public quality statement. The judges also caught two language labels: the 1750 devotional is Kaqchikel ("richin"), and the Codex Osuna page is Spanish. Both were corrected or noted in `sweep_log`.

**What it means.** If these books are routed to a CLI lane, it should be 3.1 Pro, not 3.8 Flash, because Flash's normalisations silently erase the orthography that makes these texts readable as what they are. At ~65 s/page, the ~20K pages of the Nahuatl and Mayan-primary books need ~360 CLI-hours serial. The decision owed (status `undecided`): run 3.1 Pro through the CLI on these books, staged with a calibration pass first (planted controls + a second judge family), or wait for a measured flash-lite stratum. Owner: #6559.

**Artifacts.** `scripts/eval/results/nahuatl-maya-ocr-6559/`: `pages.json` (sample), `reads-gemini-3.8-flash-low/`, `reads-gemini-3.1-pro-low/` (each read + its provenance meta: model, CLI version, image URL and sha256, prompt), `judge-opus-A.json`, `judge-opus-B.json` (per page: own transcription head, scores, error counts, quoted worst error).

*Replicated?* No.

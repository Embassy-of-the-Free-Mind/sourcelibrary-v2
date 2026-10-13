# Reading instructions for the #5939 header backfill (one batch = ≤ 20 files, fresh context)

Work only in the worktree root (ROOT). Do NOT edit, create or delete any .md file under
scripts/eval/experiments/. Do NOT run git. No external model or API calls. The only output
is ONE JSON file per batch.

INPUT: `results/experiments-backfill-5939/batch-N.json` — write-ups (keys = file names in
`scripts/eval/experiments/`) with a rule-drafted header and `why` (the reasons the rules were
unsure). Drafts are often wrong: the verdict is a first sentence, status a keyword guess, n the
first number in the text, languages word matches.

SCHEMA — read "The header (#5939)" at the end of `scripts/eval/experiments/README.md` first.
- stage: ocr | translation | metadata | image | pipeline — what the result is about.
- measure: accuracy | agreement | stability | preference | judged | judged_vs_reference | none.
  Use the file's own `measure:` statement when it has one. accuracy = scored against an
  independent reference text or label; agreement = engine vs engine or vs stored output, no
  truth; stability = the same engine run twice; preference = A/B pick, no reference; judged =
  a model or person grading without a reference (by eye counts here); judged_vs_reference =
  judges reading against a published human reference. `none` for plans, censuses, cost sizing,
  repair logs. A list (deciding one first) only when two measures both carry the verdict.
- languages: ISO 639 codes of the SOURCE material tested (la, grc, en, de, fr, it, es, nl, bo,
  lzh, zh, ja, sa, pi, he, ar, fa, syc, cop, mn, egy, ko, gez, ru, hy …). English only when
  English pages were tested. [] when not language-specific or more than 6 languages.
- scripts: ISO 15924 (Latn, Grek, Tibt, Hani, Jpan, Deva, Hebr, Arab, Syrc, Copt, Mong, Egyp,
  Ethi, Cyrl, Armn, Kore). [] if not script-specific or many.
- canons: only if the material IS that canon. Corpus ids: derge-tengyur, derge-kangyur, cbeta,
  cbeta-chan, pali-mula, pali-atthakatha, pali-tika, gretil-buddhist, gretil-vedanta,
  gretil-gaudiya, sefaria-zohar, sefaria-lurianic, sefaria-cordovero, openiti-sufi, ganjoor,
  mongolian-kanjur, tripitaka-koreana, kanripo. Tradition ids: tibetan, chinese-buddhist,
  chinese-classics, pali, sanskrit, kabbalah, sufi, persian-poetry, mongolian. Prefer the
  tradition id unless one corpus row is clearly meant. [] otherwise.
- n_books, n_pages: the scored sample the verdict rests on (not corpus or backlog size); null
  if not stated.
- verdict: ONE plain line ≤ 200 chars, no markdown, what the run FOUND, with the key number.
- status, as of 2026-10-06 (not as of the file's date): adopted (the tested change is now in a
  production lane or prompt) | rejected (tested, not taken) | undecided (a decision was asked
  and is recorded nowhere) | superseded (a LATER file re-ran or retracted the same question and
  replaces this answer; set superseded_by to it) | informational (measurement, census or
  diagnosis; no adopt/reject asked). Check `scripts/eval/DECISIONS.md` (grep the issue number or
  file name), later files on the same issue (`ls scripts/eval/experiments | grep <issue>`, grep
  their text) and `src/app/research/canon-gap/improvements.ts`. A follow-up that EXTENDS a
  result does not supersede it.
- decision: what it changed or why not, with the PR/issue number, ≤ 160 chars; null if nothing
  is recorded.
- superseded_by: the later file's name, else null.
- issue: the primary issue number (file-name suffix or heading), or a list, primary first (max 4).

PROCESS: read every file in full. Keep status checks targeted (grep, do not read whole other files).

OUTPUT: `results/experiments-backfill-5939/reviewed-batch-N.json` = { "<file>.md": { stage,
measure, languages, scripts, canons, n_books, n_pages, verdict, status, decision,
superseded_by, issue } } for every file in the batch, nothing else. Validate from ROOT:
`node scripts/eval/experiments-backfill.mjs apply scripts/eval/results/experiments-backfill-5939/reviewed-batch-N.json --dry-run`
(a dry run writes nothing) until it reports 0 invalid. NEVER run apply without --dry-run.

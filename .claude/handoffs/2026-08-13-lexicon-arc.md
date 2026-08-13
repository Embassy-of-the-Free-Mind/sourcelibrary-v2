# The lexicon arc: ancientlibrary.net → parsing reader → dataset → blog (2026-08-09 → 08-13)

One question ("anything we could learn from ancientlibrary.net?") became four shipped
things and two parked decisions. Everything below is merged/live unless marked open.

## Shipped

- **Latin + Greek dictionary lookup API** (`GET /api/lexicon/lookup?word=X&lang=la|grc`)
  — live on prod (Latin since #3840; Greek dispatch is still only on the parked #3851
  branch). Data in prod Mongo: `lexicon_entries` (51,596 L&S), `lexicon_lemma_map`
  (1.4M Latin forms), `lexicon_entries_grc` (119,450 LSJ), `lexicon_lemma_map_grc`
  (568,918 forms, 95.1% LSJ join), `lexicon_misses` (ranked miss telemetry, nothing
  automated reads it).
- **Dataset with DOI**: concept `10.5281/zenodo.21884364` → v2 `zenodo.21884913`
  (CC BY 4.0). v1 had a flawed Latin table (form==headword self-rows and the coded
  irregulars were missing); v2 fixed via `scripts/lexicon/export-lemma-datasets.mjs`
  (1,474,426 Latin rows). Validation: Greek 88.8%/96.6% vs Perseus treebank; Latin
  91.4%/95.1% vs Index Thomisticus (scorecards in `scripts/eval/results/`).
- **Blog post live**: sourcelibrary.org/blog/greek-lemma-table (#3883, then #3961) —
  shape-cloud explorable (three verbs, collision-free spiral, Greek/Roman toggle,
  per-form Morpheus parses in the caption). Every number artifact-verified by a
  Sonnet fact-check agent; romanizer adversarially hardened (per-character marks).
- **Security**: `npm audit --omit=dev` = 0 vulns (#3866); five dependency PRs merged.
- **Greek pipeline scripts now on main**: `scripts/lexicon/{enumerate-greek-forms,
  morpheus-crunch,import-lsj,shape-cloud-parses,export-lemma-datasets}.mjs`.
  morpheus-crunch's `main()` is guarded — importing its betacode converters must
  never start a corpus crunch (it did, once).

## Open / parked

- **#3851 (reader popover + Alpheios prototype branch `feat/lexicon-popover`)** — DO NOT
  merge as-is. Parked pending Derek's Alpheios direction; contains the Vercel preview
  backing the demo links in the Gmail draft to Harry Diakoff (thread "a new contender
  I saw on HackerNews", draft r5759226993108342911). Before it ships: rank Greek
  lemma-map candidates by corpus frequency (ἐστίν lists εἴλω/ἀλέα as confident
  cohabitants), add elision expansion (ἵν→ἵνα class), verify queryVariants enclitic
  handling is on main (spot-check suggests -que misses on prod). All specced in
  #3823 comments.
- **Morpheus give-back** (for the Harry conversation): unanalyzed-forms ledger, arm64
  image, MORPHLIB default, output-format docs.
- Lexicon issue of record: **#3823**. Full state also in auto-memory
  `project_lexicon_parsing_reader.md`.

## Lessons already recorded (auto-memory)

`lesson_granularity_bugs_in_text_transforms` (sigma/iota/elision/upsert — one shape),
`lesson_adversarial_agents_are_a_release_gate` (4/4 rounds found real defects; a killed
process is a message — the agent that killed the v1 Zenodo publish was right).

## Gotchas that cost time this arc

- Both the Mac and Hetzner are ARM; the Morpheus image is amd64-only → emulated,
  sharded, resumable runs (`--shard-index/--shard-count/--resume`).
- Zenodo web-UI file URLs return HTML; download via `/api/records/<id>/files/<name>/content`.
- `ZENODO_ACCESS_TOKEN` in `.env.local` carries a literal `\n` — strip before use.
- A tool keeps appending a `nextjs-agent-rules` block to `AGENTS.md`; discarded twice
  per one-source-of-truth doctrine. If it reappears, find the writer.

# Canonical loci, a session collision, and what a citation actually claims — 2026-08-07/08

Purely technical; no PII or business material. Committed deliberately (`git add -f`).

## What shipped

| PR | What |
|---|---|
| #3703 | Canonical loci — Bekker/Stephanus references resolve to leaves. `get_locus` MCP tool, `/api/locus`, 10 registered editions, 6,324 anchors |
| #3719 | `server.json` version, a section-letter guard, and a read-side schema check |
| #3722 | Feedback message cap 5,000 → 20,000, as one constant |
| #3723 | The continuity ellipsis bug |
| #3738 | `ARCHITECTURE.md` rewritten for humans, with generated numbers |
| #3748 | `doc-staleness.mjs` now watches the human tier |
| #3762 | Citation credit says what we actually did to the text |

Issues opened: #3720 (locus follow-ups), #3721 (continuity), #3724 (the reading-edition question), and #3713 closed as superseded.

## The four things worth remembering

**1. The numbers were already in the OCR.** Bekker and Stephanus numbers are printed on
the pages and were captured by OCR years ago; nobody had read them. We hold *both* root
editions complete — Bekker 1831 vols I–II and Stephanus 1578 vols 1–3 — which is what
made the whole thing tractable. `1094a8` → Bekker vol. II p.310, verified against the
leaf, and that is the number a reader had to guess by hand in #3653.

The addressing path reads no range table. Per-work ranges are derived from the editions'
own running heads and then *agree* with the canonical values — agreement as a check, never
as a source. Invariants in `.claude/docs/invariants/canonical-loci.md`.

**2. Three sessions collided in one evening, and two collisions broke production.**
Two built #3661 in parallel and wrote the same Mongo collection with incompatible
schemas; a third fixed the MCP server version while my PR bumped one of its three
literals. Nobody claimed an issue first. Now in `CLAUDE.md` under Multi-Session
Awareness: a worktree isolates files, not production.

The failure mode is the part to keep: `/api/locus` answered every reference with
"no witness holds an anchor at this reference" — the honest, fail-closed message —
which reads as a thin corpus rather than a broken store.

**3. The continuity bug was found by the reporter retracting their own theory.**
The translation layer appends an ellipsis where a sentence runs off the leaf, and
`TERMINAL` contained both `…` and `.`, so **the marker meaning INCOMPLETE made the
detector say COMPLETE**. One mechanism, five books, and it subsumed nearly every false
negative in four earlier reports. My guess (the furniture stripper) and theirs (hyphen
resolution) were both wrong; both are recorded on #3721 so nobody re-runs them.

Capturing the real page text rather than writing fixtures caught a bug in my own fix:
the ellipsis is followed by a closing quote (`energy..."`), so the first pattern matched
nothing on the very pages it was written for.

**4. The citation apparatus was wrong in the direction nobody reported.** The complaint
was that all six formats credit Aristotle over our English; five of six already said
"trans. Source Library" — only `inline` didn't. But the credit was *unconditional*, so
Taylor's 1818 English was cited as **our** translation: claiming a named historical
translator's work and erasing him in one line. `generateCitations` was extracted to
`src/lib/citation.ts` because it could not be tested inside a route file, which is how it
drifted.

Scale, measured: 17,825 of 19,465 live books (91.6%) serve English we produced, across
4,887,266 pages; two independently-shaped samples put the edit marker at 6.1% and 6.2%.

## Open, and needing a human

- **#3724 — reading edition or evidentiary text?** Option A shipped (honest labels).
  Option C — verbatim beside reading text — is the better long-run answer and is a
  product decision, not a task.
- **#3689** — the Plotinus footnote stream is still quotable as Aristotle, now with BibTeX.
- **#3720** — Congreve 1855 prints Bekker in its margins and is registrable; that would
  give Bekker → English for the *Politics*, which nothing currently does. Taylor 1818
  never can: it predates Bekker by 13 years.
- **Stranded work:** the `feat+corpus-dataset` worktree holds uncommitted changes
  (`src/app/blog/reading-or-generating/page.tsx`, `public/data/corpus/`). The reaper
  keeps it rather than touch it.

## Verification notes

Everything was checked against production rather than inferred, and three claims changed
as a result: the reporter's "real ceiling is below 5,000" (false — the longest stored
message is 4,956), their "all six formats" (five already credited us), and my own
"`server.json` is the only version gap" (there were three literals). Guards were proved
by planting a positive control — a foreign-shaped row for the schema check, a reverted fix
for the continuity tests.

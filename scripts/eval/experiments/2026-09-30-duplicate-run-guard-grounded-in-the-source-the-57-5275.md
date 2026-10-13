---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 2
n_pages: 57
verdict: "Checking the source for a repeat across the seam releases all 57 refused Tibetan refrain pages (57 to 0); on a 1,000-book sample 10 of 229 duplicate flags are released, all real source repeats."
status: adopted
decision: "sourceRepeatsAcrossBoundary added to block-drift.mjs leaf-drift guard (PR #5306)"
superseded_by: null
issue: [5275, 5021]
---
## 2026-09-30 — Duplicate-run guard grounded in the source (#5275): the 57 refrain pages the per-leaf guard refused go 57 → 0, the narrative book and the #5021 fixtures are untouched, 10 of 229 page-level duplicate flags on a 1,000-book mirror sample are released, all of them the source repeating itself

**Why:** the #5260 re-pilot (2026-09-29) refused 57 of 168 seam pages of the canonical Tibetan pilot
book as `leaf-drift` / `duplicated`: the sūtra's refrain ("…are non-dual; they cannot be divided, are
not separate, and are not distinct. Through the purity of…") recurs on both leaves, and
`duplicatedAcrossBoundary` reads the text's own repetition as leaf 2's opening copied onto leaf 1.
The $226 batch retranslation of the Tibetan cohort (#4523) runs the same guard, and the Kanjur
volumes are refrain end to end. No model spend.

**Fix.** `sourceRepeatsAcrossBoundary(ocrPrev, ocrNext)` in `scripts/lib/block-drift.mjs`: the same
windows as the translation check (last 40% of N, first 10% / ≥ 60 tokens of N+1) on the SOURCE,
share a run of ≥ 6 tokens → a run the two translations share is the refrain, not a duplication, and
`blockDriftBoundaries` goes on to the `moved` test instead. Tokens are runs of letters, marks and
digits — a Tibetan syllable — because the Yigdzin OCR spells each recurrence a little differently
and the 40-char shingles of `sharedRun` found the source repeating on only 20 of the 57; syllable
runs found it on all 57 (the audit script's LEAK count makes the same distinction with character
runs, sized on cased-script prose). A missing source keeps the old verdict.

**Sized on the two pilot books** (Mongo `pages`, read-only; the 57 refused texts from Hetzner
`/root/leaf-break/refused-evidence.jsonl`, now `tests/fixtures/leaf-break/refrain-seams-5275.json`):
source run across the seam on the 57 refused pages 7–38 syllables (shortest 7, floor 6); on the
148 seam pages of the narrative rnam thar 0–5 on 138 and 6–12 on 10 (a stock formula on both
leaves) — its 146 served translations had 0 duplicate flags, so there is no real duplication there
for the exemption to hide. `assessTranslationHealth` on the 57: **refused 57 → 0**; the same 57
translations against a source whose second leaf is a narrative leaf (no repeat): **57 refused**,
so the verdict is the source's. The pilot's bridged p.283 and a bridged refrain page stay `leaf-seam`.

**Page level, measured before flipping** (`blockDriftBoundaries` serves the block lanes too):
`~/sl-corpus` mirror, 1,000 books seeded 5275, 295 with consecutive translated pairs, **72,671 pairs,
229 duplicate flags, 10 exempted (4.4%)** — read by their text: two Avestan prayers (Ashem Vohu,
Yatha Ahu Vairyo), a Mishnah refrain (Hullin, "in the Land and outside the Land…"), a Sumerian
hymn refrain (Ur-Namma), a Sanskrit verse quoted on both pages, a Latin sentence the source prints
twice, a Kircher table header (Musurgia), a `[Musical notation]` placeholder run, and two `&nbsp;`
runs. Every one is the source repeating; none is a copied opening. The 9 #5021 fixtures and the
duplicated-boundary fixture measure 0 and keep their verdicts (pinned in `tests/unit/block-drift.test.ts`).

**Not caught, by design:** a real duplication on a page whose source also repeats a ≥ 6-token
formula across the boundary — the guard cannot tell the copy from the refrain without alignment.
Measured exposure: 10 of 148 narrative seam pages have such a formula, and 0 duplicate flags.

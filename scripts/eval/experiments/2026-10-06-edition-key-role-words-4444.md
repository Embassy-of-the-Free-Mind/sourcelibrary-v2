## 2026-10-06 · What does dropping role words from the `edition_key` surname do to the corpus? (#4444, #6019 decision 6)
<!-- PRIOR ART: scripts/maintenance/edition-key-integrity.ts counts stored-vs-computed drift but not which groups a change merges or splits, and reads `books` only; scripts/maintenance/materialize-edition-keys.ts (dry run) reports cluster totals after a change, not the difference; the #6019 review (2026-10-06-dedupe-review-6019.md §4) counted the role-word keys but did not replay a fix. -->

**Question.** `editionSurname()` took the last word of an author string, so "Lazarus Zetzner (ed.)" keyed as `ed`. Before changing the key the import gate matches on: how many keys change, and which duplicate groups appear or break?

**Measures.** `measure`: exact counts over a snapshot, no sample and no model. Every non-artwork row of `books` (109,087) and `books_warehouse` (22,542), read once by `_id` on 2026-10-06 21:10 UTC. Each row's key was computed twice from the same inputs: with the builder at `origin/main` (`eb1dcb41f`) and with the builder in this change. Groups are counted across both collections together, as the import gate's edition-key tier queries them. "Live" is `visible: true` with `pages_count > 0` (41,977 rows).

**Script.** `scripts/audit/edition-key-replay.mjs` (`snapshot`, then `diff --before origin/main`). Artifact: `scripts/audit/edition-key-replay-4444/role-words.json` (every changed row, every merge).

**Result: the change itself.**

| | count |
|---|---:|
| keys that change | **1,275** (1,156 in `books`, 119 in `books_warehouse`) |
| … on live books | **805** |
| key quality tier changes | 0 |
| new shared keys (merges) | **5 groups, 12 rows** |
| … with two or more live books | 1 |
| groups broken (splits) | **0** |
| groups of 2+ rows, before → after | 21,286 → 21,289 |
| groups with 2+ live books, before → after | 47 → 48 |

1. **All five merges are the same printing catalogued twice**, read from title, author and year (no image opened): Commandino's Hero *Spiritalium liber* 1575 (both live), Giorgi's *Spiritali di Herone* 1592, Giles's *Taoist Teachings from the Book of Lieh Tzŭ* 1912, Brasseur de Bourbourg's *Popol Vuh* 1861, Resen's *Edda Islandorum* 1665. In each, one record carried "(ed.)" or "(trans.)" and the other did not. The import gate would have declined the second copy of each.
2. **Nothing splits**, because two records that both said "(ed.)" still share a surname afterwards.
3. The old surname slot on the changed rows: `ed` 565, `trans` 254, `editor` 96, `eds` 63, `hrsg` 51, `tr` 32, then 30 rarer forms (`commentary`, `comm`, `translator`, `attrib`, `bearb`, `attr`, `attributed`, `compiler`…). The #6019 review counted 734 live books on a shorter word list; with the German catalogue forms and the commentary/compiler family the live count is 805.
4. The TypeScript builder and its `.mjs` twin agree on the surname for all 131,629 rows.

**Result: what the re-stamp will also do.** 2,706 stored keys already differed from what the builder at `origin/main` computes, because a year, author or title was edited after the key was stamped. The identity sweep rewrites those too, so the write is larger than the change:

| re-stamp (stored key → new builder) | count |
|---|---:|
| rows rewritten | 3,969 (3,850 `books`, 119 warehouse; 1,897 live) |
| … caused by this change | 1,275 |
| merges | 17 groups, 37 rows (11 with 2+ live books) |
| splits | 249 groups, 500 rows (0 with 2+ live books) |
| groups with 2+ live books, stored → after | 37 → 48 |

The 249 splits are mostly a `books` row and its own `books_warehouse` copy whose year was later corrected on one side (201 by year alone). The 12 merges not caused by this change are pairs whose author or year was corrected after stamping (five Aldine editions stored under `manuzio` whose author is now Cicero, Machiavelli, Dante, Statius, Propertius).

**Not fixed here, measured on the way.**
- A role word followed by a name still keys on that name: "Thucydides (ed. Henri II Estienne)" → `estienne`. 528 rows end in such a group ("(ed. …)" 254, "(trans. …)" 220, "(tr. …)" 54), 297 of them live.
- Non-names in the slot: `unknown` 9,658 rows, `sn` 2,142 ("[s.n.]"), `anonymous` 1,394, `collection` 1,244.
- The `.mjs` twin's `editionYear()` still rejects a negative (BCE) year that the TypeScript side accepts: 435 rows get a different year slot depending on which side stamps them; 433 are stored in the twin's form.

**Limits.** One snapshot; rows imported during the run are not in it. "Same printing" for the five merges is a metadata judgement.

*Replicated?* No; one run. *Artifacts:* `scripts/audit/edition-key-replay.mjs`, `scripts/audit/edition-key-replay-4444/role-words.json`.

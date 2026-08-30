# Attribution: from one reader's note to a measurement loop — 2026-08-11/12

Started from a single MCP `submit_feedback` item (a mis-credited 1592 book).
Ended with a metric that scored the whole day's work as a net regression, which
is the useful part.

## What shipped

| PR | what |
|---|---|
| #3899 | `author-vs-ai-metadata.mjs` — books whose catalogued author is contradicted by enrichment |
| #3906 | name-form equivalence + contaminated-enrichment flag (residue 220 → 154) |
| #3907 | `title-page-attribution.mjs` — read the author off the record's own title |
| #3913 | shared `latin-morphology.mjs`; genitive→nominative by thesaurus lookup |
| #3921 | `thesaurus-variant-shape.mjs` — `variants[]` is a match surface, 11% unsafe |
| #3923 | correction: de-matching is safe; I'd measured the wrong denominator |
| #3945 | `attribution-health.mjs` + `.claude/docs/attribution-health.md` — the metric |
| #3946 | mint 2 docs, re-link 8 books, second ledger snapshot |

**Data:** 142 book records corrected, 5 author docs merged, 2 minted. Backups in
session scratch as `_tmp-*-backup-2026-08-11.json` (merge-on-id, reversible).

## The measurement

`node scripts/audit/attribution-health.mjs --snapshot`. Baseline 2026-08-12,
21,974 visible **text** books: reachable (T3+) **77.87%**, anchored (T4)
**64.0%**, T1 unusable **68**, contradicted 246 of 4,313. After the mint:
77.91% / 64.03%. Ledger at `.claude/docs/attribution-health-ledger.jsonl`; the
script prints its own `SINCE <date>` delta.

## The thing worth remembering

**Every headline number I produced was wrong until something forced a
denominator into view.** "1,526 books at risk" → 0. "6,025 unusable strings" →
68. "142 records corrected" → a net −7 on reachability. Written up in
`invariants/measurement-instruments.md`.

The specific trap: correcting a byline **clears `author_id`** when the right
person has no thesaurus doc, so a wrong-but-reachable attribution becomes a
right-but-unreachable one. Only 8 of 41 such records could be recovered, because
the early passes recorded a verified *name* but no QID (→ #3948).

## Recurring hazard, hit four times

Matching a partial name into a store lands on a **different person**:
`Annibal Caro` → `hugo-de-sancto-caro`; `Paulus Manutius` → `aldus-manutius`;
`Iacobi Sannazarii` → *Jacob of Edessa*; `王植` ⟷ `王質` (same romanisation, two
men). Every instance was caught by **printing which record matched before
writing**. That habit is the whole defence.

Related: for CJK the characters are the identity — `sameNameForm` strips
non-Latin script and will happily merge two people who romanise alike.

## Open

- **#3948** recover the ~33 books still stranded at T2
- **#3949** contamination has a second signature: description-vs-title mismatch
- **#3950** three audit false positives: Unicode pairs, MARC relators, and
  `"Various"` as a *legitimate* collective attribution
- **#3951** human queue: 24 held verdicts, 4 confirmed-distinct CJK pairs, 2
  wrong QIDs (`lu-ji-2`, `wang-zhi-2`), the `/author/persius` slug question

## Note on scale

142 records is **0.4%** of the visible corpus, and the day drifted into
infrastructure-about-infrastructure more than once. The reader-facing feedback
queue that this started in still has untouched items: PDF export layout, BPH
manuscript records not clickable, gallery "load more", subject-page image links.
Those are probably the better next move.

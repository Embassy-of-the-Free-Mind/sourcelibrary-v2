# Attribution: 52 bylines, 522 artworks, and one axis nobody had typed (2026-08-18)

Started as "do the 261" from a screenshot of another session. Ended with seven PRs,
and the through-line is not any of the individual fixes.

## Merged

| PR | what |
|---|---|
| #3982 | the pilot itself — `title-page-ocr.mjs`, the benchmark harness, the non-Latin invariant |
| #4015 | 24 additive title-page bylines |
| #4019 | sha1 gate on `SUSPECT_NOT_DUP` |
| #4021 | 23 Aldine imprint corrections |
| #4027 | 5 hand repairs + typed byline relations |
| #4034 | `citation_author` / `article:author` / `DC.creator` |
| #4039 | gallery schema + the Vercel rule |

Reader-visible: **52 bylines** corrected or added, **522 artworks** un-hidden,
four schema.org surfaces no longer claiming an institution is a person.

## The number in the screenshot did not survive

"261" was an upper bound built from the wrong denominator. The pool the method was
actually *measured* on is **161** — Latin script, blank-or-placeholder byline, public,
no author page. The extra ~100 were 38 loose collectives (#3950 settled that a
collective is a deliberate cataloguer ANSWER) and 31 non-Latin books where the prompt
sits at ~52%.

Funnel, and the denominators are the finding: 1,239 flash-lite candidates → 161
measured pool → 80 named an author, **81 said the page names nobody** → 38 survived
deterministic screens → **24 survived an adversarial refuter that killed 14 of 38 (37%)**.

The method's value is mostly in what it declines to say.

## What the refuter caught that a benchmarked reader did not

All would have shipped as public bylines:

- **Victor of Capua** — the genitive governs *prefacio*, not the book. He wrote the
  preface to a gospel harmony and says in it that he found the work anonymous.
- **Alexander Neckam** — never printed by the book. A later hand wrote it in,
  inverted-catalogue style; a cataloguer's conjecture read as a byline.
- **Joachimus Magdeburgius** ×2 — the genitive governs *einer Vermanung*, an admonition
  bound in *sampt* the Augsburg Confession.

37% is the gap between "validated instrument + rule-based screens" and "adversary".

## The Aldine finding

`Manuzio, Aldo, 1449 or 50-1515 & Torresanus, Andreas, de Asula` is a press
partnership sitting in `books.author` on **85 books**. #3894 records 41 for
"Manuzio, Aldo" alone.

More useful than the fix: `title-page-attribution.mjs` reads `books.title` and flags 22
books corpus-wide. It cannot do better — **346 of the 603 books in its printer-dynasty
scope return `NO_NAME`**, meaning the title *string* is silent. The scanned pages are
not. Those 346 are the next sweep and need a cost estimate first.

## The axis nobody had typed

`is_person` types the ENTITY. Nothing typed the EDGE. Consequence: four emitters
asserted authorship straight from `books.author` — schema.org, `citation_author`,
`article:author`, `DC.creator` — plus `creator` on gallery images. Scale, measured:
**1,538 visible books, 4,586 gallery images**, including the Voynich Manuscript
claiming Beinecke Library as the Person who made it.

`src/lib/corporate-bylines.ts` now names four relations behind one predicate,
`bylineClaimsAuthorship()`. Written up in `invariants/author-identity.md`.

**Fixing one emitter and declaring victory is how this stayed live.** Only verifying the
rendered page caught the other three.

## Three mistakes worth keeping

1. **A tracking issue's unchecked box is a snapshot.** #3730 said 244 restore candidates
   awaited Derek. `dedup_apply_runs` showed all four lanes applied on 2026-08-09 18:56,
   ~40 min after the reports were written, and all 244 keepers visible. I recommended
   work that had shipped nine days earlier. Verify against the store that would record
   the doing — run-provenance (`dedup_apply_runs`, `sweep_log`, `field_provenance`) or
   the live field. Corrected on the issue; memory entry extended.
2. **Reporting a bucket count as a finding.** "451 books are institutions" was a regex
   net's output quoted as a verdict; the real figure was 1,538 because the filter had
   dropped every already-linked byline. Same subset-as-population error twice in a day.
3. **Nearly waving through a real Vercel failure.** A `● Ready` Preview at the top of
   `vercel ls` belonged to someone else's worktree. The rule now says how to scope it
   (#4039). The failure was real: #4024 added `scripts/output` to `.vercelignore` and
   swept away three tracked build-time JSON imports; #4029 fixed it four minutes after
   my build ran.

## Open, deliberately

- **The 346 `NO_NAME` printer-dynasty books** — the argued-for next sweep.
- **~1,585 untyped author strings.** Grow the table by reading, not by widening a
  pattern.
- **The ~446 Bhutanese monastery bylines** — typed now, not rewritten. Whether
  provenance should move fields is a product decision.
- **`creator` on gallery images for personal authors.** Vesalius wrote the *Fabrica*;
  van Calcar's workshop cut the blocks. Usually a fabricated attribution, but removing
  it corpus-wide is curatorial with SEO reach. Documented at the code site.
- **Corporate-heading merges** — Council of Trent under two strings, Imperial
  Astronomical Bureau under two.
- **42 + 34 rows held for a human** in the two verdict JSONs, mostly compilers of
  anthologies where main entry is a cataloguing decision.

## Health at close

`reachable (T3+) 77.95%`, unchanged — by construction. Nothing here set `author_id`;
these moves are T0→T2 and T2→T2-with-a-correct-name. **T2→T3 linking (3,051 books) is
still the only lane that moves the headline**, and the exact-match linker is exhausted
(4 writes from 9,341 scanned), so it needs minting, not linking.

28 open PRs remain under my name, oldest #2781. `/reap-prs` in a fresh session.

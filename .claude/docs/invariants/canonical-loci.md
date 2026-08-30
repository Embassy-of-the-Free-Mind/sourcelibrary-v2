# A canonical locus is read off the leaf, never derived from a page count

**Read this when:** touching `locus_anchors` / `locus_books`, registering an edition in `src/lib/locus-editions.ts`, changing `src/lib/locus.ts` or `/api/locus`, or about to state where a Bekker or Stephanus reference lands.

*Added 2026-08-07 with the first implementation (#3661). The measurement that scoped it is on that issue; this file is the part you must not break.*

---

## What the system is for

Scholarship addresses Aristotle by Bekker number (`1094a8`) and Plato by Stephanus
number (`Rep. 328b`). Those systems were agreed centuries ago so a citation would
survive re-typesetting. Source Library addressed everything by scan page, which is
a property of one copy and shareable with nobody — so an agent fact-checking
attributed Aristotle quotes through MCP had to rebuild the mapping by hand and
then **guess**: *"deriving page ≈ 310 + (Bekker − 1094), and guessing"* (#3653
item 2). It happened to be right. That is the situation this replaces.

## The rule that must not be relaxed

**A published locus is a number that was printed on that leaf.** Not fitted, not
interpolated, not inferred from a range table. There is exactly one exception and
it is fenced: in a root edition whose scan→printed offset is constant and
verified, a leaf whose own number was misread may take the frame value **iff both
neighbouring leaves are printed anchors agreeing with the offset**. Those carry
`basis: "frame"` and are counted separately everywhere.

Why the fence is tight: a fabricated citation is worse than no citation
(`entity-page-attribution.md`). An interpolated locus looks exactly like a read
one, and the reader who follows it lands on prose that is not what they cited.

**Segment before quoting any coverage number.** Two different mechanisms put a
canonical number on a page and they are not comparable:

| | mechanism | editions |
|---|---|---|
| A | the book's own pagination IS the citation standard | Bekker 1831, Stephanus 1578 |
| B | the reference is printed in the margin beside the text | Burnet's OCT, the Oxford translation |

#3661's first pass asked one question of both — "does scan→printed fit a line?" —
and scored the more valuable mechanism **worst**, because Bekker numbers in a
margin do not advance at the rate of pages. Historia Animalium scored `fit=0.009`
and is one of the best books in the corpus for this. Never sum A and B into one
"% covered".

## Where the reference frame comes from — and where it does not

The per-work reference ranges are **derived** from the editions' own running
heads joined to the numbers read inside them, not asserted from memory. They then
agree with the values a classicist would recognise (Physics 184–267, Metaphysics
980–1093, NE 1094–1181, Politics 1252–1342, Poetics 1447–1462, Republic 327–621,
Laws 624–969). That agreement is a **check on the derivation, never its source**.

`src/lib/locus-works.ts` does assert one thing: that `ΠΟΛΙΤΕΙΑ` and `DE REPVBL`
name the same dialogue, and that its English name is "Republic". It carries **no
page ranges by design**, so a wrong row can mislabel a leaf but cannot move a
citation to a different one. A test asserts that no range field ever appears
there. Keep it that way.

`expect` blocks in `src/lib/locus-editions.ts` are regression pins recording what
a reviewed run produced. They are verified against the data and a mismatch
**refuses the edition** rather than warning; they are never read to decide where a
locus is (`tests-that-are-not-guards.md`).

## Traps that already bit

- **A printed number is not necessarily a canonical number.** Stephanus vols. 1
  and 3 append Estienne's and Serranus's annotations, separately paginated from 1.
  Those numbers are printed, real, and not Stephanus references — 54 anchors in
  vol. 1 and 130 in vol. 3. They are dropped as off-frame. Vol. 3's frame holds on
  only 75.9% of its printed numbers, the weakest in the set; re-check it first if
  anything drifts.
- **Match by page, never by section.** A leaf carries a run of Stephanus sections
  and the margin records only one. Filtering on the requested section reported
  `Republic 328b` as absent while we held the leaf, whose margin read `328 c`.
- **A work's opening leaves can sit under its predecessor's running head.** The
  recto names the work, the verso names only the author, so the first leaf or two
  of a work inherits the previous one. Stephanus vol. 2 leaf 340 is printed 328 and
  is Republic text under the head `PLATONIS`; before both candidates were recorded
  (`work_header_alt`), `Republic 328b` missed the very edition the numbering is
  named after. Verified against the scans: leaf 339 is the Republic's title page.
- **Two works genuinely share a page** where one ends and the next begins — Bekker
  184 (Sophistical Refutations / Physics) and 1447 (Rhetorica ad Alexandrum /
  Poetics) are both such joins. The API reports these as
  `other_works_at_this_reference` rather than hiding them; a caller that ignores
  that field will conclude a passage is absent when it is one row down.
- **The same number exists in both systems.** Bekker and Stephanus ranges overlap
  almost entirely, so a bare number returns Aristotle and Plato leaves together.
  Never infer the system from the number's magnitude — that misattributes a
  quotation to a different author.
- **`locus_anchors` is a derived store with one writer outside the pipeline** —
  the exact shape that went dark for 60 days in the page-embedding outage
  (`derived-stores-and-schedules.md`). `locus_books.ocr_updated_max` holds the
  SOURCE's OCR timestamp so a re-OCR is detectable, and
  `scripts/audit/locus-anchor-staleness.mjs` is the detector: it checks coverage
  against the registry and exits 1. A stale anchor points at text that has moved.

## The collection name is shared state between sessions

**This already broke production, on the day it shipped.** Two sessions implemented
#3661 in parallel — #3703 merged, #3713 opened four minutes later — and both wrote
a Mongo collection called `locus_anchors` with incompatible schemas
(`ref_page`/`page_number`/`ref_label` against `page`/`scan_page`/`locus`). The
second extractor ran after the first and replaced 6,324 rows with 4,279. The
merged API queried `ref_page`, matched nothing, and every reference on production
returned `witness_count: 0` with the honest message *"no witness holds an anchor
at this reference"* — **indistinguishable from a genuine gap in the corpus.**

Three things worth keeping from that:

- **A row count is not an integrity check.** The foreign rows carried `book_id`,
  so per-edition counts passed while the feature was dead. The audit now asserts
  the SHAPE (`ref_page` present on every row) and fails loudly. That is the
  read-side lesson of `derived-stores-and-schedules.md` one layer down: an empty
  answer and an unreadable store look identical from outside.
- **A write-time guard would not have helped.** The clobbering writer was the
  other session's script, which does not run this repo's guards. Only a check that
  both sides run — or a check on the read side — can catch it.
- **The root cause was coordination, not code.** Neither session claimed the issue
  before starting, though `CLAUDE.md` prescribes exactly that. No guard in an
  extractor fixes duplicated work.

## Taken from the parallel implementation (#3713)

Recorded because the reasoning is worth keeping, and because two of these were
defects in the merged version:

- **`server.json` must be bumped with the MCP server version.** #3703 moved the
  route to 4.7.0 and left the manifest at 4.6.0;
  `scripts/audit/mcp-directory-contract.mjs` asserts they match, and it would have
  failed against production. Adding a tool needs no directory re-review — the
  fixture exists to catch REMOVALS — but the version has to track.
- **The section letter is checkable.** Bekker prints two columns (a, b); Stephanus
  divides a page into five sections (a–e). A Bekker anchor reading `1094e` is an
  OCR misread of `b`. `plausibleSection()` drops the letter and **keeps the page**,
  because the digits are separate evidence from the letter — #3713 rejects the
  whole anchor. Measured 2026-08-07: this corrects **zero** rows across the ten
  registered editions, so it is preventive, not a fix.

And two things in that implementation to avoid, both measured against our data:

- **Do not gate Bekker at a lower bound of 184.** #3713's parser rejects any
  Bekker page outside `[184, 1462]`, but Bekker numbering starts at 1 — we hold
  **175 anchors below 184**, the whole Organon (Categories 2–15, De
  Interpretatione 16–24, Prior Analytics 25–71, Posterior Analytics 72–100, Topics
  101–164, Sophistical Refutations 165–183). The gate is latent there only because
  that registry omits Bekker vol. I; add it and the Organon vanishes with no error.
- **Do not discard the work name for Stephanus.** #3713 drops it, reasoning that a
  canonical number is globally unique within its system. True for Bekker, **false
  for Stephanus**, which restarts in each 1578 volume: Stephanus 328 appears under
  **five** distinct running heads in our editions (Letters, Minos, Protagoras,
  Epistola, Republic) and under three within #3713's own seven. Without the work
  name, `Republic 328b` and `Letters 328b` are the same query.

## What this does NOT solve

Of 276 live Aristotle and Plato books, 10 are registered here. The rest hold no
usable numeric structure and **cannot be reached this way at all** — bridging them
needs text alignment to a root edition, not number alignment. Do not let a
coverage number over these 10 editions be read as coverage of the corpus.

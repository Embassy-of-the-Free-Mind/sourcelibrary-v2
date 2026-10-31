---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 1759
n_pages: null
verdict: "Reading the title page of 1,759 live books whose author is a placeholder finds a printed author in 89 (5%). About half of those raw reads are usable: initials, N. N., biblical names, pseudonyms and corporate bodies make up the rest. After deterministic screens, a Sonnet refuter on the same leaves (27 keep / 26 refute) and a review of every kept reason, 25 books were written. Most of these books really have no author on the title page."
status: adopted
decision: "Never write a raw title-page read. Screens + refuter + review, then apply-byline-proposals-3894.mjs with run titlepage-authors-7761. The yield (1.4% of books read) does not justify running the reader again on this population."
superseded_by: null
issue: [7761, 7660]
router_evidence: "none — a catalogue-attribution measurement, no OCR or translation route"
---
## 2026-10-31 · Can the title page name the author of a live book with a placeholder author? (#7761, #7660 stage 4)
<!-- PRIOR ART: scripts/audit/titlepage-vision-pilot.mjs (#7660 / PR #7682, the reader and its 9/12 pilot); #3982 / PR #4015 (the earlier title-page lane: reader → screens → refuter, 24 of 161 shipped). -->

**Why.** 11,168 live books had no `author_id`; 3,780 of them carry a placeholder (Unknown, empty, [s.n.], Various), and the GND harvest names a usable author for almost none.

**Target.** 4,188 live books, no `author_id`, author matching the pilot's placeholder pattern. Manuscript and non-codex sets left out (heidelberg 1,056, etcsl 381, bdrc 232, museumsofindia 99) and books with no manifest. 2,216 to read.

**Reader.** `titlepage-vision-pilot.mjs --ids`, agy `gemini-3.8-flash-low` on the subscription, prompt `titlepage-vision-v2`, four front leaves from the manifest. Main box 8 shards; e-rara (1,011) on gex45 because e-rara refuses the main box. Every read is kept (candidate-reads). 1,759 read. 457 refused at source (Harvard 277, SLUB 99, Gallica 33, IA 35 …) are being re-read from our own archived copies (`images.sourcelibrary.org/archived/<book>/<n>.jpg`); all 457 have them.

| read outcome | books |
|---|---:|
| title page, no author printed (or no title page) | 1,638 |
| names an author or praeses | 89 |
| names an editor only | 5 |
| unparsed | 27 |

**By eye, before screens.** 20 of the author proposals drawn at random, 6 title pages opened, the rest judged from the quoted words: 10 right, 5 initials or placeholder, 3 wrong (a respondent, a pseudonymous satire, Solomon for *Proverbs*), 2 corporate bodies.

**Screens** (`screen.mjs`, deterministic): 89 → 53. Out: initials 12, corporate bodies 8 (deferred — the link backfill is persons only), biblical 7, pseudonym or pseudo-ancient 4, praeses forename only 3, N. N. 1, several names 1.

**Refuter.** `claude -p --model sonnet`, Read tool only, sealed folder with the same four leaves, told to refute unless the name is printed as the writer. 27 keep, 26 refute. The refutes read right: *Problemata Aristotelis* compilations (6), respondents and candidates, a donor, a memorial, collections from various authors, a prayer anthology.

**Review of every kept reason.** Dropped 3: Estienne (the printer), Albertus Magnus for *Compendium theologicae veritatis* (Hugh Ripelin), Vyāsa for a Purana. Overrode 1 refute: the second copy of Brandmüller's 1658 Basel rector's programme, whose twin the refuter kept after reading the first-person dedication.

**Written 2026-10-31.** 25 books, run `titlepage-authors-7761`: 25 `sweep_log` rows, 38 `field_provenance` rows, `books_catalog` mirrored, 25 revalidated. 13 linked to an existing author doc; 12 names have none yet. Backup and every verdict in ops `backups/authors-7761-live/`.

**Spot check, by eye, 2026-10-31.** 10 of the 25 written title pages opened, chosen for the risky roles (praeses, candidate, compiler, editor, traditional attribution): 10/10 right. Oecumenius is the catalogue attribution; the Pauline commentary is pseudo-Oecumenius in modern scholarship.

**Not established.** The other 15 are judged by refuter + review, not by eye; no held-out set. The 457 re-reads from archived copies are not yet screened.

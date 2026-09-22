# The Spanish column of a bilingual leaf — 2026-08-25/27

Started from one line of a previous session's leftovers: *"The Ximénez columns —
94% of its pages carry Ximénez's own Spanish, trapped behind concatenated OCR.
Most interesting problem left, and it generalises to the Florentine Codex."*

The premise turned out to be half right, and the half that was wrong is the
interesting part.

## The premise was wrong about "concatenated", and that made it a smaller job

The OCR is not concatenated. `src/lib/types/prompts/defaults.ts` has told the
model since early 2026 to transcribe the left column, emit `<column-break/>` on
its own line, then transcribe the right — and the model does. 112 of the Ximénez
manuscript's 132 pages carry exactly one marker, `<columns>2</columns>` in the
envelope, and `page.columns = 2` on the document. `NotesRenderer` already renders
on that marker.

So the Spanish was never trapped. It was **delimited, addressable, and unread**:
nothing downstream asked which side of the marker was which language.

The measurement that settles it, on the Ximénez manuscript (bar = 18% broad
closed-class function-word share):

| | columns | median share |
|---|---|---|
| above the bar | 125 | 44.8% |
| below | 118 | 1.7% |

Bimodal with nothing in between — 1 of 243 columns is a close call.

## What was actually broken, in three layers

**1. The catalogue.** `books.language` read `K'iche' Maya`. The leaves' own
`<language>` tags say Spanish on 96% of them and K'iche' on 89%. Under a
one-language record every Spanish surface in the product is blind to the book by
construction.

**2. The gate.** `src/lib/localized.ts` had already reasoned about this and
stopped, deliberately and in as many words:

> *"A half-Spanish page is a weaker promise than `/es` makes, and a bilingual
> edition is its own question (the Ximénez Popol Vuh carries K'iche' and Spanish
> in parallel columns and is catalogued under K'iche'). Widen this only with a
> decision about what a bilingual page owes a Spanish reader."*

That was the right call at the time and it names the missing decision precisely.
The answer this session ships: **the page is half Spanish; the column is all of
it.** Measure the column and the promise `/es` makes is fully kept.

**3. The Florentine Codex, which is worse than a coverage gap.** All three
volumes already have `pages_translated_es` — 703 / 752 / 992 — written by
`es-translate-worker.mjs`, which pivots our ENGLISH AI translation into Spanish.
So the Spanish edition of a Spanish source is a machine round-trip. Vol. 2,
p. 201:

```
Sahagún, on the leaf (1577)
  "que no te ensuberbescas, ni te altiuescas… y baxa la cabeça, y recoge tus braços"

stored as translations.es (source: ai-pivot-en)
  "que no te vuelvas orgulloso, ni te enaltezcas… y baja la cabeza, y cruza los brazos"
```

2,121 pages in that state. **This is the finding worth carrying**, and it is not
about the Codex: any book whose leaves are already in the target language can be
overwritten by a pivot worker that only checks whether the field is empty.

## What shipped

Branch `worktree-bilingual-source-columns`, one commit, 3,007 unit tests green,
`tsc --noEmit` clean.

- **`scripts/lib/source-column.mjs`** — split on the marker, score each segment,
  return only what is decisively the target language.
- **`scripts/audit/source-column-separation.mjs`** — the positive control.
- **`scripts/maintenance/relabel-bilingual-edition.mjs`** — catalogue relabel
  from the leaves' own page tags.
- **`scripts/maintenance/extract-source-columns.mjs`** — the writer. Dry-run by
  default; refuses to overwrite `ai-pivot-en` without `--replace-pivot` and
  anything human-written ever.
- **provenance across every read path** — `source: 'source-column'` gives the
  quote API a third `text_source`, the MCP tools a tip, the reader an "On the
  leaf" badge.

### Four things that only measurement caught

**The `<language>` tag order is not evidence.** It looks like it names the
columns in order. On 400 sampled pages of Codex vol. 1 the model wrote "Spanish,
Nahuatl" 300 times and "Nahuatl, Spanish" 24 times for one physical layout. An
ordering right 93% of the time puts the wrong language into the Spanish lane on
one page in fourteen and nothing downstream can detect it. Every segment is
scored on its own words instead.

**One score was not enough.** A broad closed-class share separates Spanish from a
non-Romance column beautifully and admits FRENCH at 22% — `de que en le un si ni
es` are French too. Two pages of Brasseur's French commentary on Landa were
accepted before a second, Spanish-EXCLUSIVE score was added (`el y los las del
con para muy pero como porque` — none of them French or Latin words).

**The thresholds are measured, not chosen.** Plainly-Spanish columns score
12.6–19.6% exclusive (p05 across five books); plainly-not ones 1.7–6.3% (p95).
10% is the empty middle. The first value picked by eye was 4.5%, which is where
the French got in.

**The first version of the audit measured itself.** It partitioned columns at the
18% bar and reported `min(above) − max(below)` as "the gap" — which is ~0 on any
dense distribution by construction, so it screamed on the Codex, where the
mechanism is fine. It now reports CLOSE CALLS: columns whose verdict flips if
either bar moves ±25%. Same shape as the entry in `measurement-instruments.md`
about a metric that cannot fall.

Two rules that fell out and are worth reusing:

- **A rule that declines an ambiguous page is not automatically safe.** An early
  version declined any multi-column page where every column read as Spanish, on
  the grounds that it was "a page we do not understand". Run against the positive
  control — a Spanish book printed in two columns — it threw away 91% of it. Both
  columns being Spanish is not a puzzle; it is a two-column Spanish page.
- **`SourceBadge` fell through to "AI" for any unrecognised provenance.** That is
  the quiet version of the exact mistake this work is about: it would have
  labelled Ximénez's 1701 Spanish as machine output. Unknown provenance now
  renders as unknown. Relatedly, `ContentSource` was still `'ai' | 'manual'`
  while the writers had been storing `batch_api` and `ai-pivot-en` for months —
  a `.mjs` writer is not type-checked, so nothing complained.

## What was written to production

| book | pages | note |
|---|---|---|
| Popol Vuh, Ayer MS 1515 | `language` → `K'iche' Maya-Spanish`, `languages[]`, `language_multi` | catalogue relabel |
| Popol Vuh, Ayer MS 1515 | **125** `translations.es` | Ximénez's own 1701 Spanish — nothing overwritten |
| Landa, *Relación* (Brasseur ed.) | **175** `translations.es` | Landa's own Spanish — nothing overwritten |

Both books had `pages_translated_es: 0` before, so no paid output was destroyed.
`books.updated_at` is bumped on both for the Supabase catalog sync.

## Open, and deliberately not done

1. **The Codex replacement — a curatorial call, not a technical one. Issue #4226.** Replacing
   2,121 pages of pivot Spanish with Sahagún's is *ad fontes* and is what the page
   actually says; it also hands a Spanish reader 1577 orthography instead of
   modern prose, and discards paid output (regenerable from the English we keep,
   at cost). The command is
   `extract-source-columns.mjs --book=<id> --commit --replace-pivot`, and it
   reports its counts before writing.
2. **Spanish search for the 300 pages just written.** They are readable on `/es`
   and return nothing for a Spanish query until
   `scripts/workers/embed-page-texts.mjs --lang=es` runs. **BILLED** — ≈$0.04 for
   these, ≈$0.30 including the Codex.
3. **`sync-es-collection.mjs`** has not been run, so `en-espanol` does not yet
   carry the two books.
4. **The *Informe contra idolorum cultores*** (`Spanish / Latin`, 276 pp) is the
   one candidate the audit still flags — 9.5% close calls. Hand-checking showed
   FALSE NEGATIVES, not false positives: pp. 35 and 45 are genuine 17th-century
   Spanish declined at b20.9%/x9.2%, because the archaic orthography ("Otrofi",
   "escriuano", "dela") depresses function-word hits. It is also not a
   parallel-text at all — it is a Spanish book with Latin quotations, i.e. a
   catalogue question, not a column one.
5. **The four BYU Chilam Balams — three imported, two four-up sheets blocked.**
   Looked at the actual plates rather than the catalogue, which changed the
   answer on every one of them. Dedup ran first: none was already held (we have
   Chumayel, Kaua twice, and Tizimín only as Edmonson's modern English
   translation).

   | | record | frames | what the images actually are | |
   |---|---|---|---|---|
   | **Teabo** | 79957 | 44 | **Colour photographs of the original leaves.** BYU's record says "Original manuscript, loosely bound" and it is true — unusual in the Gates material, which is mostly photographic. | [imported](https://sourcelibrary.org/book/6a8d9b7c4cc19d0e10153aa9) |
   | **Nah** | 85095 | 64 | Photostat NEGATIVE, white on dark grey, one page per frame. Legible as it stands. | [imported](https://sourcelibrary.org/book/6a8da255aa8f57838adf7fe4) |
   | **Ixil** | 83560 | 133 | **Mixed, and the catalogue says so** — "Photocopies; Typescripts". Frames 1–~85 are positive photostats of the manuscript; from ~86 the folder continues with Gates's own typescript, headed "Ixil - 9", "Ixil - 10", plant names in red. | [imported](https://sourcelibrary.org/book/6a8da256aa8f57838adf8025) |
   | Calkiní | 138175 | 8 (7 usable) | Four-up negative. Blocked, below. | — |
   | Tizimín | 85910 | 19 | Same four-up shape. Blocked, below. | — |

   All three imported hidden and unprocessed. **OCR and translation cost money
   and were not started.**

6. **Calkiní — split by hand and imported.** 26 pages,
   [book 6a8ee3de…](https://sourcelibrary.org/book/6a8ee3de880abaf2b45934c3),
   hidden and un-OCR'd. This is the only importer here that MAKES its page
   images: each source frame carries four manuscript pages, so there was nothing
   to point a page row at. Frames quartered, mounts trimmed, top row rotated
   180°, tones inverted, three derivatives per page written to
   `pages/{bookId}/…` on R2 through `validateR2Key` + `assertBookScopedKey`.

   **Page order was read off the leaves, and it is not the layout.** The rule:

   - Each COLUMN of a frame is one leaf, recto above verso. The recto carries its
     number at the top RIGHT, the verso the SAME number at the top LEFT.
   - Left column runs TL→BL; the right column runs the other way, BR→TR, because
     the top row was laid head-down.
   - **The frames are not in page order and no layout rule would have worked:**
     frame 1 holds leaves 58 and 55, frame 3 holds 59 and 62, frame 4 holds 61
     and 60. Both frame 3 and Tizimín frame 5 give a clean ascending span of
     four, so two frames alone would have supported a confident, wrong rule.
   - Confirmed by TEXT as well as number: leaf 59 recto ends *"…cate molah uba"*
     and its verso opens *"Batabob…"*; leaf 55 verso ends *"y cabe thoxbil"* and
     leaf 56 recto opens *"thoxbil - tu chi cahun…"* — the scribe's catchword
     carrying across two different sheets.
   - The twelve leaves came out **55–66, each exactly once**, which is precisely
     the "24 p." on BYU's record. That agreement is the check: a misread number
     shows as a gap or a duplicate, not as a quietly scrambled book. Leaf 67 is
     the colophon.

   **Two things only reading the output caught.** The first import produced 28
   pages because the last sheet is NOT four-up — it holds two full-width pages
   stacked upright, and quartering it made four half-pages whose lines ended
   mid-word (*"…Ah calkiniob J"* | *"uan de Dios Yuc…"*). Corrected to a
   `two-up` layout; the book is 26 pages. And ContentDM dropped the connection
   mid-frame twice, so the importer now retries and resumes — the first crash
   left a book with zero pages, which a plain already-imported check would have
   stranded forever.

   Verified after the fact by fetching all 26 served images, decoding each, and
   contact-sheeting the top-right corner of every page: the twelve rectos read
   55…66 in ascending order at exactly the odd page positions.

7. **Tizimín — still blocked, and the blocker is different.** Same geometry, same
   split works (frame 5's top-left dates itself *"hum pis kin Febrero 1522
   haab"*). But its foliation is SPARSE: across frames 1–4 only four leaves carry
   a legible number, and the frames are no more in order than Calkiní's.
   Thirty-eight leaves cannot be ordered from a handful of anchors. Its first
   sheet's right-hand column is not manuscript at all but a Spanish donation
   inscription (*"Obsequio de este libro… Manuel Ximenez Perez"*).

   **To finish:** split all 19 frames, import hidden in frame order, OCR (the
   prompt already emits `<page-num>`), reorder by what the model reads off each
   leaf. 76 pages of OCR — costs money, not run unasked.

## The generalisation, stated plainly

This is not a Maya problem. 91 distinct `books.language` values on ~200 live books
name more than one language — `Latin-German` (60 books, 10,319 pages),
`Greek-Latin` (29 books, 10,591), `Hebrew-Greek`, `Irish/English`,
`Chinese-English`, `Welsh/English`. Every one of them is a book where half the
leaf may already be in some reader's language, and where a pivot worker will
happily write a machine translation of it into the field that reader reads.

The mechanism here is per-language by design — `spanishColumnText` is Spanish
because Spanish is the only locale `/es` ships. Adding a language means adding
its two word lists and re-running the separation audit against its own controls.


---

# Part two — what the Maya work turned into (2026-08-26/27)

Everything above shipped. Then "is all the metadata captured, such as holding
library?" turned out to be the important question of the session, and the answer
was no — in a way that generalised well past the four books.

## The shape of every bug in this half

**A record can be complete from the writer's side and incomplete where the site
looks.** None of these throws, none shows up in a count, and each is only
findable by asking the READ path what it needs.

| what was recorded | where the site looks | consequence |
|---|---|---|
| `provider: 'byu'` | `ImageSourceProvider` union → `LIBRARY_PARTNERS` | no `/libraries` page, no credit at all |
| call number in `dc_identifier` | `image_source.shelfmark` | classmark never shown |
| `license: 'Public domain'` | `IMAGE_LICENSES` keyed by **id** | rendered as a raw string |
| `book_visible` absent | `{ book_visible: true }` — an EXACT match | 27,115 illustrations invisible |

The last one is the big one and it explains a reader complaint.

## 27,115 extracted illustrations that existed and could not be seen

`gallery_images` denormalises `book_visible` from `books.visible`; ~15 read
paths filter on it exactly — the gallery, collections, artist pages, hero
mosaics, and **a book's own illustration strip**. A row where the field is
ABSENT fails that filter. Extraction had run, the images were in the database,
and the reader was told the book had none.

- The tell it was a bug and not a design: exactly one path,
  `/api/search/unified`, uses `{ $ne: false }`, which DOES match absence. Same
  row findable in search, missing from the gallery.
- **The trap:** `dedup-clean-gallery.mjs` sets `book_visible: false` to suppress
  images it judged DUPLICATES — the same field. A blanket "set true where the
  book is live" would have un-suppressed every de-duplicated image. 436 rows
  carrying `is_duplicate`/`dedup_hidden_at` were deliberately left alone.
- **Root cause:** the reconciler still exists (`/api/admin/sync-gallery-images`)
  and its cron was archived under "replaced by Hetzner workers". No worker took
  it over. **A denormalized field whose refresher was retired drifts silently,
  because nothing about the read path looks broken.**
- 26,787 restored. This is also the answer to the 2026-08-25 feedback "How to
  see all illustrations?" — the book page's whole illustrations section is gated
  on `galleryPlates.length > 0`, so it never rendered.

## `iiif` is a protocol, not a library

The audit reported 1,380 live books with no library page, mostly under `iiif`.
The obvious fix — add an `iiif` entry — would credit a standards body for the
Bayerische Staatsbibliothek's scans. Grouping by the HOST of the manifest gives
**fifteen** institutions and 16,994 records (the audit said 997 because it only
counts live books). Twelve already had a key AND a page and had never been
pointed at. **16,993 reassigned; "no library page" 1,380 → 10.**

## The audits, which are the durable part

- `scripts/audit/record-completeness.mjs` — read-path completeness by provider,
  and duplicate clusters whose copies DIFFER (898 editions have >1 copy; only
  the **219 that materially differ** are reported, ranked by what a reader loses
  landing on the thinner one. Worst: two live copies of *Historia Critica
  Philosophiae*, one 1,416 pages OCR'd and translated, the other 24).
- `scripts/audit/gallery-denorm-drift.mjs` — separates ABSENT from STALE and
  never touches a dedup suppression.

**Both parse their vocabularies out of the TypeScript and CHECK THE PARSE**,
because two parser bugs of the same shape happened in one function: a `;` inside
a comment truncated the provider union (18 of 60 — would have called three
quarters of the corpus invalid), and stripping `//` to end of line shredded the
licence alias table (every `'http://…'` key became `'http:`). A parser that
silently under-reads manufactures findings.

## Two judgement calls worth keeping

**The licence fix went in the RENDERER, not the data.** 3,740 books store
something that is not one of our seven ids, and almost none of it is wrong —
sources record their own rights statement and the importers kept it. Rewriting
would be lossy, and in one case false: 1,260 books store
`rightsstatements.org/vocab/NoC-NC` = "No Copyright – Non-Commercial Use Only",
which is **not** public domain. There is a test pinning that. `licenseDisplay()`
resolves for display; the stored string stays.

**Absence has more than one cause.** 121 live books had no cover; 105 are ETCSL,
a text corpus with no page images, where coverless is correct. Ten were real.

## Still open

- **7,899 live books with no categories** — 36% of the corpus, absent from every
  subject facet. Needs classification, so it costs money.
- **219 diverging duplicate clusters** — curatorial. `--json` makes a worklist.
- **Tizimín** — still unimported; sparse foliation, needs the OCR `<page-num>`
  route (76 pages).
- **`sync-gallery-images` has no scheduler.** The drift will return. Either
  re-arm a cron or fold it into a Hetzner worker.
- Image extraction has never run on most of the Maya corpus, including
  everything imported this session.

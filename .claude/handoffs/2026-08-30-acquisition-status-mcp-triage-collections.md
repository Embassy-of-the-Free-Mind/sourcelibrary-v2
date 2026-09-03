# Acquisition status, MCP feedback triage, and two new collections — 2026-08-30

Session started as "how's acquisition?", became a feedback triage, ended by building
the two pending collection proposals. Derek's constraint mid-session: **no spending.**

---

## 1. Acquisition: the drain finished, the queue is idle

`acquisition_queue` has **0 pending, nothing claimed, nothing in flight.** Corpus is
109,367 books / 47,483 visible. Books created: 3,998 on Aug 27, 561 on Aug 28, then
**zero on Aug 29 and 30** — not a stall, just nothing left queued.

`held-flip-2026-08-27` (17,631 rows) resolved completely:

| outcome | rows | share |
|---|---|---|
| acquired | 4,249 | 24% |
| no-match | 7,698 | 44% |
| re-held | 3,701 | 21% |
| import-failed | 1,983 | 11% |

Projection was ~7K acquisitions; actual 4.2K.

### The PLAUSIBLE pilot verdict argues AGAINST the big drain

`plausible-pilot-2026-08-27` (500 rows): **73 acquired (14.6%), 247 re-held (49%)**,
155 no-match, 25 failed. Half the tier is genuinely already held — the old gate was
roughly *right* about PLAUSIBLE, contradicting the LLM's "43% false" estimate (the
thin-payload failure mode again). Extrapolated over the **76,278** still-unflipped
held rows: ~11K acquisitions bought with ~37K wasted re-screens. This is the
$200–400/mo recurring-R2 question and it is **Derek's call, not started.**

### Open gap, free to fix

**8,433 `import-failed` rows have never been retried, and not one records why.** There
is no `fail_reason` field on the collection at all — a `--retry-failed` run would be
blind. Add the field before the retry.

---

## 2. MCP feedback triage — verify before filing

A 10-item bug report arrived 2026-08-30 07:55 (`feedback`, channel `mcp`) from an
extended agent session. I verified each claim against prod rather than filing what it
asserted. Roughly half duplicated open issues (#4281, #4329, #4246, #4285, #3697), so
the genuinely new surface was much narrower than ten items.

**Filed:** #4387 (summariser), #4388 (MCP tool contracts), #4389 (unknown-N slugs),
#4390 (english_title), #4391 (ETCSL 2.1.1), evidence comment on #4246, and #4399
(the create-collection sync bug found later).

### Understated by the reporter

- **The summariser appears to read only the opening slice.** It *guessed* this and
  suggested a diagnostic; I ran it. Of 9,982 live books ≥100pp with quote pages,
  **45% have every pull-quote in the first quarter, 71% in the first half**, mean
  max-quote position **0.38**. If quotes were drawn from the whole book that mean
  would be near 1.0. Public-facing: the same summaries render on `/book/`. → #4387.
  The diagnostic is free and should be the regression check.
- **`english_title` already exists and is already indexed** (boost 8 in
  `buildBookSearchStage`). It is populated on **712 of 13,254** live non-Latin-titled
  books = **5.4%**, so **12,542 books are dark to English queries** with the
  retrieval machinery built and waiting on data. The reporter proposed *building*
  the field. → #4390.

### Wrong

- Blamed a CJK ideographic comma (U+3001) for empty-author `work_id`s corpus-wide.
  **Exactly 2 books** have that comma. The 1,916 `local:n::` work_ids are
  overwhelmingly authored "Anonymous" — a known resolver limit. Extrapolated from one
  example.
- Ranked "merge the Trigault duplicates, this is wasting money" as priority #1. The
  pipeline is paused and the duplicate is hidden. Nothing is spending on it.
- "`list_books` search leaks" — not a bug. Atlas Search deliberately matches
  `reading_summary.overview` and `name_forms` too. The defect is the tool description
  saying "Filter by title or author". → #4388.

### One clean win, precisely located

`search_images(book_id=…)` returns a whole-corpus `total`/`remaining` (206,362).
`src/app/api/gallery/route.ts:443` — the `else if` that selects the accurate
`countDocuments(filter)` path lists every structural filter **except `bookId`**, so a
book-scoped call falls through to `estimatedDocumentCount()`. `filter.book_id` is
already set at `:206`; adding `bookId` to the condition is the whole fix. Note the
near-miss: the `structurallyFiltered` guard at `:530` *does* include `bookId` but only
gates the artwork-injection lane.

### Confirmed data damage

- **111 books live at `/book/unknown-N`**, all `visible: true`. Real shareable URLs.
  Repair the generator *before* the slugs, and add redirects. → #4389.
- **Bartolomeo Ricci duplicates share an identical `work_id` AND `edition_key`** and
  both are live. Not a recall gap — dedup matched and did not collapse. A third
  record is attributed to Torresano, the *printer*, which forks its work identity.
  → comment on #4246.

---

## 3. Two collections built — PR #4398, live

Both proposals were Derek's own, submitted via MCP, pending since Aug 26 / Aug 30.
Assembled entirely from existing holdings: no acquisitions, no OCR, no translation.

- https://sourcelibrary.org/collections/harmonia-mundi-economic-order — 33 tagged, 32 in grid
- https://sourcelibrary.org/collections/picturing-the-world-1450-1750 — 22 tagged, 22 in grid

Script: `scripts/create-proposed-collections-2026-08.mjs`. Copy follows
`collection-intro-writing-rules.md` v3 and the `featured-work-description` skill.
Both proposals now `status: approved` with `created_collection_slug` set.

### Two fabricated book ids

Each proposal contained exactly one id matching **no record in `books` or
`deleted_books`**. Well-formed hex, correct id-space, one sitting inside a real
import batch with genuine neighbours two characters away.

- harmonia `698420e1…` → **substituted** with the real Saint-Martin *Des erreurs et
  de la vérité* (1775); the rationale cites him and his sequel was already listed.
- picturing `69b51e49…` → meant to be "Postel (1635)". Postel died 1581, so the date
  is invented too. **Dropped, not substituted**, and recorded in `curation_todo`.

The approve endpoint would have silently built a short collection: `updateMany`
matching fewer docs than ids given is not an error. Written up in
`.claude/docs/invariants/agent-tool-results.md` (new final section).

### Two things that nearly shipped looking correct

1. **`$addToSet` on `books.collections` does not bump `updated_at`.** The Supabase
   sync is incremental on `updated_at`, so the grid renders **empty while
   `book_count` reads perfectly**. Hence `$currentDate` in the script.
   `src/lib/create-collection.ts:78` and `PATCH /api/collections` **both omit it**,
   so every collection made through the API or the proposal-approve flow has an
   unpopulatable grid. → **#4399**, with a guard design (a helper that owns both
   operators, or a test that runs the sync selector) rather than another doc.
2. **`book_count` counted 33 while the grid showed 32.** The grid serves *readable*
   books; Carey's *Principles of Social Science* (497pp, 300 OCR'd, 0 translated) is
   a member no page shows. Fixed: `book_count` = readable subset, `total_book_count`
   = membership. Caught only by diffing the live grid against Mongo membership —
   appended to `invariants/visibility-and-stats.md` as a second instance of the
   existing "a card must count what its TARGET page renders" rule.

### Deliberately out of scope

Quote bands and gallery images for both (the quote-over-a-plate design exists only as
the bespoke `/collections/mycology` route, not as a collection field). Acquiring Zhang
Huang's *Tushu Bian* (1613) and finishing *Wakan Sansai Zue* past juan 20 at ~10% —
both spend decisions, recorded in `curation_todo`, not started.

---

## State at close

- PR **#4398** green, mergeable, **awaiting Derek's review** (repo is review-gated).
- Feedback queue: **0 unread**. The MCP report marked `read`, deliberately **not
  `addressed`** — that auto-emails the submitter.
- Parked on Derek, all paid: the 76K PLAUSIBLE drain, CADAL full OCR (~$1,264, #4311),
  any `english_title` backfill, any summary regeneration.
- Worktree `feat+collections-harmonia-picturing` kept (open PR).

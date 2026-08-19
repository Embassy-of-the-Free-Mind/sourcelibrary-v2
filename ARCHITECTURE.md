# How Source Library works

A guide for a person reading cold. Start here, read once, and you should be able
to place any file, collection or worker you meet afterwards.

> **This is the human tier.** The machine tier is `CLAUDE.md` and
> `.claude/docs/invariants/`, indexed by *"read this before you touch X"*. That
> tier is deliberately not a narrative and this one is deliberately not
> exhaustive. When you need the detail, the last section says where to look.

---

## 1. What this is

Source Library is a digital library of historical primary sources — alchemy,
Hermetica, Kabbalah, Rosicrucianism, early modern science, and a good deal
beyond them — that makes scanned books **readable and citable**: page images,
AI-aided OCR, translation into English, and curation that surfaces them.

The core experience is *reading and quoting an original*. Everything else exists
to serve that: collections and galleries are how a reader finds a text,
shortlinks and DOIs are how they cite it, and partner subdomains are how an
institution presents its own holdings as a reading room.

Two things follow from this that shape the whole system:

- **A citation must be trustworthy.** Serving a passage that is not quite what
  the author wrote is the worst thing this system can do — worse than serving
  nothing. Much of the code that looks defensive exists for that reason.
- **The corpus is unevenly processed, on purpose.** A book can be acquired,
  scanned, read, translated and curated at different times, or never. "How many
  books do we have" therefore has several correct answers.

## 2. The corpus, measured

<!-- STATS:BEGIN -->
*Measured 2026-08-08 against production. Regenerate with `node scripts/audit/architecture-stats.mjs --apply` — do not hand-edit, and do not quote these elsewhere without re-measuring.*

| | count | what it means |
|---|---|---|
| Books, all records | 104,625 | includes acquisition candidates and unprocessed imports |
| — with page images | 79,639 | the scan actually arrived |
| — with OCR | 55,362 | at least one page has been read |
| — with translation | 20,462 | at least one page has been translated |
| — publicly listed | 34,084 | `visible: true` |
| **— live** | **19,465** | **`visible: true` AND `pages_count > 0` — the canonical "readable" filter** |
| Pages | 19,132,895 | one document per leaf |
| Entities | 1,018,025 | people, places and things extracted from the text |
| Collections | 375 | curated groupings |

Most-held languages among live books: Latin 6,543 · English 2,336 · German 2,309 · Tibetan 1,473 · Greek 1,105 · French 763.

**The gap between 104,625 and 19,465 is the system**, not a defect: a book is acquired long before it is readable, and each stage below moves some of that difference.
<!-- STATS:END -->

## 3. The life of a book

This is the spine. Everything else in the repository hangs off some stage of it.

```
  ACQUIRE ──> IMPORT ──> ARCHIVE ──> READ ──> TRANSLATE ──> ENRICH ──> SERVE
  catalogues   record     images      OCR      English      meaning    reader,
  & archives   created    to R2       text     text         & search   API, MCP
```

**1. Acquire.** Candidate books are found in public archives — Internet Archive,
Gallica, HathiTrust, e-rara, museum IIIF endpoints — and screened for subject fit
and duplication. Deduplication happens *before* import (`src/lib/dedup.ts`),
because a duplicate that gets in is far more expensive than one kept out.

**2. Import.** A `books` record is created, usually **hidden**, with metadata
from the source catalogue. Metadata from archives is frequently wrong — languages
mistagged, editors recorded as authors — so several later stages exist to correct
rather than trust it.

**3. Archive the images.** Page images are fetched and written to **Cloudflare
R2**, served from `images.sourcelibrary.org`. This is the stage most often
mistaken for "OCR is stuck", because a book waiting on images looks identical to
one waiting to be read. Spreads are split into single leaves here, and crops are
non-destructive: the original stays.

**4. Read (OCR).** Each page image goes to Gemini and comes back as text with
light structure — running heads, printed page numbers, marginalia, notes marked
up in place. That markup matters later: it is how the reader knows which words
are the author's and which are the printer's furniture, and it is where canonical
citation numbers turn out to have been hiding all along (§7).

**5. Translate.** Pages are translated into English, with the original preserved
alongside. Both are served; neither replaces the other.

**6. Enrich.** Summaries, chapter structure, extracted entities, quality scores,
collection assignment, and **page embeddings** for semantic search. Embeddings
are written here, in the pipeline, rather than by a separate job — a cron that
stops is silent, and one that had stopped left semantic search blind on nearly
half the corpus for two months before anyone noticed.

**7. Serve.** The reader, the API, the MCP server, exports, DOIs. Covered in §5.

A book can stall at any stage, and many deliberately do — processing is currently
**paused** by choice, not by breakage.

## 4. The four stores, and why there are four

The most confusing thing for a newcomer. Each exists for a reason that the others
cannot serve.

| Store | Holds | Why not one of the others |
|---|---|---|
| **MongoDB Atlas** (`bookstore`) | The truth: books, pages, OCR, translations, entities, users. 141 collections. | Documents of wildly varying shape, and the pipeline writes constantly. |
| **Supabase Postgres** | Derived read models: browse/catalog listings, analytics, and every **vector** index for semantic search. | Postgres does relational filtering and `pgvector` similarity that Mongo would do badly. |
| **Cloudflare R2** | Page images and derivatives. | Object storage is the right shape and the cheap egress matters at 19M pages. |
| **Cloudflare CDN** | Cached HTML and images at the edge. | Pages are cached for 24h, which is why deploys need a purge (§6). |

**The rule worth internalising:** Mongo is authoritative; Supabase is derived. A
derived store can be rebuilt and will silently fall behind, so when something is
missing from search but present in the reader, suspect the sync, not the data.
The inverse — a book readable but not listed — is usually the same thing from the
other side.

## 5. What consumes it

- **The website** (`sourcelibrary.org`) — reading, browsing, collections,
  galleries, the librarian chat.
- **Partner subdomains** — an institution's own holdings as a standalone reading
  room, on their own domain, with their own branding.
- **The MCP server** (`/api/mcp`) — the library as a tool for AI agents: search,
  quote with citation, canonical-reference lookup. Listed in the Claude
  connector directory, and a meaningful share of serious use now arrives here.
- **The REST API** (`/api/…`) — the same capabilities for ordinary clients.
- **Exports** — PDFs, plain text, corpus snapshots, and DOI-minted scholarly
  editions via Zenodo.

The MCP surface deserves particular attention when changing anything about how
text is served: an agent will follow an instruction in a tool description
literally, at scale, and cannot see the page to notice something is off.

## 6. Where it runs

| Where | Runs what |
|---|---|
| **Vercel** | The Next.js app and its scheduled jobs. Merging to `main` deploys production, and the cache purge afterwards is automatic. |
| **Hetzner** (a rented box) | Pipeline orchestration, translation and embedding workers. It pulls `main` every few minutes, so script changes go live without a deploy. |
| **AWS Lambda + SQS** | Per-page AI work — OCR, translation, image processing — queued and run in parallel. |
| **Gemini** | The model behind OCR, translation and enrichment. |

Two consequences that catch people out: a change under `scripts/` needs no
deploy, and a bare `vercel --prod` without a cache purge can leave pages
rendering unstyled for up to a day.

## 7. Two ideas worth understanding early

Most of the subtlety in this codebase comes from two problems that sound simple.

**Which words are the author's?** A scanned page carries the author's text, the
printer's running heads, a translator's notes, an editor's commentary, and
sometimes a long extract from a completely different author. If the system cannot
tell these apart, it will hand someone a beautifully formatted citation
attributing one writer's words to another. Page markup, front-matter detection,
continuity flags across page breaks, and interpolation detection all exist for
this single problem, and it is not solved.

**How do you address a passage?** A scan page number is a property of one copy
and shareable with nobody. Scholarship addresses Aristotle by Bekker number and
Plato by Stephanus number, agreed centuries ago precisely so a citation survives
re-typesetting. Those numbers were already printed on our pages and captured in
OCR; `get_locus` now resolves them to leaves. The same question — *what is the
stable identity of this thing* — recurs for works, editions and authors, and is
the hardest unfinished business in the data model.

## 8. How to see it working

Reading about a system is worse than watching it. All read-only:

```bash
# The corpus, live
node scripts/audit/architecture-stats.mjs

# Is the MCP surface healthy? 14 checks against production
node --env-file=.env.production.local scripts/audit/mcp-directory-contract.mjs

# Ask the library a question the way an AI client does
curl -s "https://sourcelibrary.org/api/locus?ref=1094a8"
```

`/health`, `/progress` and `/status` (repository slash-commands) give a fuller
picture of the pipeline.

## 9. Where the deep knowledge lives, and why it is shaped that way

This document is a map. The territory is documented elsewhere, in a form that
looks strange until you see the reason for it:

- **`CLAUDE.md`** — the rules that apply no matter what you are doing. Capped in
  length on purpose.
- **`.claude/docs/invariants/`** — one file per subsystem, each opening with
  *"Read this when…"*. Every one is scar tissue from a real incident, and they
  are written to be found at the moment of danger rather than read through.
- **`.claude/docs/`** — reference material, read on demand.
- **`.claude/handoffs/`** — what happened in a particular session.

**Why the split matters.** Those documents are organised for *retrieval by
trigger*; this one is organised as a *narrative*. Both are legitimate and they
cannot be merged: a narrative is full of counts, which rot, while an invariant is
anchored to an incident, which does not. That difference is exactly why this file
went eight months describing a system that no longer existed while the tier next
door stayed accurate — and why its numbers are now generated (§2) rather than
typed.

If you change how the system works, this file is part of the change.

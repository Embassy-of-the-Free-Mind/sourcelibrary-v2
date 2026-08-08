# Why identity correctness is worth a month

**Read this when:** deciding whether work on `author_id` / `work_id` /
`edition_key` / `duplicate_of` is worth doing instead of adding books, adding
features, or improving OCR. Also read it before arguing that any of this is
plumbing.

The architecture is in [`translation-works-architecture.md`](./translation-works-architecture.md)
and #3258. The binding rules are in [`invariants/work-identity.md`](./invariants/work-identity.md)
and [`invariants/edition-identity.md`](./invariants/edition-identity.md). **This
doc is only the argument for spending time there at all.** Every number below is
measured, with the date it was measured; re-measure before quoting.

---

## 1. The library currently fails at collocation

Cutter set two objectives for a catalogue in 1876. The first is *finding*: let a
reader locate a book whose author or title they know. We do that well — search,
shortlinks, DOIs. The second is *collocation*: **show the reader what the library
has** of a given work, a given author, a given edition. We do that badly, and
identity is the only reason.

Measured 2026-08-08 across 19,465 live books (`visible: true`, `pages_count > 0`):

| Reader question | Books we could answer it for | Share of live corpus |
|---|---|---|
| "What other editions of this work do you hold?" | **5,183** (1,668 work clusters) | 27% |
| "Do you have this in a language I read?" | **1,645** (428 multi-language work clusters) | 8.5% |
| "Is there a better scan of this printing?" | **625** (293 full-quality edition clusters) | 3.2% |

Against that, the one collocation surface that shipped —
`TranslatedSiblingNotice` (#3033, PR #3238) — reached **157 books across 117
works** when measured 2026-07-19. It is gated narrowly and deliberately, and it
is the *only* place a reader is told that a sibling exists.

So roughly **1,645 live books sit in a work cluster that spans more than one
language, and we tell readers about 157 of them.** A reader on Ficino's Latin
*De mysteriis* is not told we hold it in English. A reader on volume 4 of a set
is not told we hold 1 through 3, or that 5 is missing. This is not a missing
feature; the feature is cheap. It is a data-confidence problem — we do not show
the rail because we do not trust the clusters behind it.

**That is the point of the work: not correctness for its own sake, but earning
the right to put a collocation rail on a book page.**

## 2. The public claims rest on identity, and one of them is already paused

First-translation is a claim about a `(work, source-language)` pair, not a
property of a book. The translation-gap figure is a count over works. Both are
load-bearing public claims — the FT badge appears on book pages, and the gap
number has been published.

`edition_key`'s validator, run the day it landed (2026-08-07), found **222
clusters that are one edition carrying two different `work_id`s**, 213 of them
at full key quality. Nearly all are one mechanical fault: the resolver slugs from
either the English gloss or the original-language title depending on the pass, so
one work becomes two —

- `local:a:johann-otto-von-hellwig:curious-physics` ↔ `local:n:hellwig-johann-otto-von:curiosa-physica`
- `local:n:gallico-samuel:essence-pomegranates` ↔ `local:n:gallico-samuel:asis-rimonim`

Every one of those is a work that answers "have you been translated?" twice,
independently, and can answer it two different ways.

The FT effort was **paused by Derek on 2026-07-19** with the words "still seems
quite disorganized." That pause is not an unrelated scheduling decision — it is a
symptom of exactly this. The identity layer underneath the claim was not solid
enough to adjudicate the claim. Fixing the layer is the precondition for ever
un-pausing, and #3258 says so explicitly: the non-FT identity issues were chosen
because each "quietly de-confuses FT from below."

## 3. The damage compounds, and it is compounding right now

This is the argument that decides the timing.

Dedup's title tier cannot reach **20,454 of 79,715 non-artwork books (25.7%)**
(measured 2026-08-08). Two causes, roughly half each:

- **11,685** have `normalized_title: ''` — `dedup.ts normalizeTitle()` strips
  `[^\w\s]`, JS `\w` is ASCII-only, and every non-Latin-script title therefore
  normalizes to the empty string.
- **8,769** have no `normalized_title` at all — **47 direct-insert scripts** under
  `scripts/import/` and `scripts/iiif-discovery/` hand-build book documents and
  never go through `src/lib/import-utils.ts`. Eleven of them don't write the
  field even by hand.

Now the part that makes it urgent. Those books by creation month:

| Month | Books added that dedup cannot see |
|---|---|
| 2026-06 | **11,689** |
| 2026-07 | **5,104** |
| 2026-03 | 2,129 |
| 2026-04 | 1,050 |
| earlier | 481 |

**82% of the unreachable population arrived in the last two months.** This is not
legacy debt sitting still; it is a hole that opened alongside the current
non-Latin acquisition push and is taking on water at roughly the acquisition
rate. Every month it stays open, the number grows by however many books we
import.

Two properties make identity debt worse than ordinary debt:

**It gets more expensive with scale, not merely larger.** Duplicate adjudication
is pairwise. A cluster of two is a glance; a cluster of eight is a research task.
The Yingzao Fashi case (§4) went from a false pair to a false eight.

**It can erase its own repair path.** The canonical version is in `CLAUDE.md`:
the archiver that both *set* `archived_photo` and used it as its own "already
done" marker, so a wrong write made the page permanently invisible to every later
run. Identity has the same shape — a book merged into the wrong work, or hidden
as a duplicate of a book it is not a copy of, stops appearing in the queries that
would find the error.

## 4. Bad identity does not merely omit — it fabricates

The strongest single piece of evidence, found 2026-08-07 while materializing
`edition_key`:

Eight books titled `營造法式 (Yingzao Fashi) · 卷一~卷四`, `· 卷五~卷九`, `· 卷十~卷十四` …
are **eight different juan ranges of a 34-volume work**. With the Chinese erased
by the ASCII normalizer, all eight normalized to one identical string, and they
had been sitting in the duplicate queue as **seven redundant copies awaiting
merge**. Approving that queue would have hidden seven-eighths of a book.

Likewise `حي بن يقظان / Philosophus Autodidactus` (243pp, Arabic and Latin) was
merged with a Latin-only 223pp edition — two genuinely different books presented
as one to whoever next worked the queue.

The volume-awareness that reduced the false-cluster count from 456 to 296 in July
was **Latin-only**, and nobody could see that because the affected books produced
no error, no warning, and no empty result — just a plausible cluster. A silent
normalizer failure does not look like a bug; it looks like a finding.

This generalises, and it is the reason to be systematic rather than opportunistic:
**`\w`, `\b` and `[a-z]` are Latin-only assertions**, and in a corpus that is
substantially Chinese, Tibetan, Arabic, Greek and Cyrillic they fail quietly and
return well-formed nonsense.

## 5. Why *this* work and not more building

The four keys now all exist — `edition_key` landed 2026-08-07 and was the last
one. The failure mode from here is not "we lack machinery." It is that machinery
gets built, generates a queue, and nothing drains it. As of 2026-08-08 the
unworked queues are:

- **1,993** dark-cluster duplicate pointers (keeper hidden, no onward pointer)
- **297** both-visible same-edition clusters — the keeper-choice backlog, open since July
- **222** work_id conflicts — added by me on 2026-08-07
- **112** prose-tail duplicates with no pointer

An unworked queue is worse than no queue, because it *looks* like the problem is
handled. Derek's standing instruction is to finish and integrate core machinery
before opening new fronts; the honest reading of that instruction right now is
that adding a fifth layer would violate it, and draining the four satisfies it.

## 6. The counter-argument, stated fairly

None of this adds a book, a reader, or a page of OCR. August could instead buy
several thousand new titles or a large OCR batch, both of which are visible and
countable.

The reason to do identity anyway:

- The corpus is already ~5–7B words across ~80K processed books. The marginal
  reader value of book 80,001 is low; the marginal value of making 80,000 books
  *findable as what they are* is high, and it applies to all of them at once.
- Identity errors are monotonically cheaper to fix earlier — see §3. Acquisition
  is not; a book we don't buy in August costs the same in October.
- Acquisition actively *worsens* the identity position while the writer path is
  open (§3), so the two are not independent bets. Closing the writer path is a
  precondition for acquiring at scale without compounding the problem.

The honest version of the trade is therefore not "identity versus acquisition."
It is: **fix the writer path first, then acquire freely.**

## 7. What "done" looks like

Not "improved." The month's work is falsifiable:

| Gate | Measured 2026-08-08 | Target |
|---|---|---|
| Books unreachable by import dedup | 20,454 (25.7%) | <1%, enforced by CI |
| New books created without `edition_key` | unenforced | 0, enforced by CI |
| work_id conflicts (one edition, two works) | 222 | single digits, remainder triaged |
| Live books that can see their siblings | 157 | 1,645 addressable, gated on full-quality keys |
| Dark-cluster pointers awaiting human triage | 1,993 | pre-classified to a reviewable set |

Execution plan and sequencing: **#3730**.

---

*Living doc — update it, or archive it under its last-accurate date. Numbers
carry the date they were measured because every one of them drifts; the argument
does not depend on any single figure, but a stale figure quoted as current is
exactly the failure this project keeps having.*

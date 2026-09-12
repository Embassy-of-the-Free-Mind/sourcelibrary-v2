# Field sprawl: three families consolidated, four guards built — 2026-08-13/18

`books` went **476 → 423 top-level fields**. Issue #3969. Everything below is merged and
applied to production unless marked otherwise.

## What shipped

| PR | what |
|---|---|
| #3983 | stripped 62 `tenant_id: 'default'` writes from 36 import scripts |
| #3984 | `scripts/lib/sweep-log.mjs` + `scripts/lib/book-docs.mjs` (whitelisted constructors) |
| #3986 | `hide_reason` → `hidden_reason` migration |
| #3993 | weekly `field-sprawl-watch.yml` |
| #3998 | `--max-nested` ceiling + `.claude/docs/invariants/field-sprawl.md` |
| #3999 | 50 import scripts adopted the constructors |
| #4000 | restore path stops carrying archive-only/retired fields (closed #3997) |
| #4001 | tracked `install-collection-validator.mjs` |
| #4008 | DB-side entities-sweep interlock (`entities-sweep-active.mjs`) |
| #4011 | **deleted 50 orphan fields** — 3,467 instances / 2,120 books |
| #4012 | **PR-time lint** `new-field-writes.mjs` + the grep trap documented |
| #4013 | field ceiling applies to the FULL count, not just the sample |
| #4014/#4016 | **deleted `pageCount`+`page_count`** — 13,328 books; ratchet closed |

Data applied: tenant cleanup (20,010 books + 4,156,480 pages), `hide_reason` (500),
orphans (3,467), page count (13,328). **Every removed value is preserved** as a
`sweep_log` row; `restore-orphan-book-fields.mjs --sweep <name>` replays them.

## The four prevention layers (strongest first)

1. **`$jsonSchema` validator** — installed in `warn` mode by Mayank (#4002). ⚠️ It was
   generated pre-deletion, so it still **permits the 50 deleted fields**. Needs one
   re-run; step 2 will now print **423**.
2. **PR-time lint** — `new-field-writes.mjs` fails any PR that `$set`s an unknown
   `books` field. Runs on every `pull_request` (~12s, no DB). Baseline:
   `scripts/lib/books-field-write-baseline.json` (24 accepted — shrink, never grow).
3. **Weekly watch** — `--max-fields 383 --max-nested 65 --forbid <54 retired names>`.
4. **Constructors** — `makeBookDoc`/`makePageDoc`, adopted in 50 import scripts.

`scripts/lib/books-known-fields.json` (423 fields, 54 retired) is the **single source of
truth** shared by the lint and the validator. Adding a field = edit it in the same PR.

## Corrections this session made — the durable part

- **`git grep -E "\bfield\b"` matches NOTHING here** (BSD ERE has no `\b`) and exits 1 —
  indistinguishable from "no references". Two reader surveys used it; re-checking 61
  candidates with `-P` found **six live fields** in their orphan lists. Documented in
  `invariants/field-sprawl.md`.
- **A reader hides in two places grep won't look**: cron-only (`photo` → Supabase →
  public thumbnails) and dynamic (`book[someVar]`).
- **Delete by proving reversibility, not by grepping harder.** Restore path first,
  canary round-trip byte-identical, then the full run. Used for both deletions.
- **`pageCount` held a stale PRE-SPLIT count on 186 books** (181 visible) — 90 vs 179,
  65 vs 129, with real page docs matching `pages_count`. Nothing read it; it was a
  loaded gun for the next query that reached for the plausible name.
- **Family 4's plan in the issue is a category error** (posted, not executed):
  `image_resolution_*` (1,987 docs, **0 artwork**, 303-page books) and
  `image_upgrade*`/`upgrade_source` (674 docs, **all artwork**) are two subsystems, not
  three spellings of one. And **`image_resolution_upgrade_source` holds a pixel width**
  (3888, 3504), not a source.
- **FT cards**: `reference_translations` has no `work_id`/translator/URL — raw MARC,
  cards are QID-keyed. The "126K records to promote" framing was wrong. What the data
  gives is **corroboration**: across 599 empty cards, 293 authors absent from LoC/ESTC,
  301 present-no-match, **3 for human review**. Recorded in non-rendered
  `search.catalogue_checks`; reader-visible text byte-identical.

## Next

- **Mayank**: re-run the validator install so it reflects 423 (#4002 has the corrected steps).
- **Family 4a**: consolidate the artwork upgrade pair — needs *value* normalization
  (`commons` vs `Commons alternate`), has live writers and a live reader. Full ladder.
- **Family 4b**: rename `image_resolution_upgrade_source` → `..._width`. Cheap, removes a trap.
- Then: language (18 fields); `books.tenant` (148 docs — ritman catalogue provenance
  misnamed, read by `/api/catalog` as 'location': rename, don't unset).
- **8 UNCERTAIN fields** from the audit (collection-name collisions) still unresolved.
- Error-mode flip: needs a quiet week of Atlas logs **and** `restored_from` added
  deliberately — no scan will ever contain it until a book is restored.

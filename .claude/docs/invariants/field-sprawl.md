# A sweep records a ROW, not a COLUMN

**Read this when:** Writing a maintenance sweep or import that updates `books` or `pages`; adding a field to any Mongo collection; changing `scripts/lib/book-docs.mjs`, `scripts/lib/sweep-log.mjs`, or `scripts/audit/field-sprawl.mjs`; or deciding whether the `books` schema validator should move to `error` mode.

*Written 2026-08-14 after #3969 families 1 and 2. See the issue for the full measurement history.*

---

## The rule

**A sweep records a ROW in a log collection keyed to the book, never a new FIELD on the book.**

Use `recordSweepAction(db, { sweep, book_id, action, detail })` from `scripts/lib/sweep-log.mjs`. It writes to `sweep_log`, stamped with the script name. Deliberately *not* `audit_log` — that one feeds the user-facing book history timeline, so writing there lets a bulk sweep actuate something readers see.

Build import documents with `makeBookDoc()` / `makePageDoc()` from `scripts/lib/book-docs.mjs`. Unknown keys throw; retired keys throw with the incident that retired them.

## Why this is correctness, not tidiness

**A query against a field that exists but is 2%-populated returns a confident, well-formed, WRONG answer.** It does not error and does not return null — it returns a small clean number that reads like a finding.

`books` reached **477 top-level fields with only 17 on ≥99% of documents**, ~140 written by a single sweep and then abandoned. Compare `books_warehouse`, the newest book collection: 129 fields, 25 core. The difference is not complexity; it is accretion.

## The lesson that cost the most: consolidation without enforcement is a treadmill

PR #2085 (2026-05-27) fully consolidated the tenant family — 45K books and 6.4M pages cleaned, writers stripped from `src/`, readers migrated, canonical field declared. It explicitly left the "one-shot historical import scripts" alone as already-run.

**Those scripts are the standard route for 429-prone sources and are reused constantly.** Within three months the field was back on 20,010 books and 4,156,480 pages (#3983 stripped 62 write sites across 36 scripts; the data was re-cleaned 2026-08-13/14).

So: **a cleanup is not done when the data is clean. It is done when something standing prevents the regrowth.** The four layers, strongest first:

1. **The DB refuses it.** `$jsonSchema` + `additionalProperties: false` on `books`. Installing it needs `dbAdmin`; the app credential is `readWriteAnyDatabase` and cannot run `collMod` — that privilege split is what makes it a boundary rather than a convention. Generate with `field-sprawl.mjs --emit-validator` (full scan only — a sampled validator rejects legitimate writes to ~80 rare fields).
2. **The easy path is the correct path.** The constructors above. One hand-rolled literal per script is why one bug shipped 62 times.
3. **CI notices drift.** `field-sprawl-watch.yml`, weekly. `--max-fields` ratchets DOWN after each consolidation; `--forbid` lists retired names and fails on reappearance.
4. **This document.** Weakest layer; the other three exist because it is.

## Adding a legitimate field

Adding a field is meant to be deliberate, not blocked. The path:

1. Add it to `BOOK_FIELDS` / `PAGE_FIELDS` in `scripts/lib/book-docs.mjs` (in its comment-grouped section).
2. If the validator is installed in `error` mode, re-emit and reinstall it — `field-sprawl.mjs --collection books --emit-validator <file>`, then `scripts/output/install-books-validator.mjs` with a dbAdmin credential. In `warn` mode nothing is required; the write succeeds and is logged.
3. Ask once whether it should be a field at all. If it records *what a job did*, it is a row (`sweep_log`). If it describes *what the book is*, it is a field.

## Traps that each cost a round

- **Gap ratio does not rank danger.** `deleted_reason` and `deletion_reason` are a perfect duplicate on the same 15 books.
- **Sampling undercounts fields by ~80 on `books`**, and a 200K-document `$sample` estimated a pages residue at 1.4M when the exact walk found **4.16M**. Anything deciding what to keep or delete must use exact counts.
- **The validator binds only the top level.** A free-form object field (`metadata`, 60 sub-keys; `translation_verification`, 48) is an unguarded floor below it. The watch carries `--max-nested` for this.
- **A restore path is a writer.** `POST /api/books/restore/[id]` spreads the drifted 260-field `deleted_books` shape back into `books`, which both re-pollutes retired fields and would 500 under `error` mode (#3997 — blocks the flip).
- **Hour-scale Mongo jobs belong on Hetzner.** A residential connection drops sustained TLS flows; the 4.16M-row walk died three times locally and completed there.

## Verifying

```
node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --collection books
node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --collection books --forbid tenant_id,hide_reason
```

Exit 1 means a ceiling was exceeded or a retired field came back. **The response is to find the writer and strip it — never to raise the ceiling.**

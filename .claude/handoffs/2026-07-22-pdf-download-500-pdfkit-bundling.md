# PDF download 500s — pdfkit bundling fix (#3317) — 2026-07-22

Follow-up feedback from the PDF-downloads reader (`feedback` row
`6a5f889370d2b7e1c209050f`, 2026-07-21): PDF option visible but every click
gave "Download failed. Please try again", signed in. Turned out **every
pdf-translation / pdf-facsimile download had 500ed on prod since #3285
shipped** — the feature only ever worked on dev machines.

## Root cause (from prod runtime logs)

`ENOENT /ROOT/node_modules/pdfkit/js/data/Helvetica.afm` thrown inside
`new PDFDocument()` (initFonts). Turbopack bundles pdfkit into the function
chunk and rewrites `__dirname` to a literal `/ROOT/...` path; the constructor
loads its built-in Helvetica metrics from `__dirname + '/data/...'` before any
registered custom font matters. Invisible locally because `node_modules`
physically exists there — tsc, tests, and local generation all pass.

Debug shortcut that found it fast:
`vercel logs --project sourcelibrary-v2 --level error --since 1h --json`
(the non-json table truncates messages; --json has full stacks).

## Shipped

**PR #3317** (merged, deployed via `npm run deploy:prod`, purged + warmed):
`serverExternalPackages: ['pdfkit']` in `next.config.ts` + belt-and-suspenders
`./node_modules/pdfkit/js/data/**` pin in `outputFileTracingIncludes` for both
download routes. The config comment there is the guard against removal.

## Verified on prod (signed-in browser session)

- `pdf-translation` → 200, 55KB `%PDF` (matches local render)
- `pdf-facsimile` (open-license book) → 200, 535KB `%PDF`
- `pdf-facsimile` (NDL-restricted book) → 403 license gate, working as designed

## Feedback loop closed

Row marked addressed + reply emailed (Derek approved in-session) via
PATCH `/api/feedback/[id]` with Bearer CRON_SECRET + browser UA
(`{"ok":true,"replied":true}`). If Jo replies it lands as a new feedback row.

## CLAUDE.md check

No new CLAUDE.md invariant PR'd: the regression point is guarded by the
next.config.ts comment, and the general lesson ("a dep that does runtime
`fs.readFileSync(__dirname...)` must be in serverExternalPackages, and a
user-facing feature isn't done until exercised on a REAL deployment") is
recorded in auto-memory (`lesson_pdfkit_bundling_enoent_prod_only`). Promote
to CLAUDE.md if a second fs-reading dependency bites.

## Open threads (unchanged from 2026-07-21 handoff)

- `pdf-ocr` / `pdf-both` Phase 2 (#3283) still deferred.
- 300-page facsimile PDF still not load-tested end-to-end on prod.
- Librarian conversation export feedback (`6a4a62119dd0c07db0cd51a8`) untriaged.

# Import cost & egress — where a bulk job should run

**Read this when:** writing or running any bulk import, archiving sweep, or
source enumeration; or choosing between `/api/import/*` and a `*-direct.mjs`
script.

---

## The rule

**A bulk import must not go through a Vercel function.** Use the direct-insert
pattern (`scripts/import/*-direct.mjs` + `insertBookIfNew()`), run from Hetzner.

The API routes exist for *interactive, one-off* imports — a curator adding a
book from the admin UI. They are the wrong tool for a wave of hundreds.

## Why, with the numbers

Vercel is **~$3,069/mo** (Nov 2025 – Jul 2026: **$11,089.37**), on Derek's
personal card. Function invocations are not incidental to that bill — the
`costs/infrastructure-costs.md` register carries a **~$1,000/mo** line for
crawler traffic whose entire cost was that each rejection ran in
`src/proxy.ts` and so "still cost an edge request **+ a function invocation**."
That is the same shape as a bulk import: work that does not need to be inside a
serverless function, billed as if it did.

An import route is the expensive case of that shape. `/api/import/gallica` and
`/api/import/ia` declare `maxDuration = 300`; importing a 300-page manuscript
holds a function for 30–90 seconds while it fetches a manifest and writes Mongo.
Neither of those needs Vercel. A 356-book wave is several hundred long-running
invocations bought for nothing.

**Measured 2026-08-31:** ~1,500 eGangotri books and 20 Gallica books were
imported through the routes in one session before anyone asked the question.

## What to do instead

`scripts/import/*-direct.mjs` — fetch the manifest on the machine running the
job, build the docs with `makeBookDoc()` / `makePageDoc()`, insert through
`insertBookIfNew()` (the direct importers' equivalent of the route's dedupe
gate; skip-and-record is the default, and a declined book leaves a row in
`dedup_skips`). Templates: `harvard-wuzhen-direct.mjs`,
`gallica-islamic-direct.mjs`.

The pattern already existed — `import-workflow.md` step 4 prescribes it — but it
was documented for the **datacenter-429** reason, so it read as a workaround for
awkward sources rather than the default for bulk. It is both.

## Where to run it: three different IPs, three different consequences

| runs from | egress | consequence |
|---|---|---|
| **Vercel** | datacenter | costs invocations; some sources 403/429 datacenter IPs (Harvard, Gallica, QDL) |
| **Derek's laptop** | his home ISP | free, residential IP passes source gates — but it spends *his* connection's quota and dies when the laptop sleeps |
| **Hetzner** | its own dedicated IP | free, always-on, survives overnight, separate quota from Derek's home IP |

**Hetzner is the default for any long job.** A sweep run from the laptop is
borrowing Derek's personal quota: on 2026-08-31 a Gallica enumeration burned his
residential IP's budget to the point that later queries 429'd, while the same
queries from Hetzner were unaffected. It also ties the job's life to a laptop lid.

Check where you are before starting a long job — `hostname` and
`curl -s https://api.ipify.org` — and say so in the report. "Where did this run"
is not a detail; it decides who pays and whether the source will answer.

## The exception

An import that genuinely needs a browser session or an interactive credential
cannot be a headless direct-insert. Those are rare; name the reason in the
script header when claiming it.

## Related

- `.claude/docs/import-workflow.md` — the enumerate → dedupe → import loop
- `~/sourcelibrary-ops/costs/infrastructure-costs.md` — the cost register (private repo)
- `.claude/docs/invariants/archive-fetch-failures.md` — 403/429 handling once a source blocks

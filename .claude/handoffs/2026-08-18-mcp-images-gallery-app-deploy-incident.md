# MCP images epic: in-chat gallery shipped + the deploy pipeline broke — 2026-08-12 → 08-18

One thread ("I want pics in my claude sessions") that became eleven merged PRs, one
infrastructure incident, and a working in-chat image gallery on every Claude surface.

## Shipped (all live on prod, all verified)

- **#3944 + #3955** — search_images filters actually filter (three leak lanes closed; the
  real one was the gallery search-enrichment lane ~line 510 replacing `total` with a
  corpus-wide count); `get_quote`/`get_quotes` `include_image` (page scan as inline MCP
  image block); `get_book` cover inline; audience → `['user','assistant']`.
- **#3960** — `include_thumbnail_base64` on search_images: data URIs for *programmatic*
  harnesses only (a chat model cannot re-emit hundreds of KB of base64 — measured limit).
- **#3971** — honest tool descriptions (clients collapse image blocks; don't claim
  "rendered above").
- **#3980 + #4017** — MCP Apps gallery viewer (`ui://source-library/gallery-viewer`,
  `text/html;profile=mcp-app`, `capabilities.extensions['io.modelcontextprotocol/ui']`).
  v1 hand-rolled the postMessage protocol and rendered a BLANK card: apps must use the
  official `@modelcontextprotocol/ext-apps` `App.connect()` — handlers only fire after its
  handshake and **the iframe is zero-height until the app reports size** (connect
  auto-installs that). Source: `scripts/mcp-app/gallery-app.js`; `build.mjs` bundles into
  the committed `src/lib/mcp-gallery-app.ts` (SDK is build-time only, `npm i --no-save`).
- **#4028 + #4031 + #4032** — card click-through. Three field-test rounds:
  (1) sandbox swallows `target=_blank`; (2) SDK's `openLink` takes `{url}` NOT `{uri}`
  (the hosted API doc says uri — the doc is wrong) and *resolves* `{isError}` instead of
  rejecting, so the wrong name failed silently; (3) `window.open` fallback in a sandboxed
  iframe degrades to a FILE DOWNLOAD — removed; failure now shows a copyable-link strip
  with the failure reason. **Confirmed working by Derek 2026-08-18** via the host's
  "Open external link" dialog.
- **Issues filed from the Aug-11 MCP feedback:** #3936 (fixed), #3937 (remote done; npm
  stdio package still text-only — the one open slice), #3938–#3943 (open), #3978 (closed,
  verified).

## The deploy incident (#4025 — OPEN, needs Derek)

- GitHub→Vercel integration builds fail/cancel since ~08-17 under the **frondular** scope
  (other dev's connected account; our CLI context cannot inspect it). Merge 4d819a8e's
  production deploy reported `failure` → **merges do not deploy** until the integration is
  fixed in the Vercel dashboard (Settings → Git). CLAUDE.md carries a dated SUSPENDED
  notice on the merge-deploys invariant (this PR).
- Recovery surfaced two more traps, both fixed:
  - **Vercel caps CLI uploads at 15,000 files**; untracked `scripts/output` (35K files,
    Suda harvest) blew it → `.vercelignore` (#4024).
  - The blanket ignore then **broke the next build**: `read/gilgamesh/page.tsx`
    build-imports `scripts/output/gilgamesh-tablets.json` (one of THREE tracked files
    there), and the first post-ignore build passed on Vercel's build cache, masking it.
    Negation patterns re-include the tracked trio (#4029). Ignoring is deletion-class:
    `git grep` inbound refs AND `git ls-files` the directory first.

## Suda backup note (data safety)

`scripts/output/sol-harvest` (33K files, 443MB) is the checkpointed SOL scrape; derived
dataset is already JSONL. Snapshot `sol-harvest-2026-08-18.tar.gz` added to Hetzner
`/root/backups/` (sha256 0a445935…, alongside 08-11/12/13). **An R2 copy was made and
immediately retracted**: the main R2 bucket is served in FULL via images.sourcelibrary.org
— no private prefix exists, and deleting an object is not enough (Cloudflare cache kept
serving it until a targeted purge). CC BY-NC-SA content must never touch that bucket.

## Open threads

- **#4025** Vercel integration (Derek, dashboard) — until closed: `npm run deploy:prod`
  after merges + verify the artifact on prod.
- **#3937** npm stdio MCP package has no image support (remote server is complete).
- Feedback rows from Aug-11: everything substantive shipped; marking them addressed
  auto-emails the submitter (Derek) — awaiting his yes/no.
- Upstream: if link-opening regresses, the gallery's failure strip prints the exact
  reason string for an anthropics/claude-ai-mcp report.

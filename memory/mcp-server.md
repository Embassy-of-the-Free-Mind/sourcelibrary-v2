# MCP Server

Source Library exposes its corpus over the Model Context Protocol. **There are two
servers and they are not the same thing** — most confusion here comes from treating
them as one.

| | Remote connector | npm package |
|---|---|---|
| Code | `src/app/api/mcp/route.ts` | `mcp-server/` (separate package at the repo root) |
| Reached at | `https://sourcelibrary.org/api/mcp` (Streamable HTTP, stateless) | installed locally, stdio |
| Used by | Claude.ai, Cowork, Claude Code, anything in the directory | local/dev clients |
| Version | `4.4.0` (in the route's `serverInfo`) | `4.5.0` (`mcp-server/package.json`) |
| Tools | 13 | 12 |

The two tool lists have **diverged** and that is not (currently) a bug to fix
blindly: the remote server carries `get_quotes` (batch) and `propose_collection`
which the package lacks, and the package carries `check_duplicate` — a
pre-import helper that has no business on a public unauthenticated surface — which
the remote server rightly lacks. Check the file you are actually changing.

## The listing, and the thing that must not happen again

The remote connector is **live in the Anthropic directory** since 2026-08-04, as a
**community connector**, at <https://claude.ai/directory/connectors/source-library>.
It is also in the official MCP registry as
`io.github.Embassy-of-the-Free-Mind/sourcelibrary`, driven by `server.json`. Those
are two independent listings that drift; see `.claude/docs/mcp-registry-publish.md`
for which one is ours to edit (only the registry — the directory listing is not
linked to a Claude organization, so its copy changes by replying to
`directory@mail.anthropic.com`).

It got there the hard way. It was listed in late April 2026, **silently de-listed
in mid-May with no notification**, and took until August to be republished. Two
defects were found and fixed in between, and both were invisible from inside the
codebase — the app worked perfectly with either present:

1. Tool titles lived only in the **deprecated `annotations.title`**, so the
   top-level `Tool.title` the directory validator reads was null (PR #2618).
2. The server **advertised OAuth** via `.well-known/*` but never enforced it —
   unauthenticated `initialize` returned 200 and tokens were never validated. That
   advertise-but-don't-enforce hybrid reads as broken OAuth (PR #2621).

**Guard:** `scripts/audit/mcp-directory-contract.mjs` (`npm run audit:mcp`) speaks
MCP to production and asserts both properties plus a committed tool manifest.
`npm run audit:mcp:self-test` runs the negative controls — every predicate against
the defect it exists to catch, including the exact 2026-05 title-under-annotations
shape. CI: `.github/workflows/mcp-directory-contract.yml` (self-test on PRs, live
audit nightly). **A Vercel preview URL is a valid target** — nothing keys on the
production hostname — so run `npm run audit:mcp -- <preview-url>` before merging
anything under `src/app/api/mcp/**` rather than finding out the next morning.

**What a change costs.** Neither listing snapshots the tools; both hold a pointer
to `/api/mcp`, and clients call `tools/list` on connect. So **adding a tool, adding
a parameter, or rewording a description ships on deploy — no re-publish, no
re-review.** Renaming or removing a tool is the one genuinely breaking move: it
silently breaks saved Claude Projects and any client holding the old name. Add and
deprecate instead; the manifest in
`scripts/audit/mcp-directory-contract.tools.json` fails CI if a name disappears.

## Notes

- **AUTH: none.** The remote connector is intentionally fully open — read-only
  public data, no per-user accounts. The OAuth routes were deleted 2026-06-20 and
  all four now 404. Don't re-add OAuth unless you actually want per-user gating,
  and if you do it must `401` + `WWW-Authenticate` to trigger the flow. (This
  file previously described the remote server as "with OAuth"; that has been
  wrong since June.)
- Write tools (`submit_feedback`, `share_findings`, `propose_collection`) are
  public unauthenticated writes into human-review queues, never rendered to other
  users unreviewed. Treat everything they receive as untrusted input.
- Read tools run against the production `bookstore` database; rate limiting and
  the Cloudflare/Vercel rules cover the route (`ai_bots_protection: block` globally
  with a WAF allow for `/api/mcp`).
- `/api/mcp` gets heavy crawler attention, and the directory listing increased it.
  `mcp_clients` (initialize handshakes, #3644) and `mcp_tool_calls` record who
  connects — **segment by `client_name` before quoting usage**, because a large
  share of handshakes are directory crawlers (`glimind-probe`, `mcpbeat`, `glama`,
  `MCPScoringEngine`, `census-probe`, …) rather than readers.

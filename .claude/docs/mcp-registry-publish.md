# Publishing Source Library to the Official MCP Registry

The Source Library MCP is listed in the **Official MCP Registry**
(`registry.modelcontextprotocol.io`). PulseMCP, Glama, and most other
third-party directories auto-ingest from the official registry, so this is
the single highest-leverage place to be listed.

## Two listings exist, and only one of them is ours to edit

Don't conflate them — they drift, and updating one does nothing to the other.

| | Official MCP Registry | Anthropic connector directory |
|---|---|---|
| Where | `registry.modelcontextprotocol.io` | <https://claude.ai/directory/connectors/source-library> |
| Since | 2026-04 (PR #1801) | published 2026-08-04, approved as a **community connector** 2026-07-31 |
| Source of truth | `server.json` in this repo | Anthropic's own record |
| How to change it | bump `version`, run `mcp-publisher publish` (below) | **reply to the `directory@mail.anthropic.com` thread** |

The directory listing is **not linked to a Claude organization**, which is why it
does not appear in any submission portal. Anthropic publish and maintain it;
nothing is required from us. To gain self-serve edit access, reply to that thread
with a Claude organization ID on a Team or Enterprise account — we don't have one
yet, so listing copy currently changes by email.

**Neither listing snapshots the tools.** Both store a pointer to
`https://sourcelibrary.org/api/mcp`, and clients call `tools/list` on connect. So
adding a tool, adding a parameter, or rewording a description goes live on deploy
with no re-publish and no re-review. **Renaming or removing an existing tool is
the one genuinely breaking change** — it silently breaks saved Claude Projects and
any client holding a tool name. Add-and-deprecate instead.

**But the directory record DOES snapshot the auth mode, and never re-probes.**
This is the one property where changing the server is not enough, and it cost us
the entire listing funnel for three weeks. The May submission declared "OAuth 2.0
+ PKCE + Dynamic Client Registration"; PR #2621 removed every OAuth endpoint on
2026-06-20; Anthropic's record still said OAuth. So the directory's "Connect to
Claude" button ran client registration against endpoints that 404'd and failed for
every visitor with *"Couldn't register with Source Library's sign-in service"*
(ref `ofid_6c896212e1e85390`) — while the identical URL added as a **custom
connector worked fine**, because that flow probes the live server instead of
trusting a record. That asymmetry is the tell: **directory fails + custom works =
their record disagrees with your server.**

Two rules follow:

1. **Before changing auth mode (or the endpoint URL), plan to change THEIR copy
   too.** For the directory that means replying on the approval thread —
   whose footer says "Replies go to the MCP Directory team and are read by a
   person." We did email `mcp-review@` on 2026-06-22 and got only the
   "high submission volume" auto-reply plus Intercom ticket #110826204; nobody
   read it, and the listing published six weeks later still declaring OAuth. **An
   auto-acked email is not a delivered correction.**
2. **Or make the server match their record.** PR #4302 (2026-08-28) restored a
   *working* OAuth flow — RFC 8414/9728 metadata, RFC 7591 registration at
   `/oauth/register` (the May-era version had none, which is precisely why DCR was
   the failing step), zero-click auto-granted authorize, PKCE token — while
   `initialize` still answers anonymous callers, so no existing client is gated.
   Fixing either copy resolves the mismatch; the mismatch itself is the bug.

`npm run audit:mcp` now asserts the whole flow works end to end *and* that
unauthenticated `initialize` still succeeds. Note it used to assert the
opposite — no OAuth advertisement — which was correct in June and actively wrong
after August: **when a guard encodes one side of an external contract, changing
the contract means inverting the guard.**

## What's published

The registry shows the contents of `server.json` at the repo root. Edit that
file to change the registry listing (title, description, version, URLs).

The namespace is `io.github.embassy-of-the-free-mind/sourcelibrary`, which is
tied to GitHub ownership of `Embassy-of-the-Free-Mind/sourcelibrary-v2`. The
publisher CLI authenticates against GitHub to prove ownership.

## How to update (one-time setup + each release)

### One-time setup

1. Download the `mcp-publisher` binary for your platform from
   <https://github.com/modelcontextprotocol/registry/releases>.
2. Run `mcp-publisher login github` once — opens a browser to authenticate.

### Each time `server.json` changes

```bash
# Bump the version in server.json first, then:
mcp-publisher publish
```

The CLI reads `server.json` from the current directory, verifies the GitHub
namespace, and posts to the registry. Listing updates within minutes.

## Verifying the listing

```bash
curl -s https://registry.modelcontextprotocol.io/v0/servers \
  | jq '.servers[] | select(.server.name=="io.github.embassy-of-the-free-mind/sourcelibrary")'
```

## When to bump `version`

Bump on any user-visible change to the MCP — new tools, changed tool
descriptions, behavior changes. Patch bumps for fixes, minor for additions,
major for breaking changes. The version in `server.json` should track the
version string in `src/app/api/mcp/route.ts` (the `version: '4.3.0'` field
returned to clients).

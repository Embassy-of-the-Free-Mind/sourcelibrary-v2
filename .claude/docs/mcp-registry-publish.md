# Publishing Source Library to the Official MCP Registry

The Source Library MCP is listed in the **Official MCP Registry**
(`registry.modelcontextprotocol.io`). PulseMCP, Glama, and most other
third-party directories auto-ingest from the official registry, so this is
the single highest-leverage place to be listed.

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

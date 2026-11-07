# Reader-origin box (#8384)

One Hetzner box that renders `/book/*` for a share of anonymous readers, behind the
`workers/web-origin` Cloudflare Worker, with Vercel as the live fallback. It serves
nothing else. Plan, stages and stop rules: #8384. Load numbers: #8374.

```
reader → Cloudflare → Worker ──(bucket/staff, GET, no session)──► box: Caddy :443 ─► next start ×4 (localhost:3101–3104) ─► Atlas (secondary), Supabase (anon)
                         └──(everything else, or box error/slow)──► Vercel (unchanged)
```

## Files

| File | What |
|---|---|
| `setup.sh` | One-time, idempotent: Node 22, Caddy, user `slweb`, `/srv/sl-web`, systemd units, Caddyfile, firewall |
| `firewall.sh` | ufw: 22 from `ADMIN_IPS` (main), 443 from Cloudflare's published ranges only |
| `make-env.mjs` | Writes `/etc/sl-web/env` from an allowlist, piped over ssh (no value is printed) |
| `deploy.sh` | `sl-web-deploy [sha]`: build the commit `release` points at and roll it out one process at a time |
| `sl-web-deploy.timer` | Runs the deploy every 5 min; a no-op unless `release` moved |
| `sl-web@.service`, `sl-web.slice` | `next start -p <port> -H localhost`, four instances, 5 GB each, 24 GB together |
| `Caddyfile` | Secret check, `/book/*` and `/_box/_next/static/*` only, Host pinned, client identity mapped |
| `guard.cjs` | Write guard preloaded into every Next process (from #8374) until the scoped Mongo user exists |

## Bring-up

```
scp -r infrastructure/web-box root@<box>:/root/web-box && ssh root@<box> bash /root/web-box/setup.sh
node --env-file=.env.production.local infrastructure/web-box/make-env.mjs | ssh root@<box> 'install -m 0640 -g slweb /dev/stdin /etc/sl-web/env'
ssh root@<box> 'umask 027; printf "SL_BOX_SECRET=%s\nSL_BOX_SITE=box1.sourcelibrary.org\nSL_BOX_TLS=/etc/sl-web/origin.pem /etc/sl-web/origin.key\n" "$(openssl rand -hex 32)" > /etc/sl-web/caddy.env; chgrp caddy /etc/sl-web/caddy.env'
ssh root@<box> 'sl-web-deploy && systemctl enable --now sl-web@3101 sl-web@3102 sl-web@3103 sl-web@3104 caddy sl-web-deploy.timer'
```

For the loopback-only stage-0 check, set `SL_BOX_SITE=box1.sourcelibrary.org:8443`,
`SL_BOX_TLS=internal` and `SL_BOX_BIND=127.0.0.1 ::1`.

## Why it is built this way

- **`-H localhost`**, not `127.0.0.1`: with the IP, every proxy rewrite (tenants, `/book/<id>`) became an HTTP proxy from the server to itself (#8374).
- **The build reads no production data.** `GUARD_MODE=build` refuses every socket except loopback. Book routes generate on demand (`generateStaticParams` returns `[]`), so the box needs no data at build time, and pages that do prerender data are never served here.
- **Assets under `/_box`** (trap 1): `SL_ASSET_PREFIX=/_box`, so box pages ask for `/_box/_next/static/*`, which the Worker routes here. A separate asset host would be blocked by the site's CSP (`'self'` only) and need CORS for fonts. Caddy serves those files from `/srv/sl-web/static`, which keeps every build of the last 7 days, so a tab holding the previous release's HTML still finds its chunks.
- **Client identity** (trap 2): the Worker sends `X-SL-Client-IP` / `X-SL-Client-Country`. Caddy turns them into `CF-Connecting-IP` / `CF-IPCountry` and `X-Forwarded-For`, and strips every client-writable identity header. The app reads only those, because `SL_BOX_CLIENT_IDENTITY=cloudflare`.
- **Same commit as production:** the timer builds `origin/release`, which is what Vercel builds (#7008). A build takes about 4–5 minutes here. Until it finishes, the box serves the previous release, as Vercel does during its build.

## Trap 3: the box's own Mongo user (needs Derek, or the Atlas owner)

Until it exists, the box uses the shared URI with `readPreference=secondary` and the
write guard refuses every write. The guard log shows what a reader render tries to write,
and those writes are what the role below allows. Measured on the box and in #8374:

| Collection | Write | From |
|---|---|---|
| `api_usage` | `insert`, `createIndex` (idempotent, once per process) | `src/lib/api-usage.ts` |
| `analytics_agent_requests` | `update` with upsert | `src/lib/agent-requests.ts` |

Proposed Atlas custom role `sl-web-reader` (Database Access → Custom Roles), on database `bookstore`:

| Resource | Actions |
|---|---|
| `bookstore` (all collections) | `find`, `listCollections`, `listIndexes` |
| `bookstore.api_usage` | `insert`, `createIndex` |
| `bookstore.analytics_agent_requests` | `find`, `insert`, `update` |

Nothing else: no `remove`, no `dropCollection`, no other database. Then make a user
`sl-web-1` with only that role, restricted to the box's address (157.180.78.233/32),
and pass its URI as `BOX_MONGODB_URI` to `make-env.mjs`. After that, `guard.cjs` can come
out of `NODE_OPTIONS`; keep its log for the first 48 hours to confirm the counts in
`api_usage` and `analytics_agent_requests` stay continuous (the plan's check).

## Needs Derek

1. A DNS record `box1.sourcelibrary.org` → 157.180.78.233, **proxied**.
2. A Cloudflare Origin CA certificate for `box1.sourcelibrary.org`, saved as `/etc/sl-web/origin.pem` / `origin.key` (mode 0640, group caddy).
3. Open 443 on the Hetzner cloud firewall `sl-web-fw` to Cloudflare's ranges (the host firewall already allows only those).
4. The Mongo user above.
5. The Worker deploy and its two secrets (`workers/web-origin/wrangler.toml`).

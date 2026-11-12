# Simulated-user scenarios (e2e-sims)

Playwright scenarios that act out a feature's user stories with several
invented people at once — one browser context each — and check what each of
them sees. They are written **before** the feature, from its spec.

**Red by design.** Until the feature exists every test fails, on purpose, with
`Study Rooms route /study-rooms returned 404 — not built yet?`. A test turning
green is the feature meeting a story.

| Folder | Feature | Spec |
|---|---|---|
| `study-rooms/` | Study Rooms (pixel-art library, group rooms, chat, proximity calls) | `docs/study-rooms/SPEC.md` |

## Not the nightly e2e

`playwright.config.ts` runs `./e2e` against production every night, read-only.
These sims are different: they sign in invented users and **write** (chat,
notes, reports). So they:

- have their own config, `e2e-sims/playwright.sims.config.ts`;
- are not run by any CI workflow, and are excluded from the root `tsconfig.json`
  (type-check them with `npx tsc -p e2e-sims`);
- refuse to start against production. `BASE_URL` must be `localhost` /
  `127.0.0.1`, or a host you name in `SIMS_ALLOW_HOST`.

**The server you point them at must use a non-production database and
Supabase/LiveKit project.** A local `next dev` started with the production env
file would write the sims' chat and notes into production. Use a scratch
database.

## Running

```bash
# 1. a local server on a scratch database, with a known AUTH_SECRET
AUTH_SECRET=local-sims-secret npm run dev

# 2. the sims, signing in with the same secret
BASE_URL=http://localhost:3000 SIMS_AUTH_SECRET=local-sims-secret npm run test:sims

# just list them (no server needed)
npm run test:sims -- --list

# one journey
BASE_URL=http://localhost:3000 SIMS_AUTH_SECRET=local-sims-secret npm run test:sims -- 03-chat
```

Sign-in: the site uses Auth.js JWT sessions, so `fixtures.ts` mints the same
session cookie a real sign-in would leave, for invented users with `.invalid`
emails. No email is sent. `SIMS_COOKIE_NAME` overrides the cookie name if the
server is not the usual `next dev` (http) or a https build.

Media: Chromium runs with `--use-fake-ui-for-media-stream` and
`--use-fake-device-for-media-stream`, so calls connect with a test pattern and
tone, and no permission prompt.

The sims assume a fresh database: some check first-visit behaviour (consent,
character picker), so re-running against the same data can fail those.

## Files (study-rooms)

- `contract.ts` — routes, `data-testid`s and data attributes. Build the UI to
  match, or change the contract in the same PR.
- `personas.ts` — the five invented composite personas and their devices.
- `fixtures.ts` — test sign-in, the `Reader` driver, the `cast(...)` fixture.
- `target.ts` — the never-production guard.
- `NN-*.spec.ts` — one file per journey group in the spec.

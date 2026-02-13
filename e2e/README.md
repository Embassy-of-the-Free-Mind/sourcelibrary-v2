# E2E Tests

Lightweight safety-net tests that verify critical paths on production after deploys. All tests are **read-only** — they navigate pages and check that content renders, nothing is modified.

## What's tested

| Spec | What it checks |
|------|---------------|
| `homepage` | Title, hero section, book cards, search input |
| `search` | Results for "Ficino", result links, Books/Index mode tabs |
| `book-detail` | Musaeum hermeticum title, language, pages grid, about section |
| `gallery` | Heading, image cards, search inputs |
| `page-reader` | Page loads without 404, page image renders |
| `navigation-flow` | Full click-through: homepage -> book -> page reader |

## Running locally

```bash
# Headless (same as CI)
npm run test:e2e

# With browser visible
npm run test:e2e:headed

# Interactive UI mode
npm run test:e2e:ui
```

Against a different URL (e.g. a Vercel preview deploy):
```bash
BASE_URL=https://sourcelibrary-v2-abc123.vercel.app npm run test:e2e
```

## CI schedule

- **Nightly at 6am UTC** via GitHub Actions
- **Manual trigger** from Actions tab (with optional `base_url` input)

## When tests fail

1. GitHub sends an email notification (if enabled in your [notification settings](https://github.com/settings/notifications))
2. The Actions run uploads two artifacts (kept 7 days):
   - **playwright-report/** — full HTML report, open `index.html` locally
   - **test-results/** — failure screenshots and traces
3. To debug a trace locally: `npx playwright show-trace test-results/.../trace.zip`

## Fixtures

Tests use hardcoded IDs for stable production data (`e2e/fixtures.ts`):
- **Book:** Musaeum hermeticum (`695203a5ab34727b1f041c53`) — flagship item, 882 pages
- **Page:** Page 1 of that book (`695203a6ab34727b1f041c54`)
- **Search:** "Ficino" — returns 2+ results

If Musaeum hermeticum is ever deleted (extremely unlikely), update `fixtures.ts` with another stable book.

## Design decisions

- **No `data-testid` attributes** — avoids modifying production components. Tests use headings, URL patterns, and ARIA roles.
- **Chromium only** — cross-browser would triple CI time for minimal benefit on a content site.
- **Generous timeouts** — production uses React Suspense streaming; cold starts can take 10-15s.
- **1 retry** — handles transient network/cold-start flakiness without masking real failures.

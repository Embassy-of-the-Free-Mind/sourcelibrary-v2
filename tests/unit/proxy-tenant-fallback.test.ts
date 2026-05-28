import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Tenant-shaped path safety net.
//
// The proxy used to keep an explicit NON_TENANT_PATHS allowlist and 404 any
// unknown top-level slug itself, so every new static route (src/app/<slug>/
// page.tsx) had to be added to that list or it would 307-redirect to / (we hit
// this with /q, /for-libraries, /dmca, /sponsors). That allowlist was deleted
// when the parallel routes tree was removed (commit 61603c89). Two things now
// hold the invariant instead, so no per-route allowlist is needed:
//
//   1. Static top-level routes win over the [tenant] dynamic segment by Next.js
//      routing precedence, so /sponsors always resolves to src/app/sponsors,
//      never the tenant catch-all.
//   2. Unknown tenant-shaped slugs are 404'd by the [tenant] dynamic route
//      calling notFound() when no tenant resolves from the request headers
//      (see the proxy comment at src/proxy.ts and src/app/[tenant]/page.tsx).
//
// This test guards (2): if the notFound() fallback is removed, unknown slugs
// would render an empty tenant shell with a 200 instead of 404ing.

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TENANT_PAGE = path.join(PROJECT_ROOT, 'src/app/[tenant]/page.tsx');

describe('[tenant] unknown-slug fallback', () => {
  it('the [tenant] dynamic route 404s when no tenant resolves', () => {
    const src = readFileSync(TENANT_PAGE, 'utf8');
    expect(
      src,
      'src/app/[tenant]/page.tsx must import notFound from next/navigation',
    ).toMatch(/import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*['"]next\/navigation['"]/);
    expect(
      src,
      'src/app/[tenant]/page.tsx must call notFound() as the unknown-tenant fallback',
    ).toMatch(/notFound\s*\(\s*\)/);
  });
});

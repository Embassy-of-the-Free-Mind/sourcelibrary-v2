# Authentication across subdomains

**Read this when:** Touching `src/lib/auth.ts`, session cookies, or per-tenant role checks.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

The NextAuth session cookie is set on `.sourcelibrary.org` (with the leading dot) in production, so signing in on `sourcelibrary.org` carries through to every tenant subdomain (`bph.sourcelibrary.org` today, `kloss/jung/...` later) and vice versa. Gated on `VERCEL_ENV === 'production'` — Vercel previews and localhost stay host-scoped.

**Identity shares, permissions do not.** Role checks still run via `memberships` collection lookups per tenant (`getTenantMembershipRole` in `src/lib/auth-helpers.ts`). A user signed in on the parent site does not inherit any tenant role just by visiting a subdomain; the `withAuth(handler, { minRole })` wrapper (and role-specific shorthands like `withEditorAuth`, `withAdminAuth`) continues to enforce per-tenant gates.

**CSRF token stays per-host** (`__Host-` prefix forbids the `domain` attribute, and each subdomain hits its own `/api/auth/*` routes).

Source: `src/lib/auth.ts` (cookies block). See `.claude/docs/auth-tenant-cookies.md` for the full rationale and rollback notes.

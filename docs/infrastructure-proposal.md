# Source Library Infrastructure Proposal

**Date:** February 2026
**Status:** Draft for team review

---

## Summary

Three infrastructure initiatives to prepare Source Library for scale: moving image storage to Cloudflare R2 (zero egress costs), locking down API routes and adding API keys, and a brief assessment of IIIF. These are independent and can be executed in any order.

---

## 1. Move Image Storage from Vercel Blob to Cloudflare R2

### Problem

We store ~190K page images (~6GB) in Vercel Blob. Vercel Blob charges $50/TB for egress bandwidth. If an AI company starts crawling page images or traffic grows significantly, costs spike fast.

### Cost comparison

| Monthly traffic | Vercel Blob | Cloudflare R2 |
|----------------|-------------|---------------|
| 10 TB served | ~$523 | ~$15 |
| 100 TB served | ~$5,023 | ~$15 |
| 500 TB served | ~$25,023 | ~$15 |

R2 has **zero egress fees**. Storage is $0.015/GB/month. This is a 99% cost reduction at scale.

### Approach

**Dual-write migration** -- no downtime, no big-bang cutover:

1. Create R2 bucket with custom domain (`images.sourcelibrary.org`)
2. Build a storage abstraction (`src/lib/storage.ts`) that replaces all `@vercel/blob` imports
3. New uploads go to R2, with Vercel Blob as a backup during transition
4. Background script copies existing ~190K blobs to R2 and rewrites MongoDB URLs
5. Once verified, remove Vercel Blob dependency

### What changes

- **8 files** swap `import { put } from '@vercel/blob'` to `import { storagePut } from '@/lib/storage'`
- Image proxy allowlist gets `images.sourcelibrary.org` added
- One new dependency: `@aws-sdk/client-s3` (R2 uses S3-compatible API; we already have `@aws-sdk/client-sqs`)

### What doesn't change

- `getPageImageUrl()` fallback chain -- untouched
- Frontend components -- they read URLs from MongoDB, work automatically once URLs point to R2
- Lambda workers -- they fetch images via HTTP, R2 public URLs work the same way
- IIIF manifests -- reference whatever URL is in `archived_photo`
- `photo_original` -- never touched, provenance preserved

### Risks

| Risk | Mitigation |
|------|-----------|
| CDN caches stale image after overwrite | 1-day cache TTL (overwrites are rare) |
| R2 read operations at extreme scale ($0.36/M reads) | Cloudflare bot protection + rate limiting |
| DNS must be on Cloudflare for custom domain | Migration step if not already there |

### Rollback

During dual-write both backends have copies. Migration script logs all URL changes -- a rollback script can restore old URLs. Vercel Blob data is never deleted.

### Effort

~3-5 days of implementation + 1-2 hours for the background migration to run.

---

## 2. API Keys + Access Tiers

### Problem

All 195 API routes are completely open. There is no middleware, no rate limiting, and no API key system. This includes:

- **Admin routes** that can delete books, trigger expensive AI processing, and manage imports
- **Processing routes** that spend Gemini API credits
- **Import routes** that create books from external sources

NextAuth (Google + GitHub OAuth) exists in the codebase but is not enforced on any route. Anyone who finds the API can call any endpoint.

### Architecture

**MongoDB-based API keys** -- no external SaaS dependency. One `api_keys` collection, in-memory rate limiting.

A single `src/middleware.ts` handles all auth decisions using NextAuth v5's middleware wrapper (decodes JWT session cookie at the edge):

```
1. /api/cron/* → skip (Vercel auto-protects)
2. /api/auth/* → skip (NextAuth handles itself)
3. Admin/write route + no session → 401
4. x-api-key header present → validate key, apply tier rate limits
5. No key, no session → apply anonymous rate limits (30 req/min)
```

**Key format:** `sl_live_` + 32 hex chars. Stored as SHA-256 hash (never plaintext).

### Route classification

| Category | Examples | Auth |
|----------|---------|------|
| **Admin/Write** | `/api/admin/*`, `/api/import/*`, `DELETE /api/books/*`, `/api/process/*`, batch OCR/translate | NextAuth session required |
| **Public Read** | `GET /api/books/*`, `/api/search/*`, `/api/gallery`, `/api/iiif/*` | None (rate-limited) |
| **Community Write** | `/api/likes`, `/api/highlights`, `/api/annotations`, `/api/track` | None (strict rate limits) |
| **Cron** | `/api/cron/*` | Vercel auto-protected |

### Access tiers

| Tier | Rate (req/min) | Daily | How to get |
|------|---------------|-------|-----------|
| Anonymous | 30 | 1,000 | No key needed |
| Free | 60 | 5,000 | Register at `/developers/keys` |
| Academic | 120 | 20,000 | Institutional email |
| Commercial | 300 | 100,000 | Contact us (Stripe billing later) |

### What won't break

| Caller | Why it's fine |
|--------|--------------|
| Browser visitors (not logged in) | Only hit public read routes, allowed with anonymous rate limits |
| Admins (logged in) | Session cookie passes through, admin routes work |
| Lambda workers | Talk directly to MongoDB, never through the API |
| Vercel crons | Skipped by middleware, auto-protected by Vercel |
| SSR data fetching | Pages call `getDb()` directly, not through API routes |
| MCP server | Hits public read routes, works without key |

### Phased rollout

| Phase | What | Effort | Urgency |
|-------|------|--------|---------|
| 1: Admin auth | `src/middleware.ts` + route classification | 1-2 days | **Urgent** |
| 2: API keys | `api_keys` collection, key management, rate limiter | 3-5 days | Medium |
| 3: Self-service | `/developers/keys` page, docs update | 2-3 days | Low |

Phase 1 ships as an independent PR. The site works exactly the same for visitors -- only unauthenticated calls to admin/write routes get blocked.

### New files

- `src/middleware.ts` -- central auth/rate-limit logic
- `src/lib/api-keys.ts` -- key generation, validation, usage tracking
- `src/lib/rate-limiter.ts` -- in-memory sliding window
- `src/lib/route-classification.ts` -- which routes need what auth
- `src/lib/types/api-key.ts` -- TypeScript types

### Existing files modified

- `src/lib/auth.ts` -- add admin role to session callback
- `src/app/api/admin/ensure-indexes/route.ts` -- add `api_keys` and `api_key_usage` indexes
- `src/app/developers/page.tsx` -- update API docs with auth info
- `src/lib/api-client/client.ts` -- send `x-api-key` header when configured (already has auth token plumbing)

---

## 3. IIIF Assessment

### Current state

We already serve **IIIF Presentation API 3.0 manifests** at `/api/iiif/[id]/manifest`. These are well-built: proper metadata, annotation references for OCR/translation, image service declarations for IA/Gallica/MDZ, table of contents, licensing. A researcher can paste the manifest URL into Mirador and it works for books from external IIIF sources.

### What we're missing

A **IIIF Image API** -- the part that lets viewers dynamically resize/crop images we host ourselves (Vercel Blob / future R2 images). Without it, viewers fall back to the static full-size image for self-hosted content.

### Is it worth building?

**Not now.** The honest assessment:

- **Audience overlap is small.** Maybe 5,000-15,000 DH researchers use IIIF viewers worldwide. The subset interested in Western esotericism is very small. Our audience wants readable translations and searchable text.
- **AI companies don't use IIIF.** They want bulk downloads, not dynamic image parameters.
- **Google Scholar doesn't index IIIF manifests.** Discovery comes from HTML meta tags, DOIs, and SEO.
- **Cross-institutional comparison** (IIIF's killer feature) is weak for printed books. It matters for unique manuscripts.
- **The DH community itself** acknowledges IIIF is overkill for small projects (hence tools like Wax for static IIIF).

### What would actually help more

- Google Scholar meta tags on edition pages (a few hours, high discovery impact)
- Schema.org JSON-LD structured data (a few hours, helps SEO)
- Better citation export (BibTeX, RIS)
- More books processed (the actual mission)

### If we ever need it

The "good enough" version (Level 0 `info.json` responses) takes about a day. Full dynamic Image API (Level 1, using Sharp which we already have) takes 1-2 weeks. Neither is urgent. Our existing manifests are a solid foundation that signals "serious digital library" without the maintenance burden.

---

## Future Considerations

These came up in research but don't need action now:

### Bulk data distribution (for AI companies)
- **S3 requester-pays bucket** -- they download, they pay egress. What arXiv does.
- **Academic Torrents** -- free P2P distribution for the full corpus
- **IIIF Collection manifests** -- standards-compliant harvesting for DH researchers
- Wait until there's actual demand.

### Multi-tenancy (partner institutions)
- Add `tenant_id` to shared MongoDB collections when a real partner appears
- Per-tenant R2 prefixes for storage isolation
- Don't build until concrete.

### Recommended sequencing

1. **API keys Phase 1** (admin auth) -- urgent, all routes are open
2. **R2 migration** -- highest cost impact, blocks on Cloudflare setup
3. **API keys Phase 2-3** (keys + self-service) -- before publicizing the API
4. **SEO / discoverability** -- quick wins (Scholar tags, Schema.org)
5. **Bulk data access** -- when AI companies come knocking
6. **IIIF Image API** -- if/when a grant or partnership requires it

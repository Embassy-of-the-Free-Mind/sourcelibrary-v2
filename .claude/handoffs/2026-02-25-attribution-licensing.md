# Attribution Branding & License Unification

**Date:** 2026-02-25
**Commit:** ce41190
**Deployed:** Yes (Vercel prod)

## What Changed

### 1. Attribution Line: "Produced by SourceLibrary.org in Amsterdam, 2026"

Added to every output surface where a user or machine encounters Source Library content:

| Surface | File | Before |
|---------|------|--------|
| Reader footer | `TranslationEditor.tsx:1290` | "CC0 Public Domain" (wrong) |
| Plain text API | `api/books/[id]/text/route.ts:100` | No producer line |
| TXT download header | `api/books/[id]/download/route.ts:66` | "AI assistance and human review" |
| EPUB title page | `download/route.ts:364` | "Source Library, a project of the Ancient Wisdom Trust" |
| EPUB colophon | `download/route.ts:410` | Long paragraph about Source Library |
| Loeb parallel EPUB title | `download/route.ts:696` | "Source Library · [date]" |
| Scholarly EPUB copyright | `download/route.ts:1585` | "Source Library is a project..." |
| Scholarly EPUB colophon | `download/route.ts:1766` | Long paragraph |

### 2. License Unification: CC BY-SA 4.0

All references to "CC BY 4.0" in Source Library's own translation outputs changed to "CC BY-SA 4.0" (ShareAlike). This includes:

- TXT download headers
- All EPUB front matter and colophons (standard, Loeb, facsimile, scholarly)
- OPF `<dc:rights>` metadata in Loeb, facsimile, and scholarly EPUBs
- SPDX fallback identifiers changed from `CC-BY-4.0` to `CC-BY-SA-4.0`

**Not changed** (correctly left as CC BY 4.0): Source image licenses from external libraries (Gallica, MDZ, etc.), edition license picker options in the UI, Zenodo license mapping. These describe other parties' licenses, not ours.

### 3. AI Crawler Blocking (previous session, same commit)

- `robots.ts` — blocks GPTBot, ChatGPT-User, CCBot, Google-Extended, anthropic-ai, Claude-Web, Bytespider, and others
- `/terms` page — rewritten with tiered licensing: free for individuals/researchers, API license required for companies with 5M+ users
- `llms.txt` — updated with licensing terms
- API routes (`/api/search`, `/api/books/[id]/quote`, `/api/books/[id]/text`) — include `license` object in JSON responses

### 4. Architecture Notes

The existing SSR/CSR split is favorable for this licensing model:
- **Book overview pages** (`/book/[id]`) are server-rendered — crawlers see metadata, summaries, Schema.org JSON-LD, Google Scholar meta tags
- **Page reader** (`/book/[id]/page/[pageId]`) is 100% client-rendered — crawlers get an empty shell, can't see translation text
- **API** (`/api/books/[id]/text`) returns full text with license headers — this is the sanctioned machine access channel

## Realistic Assessment

The attribution line is a brand stamp, not a technical protection. It works like Google Books' "Digitized by Google" — not because it's enforceable, but because it's persistent. The text travels with the content. The CC BY-SA 4.0 license legally requires attribution, so embedding it everywhere makes compliance easy and stripping obvious.

The robots.txt and tiered licensing are good-faith signals. They won't stop determined scrapers but establish legal standing if needed.

## Files Modified

- `src/components/pipeline/TranslationEditor.tsx` — reader footer
- `src/app/api/books/[id]/text/route.ts` — plain text API header + JSON license object
- `src/app/api/books/[id]/download/route.ts` — all download formats (TXT, EPUB x5)
- `src/app/api/books/[id]/quote/route.ts` — license object (previous session)
- `src/app/api/search/route.ts` — license object (previous session)
- `src/app/terms/page.tsx` — full rewrite (previous session)
- `src/app/robots.ts` — AI crawler blocking (previous session)
- `public/llms.txt` — licensing terms (previous session)

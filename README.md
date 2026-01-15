# Source Library v2

A Next.js application for digitizing and translating historical texts. Built for the Embassy of the Free Mind.

## Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: MongoDB Atlas
- **AI**: Google Gemini for OCR and Translation
- **Storage**: Vercel Blob for images
- **Deployment**: Vercel

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Architecture

### Image System

All page images go through `/api/image` for consistent sizing and cropping:

| Tier | Size | Quality | Use Case |
|------|------|---------|----------|
| Thumbnail | 400px | 70% | Grid views, page navigation |
| Display | 1200px | 80% | Main reading view |
| Full | 2400px | 90% | Magnifier, fullscreen |

### Split Pages

Books with two-page spreads can be split. Each page stores:
- `crop.xStart` and `crop.xEnd` (0-1000 scale)
- `cropped_photo` (optional pre-generated Vercel Blob URL)

Cropping happens on-demand via Sharp. OCR automatically crops inline and saves the result for future use.

### Processing Pipeline

1. **Import** - Upload images or import from Internet Archive
2. **Split** - Detect and split two-page spreads (ML or manual)
3. **OCR** - Extract text using Gemini Vision
4. **Translate** - Translate to English using Gemini
5. **Summarize** - Generate summaries and key themes

## Key Directories

```
src/
├── app/              # All routes, pages, and API endpoints
│   ├── api/          # API routes
│   ├── book/         # Book pages (detail, read, pipeline)
│   └── page.tsx      # Homepage
├── components/       # Reusable React components
├── hooks/            # Reusable React hooks for component logic
└── lib/              # Business Logic, Utilities (mongodb, ai, types), and Services
```

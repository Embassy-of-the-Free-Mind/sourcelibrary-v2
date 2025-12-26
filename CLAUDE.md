# Claude Code Guidelines for Source Library

## Security Rules - CRITICAL

### Never Read Secret Files
- **NEVER** read `.env`, `.env.local`, `.env.prod`, `.env.vercel`, or any `.env*` files
- **NEVER** read files that may contain credentials, API keys, or passwords
- If you need to know what environment variables exist, ask the user to list the variable NAMES only (not values)

### Never Embed Secrets in Code
- **NEVER** use `process.env.VAR || 'hardcoded-fallback'` patterns with actual secret values
- **NEVER** copy credentials, API keys, or passwords from environment files into source code
- If a script needs database access, it MUST read from environment variables with NO fallback, like:
  ```javascript
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  ```

### Before Committing
- Review any new scripts in `/scripts` directory for hardcoded credentials
- Ensure no secrets appear in code, even as "fallback" values
- When in doubt, ask the user to review before committing

## Project Context

This is Source Library v2, a Next.js application for digitizing and translating historical texts.

- **Stack**: Next.js 14, MongoDB, Gemini AI for OCR/translation
- **Database**: MongoDB Atlas (credentials in .env.local - DO NOT READ)
- **Deployment**: Vercel

## Image System

### 3-Tier Quality System

All page images go through `/api/image` for consistent sizing and cropping:

| Tier | Size | Quality | Use Case |
|------|------|---------|----------|
| **Thumbnail** | 400px | 70% | Grid views, page navigation |
| **Display** | 1200px | 80% | Main reading view |
| **Full** | 2400px | 90% | Magnifier, fullscreen |

### Split Pages (Cropping)

When a page is split (e.g., a two-page spread), it stores:
- `crop.xStart` and `crop.xEnd` (0-1000 scale)
- Optionally `cropped_photo` (pre-generated Vercel Blob URL)

**Image Display:**
- Uses `/api/image?url=...&cx=...&cw=...` to crop on-demand
- Pre-generated `cropped_photo` used when available (faster)

**OCR Processing:**
- If `cropped_photo` exists → uses it directly
- If only crop settings → crops inline with Sharp, saves to Blob in background
- No manual "Generate Cropped Images" step required

### Key Files

- `/api/image/route.ts` - Sharp-based image resizing and cropping
- `TranslationEditor.tsx` - `getImageUrl()` function for 3-tier URLs
- `/api/process/batch-ocr/route.ts` - Inline cropping for OCR
- `/api/jobs/[id]/process/route.ts` - Pipeline job processor with cropping

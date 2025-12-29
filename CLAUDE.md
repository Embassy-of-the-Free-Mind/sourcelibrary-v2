# Claude Code Guidelines for Source Library

## Data Protection Rules - CRITICAL

### NEVER Delete Source Material Without Explicit Confirmation
- **NEVER** call DELETE endpoints on books, pages, or any source material without the user explicitly saying "delete [specific item]"
- **NEVER** batch delete multiple items - always list them first and ask for confirmation
- If cleaning up data, **ALWAYS** list the specific items first and wait for user to say "yes, delete those"
- When in doubt, **DO NOT DELETE** - ask the user first
- The `deleted_books` collection contains recoverable items - check there before assuming data is lost
- To restore: `POST /api/books/restore/[id]`
- To list deleted: `GET /api/books/deleted`

### Assume All Books Are Valuable
- Books without IA identifiers may be from other catalogs (EFM, manuscripts, etc.)
- "Modern" looking titles may still be valuable historical sources
- When auditing the library, ONLY flag items - never delete without explicit approval

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

## QA Audit Workflow

When acting as Quality Management Assistant:

1. **Audit Process:**
   - Check 20-30 pages per book for translation quality
   - Compare catalog metadata against title page OCR
   - Align to USTC when possible
   - Make brief reports, no changes to data

2. **Reporting:**
   - Save all reports to `QAreport.md` with date/time
   - Use consistent table format for metadata comparison
   - Note translation quality percentage and any issues

3. **Continuous Work:**
   - After completing a batch of audits, notify user and **continue with the next batch**
   - Don't stop and wait - keep auditing until user says to stop
   - Update todo list as you progress

## Project Context

This is Source Library v2, a Next.js application for digitizing and translating historical texts.

- **Stack**: Next.js 14, MongoDB, Gemini AI for OCR/translation
- **Database**: MongoDB Atlas (credentials in .env.local - DO NOT READ)
- **Deployment**: Vercel

## Gemini Models

Use the latest available Gemini models. As of December 2025:

**Gemini 3 (Latest)**
- `gemini-3-pro-preview` - Best multimodal understanding
- `gemini-3-flash-preview` - Balanced speed/scale/intelligence (use for summarization)

**Gemini 2.5**
- `gemini-2.5-flash` - Stable flash model
- `gemini-2.5-pro` - Stable pro model

**Current Usage**
- Summary/Index generation: `gemini-3-flash-preview`
- OCR: Check batch-ocr route
- Translation: Check translate route

Reference: https://ai.google.dev/gemini-api/docs/models

# Accessibility track: audit → lang on every text surface → one-document reader (2026-09-25/26)

**Read this when:** picking up #5115 (accessibility for visually impaired readers), touching
`/book/[id]/read`, `src/lib/language-code.ts`, or verifying anything on a preview host.

## State at end of session

Three PRs merged and verified on production with real headless Chrome:

| PR | What | Verified live |
|---|---|---|
| #5116 | `languageToBcp47()` / `titleLang()`; `NotesRenderer` and `CollectionBookCard` set `lang`; `/book/[id]/read` one-document route; `private, no-store` CDN rule for it | Latin pane effective language `la` (was `en`); route renders parts, `?text=original`, chapters h2, pages h3; rtl on Arabic |
| #5118 | Untranslated page shows its ORIGINAL as the text, not "Not yet translated" with the words folded | 57/60 pages of an English book |
| #5162 | "Read as one document" button in `PagesGrid` beside Overview (`readHref`), en + es labels, NOT localePath'd | present on `/book/…` and `/es/book/…` |

Issue #5115 carries the audit, the remaining list, and the live verification record.
Memory: `project_accessibility_audit_2026_09_25.md`.

## Next, in order (from the issue)

1. **A real VoiceOver session** on the Fludd page and on `/read` — nothing has been *heard* yet.
   Another session's audio prototype was rejected on sight the same day; start from listening.
2. Reader structure: translation pane `h2`, `h1`, the filmstrip's one-button-per-page out of the
   tab order, `aria-hidden` on the AA / ⚠ glyphs.
3. Zero-width provenance mark reaches the accessibility tree — verify with NVDA + braille first.
4. `?text=plain` on `/read` using the existing per-page `summary` / `modernized` fields
   (Derek: "simplification is a form of accessibility"; the layer exists, it has no surface).
5. `/es/book/<id>/read` twin — and note `/es/book/<id>/overview` 404s today too (the Overview
   button IS localePath'd; `PagesGrid` one-liner, filed on #5115).

## Lessons (judgment, not mechanism — hence prose)

- **Verify a UI change by rendering the page, not by finding the string in the file.** The first
  book-page link was added to a layout branch the page never renders; `git show` said it was
  there, the browser said it was not. Cost: one extra PR.
- **The walk script measured the wrong element and reported the fix as absent.** `ReaderProse`
  wraps `NotesRenderer`; the `lang` sits on the INNER `.prose-manuscript`. When an instrument says
  a fix did nothing, check what the instrument points at before doubting the fix.
- **Preview hosts 403 all anonymous book content, and Cloudflare 403s curl with a spoofed browser
  UA.** Live checks need real Chrome (`scratchpad/prod-read-walk.mjs`, `a11y-walk.mjs`) or a
  `CRON_SECRET` bearer. Of the crawler UAs, only PerplexityBot / YouBot / Applebot-Extended reach
  the app; ClaudeBot / GPTBot / Bytespider are edge-blocked, so the in-app clamp cannot be
  exercised with them.
- **The guard that earned its keep:** `dynamic-routes-not-edge-cached.test.ts` caught the new
  `force-dynamic` route sitting under the `/book/:path*` day-long CDN rule. No doc change needed —
  the check already exists; this is what a check looks like when it works.

## Not done / out of scope

Lighthouse contrast chips (token-level), the "Recently translated" slider cards (component lacks
`language`), read-aloud/TTS (a feature, not a defect).

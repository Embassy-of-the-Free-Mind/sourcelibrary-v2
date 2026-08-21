# `prompts/` — pipeline prompt archive

This directory snapshots the prompts used by Source Library's AI pipeline, organized by phase. **Most files here are reference snapshots, not the live source of truth.** Production prompts live alongside the code that calls them — **except the OCR prompt, which is read at runtime from the Mongo `prompts` collection** (`type:'ocr', is_default:true`, currently v15), so the files under `ocr/` are snapshots that can and do lag the live prompt; the archive exists so collaborators and external researchers can read what the pipeline asks the model without cloning the worker code.

## What's in here

```
prompts/
├── book-index/              # generate keyword/subject index from full text
├── chapter-extraction/      # detect chapter/part boundaries
├── collection-relevance/    # is this book in scope for collection X?
├── cover-selection/         # pick the canonical cover page
├── faceted-tagging/         # apply structured tag facets
├── image-extraction/        # detect + score illustrations on a page
├── metadata-enrichment/     # fill in missing title/author/year/lang from text
├── modernization/           # render historical text in modern spelling
├── ocr/                     # transcribe page image to text
├── quality-scoring/         # rate book on historical_significance + 3 others
├── split-detection/         # is this a two-page spread that needs splitting?
├── summary/                 # produce reader-facing summary
├── translation/             # translate OCR text to English
└── transliteration/         # romanize Hebrew/Arabic/Tibetan/etc
```

## Versioning convention

Files are named `<prompt-name>-v<N>.md`. Higher `N` = newer. Prompts ending in `-code.md` are the code-shipped variants (escaped for JS string literals); the plain version is the human-readable text. Most directories have multiple versions because we A/B tested prompt revisions.

Files have YAML frontmatter:
```yaml
---
name: "Standard OCR"
type: pipeline
version: 10
source: src/lib/ocr.ts            # where the live prompt is defined
date: 2026-04-12
status: ACTIVE | ARCHIVED         # ACTIVE = matches production at write time
description: "..."
---
```

## Live source of truth

When in doubt, **read the code, not the archive**. The archive lags. Examples of recent drift:

| Phase | Archived prompt | Live source (canonical) |
|---|---|---|
| image-extraction | `prompts/image-extraction/image-extraction-v0.md` (status: ARCHIVED) | `scripts/workers/image-extract-worker.mjs:117` + `scripts/workers/pipeline-orchestrator.mjs:1836` + `src/lib/image-extraction.ts` |
| OCR | many `standard-ocr-v*.md` variants | `src/lib/prompts.ts` (active prompt resolution + DB-stored variants) |
| translation | many `standard-translation-v*.md` variants | DB-stored, resolved via `getTranslationPrompt()` in `src/lib/prompts.ts` |

For OCR and translation specifically: the live prompt is in the `prompts` MongoDB collection (not the filesystem). The worker queries the DB for `{ type: 'ocr'/'translation', is_default: true }` and uses whatever is current. The `.md` files in this directory are snapshots of past versions exported for reference.

## When to update this directory

- **Adding a new pipeline phase:** create `prompts/<phase>/<phase>-v0.md` with frontmatter pointing to the source file.
- **Promoting a new prompt version:** bump the version number, copy the new prompt text, mark the previous version `status: ARCHIVED`.
- **Discovering an archive is stale:** add the `status: ARCHIVED` banner + a link to the live source, like the one at the top of `image-extraction/image-extraction-v0.md`.

Don't expect every prompt change to land here — the archive is best-effort. Code is authoritative.

## Related docs

- `.claude/docs/automated-image-quality-system.md` — design of the gallery_quality / scan_quality split
- `.claude/docs/system-map.md` — pipeline overview, where each prompt fires
- `src/lib/prompts.ts` — runtime prompt resolution (DB lookup, version pinning, custom-prompt override)

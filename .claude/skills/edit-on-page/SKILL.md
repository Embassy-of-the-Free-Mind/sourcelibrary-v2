---
name: edit-on-page
description: Derek edits a page's copy directly in the browser (currently /vision?edit), then pastes back the exported JSON with his comments. Use when he says "let me edit it directly on the page", "I'll edit on the page", pastes a vision-content JSON, or asks to leave comments on the page. Applies his edits to the branch verbatim, fixes only typos, checks figures against measured sources, and answers every comment.
---

# Edit on page

PRIOR ART: `.claude/skills/curate-collection-editor.md` — that one drives the collection editor
API with a key; this is the no-backend flow where the reviewer edits a static page in the browser
and hands back JSON. `src/app/vision/content.ts` header documents the mechanism.

## What exists

- `/vision?edit` renders every text field as `contentEditable` (`src/app/vision/VisionView.tsx`).
  Nothing is saved server-side. The toolbar has **Copy JSON**, **Paste JSON**, **Add comment**,
  **Reset**.
- **Add comment**: click into a paragraph, press Add comment, type, Save. Comments are listed in
  the toolbar and exported in the JSON as `_comments: [{ path, excerpt, text }]`. They are notes
  for you, never rendered.
- Only `/vision` has this today. Adding it to another page means the same `F()` renderer pattern
  and a `content.ts` single source of truth.

## Flow

1. **Hand Derek the right URL.** If a PR is open, the Vercel **preview** URL + `?edit` (so he edits
   the branch's text, not the stale live page). Get it with
   `npx vercel inspect <deployment-id>` from the PR's Vercel check. Tell him in one line: copy
   before navigating away; Reset returns to the branch text.
2. **Receive the JSON** (he pastes it). Parse it; separate `_comments` from the content.
3. **Apply to `content.ts` verbatim**, with exactly these mechanical fixes:
   - Split paragraphs he typed with blank lines (`\n\n\n` inside one string) into separate array
     entries; drop empty `"\n"` entries. The renderer does not honour newlines inside a field.
   - Typos and casing only: brand spelling ("Source Library"), proper nouns, straight → curly
     apostrophes to match the file, a dangling word. **List every one in the reply** so he can
     veto. Never reword a sentence (see auto-memory `feedback_dont_change_authored_copy`).
   - Structure changes he asks for in prose ("move the picture up", "drop the quote") are code
     changes in `VisionView.tsx` / the `VisionContent` type, done in the same commit.
4. **Check the figures against the measured sources** before pushing: `/admin/spend` (ops
   `costs/spend-dashboard/{projection,output,narrative}.json`) for costs and pages, the budget doc
   `~/sourcelibrary-ops/docs/program-budget-5yr-2026-09.md` for budget lines,
   `visibility-and-stats.md` for corpus counts. A claim you cannot verify (a record, a history
   fact) is **flagged, not changed**. Put the flags at the top of the reply, most consequential
   first; money claims first of all.
5. **Answer every comment** in the reply, by the excerpt he'll recognise, not by path. A comment
   that asks for a feature becomes a change in the same PR when small, an issue when not.
6. `npx tsc --noEmit`, commit by path with DCO sign-off, push, and give him the **new preview
   URL + `?edit`** for the next round. sourcelibrary is review-gated: he merges.

## Don'ts

- Don't paste his JSON over `content.ts` wholesale: the file header carries provenance comments
  and the type may have changed.
- Don't "improve" his prose, tone, or structure. The Pangram detector scores this page ~0 either
  way; the judge is Derek's eye and the rules in `feedback_no_ai_flourish_in_published_copy`.
- Don't ship a figure that contradicts the spend page without saying so in the reply.

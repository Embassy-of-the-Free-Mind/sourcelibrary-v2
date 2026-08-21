# Browser translation crashed the reader — 2026-07-22

**Status:** fixed, merged (#3314), deployed to prod, confirmed by a human in a real
Chrome + Google Translate session.

## The report

An Italian reader emailed: the Pimandro "si blocca dopo poche pagine, oppure rimane
sempre sulla stessa" — blocks after a few pages, or stays on the same one. Tried with
and without an account, on a second PC, and on their phone. Their screenshot was our
own reader error boundary, machine-translated into Italian.

The Chrome translate icon lit up in that screenshot was the whole diagnosis. Nobody
had read it that way because the page *looked* like a server error.

## Root cause

Chrome/Edge's built-in translator (and the Google Translate widget) replaces every
text node with a nested `<font style="vertical-align: inherit">` pair. React still
holds a reference to the **original** text node, so its next commit calls
`removeChild` / `insertBefore` with a node that is no longer a child of the parent
React recorded. The DOM throws `NotFoundError`, React re-throws out of the commit
phase, and the nearest error boundary replaces the page.

For a reader with auto-translate on that is: open a book, turn two or three pages, get
an error screen — on every book, every device, indefinitely. It follows the reader's
browser language, not their account or our data, which is why it looked un-reproducible
from an English-locale machine.

## The fix — two parts, and the first alone is a half-fix

1. **`TRANSLATION_DOM_GUARD_SCRIPT`** (`src/app/layout.tsx`) — inline `<head>` script
   making `removeChild` / `insertBefore` no-ops when the node has been re-parented out
   from under React (the React issue #11538 remedy). Calls that would have succeeded
   are untouched. Must be inline in `<head>`: the translator can rewrite the DOM before
   the React bundle parses, so a client component is too late for the hydration commit.
   `window.__slTranslateGuardHits` counts swallowed calls. Pinned by
   `tests/unit/translation-dom-guard.test.ts`.

2. **Per-page remount while a translator is active** — the guard stops the *throw*, not
   the *staleness*: React's writes still land on nodes that left the document, so pages
   3/4/5 all rendered page 3 and page 7 rendered a splice of two. That is the reader's
   second symptom. `useBrowserTranslation` (`src/hooks/useBrowserTranslation.ts`)
   detects a translator; `TranslationEditor` keys `data-reader-panels-container` by page
   id while it is active, so each page builds fresh nodes instead of React patching
   translator-owned ones. Key is `undefined` otherwise — untranslated readers keep the
   existing in-place path unchanged.

   Panel toggles, font size and trace mode live in component state **above** the key, so
   they survive the remount. Do NOT key the whole reader — that would reset a
   translating reader's panel choices on every page turn.

Also fixed: the reader error boundary said *"Unable to load page editor — Your edits
are safe"* to readers who were not editing anything, and it **never reported**.
Route-level `error.tsx` is handled by Next.js before the global `ErrorReporter`
boundary, so the reader's single most visible failure had zero entries in
`application_errors`. That is why this ran unmeasured. It now reports as
`reader_error_boundary`.

## How it was verified (and the trap in the harness)

Chrome's built-in translator cannot be driven from CDP, and the Google Translate
**widget** is blocked by our own CSP (`translate-pa.googleapis.com` is not in
`script-src`; Chrome's built-in translator is browser-level and unaffected, so real
users are fine). So verification used a model of what the translator does to the DOM —
nested `<font>` per text node, MutationObserver-driven, `translated-ltr` +
`<html lang>` set — plus the **unfixed production build as a negative control**.

| | first page turn | 10 turns vs untranslated control | guard hits |
|---|---|---|---|
| production, pre-fix | error boundary | — | — |
| prod, post-fix | fine | 10/10 exact match, all translated | 0 |

**The trap:** the first model applied its DOM surgery *synchronously* inside the
MutationObserver callback, which lands in the middle of React's commit — something no
real translator does, since they batch and round-trip the text. It manufactured
staleness on a build that was already correct and sent one full round chasing a phantom.
Making the model apply batches asynchronously (`setTimeout`, and skip nodes React has
already removed) produced the clean result. **Always run the unfixed build through the
same harness as a control** — if the old code passes too, the harness proves nothing.

**Second trap:** a fake translator injected via CDP `initScript` persists in that tab
across navigations. Its marker text (`[IT] `) surfaced in Derek's own browser during his
manual check and read as a site defect. Close automation tabs and clear `initScript` when
a harness run ends, and never use a marker that could pass for shipped copy.

## Scope not covered

- The same crash family shows on collections and gallery pages (~1,046 `parentNode`
  errors in 7 days, plus React #418 hydration-text mismatches). The guard is site-wide
  so it should help, but this was not measured.
- Serving our own non-English UI. The real long-term answer for these readers; a
  separate piece of work.

## Files

- `src/app/layout.tsx` — guard script
- `src/hooks/useBrowserTranslation.ts` — detection (new)
- `src/components/pipeline/TranslationEditor.tsx` — remount key
- `src/app/book/[id]/page/[pageId]/error.tsx` — copy + reporting
- `tests/unit/translation-dom-guard.test.ts` — guard pin (new)
- `CLAUDE.md` — new invariant section

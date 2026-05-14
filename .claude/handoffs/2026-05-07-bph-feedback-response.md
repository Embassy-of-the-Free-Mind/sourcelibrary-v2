---
date: 2026-05-07
audience: BPH librarians (partner-facing)
purpose: Response to the catalogue-feedback list, marking what's fixed and what we need from them
related_pr: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/1643
---

# Draft response to BPH catalogue feedback

Hello — thank you for the detailed list. Here's where we are on each point. The first batch is on a preview branch now and will go live with the next deploy.

## Now fixed

**"Open the full search page" link.**
On bph.sourcelibrary.org, the hero CTA now reads **"Browse the full catalogue (27,706 works)"** and goes straight to the catalogue browser. Previously it pointed at the digitised-only search, which is why a search for *Hartmann* returned nothing — the 55 Hartmann works in the catalogue weren't being searched. The catalogue browser does find them.

**Home page framing.**
The hero now leads with **"27,706 works in catalogue"** and shows **"2,280 digitised on Source Library"** as the secondary count. The catalogue is the primary entry, as you suggested.

**"Lost in the Stacks" after clicking a search result.**
We traced this to a real 404: certain book sub-pages (the "Pages" overview tab and the AI-generated reading guide) were not wired up under bph.sourcelibrary.org, so clicking them produced our 404 page. Now wired up. *If* you can share the exact URL you hit during your *Hartmann* test, we can confirm it's resolved (or find another bug if not).

**British English on BPH pages.**
catalog → catalogue, digitized → digitised. Limited to BPH-only paths so it doesn't ripple across the wider site.

**"Format: Smaller" estimate.**
Hidden, per your request. We had been deriving the bibliographic format from object size as a fallback, but you're right that this isn't reliable without signature collation. The field is now blank rather than showing a guess. (If a librarian-entered format exists for a work, we still show that.)

**Sort by year of publication.**
Was already supported in the catalogue browser, but the dropdown labels were ambiguous ("Oldest first" / "Newest first"). Now reads **"Year (oldest first)"** / **"Year (newest first)"** so it's clearer what's being sorted.

## What we'd like from you to fix the rest

**Manuscripts.**
You mentioned that manuscripts are a separate section in Memorix with different fields. To bring them in properly we'd like:
- A Memorix export (CSV / JSON) of the manuscripts catalogue with the field schema you use, *or* a screenshot of a representative manuscript record so we can see which fields differ
- A note on whether you want them browsable in the same catalogue with a "manuscript" filter, or as a separate section under their own tab

**Wrong pages on a digitised book.**
You wrote: *"if I click on a digitized book, and then on pages, it does not show the pages of the digitized book (yet), but some other book."* We couldn't reproduce this from a code review — every check we ran went to the right book. If you can send the URL of the book where you saw it, we can dig in directly.

**Download — just the digitised scans.**
This is on the list to add. We have the page images already, so the work is wiring up a clear "Download scans" entry. A small question before we build it: would you prefer the scans bundled as a **PDF** (one file, easy to email / archive) or a **ZIP of images** (preserves originals, lossless)? Or both?

## Out of scope for this round

The bigger restructure of the home page (beyond the stats reordering) we're keeping for a follow-up round once the rest of the feedback above is settled — easier to make one larger change once than several small ones.

— [your name]

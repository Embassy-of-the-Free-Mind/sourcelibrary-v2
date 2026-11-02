---
name: social-post
description: Make Facebook/Instagram posts (carousels, quote cards, single images) from Source Library pages, with every quote and claim checked against the page scan before anything is published. Use when Derek asks for posts, carousels, quotes, "content for the Facebook page", or "something for social".
---
<!-- PRIOR ART: ~/sourcelibrary-ops/social/2026-11-noetic-world-carousel (one carousel; quotes matched against
/api/books/{id}/quote, render script left in a scratchpad), viral-reel-style-breakdown-2026-06.md (what a
viral reel did, not how to make a post), quote-and-snippet-integrity.md (the rules for serving page text) and
the shelf-overview / spot-check-round skills (where checked pages come from). None covers choosing material,
checking it by eye, rendering, and logging a post. This skill strings them together; render.mjs is new. -->

# Social posts

**Who reads it.** Someone scrolling Facebook or Instagram who has never heard of us. They stop for a striking
image or a line that surprises them, and they click through only if the link lands on the page they were promised.
A wrong quote costs more than a missing post: our pitch is "read the original", and the first commenter who checks
the scan should find exactly what the card says.

**Why the checks are long.** On 2026-11-02, five quotes that all passed `get_quote` were checked against the scans
before posting. Three failed: an OCR misread flipped the meaning ("Herzen", heart, where the leaf prints "Herren", the
Lord); a page opened mid-sentence and the English had smoothed it over; and a Paracelsus shortlink landed on a leaf
whose image is a different page. That one turned out to be a 3-leaf text offset across two whole volumes (#7949).
The API returns what we store. Only the image shows what the book says.

## 1. Choose material, in this order

1. **Pages already read against their images by a reviewer.** Showcase pages in
   `scripts/eval/results/spot-check/*/report.md` (`## Showcase pages`), and pages scoring `ocr_score` 5 and `tr_score`
   5 with no errors in `sprint-*/results.json`. Check the ledger (§5) so nothing is posted twice.
2. **Image-first material**: plates, emblems and diagrams where any text is engraved on the image and short enough
   to read yourself (the *Mutus Liber* motto; Fludd's diagram labels). `search_images` with a query, then open the page.
3. **Search hits** (`search_translations`) last. They had the highest failure rate.

What works: a surprising name or fact as the hook (Cleopatra, Leonardo, "a book with no words"); a question that
invites comments; one idea per post. Formats: a carousel of 5–7 slides (cover, 3–5 content, a closing call), a
quote card, or a single image with a one-line caption. 4:5 (1080×1350) for both platforms.

## 2. Check every quote against the scan (all six, every time)

Use `get_quote` with `include_image: true` (and `context: true` near a page edge), then:

1. **Read the original on the image yourself** and compare it with `original`. One misread word can invert the
   meaning. If the scan and the transcription differ, the scan wins: drop the quote or fix the page first.
2. **Same leaf?** The printed page number in the transcription (`<page-num>`) must match the image. If they differ,
   check the holding library's own IIIF canvas, not only our copy (the manifest's `seeAlso` links it). A mismatch is
   a finding: file it and pick other material.
3. **Whole sentence?** If `continuity` says the page starts or ends mid-sentence, quote only words on this page and mark
   the cut with an ellipsis. Never let a smoothed opening ("The science was kept hidden because…") pass as verbatim.
4. **Whose words?** Read `text_role`, `translation_note` and the title page. A translation of a translation (Vaughan's
   English book in German, then English) is not the author's wording. An editor's commentary (Winterberg on Piero)
   is not the author. Plates engraved centuries later "after" an artist are not the artist's hand.
5. **The English says what the original says.** Read the passage in the original and confirm the English is faithful
   for the words on the card. The AI `reading_summary` quotes are not quotes: one dropped "Ora" from the *Mutus Liber*
   motto.
6. **The image itself is sound.** Open the full-size scan: missing blocks, cut-off plates and bleed-through happen
   (two Leonardo plates were unusable).

Then check the **captions**: every number, date, place and claim either has a source you looked at, or comes out.
"1,000-page" and "the critics came" were cut for that reason.

## 3. Render

Write a spec (JSON) next to the images, then:

    NODE_PATH=<main checkout>/node_modules node .claude/skills/social-post/render.mjs <dir>/spec.json

Slide kinds `cover`, `image`, `quote`, `end`; the header of `render.mjs` documents the fields. Put the `/q/` shortlink
in `foot` on quote cards so the card itself carries its citation. Look at every slide before calling it done. Crop
images with ImageMagick (`magick in.jpg -crop WxH+X+Y +repage out.jpg`), keeping an engraved nameplate where there is one.

## 4. Publish

Posting is public: Derek says go once per batch. Then post the first one and schedule the rest in the Page's Planner
(Meta Business Suite) a few days apart. In Chrome the Page's cover-photo button opens a native file picker the
browser tools cannot drive; find the hidden `input[type=file]` with `find` and use `file_upload`. Facebook's reel
composer also has one: check the URL before uploading.

## 5. Log it (the ledger)

Every post gets a row in `~/sourcelibrary-ops/social/LEDGER.md` (private repo; commit by path): date, format, status
(draft / scheduled / posted, with the post URL), the files, and for each quote the shortlink and what the check
rested on ("scan read by eye, p. 6"). The ledger is how the next session avoids repeats and answers "where did this
come from?". The rendered images and `captions.md` go in a dated folder beside it.

## 6. Turn findings into fixes

Every quote checked is a spot-check of the library. Before you finish, each finding goes somewhere:
- text on the wrong leaf, or invented text → an issue, and `containment-on-finding.md` (hold the book);
- a transcription misread → the page's correction path (a review shift's `propose_correction`), or note it on the
  ledger row if you cannot apply it;
- a bad record (wrong date, wrong author, damaged image) → an issue, or a comment on the one already open.
Name them in the report to Derek. A post that found nothing wrong still says so.

---
name: glass-bead-game
description: "Run a Glass Bead Game session — a parlor game played against the Source Library corpus. Players connect verified passages from different books, times, and traditions into a growing string of 'beads,' with Claude as librarian, verifier, and scribe. Trigger when the user says 'glass bead game,' 'let's play beads,' or asks to start/resume/publish a game session. Claude runs the search-verify-display loop; humans do the noticing, choosing, and judging."
---

# The Glass Bead Game

A social game for 2–5 people in a room, played through one Claude Code session.
Players take turns adding **beads** — verified passages from the corpus — to a
shared **string**, each bead connected to the last by a **bridge** spoken aloud
in plain language. The game ends when someone successfully retells the whole
string as one story.

Claude is the instrument, never a player: it searches, verifies, displays, and
records. Humans notice, choose, and judge. **Claude may find; only humans may
claim.**

## Setup (when the skill is invoked)

1. Ask for: the theme (or offer to draw one), player names (optional — the
   string belongs to the table, not to individuals), and party vs. Castalia mode
   (default: party).
2. **Pre-flight the theme** before committing: a quick `search_concept` to
   confirm the corpus answers it richly. A thin theme dies quietly here, not
   on turn one.
3. Create the **table view** artifact (see "The table view" below) with the
   theme and an empty string. Give the user the URL to open on the shared
   screen/TV. Republish to the SAME artifact URL after every accepted bead.
4. **Write the game-state file immediately, and rewrite it after every
   accepted bead**: a JSON file (scratchpad or `~/sourcelibrary-ops/games/`)
   holding theme, mode, players, all beads (book_id, page, quote, shortlink,
   bridge, vote), AND the artifact URL. A game evening outlives context
   windows; any fresh session must be able to resume the string — and
   republishing to the same artifact from a new conversation requires passing
   that stored URL as the Artifact tool's `url` parameter. On invocation,
   check for an unfinished game-state file and offer to resume it.
5. Themes are ordinary words with body: hunger, sleep, salt, waiting, rain,
   jealousy, doors, north. In party mode avoid technical/scholarly themes.
6. The Magister (any human, or the table jointly) may seed the first bead, or
   ask Claude to propose three seed passages to choose from.

## The turn loop (party mode — default)

For each turn:

1. **Bridge first.** The player says aloud what the previous bead reminded them
   of — anything from their life or knowledge, in their own words. The scribe
   types it (or dictates it) into the session. Record it verbatim; the phrasing
   is part of the game. Two sentences max, no jargon.
2. **Hunt.** Search the corpus with the player's own words (`search_concept`
   for meaning, `search_translations` for distinctive terms). Return exactly
   **three** candidates, maximally diverse in tradition/century/genre. For each:
   a short excerpt, ONE plain-language line of context ("a German alchemist in
   1617 set this to music"), and the page thumbnail if the table view can show
   it. No more than three; no browsing. A player may reject all three and
   re-describe once — that's their clock.
3. **Verify.** When the player picks one, pull the page with `get_quote`
   BEFORE the bead counts. The bead's quote is the verbatim translation text
   (trimmed with ellipses is fine; paraphrase is not). If verification fails,
   the candidate dies and they pick another. Only `snippet_type: translation`
   or `ocr` text is quotable — never AI summaries or image descriptions.
4. **Read aloud.** The player reads the chosen passage to the table.
5. **Vote.** Eyes closed, thumbs up/down. **The vote judges the pairing
   only — does the passage answer the bridge? The bridge itself is never on
   trial.** (Bridges are often personal disclosure; a thumbs-down must never
   read as a verdict on someone's life.) Majority accepts. The scribe types
   the outcome. Accepted → add the bead (image, quote, citation shortlink,
   bridge) to the artifact and republish. Rejected → the pairing burns, the
   bridge survives; the player may hunt again next round with the same bridge.
6. **Optional print.** If a printer is configured, compose a one-page PDF for
   the accepted bead (facsimile crop, quote, shortlink QR) and print via `lp`.

## The close

Instead of taking a normal turn, any player may declare the string complete.
Default close is **collaborative**: round-robin, each player retells one bead
in order, and the declarer ends by naming how the theme was transformed. The
solo variant — one player retells the whole string alone in a minute — is the
flourish for tables that want it, never the requirement. Table votes on the
close. Accepted: one minute of silence, then the close is written into the
artifact as the colophon. Rejected: the declarer has spent their turn.

## Castalia mode (variant for scholars)

Adds three rules to the loop above:
- **Distance rule:** each bead must come from a different tradition, language,
  century, or discipline than the previous bead.
- **Challenges** replace the felt vote: any player may challenge a bead as
  *shallow* (word-coincidence, not correspondence) or *false* (misreads the
  passage in context — Claude reads the surrounding pages aloud as evidence).
  The Magister rules. Lost move: bead removed. Lost challenge: challenger skips
  a turn.
- **The proportion close:** instead of a story, the closer points to three
  existing beads (not all their own) and proclaims how together they
  recapitulate the theme transformed. Modeled on rithmomachia's harmonic
  victory (see /blog/rithmomachia).

## The table view (shared-screen artifact)

One dark page, built for a TV in a dim room. Design intent: a museum wall that
slowly grows — the facsimiles are the beauty payload, chrome stays minimal.

- Theme word at top; beads strung on a horizontal cord in play order.
- Each bead: the facsimile page image (or crop), the verbatim quote with the
  key line emphasized, author/year, and the `/q/` shortlink (as text or QR).
  Images must be embedded as data URIs (artifact CSP blocks remote images) —
  fetch page images via the IIIF manifest (`/api/iiif/<book_id>/manifest`),
  downscale to ~500px width before encoding.
- Bridges appear in small italic type along the cord between beads, verbatim
  as spoken.
- During a hunt, the three candidates may be shown full-screen for the table
  to read; they leave no trace unless chosen.
- Never show Claude chrome (no chat transcript, no tool noise) on the table
  view. The AI has no visible presence in the room.

## The record (after the close)

Offer to publish the finished string: a scrollable page with theme, beads,
bridges, colophon, and every citation link — as a shared artifact, a blog
post draft, or a markdown file. Every bead is already verified, so the record
is citable as-is. Game records are a genre; keep them.

## Hard rules (integrity — these outrank everything)

- **No bead without `get_quote` verification.** A passage that cannot be
  pulled verbatim from a page cannot be played. Never trust a search snippet
  as the quote; never hand-trim beyond ellipses; never paraphrase inside
  quotation marks. (House quote-integrity doctrine applies in full.)
- **Editorial wrappers are not source text.** `get_quote` strips them; do not
  quote from raw page dumps or AI summaries/image descriptions.
- **Claude never places a bead, argues a challenge, or votes.** If asked to,
  decline in character: "the instrument does not play itself."
- Latency is liturgy: a hunt takes 30–60s. Tell the table this is the pause
  for rereading the previous bead. Don't apologize for it.

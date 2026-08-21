# Newsletter — working rules and the queue

Started 2026-08-01, because letters were being written one at a time with no
sense of what came next, and the August letter had grown three separate asks
before anyone noticed.

This is a living doc. Update the queue as letters go out.

## Where things are

- **Audience:** the standing Resend audience `Source Library Newsletter`
  (`5dd84247-…`), refreshed daily from Mongo by
  `scripts/workers/refresh-newsletter-audience.mjs`. It is the deduped union of
  `users`, `signup_interest`, `verification_tokens`, `beta_subscribers`,
  `volunteers` and `memberships`, minus anyone who ever unsubscribed.
- **Composer:** `/admin/email` → Compose → Manual. Since 2026-08-01 the body is
  edited as formatted text (`RichEmailEditor`), with an HTML mode for pasting a
  letter in from this repo. The compose buffer autosaves to `localStorage`, so a
  refresh no longer loses a half-written letter.
- **Copy lives in the repo**, at `scripts/email/*.body.html`, not only in the
  composer. A letter that exists solely as a saved draft cannot be reviewed,
  diffed, or explained six months later.
- **The one-off cohort machinery** in `scripts/send-user-broadcast.mjs` is for
  the welcome letter to people who have never had it. It is not the newsletter
  path — do not confuse the two.

## Working rules

**One ask per letter.** This is the rule the August letter broke. It opened as
"tell me what's wrong", then also asked people to volunteer as language
reviewers, then also asked what they were researching. Three calls to action
compete: the reader does the cheapest one, or none. Pick the ask, then let
everything else in the letter serve it.

**Do not ask for something you cannot receive.** A volunteer ask creates an
obligation to hand people work. A "hit reply" ask creates a mailbox somebody has
to read. Before queueing a letter, name who absorbs the response and what they
do with it. If the answer is "nobody yet", the letter is not ready — that is a
prerequisite, not a detail.

**Check the door before you send people through it.** Any letter with a link to
a flow gets that flow tested first, on production, that day. The `/welcome`
gate had a redirect loop (#3467) and a blank form that erased the answers behind
it (#3496) within the last month; pointing several thousand readers at either
would have been worse than not writing the letter.

**Re-measure every number.** Corpus figures drift fast and the homepage is the
number readers can check. Measured 2026-08-01: 34,040 books visible, **19,420
with readable pages** (the figure the homepage shows), 6.1M pages, 4.9M
translated, 336 feedback messages of which 298 addressed.

**Derek's copy is used as written.** Fix unambiguous typos, flag anything
factually shaky, never reword. See memory `feedback_dont_change_authored_copy`.

**Cadence:** roughly monthly. Frequent enough to be a habit, rare enough that
each letter earns its ask. No fixed date — a letter with nothing to say is worse
than a gap.

## Queue

### 1. "Can I get your feedback?" — SENT 2026-08-19
`scripts/email/feedback-newsletter-2026-08.body.html`

Sent 2026-08-19 13:28 UTC as subject "Can I get your feedback on Source
Library?" (Resend broadcast `77b35192`, 5,538 contacts), after a nine-day
stall on a Resend contacts-quota block (2026-08-10) resolved by a billing fix.
Two things learned at send time, both already fixed: the book count had
drifted (19,420 → 22,069, re-measured per the rule above, PR #3880), and a
single `@example.com` test contact in the audience makes Resend 422 the whole
broadcast (filtered at three layers, PR #4077).

Ask: **report anything that looks wrong.** Shows the three places to leave
feedback, with screenshots, and makes the trust argument (don't trust any
translation; the original sits beside it so you can check).

Closes with "what are you researching?", which is kept because it is a question
rather than a commitment, it costs the reader one reply, and the answers feed
acquisition directly. Absorbed by: Derek's inbox.

### 2. Volunteer readers — READY once someone will answer

`scripts/email/queued/volunteer-readers.body.html`

Ask: **if you read a language we hold, review a text you already care about** —
rate the translation, mark where it drifts, and read over the blog posts.

Split out of letter 1 so it gets its own send, not because it needs building.
An earlier version of this entry claimed it was blocked on routing volunteers to
texts and on making blog posts editable. Both were wrong, and wrong in the same
way — they assumed a volunteer needs to *edit*:

- **They pick their own text.** The ask is "one you already care about", so
  there is nothing to assign. No queue, no matching, no assignment UI.
- **They give feedback, they do not edit.** The feedback widget is on every
  blog post and every reader page (verified 2026-08-01 on
  `/blog/reciting-not-reading`: two controls, and the row records the page), and
  it already stores which page the note came from. The whole point of letter 1
  is that this path works.

So the 67 TSX blog posts are NOT a blocker here. Making them editable is a
convenience for whoever *applies* the fix, not a precondition for receiving it.

What remains is a commitment rather than code, but it is smaller and more
specific than an earlier version of this entry claimed. That version said eleven
people had offered to help and "appear to have heard nothing back". Checked
properly on 2026-08-01, that was wrong twice over: the eleven rows are **nine
distinct people** (two filed twice), and **ten of the eleven rows were
addressed**, several with shipped fixes — one of the repeat messages is the same
person thanking us for a swift reply. Do not repeat the silence claim.

The real finding is narrower and more useful: **they were answered about their
bug, never about their offer.** Four went on to fill in `/welcome`, and three
named precisely what this letter asks for (reviewing translations, suggesting
books, annotating texts). One asked whether a contributors' forum exists.

So before sending, two things:

- **Reply to the standing offers**, not the bug reports — those are already
  closed. It is a handful of people, and they self-selected for exactly this.
- **Write it in Spanish too.** Five of the nine wrote in Spanish and one said
  plainly that they do not read English. An English-only volunteer letter would
  miss most of the people who have already raised their hand. The site has `/es`;
  the send does not yet have a language split. Precedent for doing this properly
  is in `scripts/maintenance/apologize-welcome-loop-2026-07.mjs`, which sends
  Spanish only to people who TOLD us Spanish — never inferred from a name or a
  mail domain.

The programme those replies feed into is designed in
`.claude/docs/community-quality-review-design.md`. Its Phase 0 is literally
"reply to the nine and ask three of them for five pages each" — so answering
them is not a prerequisite to the work, it IS the first step of it.

Query for the current list (do not paste names or addresses into this repo — it
is public):

    db.feedback.find({ wants_to_help: true }).sort({ created_at: 1 })

### 3. Unwritten, worth considering
- **What we got wrong and fixed** — the reader reports that found the leaf
  offset (#3368) and the fabricated encyclopedia citations (#3361), told
  properly. Strong material, cut from letter 1 when Derek rewrote it; it is a
  letter of its own, not a section.
- **A first translation** — pick one book that had never been in English and
  tell its story. Ask: read it.
- **What arrived this season** — acquisitions, with one good plate.

## The editing primitive

Added 2026-08-01, after asking why the newsletter got its own editor when every
other authored-text field in the app had gone without one.

The survey said something useful: **the newsletter is the only surface in the
app that authors HTML.** Collection intros are `split('\n\n')` into paragraphs,
museum descriptions and catalogue notes are plain fields. So a rich-text editor
everywhere would have been the wrong generalisation — formatting marks typed
into those fields reach the reader as literal angle brackets.

What every surface *did* lack was the same four things: a word count, a way to
see the text as the reader will, a signal that there are unsaved changes, and
somewhere to say what the field is for. That is `src/components/ui/ProseField.tsx`.
It supplies chrome and leaves the control and the Save button to the caller,
which is what lets it drop into forms that already work. Autosave is opt-in via
`onSave`, because converting a deliberate save into an automatic one changes
what a half-finished edit means.

Wired into: newsletter compose, newsletter draft editing, gallery collection
descriptions, gallery image museum descriptions. Remaining candidates when they
next hurt: catalogue notes (`BphWorkEditForm`), KDP descriptions, book-collection
descriptions.

**The 67 blog posts are TSX files** under `src/app/blog/`, so applying a fix
needs a code change and a deploy. Worth improving eventually — but note this is
a cost borne by whoever *applies* an edit, not by the reader reporting one. A
volunteer proofreading a post uses the same feedback widget as everyone else,
which is on every blog page and records which page the note came from. Do not
let "the blog is not editable" become a reason to delay asking people to read
it.

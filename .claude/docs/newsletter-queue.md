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

### 1. "Can I get your feedback?" — READY, awaiting send
`scripts/email/feedback-newsletter-2026-08.body.html`

Ask: **report anything that looks wrong.** Shows the three places to leave
feedback, with screenshots, and makes the trust argument (don't trust any
translation; the original sits beside it so you can check).

Closes with "what are you researching?", which is kept because it is a question
rather than a commitment, it costs the reader one reply, and the answers feed
acquisition directly. Absorbed by: Derek's inbox.

### 2. Volunteer readers — DRAFTED, blocked
`scripts/email/queued/volunteer-readers.body.html`

Ask: **if you read a language we hold, review a text you already care about** —
rate the translation, mark where it drifts, and proofread the blog posts.

Split out of letter 1 deliberately. It is the ask with real fulfilment cost:
people who say yes expect to be given something specific, and right now
`/welcome` collects who they are and what they read but nothing routes them to a
text. Blocked on:

- a way to hand a named volunteer a named book or blog post
- deciding where their verdict goes (a rating on the book? a note? an issue?)
- someone to reply to the 11 people who have *already* ticked "I'd like to help"
  in the feedback widget and, as far as the data shows, heard nothing back

Sending this before those exist would recruit people into silence, which costs
more goodwill than never asking.

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

**Still not editable anywhere: the 67 blog posts**, which are TSX files under
`src/app/blog/`. Fixing a typo needs a code change and a deploy, which is why
the volunteer letter cannot yet ask anyone to proofread them and hand back an
edit. That is the next real gap, and it is a migration, not a component.

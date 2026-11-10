---
name: send-newsletter
description: Plan, QA, send and measure a Source Library newsletter or broadcast email — one ask, a real subject and preview line, every link opened as a signed-out reader would, a test send, then numbers at 1 h / 24 h / 72 h logged in the queue. Use when Derek says "send the newsletter", "email the list", "draft a letter to everyone", "how did the email do?", or hands over a letter to go out.
---

# Send a newsletter

PRIOR ART: `.claude/docs/newsletter-queue.md` (working rules and the queue — still the
source for cadence and the letter list; this skill is the send procedure it lacked),
`letter-editor` skill (one-to-one emails, not broadcasts), `scripts/send-user-broadcast.mjs`
(welcome-letter cohorts only, not the newsletter path).

**Why this exists.** The November 2026 letter (Solve et Coagula, 8,271 sent) went out
with no preview line, so inboxes showed "Leer en español →"; a generic subject; three
bare URLs; four destinations; a P.S. with nothing to do; a Spanish link to a retired
vercel.app page; and a deep link that showed signed-out readers a scan with no English,
because the metered reader had switched on that morning. Readers also landed on a
transcript that ended in Whisper's "he he he". None was hard to catch, and none was caught,
because the checks lived in people's heads. They are now a script (step 4) and a by-eye
pass (step 5).

**Derek's copy is used as written** (memory `feedback_dont_change_authored_copy`): fix
unambiguous typos, flag what is factually shaky, propose subject and preview variants —
never reword silently. In June 2026 an unasked subject swap put a wrong word in front of
~200 inboxes; Resend has no recall.

## 1. Purpose and the one ask
Before any copy: who is this for, what will they do after reading, and **who absorbs
the response?** A "hit reply" ask needs someone reading replies at 24 h and 72 h; a
volunteer ask needs work ready to hand out. "Nobody yet" means the letter is not ready.
One main action, at most one secondary. Count what is already waiting before asking for
more (1,795 volunteers had never been contacted when the November letter asked again).

## 2. Copy in the repo
`scripts/email/<slug>.body.html`, with a header comment carrying at least:
```
Subject: <what the reader gets, ≤ 60 characters>
Preview: <the second line in the inbox, 40–100 characters; it is not the first sentence>
Audience: <segment and how it was built>
```
- **Subject** sells the most interesting true thing in the letter, not "New …". In
  November the Drebbel machine drew as many clicks as the podcast page from third place.
- **Links on words**, never bare URLs. A button or a bold link for the one action.
- **The P.S.** is read more than the middle: give it the secondary action or cut it.
- **Spanish**: an English letter carries one "Leer en español" link to the Spanish page
  **on sourcelibrary.org** (`/es/...`), never a standalone deploy. When a claim changes in
  one language, change the twin the same day.
- **Numbers** are re-measured on send day (book count moved 19,420 → 22,069 between draft
  and send in August). Canonical live filter: `visible: true && pages_count > 0`.
- **Quotes** are checked against the stored page text and the scan, with ?page=N.
- Public repo: copy only. No addresses, names of private people, or money figures.

## 3. Destinations
Prefer the homepage, a book's front page, articles, and YouTube. A deep **book page**
link must be inside the free sample (first 20% of pages) or flagged `seo_indexable` —
otherwise a signed-out reader sees the scan and no English. To open a passage for a
letter: set `seo_indexable: true` and `seo_url: /book/<slug>/page/<page _id>` on those
pages (each page's own `_id`), then purge both URL forms in Cloudflare. Any page or flow
the letter sends people to is checked on production **that day** (the /welcome redirect
loop, #3467).

## 4. Run the QA script — FAILs block the send
```
set -a; source .env.production.local; set +a
node scripts/email/qa-letter.mjs scripts/email/<slug>.body.html
```
It fails on: no Preview line, a *.vercel.app link, a Spanish link off sourcelibrary.org,
a non-https image, a book page outside the free sample or hidden. It warns on: subject
length or a "New…" opener, more than three destinations, bare URLs, a P.S. with no link,
images without alt, every number to re-measure. Fix FAILs; take WARNs to Derek as
proposals, not edits.

## 5. Open every destination by eye, as a signed-out reader
The laptop cannot see what a reader sees (Cloudflare challenges scripted fetches; the
terms card and the meter only show to a signed-out browser). Use chrome-devtools
`new_page` with an `isolatedContext`, or an incognito window, ideally also a phone:
- A deep link from a mail app first shows the **terms card** ("Welcome, reader"). Click
  through and check the page behind it shows English.
- Read the whole destination page, top and bottom: a transcript's end, a figure's caption.
- Open two interior pages of any book you link, original and translation.

## 6. Render, tag, test-send
```
node scripts/email/render-newsletter-preview.mjs scripts/email/<slug>.body.html "<Subject>" /tmp/<slug>.html
node scripts/email/send-test.mjs scripts/email/<slug>.body.html "<Subject>" <one address>
```
The render inserts the Preview line as a hidden preheader and tags sourcelibrary.org links
`utm_source=newsletter&utm_medium=email&utm_campaign=<slug>` (#8507). Without tags, mail
clicks read as "direct" and the letter cannot be measured. Read the test on a phone: the
inbox row (subject + preview), images, every link once more.

## 7. Audience and the send
- Target the standing Resend audience **Source Library Newsletter**, refreshed daily by
  `scripts/workers/refresh-newsletter-audience.mjs`. Never the old admin-UI audience, and
  never `send-user-broadcast.mjs` (welcome cohorts only).
- **Contacts quota:** check the plan ceiling in the Resend dashboard (the API cannot read
  it) against the audience size; the list grows ~35 a day. August 2026: broadcast created,
  send refused for nine days.
- **Any `@example.com` (or other reserved test domain) contact makes Resend reject the whole
  broadcast with a 422.** The refresh filters them; check if a funnel test ran recently.
- **Two versions** (e.g. a welcome line for new accounts): build the segment by script
  just before the send, because signups continue. If you want to learn something from the
  split, vary the **subject**, not the third paragraph.
- From a person's address with a monitored reply-to, never noreply. Mid-week, morning in
  the Americas and afternoon in Europe (~13:30–14:00 UTC); not Friday evening.
- Scheduled sends: note how to cancel (Resend dashboard, or remove the box's at-job).
- Sending is irreversible and public: Derek's go on the final subject, preview and copy.

## 8. Measure and log
```
node scripts/email/letter-stats.mjs "<broadcast name>"
```
At ~1 h, 24 h and 72 h. Report clicks (opens are inflated by Apple Mail preloads),
unsubscribes against the last letter (look again before the next letter if a letter passes ~1%), bounces,
and tagged site visits by page. Read replies at 24 h and 72 h; list requests and check
holdings (`scripts/import/check-holdings.ts`). Signups carry no source, so credit a
letter only on shape (timing, spread across hours), never on a coincidence.
Add one row to the queue table in `.claude/docs/newsletter-queue.md` in the same session:
date, subject, recipients, opened %, clicked %, unsubscribes, what to change next time.

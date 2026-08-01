# The welcome gate locked readers out, and the form erased what it never showed — 2026-07-30/08-01

Reported as "`/welcome` → a 404 → an infinite loop… am I the only one?" It was three
separate bugs stacked on one another, and no, he wasn't. PRs #3467, #3464, #3496.

## What the reader experienced

1. Any page → the welcome gate redirects to `/welcome?from=<path>`.
2. Fill in the form, save. It saves correctly — `welcomedAt` is written.
3. The reader is returned to their page, and the gate immediately sends them back
   to `/welcome`. Forever, on every page. The site is unusable.
4. Separately, the form re-presented itself **blank**, so the second save wrote
   those blanks over the answers from the first.

The 404 in the original report was a red herring: `/book/6810f4e60b70c1a5b48ba3f8`
exists in neither `books` nor `deleted_books`. The `?from=` target was simply a dead
URL, and the loop took over from the 404 page.

## Root cause 1 — `update()` with no argument is a GET (#3467)

`WelcomeForm` called `await update()` to refresh the session. In `next-auth/react`,
`update(data)` only builds a request body **when called with data**, and
`lib/client.js` only sets `method: 'POST'` when a body exists. So the call was a
**GET**, a GET does not run the `jwt` callback with `trigger: 'update'`, and the
callback's DB re-read is gated on `(user || trigger === 'update')`.

`needsWelcome` was therefore frozen `true` in the JWT for its full 30-day life,
whatever the database said. Confirmed directly: `welcomedAt = 2026-07-30T08:30:32Z`
in Mongo while `/api/auth/session` still served `needsWelcome: true` hours and
several saves later.

**Fix:** `update({ welcomed: true })`. The `jwt` callback also honours that payload
*outside* its try/catch, so a failed lookup cannot re-trap someone who just saved.

**The structural half, which matters more.** `WelcomeGate`'s only guard was a
mount-scoped `useRef` — and that is no guard at all, because every firing of the
gate is a navigation and every navigation remounts the component. The gate now
records one firing per tab in `sessionStorage`, so a stale flag costs one wasted
navigation instead of the whole site. That is also what self-healed the readers
whose tokens stayed stale for up to 30 days; nothing server-side can force-refresh
a JWT.

Scope: **42 readers** saved during the window (2026-07-29 → 07-30) and every one was
then bounced. The gate had only started firing for real the day before, when #3448
fixed the `users._id` string-vs-ObjectId lookup.

## Root cause 2 — a blank form overwrites what it never showed (#3496)

`/welcome` rendered every field empty on each visit and saved those blanks over
`users.profile`. Alone this needed a deliberate revisit; combined with the loop —
which *made* people submit twice — it erased their answers.

**Blast radius, measured against every `volunteers` row rather than estimated: 2
readers.** Both recovered, because the `volunteers` mirror is written on the first
(non-empty) save and held the only surviving copy. Restored to `users.profile` with
a `profile.restoredFrom` stamp.

**Fixes:**

- `/welcome` prefills from `users.profile`, resolved **server-side** — a
  fetch-on-mount leaves a window where the form is mounted, empty and submittable.
- The API distinguishes an **absent** key ("leave this alone") from a **present
  empty string** ("the reader cleared this"). That distinction is the entire bug,
  so it lives in `src/lib/welcome-profile-update.ts` with tests rather than inline.
- A failed prefill read fails safe: the page passes `profileLoaded={false}` and the
  form omits untouched fields. A database hiccup must not be able to erase anyone.
- The `volunteers` mirror follows the same rule — it is the last-resort copy that
  made recovery possible, so a field nobody sent must never overwrite it.

**An existing test encoded the bug.** `tests/unit/welcome-name-capture.test.ts`
asserted that a body *omitting* `preferred_language` should still write `''`, so
that "asked and declined" stayed distinguishable from "never asked". That inference
*is* the data-loss mechanism. The intent survives by moving the signal to the
caller: the form sends all four fields whenever it could prefill them, so the
declined case still records `''`. The case was rewritten, not deleted.

## Root cause 3 — there was nowhere to fix it (#3464)

`/account` had no editor for the four welcome answers at all; only *members* got a
profile editor, and it edits a different thing. A reader who wanted to answer later
had nowhere to go. `/account` now has a Reader profile card for every signed-in
user, and `GET /api/me/welcome` exists so it can prefill.

## Two measurement traps hit while sizing this

- **A cohort keyed on an overwritten field drifts.** `users.welcomedAt` is rewritten
  on every save, so a "who was affected in this window" query silently loses anyone
  who came back and re-saved: the list went **42 → 40 within an hour**, dropping two
  genuinely affected people. Freeze an incident recipient list to a file and never
  re-derive it at send time. `volunteers.signals` is `$push`-ed per save and
  preserves first-save time if you must reconstruct one.
- **Wrong field names read as "no activity."** A first pass reported zero active
  users because it queried `created_at`/`timestamp` on collections that use
  `started_at`/`updated_at`, and looked for `user_id` on `analytics_pageviews`,
  which stores none at all (#3405). The zero was an instrument artifact, not a fact.

## Outcome

42 readers were emailed a thank-you with the apology folded in — split by what they
actually did (27 contributed, 15 pressed Skip or saved blank; thanking a skipper for
contributing would be false) and by the reading language they themselves stated
(12 Spanish). 42 sent, 0 failed, 0 bounced. Recipient list and send record are in the
private ops repo, not here.

## Files

- `src/components/welcome/WelcomeForm.tsx`, `src/components/auth/WelcomeGate.tsx`
- `src/lib/welcome-gate.ts`, `src/lib/welcome-profile-update.ts` (both new, both
  extracted so the rule is reachable by a test)
- `src/app/welcome/page.tsx`, `src/app/api/me/welcome/route.ts`
- `src/app/account/AccountClient.tsx`
- `tests/unit/welcome-gate.test.ts`, `tests/unit/welcome-profile-update.test.ts`,
  `tests/unit/welcome-name-capture.test.ts`

# Session flags go stale, and blank forms erase

**Read this when:** Touching NextAuth session updates, a client-side redirect guard, or any form that saves user-authored profile text.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Lessons from the `/welcome` lockout, 2026-07-30 (#3467/#3496). Full postmortem:
`.claude/handoffs/2026-08-01-welcome-gate-lockout-and-blank-form-overwrite.md`.
Three bugs stacked: 42 readers could not leave the welcome page, and 2 had their
answers erased.

- **`useSession().update()` MUST be called with a payload.** With no argument it
  issues a **GET** to `/api/auth/session` (next-auth's `update(data)` only builds a
  body when given data; `lib/client.js` only sets `method:'POST'` when a body
  exists), and a GET never runs the `jwt` callback with `trigger:'update'`. Since
  the DB re-read in `src/lib/auth.ts` is gated on `(user || trigger === 'update')`,
  every token field computed there stays frozen for the token's full 30-day life.
  Mongo said `welcomedAt` was set; the session served `needsWelcome: true` for
  hours. **Verify a session change by reading `/api/auth/session`, never by
  trusting the write** — the disagreement between the two is the diagnosis.
- **A mount-scoped `useRef` is not a redirect guard.** Every redirect is a
  navigation and every navigation remounts, so the ref resets each time and a
  stale flag becomes a lockout instead of a nuisance. Persist "already fired" in
  `sessionStorage`. This is also the only thing that can heal a stale JWT, because
  nothing server-side can force-refresh one.
- **An ABSENT field means "leave this alone"; a PRESENT empty string means "the
  reader cleared it".** Conflating them lets a form overwrite data it never showed
  the reader — `/welcome` rendered blank on every visit, so the second save wiped
  the first. Any surface that writes user-authored text must prefill (server-side,
  so there is no mounted-and-empty window) or omit the key. Rule + tests:
  `src/lib/welcome-profile-update.ts`. **Corollary:** a test asserting "record the
  blank so declined ≠ never asked" encodes exactly this bug — keep the intent, move
  the signal to the caller.
- **A cohort keyed on an overwritten field drifts under you.** `users.welcomedAt`
  is rewritten on every save, so a "who was affected in this window" query loses
  anyone who came back and re-saved — a 42-person incident list became 40 within an
  hour. Freeze an incident recipient list to a file (private ops repo — reader
  addresses never go in this repo) and never re-derive it at send time.

# Study Rooms — user-experience spec

Status: **draft for review. Nothing is built.** This spec and the simulated-user
tests in `e2e-sims/study-rooms/` come first; feature code waits until the stories
are agreed.

## 1. Purpose

People write to us from all over the world because they read the same old books.
1,604 introduced themselves on `/welcome`; 1,947 offered to help; none of them has
met another reader through the site yet. Study Rooms gives them somewhere to meet:
a small pixel-art library where a signed-in reader has a 16-bit character, walks to
a study group's room, sees who else is there, chats, talks (voice/video, by
proximity) and opens the group's text together.

What it is for: **reading primary sources together.** The game look is there to make
arriving friendly and to show presence at a glance. Every action is also available
without the game (§6, J12).

### What readers told us (aggregate, from `/welcome` introductions)

| Theme | People |
|---|---|
| Hermeticism / esotericism | 437 |
| Languages and translation | 262 |
| Classics / ancient history | 226 |
| Neoplatonism / philosophy | 191 |
| Theology / religious history | 143 |
| Alchemy | 118 |
| History of science | 80 |

About 316 are students, teachers or professors. About 350 prefer to read in
Spanish. Of the volunteers, 193 offered translation and 156 offered reviewing or
proofreading.

### The first five groups

| Group | Slug | Anchor text |
|---|---|---|
| Hermetica & Alchemy | `hermetica-alchemy` | Ficino's *Pimander* — `/book/corpus-hermeticum-pimander-ficino-translation-translator` |
| Platonists' Circle | `platonists-circle` | Taylor's *Five Books of Plotinus* — `/book/five-books-of-plotinus-taylor` |
| Translators' Room | `translators-room` | working group (no single text) |
| Círculo en español | `circulo-en-espanol` | chosen by the group |
| Ancient Worlds | `ancient-worlds` | chosen by the group |

## 2. Phases

- **Phase 0 (now, no code):** each group meets on a Google Meet link from its
  calendar event. Invitations go by email. This tests whether people come at all.
- **Phase 1 (this spec):** the in-library space at `/study-rooms` (Spanish:
  `/es/study-rooms`). Presence, positions and chat over Supabase Realtime;
  proximity voice/video over LiveKit. The group page still shows the next
  meeting and, while Phase 0 runs, its Meet link.
- **Phase 2 (later, out of scope):** recordings, shared annotations saved to the
  reader, group-owned reading plans, more rooms.

## 3. Ground rules (apply to every journey)

1. **Opt-in and signed-in only.** A logged-out visitor never appears in the space
   and never sees who is in it — only that rooms exist and when they meet.
2. **Separate from reading presence.** `src/lib/presence.ts` (the anonymous "N
   people are reading" count) keeps its invariants: aggregate only, never tied to
   a login. Study Rooms is a different layer with its own consent, and it never
   reads from or writes to the `presence` collection.
3. **You choose your name.** Display name and character are chosen on entry; the
   email address is never shown to other people.
4. **Invisible is always one tap away** (J10).
5. **No tenant subdomains.** Study Rooms does not run on BPH/EFM or other tenant
   hosts, same as reading presence.
6. **Camera and microphone are off until you turn them on**, every time.

## 4. Personas (invented composites)

These are **invented composites**, built from the aggregate themes above. They
are not real people and carry no real names, emails or words.

| # | Persona | Device | What they want | Test fixture |
|---|---|---|---|---|
| P1 | **The Professor** — retired, taught Neoplatonism for decades, reads Greek, cautious with new tech | desktop, large screen, keyboard | a serious reading of Plotinus with people who have done the reading | `professor` |
| P2 | **La Lectora** — reads in Spanish, interested in Hermetica, mostly online on her phone in the evening | phone, touch, Spanish UI | to join in Spanish without fighting a game on a small screen | `lectora` |
| P3 | **The Translator** — volunteered to help translate Latin, wants to work, not socialise | laptop | the Translators' Room: open a page, discuss a crux, leave a note for later | `translator` |
| P4 | **The Newcomer** — just signed up after finding a book, curious, not sure what happens here | desktop | to look around, see what a group is, and leave easily | `newcomer` |
| P5 | **The Host** — runs a group, moderates; in tests this is Derek's role | desktop | to open the room, welcome people, steer the reading, deal with trouble | `host` |

## 5. User journeys and acceptance criteria

Each journey lists the tests that cover it (`e2e-sims/study-rooms/*.spec.ts`).
"Sees" means the person's own browser shows it, within a few seconds.

### J1. Invitation → sign in
A reader gets an email invitation for a group meeting and follows the link.
- AC1.1 The invite link opens `/study-rooms/<group>`; logged out, the page shows
  the group, its anchor text, the next meeting time, and a sign-in button.
- AC1.2 Logged out, no avatars, names, roster or chat are shown, and the page makes
  no realtime connection.
- AC1.3 After signing in, the reader comes back to the same group page.
- Tests: `01-arrival` › *logged-out invitee sees the group but nobody in it*.

### J2. First entry: consent and character
- AC2.1 The first visit asks once, in plain words, to be visible to others in Study
  Rooms (opt-in). Saying no keeps the list view usable and nobody sees you.
- AC2.2 The reader picks a 16-bit character from at least 8 options and a display
  name (pre-filled from the account name, editable, 2–32 characters).
- AC2.3 The choice is remembered for next time and can be changed later.
- Tests: `01-arrival` › *first entry asks for consent, then a character*.

### J3. Walk to the group room
- AC3.1 The reader appears in the library entrance hall.
- AC3.2 Arrow keys / WASD move one tile per press; clicking a spot or a door walks
  there.
- AC3.3 Walking through a group's door enters that room; the room header shows the
  group name and anchor text.
- Tests: `01-arrival` › *walks from the hall into the group room*.

### J4. See others arrive
- AC4.1 When someone enters, everyone already in the room sees their avatar and
  their name in the roster.
- AC4.2 When someone moves, others see the avatar move to the same tile.
- AC4.3 When someone leaves, their avatar and roster entry disappear for everyone.
- AC4.4 Arrivals and departures are also announced in a polite live region (J12).
- Tests: `02-presence` › *two readers see each other arrive, move and leave*.

### J5. Chat
- AC5.1 Messages sent in a room reach everyone in that room, in order, with the
  sender's display name.
- AC5.2 People in other rooms do not receive them.
- AC5.3 Someone who arrives later sees the recent messages from the current session.
- Tests: `03-chat` › *room chat reaches the room and only the room*; *a late
  arrival sees recent messages*.

### J6. Join audio/video
- AC6.1 Nothing is published until the reader presses Join call; the browser asks
  for permission only then.
- AC6.2 After joining, the reader's call status says connected, and each other
  participant who joined shows as a tile.
- AC6.3 Proximity: in the hall, you hear only people near you; inside a room,
  everyone in the room hears everyone in the room.
- AC6.4 Mic and camera toggles work and show their state to others; Leave call ends
  publishing.
- Tests: `04-call` › *two readers join a call and see each other's tile*;
  *proximity: far apart in the hall, not connected*.

### J7. Open the group's text together
- AC7.1 A button in the room opens the anchor text in a side reader panel without
  leaving the room.
- AC7.2 The host can "bring everyone to this page"; others get a prompt and, if they
  accept, their panel opens at the same page. Nobody is moved without accepting.
- AC7.3 The panel links to the normal `/book/...` reader for reading alone.
- Tests: `05-text-and-notes` › *host brings the group to a page*.

### J8. Leave a note
- AC8.1 Each room has a notes board; a reader can leave a short note (up to 1,000
  characters) linked to a page of the text.
- AC8.2 Notes stay after everyone leaves and are shown, with author display name
  and date, to the next visitors.
- AC8.3 The author can delete their own note; the host can remove any note.
- Tests: `05-text-and-notes` › *a note left today is there tomorrow*.

### J9. Phone and touch
- AC9.1 On a phone the map fits the screen; an on-screen pad and tap-to-walk move
  the character. No keyboard needed.
- AC9.2 Chat, roster and call controls are reachable in a bottom sheet; nothing
  needs hover.
- AC9.3 The phone reader and a desktop reader see each other's movement.
- Tests: `06-phone` › *phone reader walks by touch and is seen from desktop*.

### J10. Privacy: opt-in, invisible, logged-out
- AC10.1 Logged-out visitors never appear and never see people (also J1).
- AC10.2 "Go invisible" removes the reader's avatar and roster entry for everyone
  else immediately; they can still look around. Turning it off brings them back.
- AC10.3 An invisible reader cannot chat or join a call (they would reveal
  themselves); the UI says so.
- AC10.4 Nobody's email, account id or reading history is visible to others.
- Tests: `07-privacy` › *going invisible hides you from others*; *email never shown*.

### J11. Moderation: report and block
- AC11.1 Every person's name opens a menu with Report and Block.
- AC11.2 Block: the blocker no longer sees the blocked person's avatar, messages or
  call tile, and is not seen by them. Takes effect without reload.
- AC11.3 Report: choose a reason, optional text; the host/moderators are told; the
  reporter gets a confirmation. The reported person is not told who reported them.
- AC11.4 The host can remove someone from the room; the removed person sees a plain
  message and cannot re-enter that room for the rest of the session.
- Tests: `08-moderation` › *block hides both ways*; *report reaches the host*;
  *host removes a disruptive person*.

### J12. Accessibility
- AC12.1 Everything works by keyboard: movement, entering rooms, chat, call
  controls, menus. Focus is always visible.
- AC12.2 A **list view** (not a game) shows rooms, who is in each, the next meeting,
  and a Join button; joining from the list puts you in the room with chat and call,
  with no map needed. It is linkable (`?view=list`).
- AC12.3 Screen readers: the map has an accessible name and a text description of
  where you are; arrivals, departures and new messages are announced in a polite
  live region; every control has a label.
- AC12.4 Respects reduced motion (no walking animation) and works at 200% zoom.
- Tests: `09-accessibility` › *keyboard-only: enter a room and send a message*;
  *list view joins a room without the map*; *arrivals are announced*.

### J13. Spanish UI
- AC13.1 `/es/study-rooms` shows the whole interface in Spanish, including the
  consent text, character picker, chat, call and moderation controls.
- AC13.2 Group names stay as named; Círculo en español is listed first in Spanish.
- AC13.3 Spanish and English readers in the same room see each other and each
  other's messages (messages are not translated in Phase 1).
- Tests: `10-spanish` › *Spanish interface end to end*; *mixed-language room*.

### J14. Reconnect after dropping
- AC14.1 If the connection drops, the reader sees "Reconnecting…" and their avatar
  stays in place for others for up to 30 seconds, marked as away.
- AC14.2 On reconnect, they return to the same room and tile, chat history fills in,
  and they rejoin the call if they were in one (asking again only if the browser
  requires it).
- AC14.3 If they do not come back within 30 seconds, others see them leave.
- Tests: `11-reconnect` › *offline and back: same room, others see you return*.

### J15. Empty room / first arrival
- AC15.1 The first person into a room sees a friendly empty state: who usually
  comes, the next meeting time, and (Phase 0) the Meet link.
- AC15.2 The first person can still leave a note and open the text.
- AC15.3 When a second person arrives, the empty state goes away for both.
- Tests: `12-empty-room` › *first arrival sees the empty state; it clears when
  someone joins*.

## 6. Design notes for the build (not decisions)

- **Contract first:** routes and `data-testid`s live in
  `e2e-sims/study-rooms/contract.ts`. Build the UI to match it, or change the
  contract in the same PR as the UI.
- **Positions** are tile coordinates exposed as `data-tile-x` / `data-tile-y` on
  each avatar, so tests and screen-reader text agree with what is drawn.
- **Realtime:** one Supabase Realtime channel per room (presence + broadcast for
  positions and chat); chat and notes persisted server-side. The browser only gets a
  short-lived channel token after the server checks the session.
- **Calls:** LiveKit room per study room; the server mints a token only for a
  signed-in, visible, non-blocked participant. Proximity in the hall by subscribing
  only to nearby participants.
- **Existing code to reuse or retire:** `src/app/api/embassy/{rooms,chat,threads}`
  already holds topic rooms and threaded chat (Mongo-backed); note that
  `GET /api/embassy/rooms` seeds rows on first read, which Study Rooms should not
  copy. `src/app/api/embassy/voice` is the AI Librarian voice agent (ElevenLabs),
  not person-to-person audio.

## 7. Open questions for Derek

1. Who can host a group — only you at first, or named volunteers per group?
2. Do we keep chat history beyond a session (and for how long), or only notes?
3. Is video wanted in Phase 1, or audio-only first (cheaper, kinder on phones)?
4. Should the space be open whenever, or only around scheduled meetings?
5. Test identities: the sims sign in by minting a session for invented users against
   a local server. Should the build add a test-only seed for those users, or create
   them on first entry?

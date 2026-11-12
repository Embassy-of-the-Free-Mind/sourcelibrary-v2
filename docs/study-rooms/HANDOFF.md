# Study Rooms — handoff

Read this first, then `SPEC.md` beside it. State as of 2026-11-12.

## What this is
A 16-bit version of the Embassy of the Free Mind (House with the Heads, Keizersgracht 123) where
signed-in readers walk a pixel character into rooms for study groups, chat, and join proximity
audio/video. Built test-first from simulated user journeys.

## Where things are
- PR #8630 (draft, labels `tier:hold` + `blocked`): https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/8630
  - `docs/study-rooms/SPEC.md` — personas, 15 journeys with acceptance criteria, design references, open questions (§7)
  - `e2e-sims/` — 27 Playwright scenarios, red by design, own config (`npm run test:sims`), refuse to run against production
  - `e2e-sims/study-rooms/contract.ts` — routes and `data-testid`s the build must match
- Moodboard / design references: https://claude.ai/artifact/Nzgjo5sAHmGLwMmsGgbRGN
- Branch worktree on the box: `/root/sourcelibrary/.claude/worktrees/study-rooms-sims` (never edit `/root/sourcelibrary` itself)

## Decided
- Setting: the Embassy house, drawn in 16-bit. Draft floor plan in SPEC "Design references"; Derek will correct rooms.
- Mechanics modelled on Gather (proximity calls, private rooms); engine/maps: WorkAdventure or a light canvas + Tiled maps.
- Planned stack: Supabase Realtime (presence, positions, chat; already a dependency) + LiveKit (audio/video).
- Phase 0 meets on Google Meet: monthly events on Derek's calendar for Platonists' Circle, Ancient Worlds,
  Translators' Room, Círculo en español. No guests invited yet.
- Five groups: Hermetica & Alchemy, Platonists' Circle, Translators' Room, Círculo en español, Ancient Worlds.

## Not done / waiting on Derek
1. Approve or edit the stories in SPEC.md, then remove the `blocked` label. No feature code before that.
2. Answer SPEC §7: who hosts, chat kept or not, audio-only vs video first, always open vs around meetings, test-user seeding.
3. Hermetica & Alchemy calendar event (2nd Tuesday, 18:00 Amsterdam) — creation was blocked; needs Derek.
4. Invite email is drafted (in the original session's chat) but not sent. Any send to readers/volunteers needs Derek's OK.
5. Photos / floor plan of the real house for the pixel art (with the Embassy's permission).
6. Engine choice (WorkAdventure vs custom), sprites (reuse philosopher's-library art vs new tileset). LiveKit beyond free tier costs money — ask first.

## Context from the data (aggregate only)
1,604 written introductions: Hermeticism 437, languages/translation 262, classics 226, Neoplatonism 191,
theology 143, alchemy 118. ~350 prefer Spanish. 1,947 volunteers, none contacted yet.
Do not export readers' names or emails to files; work with aggregates.

## Next step once approved
Build until the sims go green, journey by journey, starting with J1–J4 (arrival, presence) and J12 (list view).

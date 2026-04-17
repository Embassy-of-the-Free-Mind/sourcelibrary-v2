# Handoff: ElevenLabs Voice Research Agent (2026-04-15 to 2026-04-16)

## What Was Built

**Hermes** — a voice research agent for Source Library using ElevenLabs Conversational AI. Users speak naturally and the agent searches 10K+ rare books, reads passages, finds illustrations, and makes cross-cultural connections.

### Production
- **Page:** `/reading-room/voice` on sourcelibrary.org
- **Standalone test site:** `voice-librarian` on Vercel (dereklomas-projects), code at `/Users/dereklomas/voice-librarian/`
- **ElevenLabs Agent:** `agent_9501kp7kydgdeja9swnvzg9t2xwe` ("Hermes — Source Library")

### Architecture
- ElevenLabs handles STT → LLM → TTS via WebRTC
- 4 client tools run in browser, call Source Library APIs:
  - `search_library` → Atlas keyword search (10s timeout)
  - `search_semantic` → Supabase hybrid search (8s timeout) → Atlas keyword fallback
  - `read_page` → MongoDB page content + visual lightbox
  - `search_images` → CLIP visual search + visual lightbox
- Signed URL endpoint at `/api/embassy/voice` (keeps API key server-side)
- Tools extracted to `src/lib/voice/client-tools.ts` (testable, logged)

### UI Features
- Source Library styling (Reading Room hero, warm palette, Cormorant Garamond)
- Visual lightbox — illustrations/page scans appear as Hermes discusses them
- Push-to-talk mode (hold orb or spacebar) + open mic (toggle between)
- Text input alongside voice
- "Tell Hermes" contextual update buttons on source cards
- Transcript with Source Library icon

### Tests (25 passing)
- `tests/unit/voice-client-tools.test.ts` — 20 tests for all 4 tools
- `tests/unit/voice-signed-url.test.ts` — 5 tests for the signed URL endpoint
- Covers: happy paths, API errors, timeouts, semantic→keyword fallback, empty results, broken images, baseUrl

### Logging
- Every tool call: timing (ms), result count, fallback reason
- Session lifecycle: status transitions, errors with context
- Signed URL: latency measurement, warns on >2s
- Unhandled tool calls: console.error (config mismatch detection)

## Supabase Incident (2026-04-16)
- Multiple embedding backfill processes on Hetzner saturated Supabase Postgres
- Autovacuum ANALYZE on `page_translations` blocked all queries (7s+ for simple selects)
- Fixed by killing all backfill processes: `embed-translations.mjs`, `embed-gemini.mjs --full`, `embed-gemini.mjs --incremental`
- Lesson saved: `memory/lesson-supabase-autovacuum-saturation.md`
- NEVER run multiple embedding backfills concurrently

## Agent Config
- Voice: Sarah (EXAVITQu4vr4xnSDxMaL) — mature, confident, American. Stability 0.25, speed 1.1
- Turn: patient eagerness, 10s timeout
- Prompt: globally inclusive (Chinese, Sanskrit, Arabic, Classical, not just Western esotericism)
- force_pre_tool_speech: true (agent talks while tools run)
- Changed via ElevenLabs API (see `scripts/setup-elevenlabs-agent.mjs`)

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/voice/client-tools.ts` | Extracted, tested tool implementations |
| `src/app/reading-room/voice/VoiceAgentClient.tsx` | Main UI component |
| `src/app/reading-room/voice/VoiceAgentLoader.tsx` | ssr:false wrapper |
| `src/app/api/embassy/voice/route.ts` | Signed URL endpoint |
| `scripts/setup-elevenlabs-agent.mjs` | Agent creation/config script |
| `tests/unit/voice-client-tools.test.ts` | 20 tool tests |
| `tests/unit/voice-signed-url.test.ts` | 5 endpoint tests |

## Env Vars
| Var | Where |
|-----|-------|
| `ELEVENLABS_API_KEY` | Vercel + .env.production.local |
| `ELEVENLABS_AGENT_ID` | Vercel + .env.production.local |

## What's Next
1. **Integrate with Reading Room threads** — share research notebook between text Librarian and voice Hermes
2. **Fix Supabase hybrid_search performance** — ANALYZE should finish, then re-enable real semantic search
3. **Restart embedding backfill** (one process only!) after ANALYZE completes
4. **Visual enrichment** — show book covers from search results, not just gallery images
5. **Session persistence** — save voice transcripts, enable resuming conversations
6. **Embed in Reading Room** — mic toggle next to text input, same thread

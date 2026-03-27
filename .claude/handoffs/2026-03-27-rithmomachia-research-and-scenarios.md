# Rithmomachia Research, Testing & Strategy Scenarios

**Date:** 2026-03-27
**Branch:** main (all merged)

## What was done

### 1. Deep source research
Read all five Rithmomachia primary source treatises via OCR:
- Jordanus / Lefèvre d'Étaples (1496, Latin) — 152 pages
- Boissière (1554, French) — 106 pages (partial, reader timed out)
- Lever & Fulke (1563, English) — 97 pages
- Barozzi (1572, Italian) — 66 pages
- Selenus (1616, German/Latin) — 540 pages (Rithmomachia section: pp. 455-540)

### 2. Chapter-level OCR files created
`ocr-output/rithmomachia/chapters/` — 17 files across 3 books for fast research access:
- `lever-fulke-1563/` (6 chapters, 2,748 lines)
- `barozzi-1572/` (6 chapters, 1,753 lines)
- `selenus-1616/` (5 chapters, 1,572 lines)

Boissière and Jordanus not chaptered yet.

### 3. Blog post expanded
Two new sections added to `/blog/rithmomachia`:
- **"The Secrets Hidden in the Rules"** — 7 findings (musical intervals in victories, uncapturable pieces, pyramid knight escape, victory proclamation, Polybius military comparison, three rulesets, Lever's honest admission)
- **Jordanus Pythagorean dialogue** — Alcmeon/Bathillus/Brontinus, color cosmology, "we seek a game, not symbols!", game as philosophical initiation gateway

PR #459 has the first section. The Jordanus section pushed directly to main.

### 4. Game bugs found and fixed
- **Harmonic victory detection broken** — floating point equality on reciprocals (1/3, 1/4, 1/6 differed by 2.8e-17). Fixed with integer cross-multiplication in `victory.ts:isHarmonicProgression`. The game's highest victory was literally impossible to achieve.
- **Piece deselection broken** — clicking same piece during move phase did nothing (phase guard too strict in `game-state.ts:handleSelectPiece`). Fixed to allow select/deselect in both phases.
- **Dark pieces invisible** — odd pieces had stroke `#1a1612` on dark squares `#2a2320`. Changed to warm gray `#8a8278`.

### 5. Test suite created
`tests/rithmomachia/game-logic.test.ts` — 100 tests covering:
- Board setup (piece count, positions)
- Movement for all 4 piece types
- All 6 capture methods with custom board positions
- All 6 victory conditions including philosophical progressions
- Game state reducer (phases, turns, captures)

### 6. Strategy scenarios built
New page at `/rithmomachia/scenarios` with 10 interactive puzzles:

**Capture Puzzles (6):**
- Equality, Addition, Subtraction, Multiplication, Division, Siege
- Each with worked examples cited to Lever, Barozzi, Selenus

**Victory Formations (3):**
- Arithmetic (2, 4, 6), Geometric (2, 4, 8), Harmonic (3, 4, 6)

**Strategic Lessons (1):**
- "Use the Enemy's Pieces" from Barozzi's third rule

Features:
- Cropped board view (pieces + 2-cell padding, not full 8x16)
- Progressive hints
- Success detection per scenario type
- Primary source citations with page-level links
- Source book illustrations shown after solving (Boissière, Selenus engravings)
- URL hash routing (`#capture-siege`, etc.)

### 7. Visual improvements
- Last-move highlight on Board (rust tint on from/to squares)
- Source illustrations in scenario success state
- Dark piece visibility fix

## Key files changed/created

### New files
- `src/lib/rithmomachia/scenarios.ts` — scenario definitions with source citations
- `src/lib/rithmomachia/scenario-state.ts` — state factory + success checking
- `src/components/rithmomachia/ScenarioPlayer.tsx` — interactive puzzle player
- `src/components/rithmomachia/ScenarioSelector.tsx` — categorized list with URL routing
- `src/app/rithmomachia/scenarios/page.tsx` — route page
- `tests/rithmomachia/game-logic.test.ts` — 100 tests
- `ocr-output/rithmomachia/chapters/` — 17 chapter files

### Modified files
- `src/lib/rithmomachia/victory.ts` — fixed harmonic progression (floating point)
- `src/lib/rithmomachia/game-state.ts` — fixed piece deselection
- `src/components/rithmomachia/Board.tsx` — added region prop, last-move highlight
- `src/components/rithmomachia/Piece.tsx` — dark piece visibility
- `src/components/rithmomachia/RithmomachiaGame.tsx` — added scenarios nav link
- `src/app/blog/rithmomachia/page.tsx` — two new sections

## Known remaining work
- Boissière and Jordanus OCR not chaptered yet
- Piece move animation exists in CSS but may not trigger visually (needs browser testing)
- More scenarios could be added (Barozzi has 6 more strategic rules)
- No "reset" button working properly in ScenarioPlayer (uses page reload hack)
- Victory formation scenarios need the player to have pieces on enemy half, which may require multi-move sequences
- The game doesn't implement: pyramid knight escape from siege, prisoner redeployment, the "covert" (discovered attack) rule, or the "forgetting" penalty
- Three different "kinds of play" from Lever & Fulke are not implemented (only the first kind)

## Citation fact-check notes
All Selenus page numbers are SCAN pages (used in `?page=` URLs), not printed page numbers. The offset is ~42 (scan 521 = printed 479). Lever and Barozzi scan pages match printed pages.

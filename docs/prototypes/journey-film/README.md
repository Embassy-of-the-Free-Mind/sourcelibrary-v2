# Journey film prototype (reference for the /how-it-works build)

A self-contained HTML/Three.js prototype that follows one page from scan to citation:
Śāntideva, *Bodhicaryāvatāra* 1.4, page 13 of book `6a308272675ed2bdbe36f649`.
It was made in a Claude Code session on 2026-10-04/05 and approved in direction by Derek.
**It is a reference, not production code.** The build plan is in the GitHub issue that links here.

- `index.html`: the whole film. Everything on screen is a pure function of film time `T`, so scrubbing works. `SEGS` defines the sequence of part cards, 3D scene stretches and real-UI "screens"; `SCREENS` defines the screenshot moves and highlights.
- `img/`: page scans, Bhutanese manuscript covers, and screenshots of the live reader, Trace, Cite and the book page. All are Source Library's own content.

Open locally with any static server that sends `charset=utf-8`. `python3 -m http.server` does NOT, and the Devanagari will then render as mojibake.

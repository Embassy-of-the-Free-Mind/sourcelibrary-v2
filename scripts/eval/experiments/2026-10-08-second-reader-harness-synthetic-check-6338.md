## 2026-10-08 · Can the second-reader harness be trusted before it reads a real page? (#6338)

PRIOR ART: `2026-10-07-script-run-reviewers-6174.md` (the Opus–Opus floor and the headless runner this extends).
Harness: `scripts/eval/second-reader/`; preregistration: `scripts/eval/PREREGISTRATION-second-reader-6338.md`.

**Question.** Before the calibration reads any library page, does every number its decision rests on come out right
on inputs whose answers are known?

**Design.** A synthetic run of 40 one-page books (`tests/unit/second-reader-6338.test.ts`): 10 planted errors, 4
fabricated readers with known behaviour (a primary, a control that finds a little more, a candidate that finds
everything plus two false claims, a candidate that drops a packet), 2 fabricated adjudicators (one dissents twice),
and a by-eye file. Each figure in the report is checked against the count built in. Separately, Krippendorff's α
against the published example (Krippendorff 2011), the Hájek weights against a known frame over 300 draws, and the
sealed runner against a fake CLI and then the real one.

**Result.**
- **Four harness bugs, fixed before any real read (three found by the synthetic run):**
  1. *Matching:* a 10-character gap rule merged two different errors in neighbouring sentences, so a false claim
     vanished into a real error's cluster and the false-alarm count read 1 instead of 2. Now quotes match when they
     overlap or touch the same sentence (long unpunctuated runs in 120-character windows).
  2. *Planting:* the "invented sentence" planter could insert a sentence the page already held (formulaic texts),
     which is not an invented sentence; recall read 8/10 for a reader that caught all 10.
  3. *Sealing:* the image list passed to the sealed folder lost its last line, so every packet's last page went
     to the reader without its image (4 of 5 images per folder).
  4. *Blinding (found reading the code, then pinned by a test):* the insert and drop planters rebuilt the page by
     joining sentences with spaces, flattening every line break and paragraph on a planted page only. A reader
     could have told planted pages from their layout. They now splice the original text in place.
- **`--allowedTools` does not restrict a headless reader** (in this container's permission settings): three Opus
  reads launched by mistake on synthetic packets used Bash 36 times and an MCP server 6 times, and wrote helper
  scripts outside their folder. `claude -p --restricted --tools Read Write --strict-mcp-config` does restrict:
  a Read of a path outside the folder is refused and Bash does not exist (checked with a one-cent Haiku call). The
  calibration runner uses these flags and refuses to run on a CLI without `--restricted`.
  `spot-check/run-reviewers.sh` (shelf overview) still uses `--allowedTools` from the repo root: its readers can
  read the repository, including earlier reviews. Not changed here; raised on #6338.
- **α** reproduces 0.743 / 0.815 / 0.849 (nominal / ordinal / interval) in both the JS harness and
  `review-agreement.py`; on the eternity2 reruns (#6174) α on the serious flag is 0.89, equal to Fleiss' κ, and the
  pairwise rows are byte-identical to the committed `agreement.md`.
- **Weights:** the Hájek-weighted mean over an enriched draw lands within 0.006 of the frame value; the unweighted
  mean overstates it by more than 0.05.

**Replicated?** The synthetic suite runs in CI on every PR (35 tests). No real data yet.

**Cost.** About $1.50 API-equivalent (subscription) for the three accidental Opus reads of synthetic packets
(stopped by hand), $0.0015 for the seal check. $0 API.

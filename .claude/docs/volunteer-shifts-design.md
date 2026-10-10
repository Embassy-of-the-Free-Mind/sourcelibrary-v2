<!-- PRIOR ART: .claude/docs/community-quality-review-design.md — the human review programme (panel + stream,
page_reviews, credit-yes/payment-no); this doc extends it to volunteers working WITH their own Claude, and does not
replace it. .claude/docs/gallery-quality-volunteer-strategy.md — image annotation consensus; reused for the trust
rules. src/app/api/contribute/process/route.ts — the existing bring-your-own-Gemini-key lane; this design does not
copy it (see "What we already have"). -->
# Volunteer shifts: people contributing their own Claude to the library (design)

Status: **Phase 1 built (2026-10-10)**: the MCP tools `start_review_shift` / `submit_page_review`
and `GET /api/review/translation-check/shift`. Written 2026-10-10 from Derek's question "could people contribute
the remaining tokens of their subscriptions, and could we package up jobs for them?" Prior-art
notes and the repository map that fed this are summarised inline. The tracking issue carries the
decisions.

## The question, reframed

The intuitive shape is Folding@home for tokens: a volunteer installs a runner, it pulls jobs, burns
their idle Claude quota headlessly, and pushes results back. **That shape is the one the vendors'
terms rule out**, and it also produces the least useful output we could ask for.

- **Terms.** Anthropic's Claude Code legal page
  (https://code.claude.com/docs/en/legal-and-compliance) says plan limits "assume ordinary,
  individual usage", that Anthropic "does not permit third-party developers ... to route requests
  through Free, Pro, or Max plan credentials on behalf of their users", and that developers "may
  not collect, store, or intermediate Claude.ai credentials or session tokens". The Consumer Terms
  (https://www.anthropic.com/legal/consumer-terms, s.3) bar access "through automated or non-human
  means, whether through a bot, script, or otherwise" except by API key "or where we otherwise
  explicitly permit it". Google's Gemini CLI terms ban driving the service through third-party
  software and Google One bars transferring AI credits. **No clause either way on volunteering
  quota for an open-source project was found** — that is a question to ask, not to assume.
- **Value.** An anonymous headless Claude judging a page is worth little to us: we can run the
  same judge ourselves on our own subscriptions (and do — `scripts/eval/spot-check/`), and an
  unknown engine on an unknown prompt fails the provenance standard
  (`.claude/docs/data-provenance.md`).

What the terms permit, and what we actually lack, are the same thing: **a person, signed in to
their own unmodified Claude, sitting with a page.** The model does the heavy lifting (reads the
image, aligns the transcription, drafts the error list); the person looks, decides and signs. That
is ordinary individual use, it needs no credentials from anyone, and it produces the thing
`community-quality-review-design.md` says is starving the measurement: human-checked anchor pages.
Its corpus-wide claims rest on 32 such pages; Tibetan and Chinese have zero.

So the unit is not "tokens donated" but **a shift**: a volunteer opens Claude, says "give me a
shift", reviews five pages with Claude's help, and submits. Their subscription pays for the
reading; their judgement is the contribution.

## Prior art, and what each lends

| Project | Mechanism | What we take |
|---|---|---|
| BOINC | every job sent to ≥2 hosts, quorum validates, credit only for validated results; *adaptive replication* spot-checks trusted hosts (~10% floor) | redundancy that relaxes with trust; credit only after agreement |
| reCAPTCHA | each task pairs a known control word with an unknown one | hidden gold pages in every packet; gold grows from settled items |
| Distributed Proofreaders | gated rounds (P1 → P2 → P3); later rounds need a track record | round 1 open; adjudication only for proven volunteers |
| Wikisource ProofreadPage | "validated" needs a second, different person | nobody validates their own page |
| Zooniverse | items retire after N classifications, or early on agreement | retirement rule, not fixed N |
| AI Horde | kudos economy; new workers' rewards escrowed until trusted; weak result validation | escrow-until-trusted; reward is priority, never money — and their weak validation is the lesson |
| Chatbot Arena | crowd votes; shown manipulable by a few hundred rigged votes | blind the engine, shuffle order, cap one person's weight |
| Dawid–Skene / Crowd-Kit | latent-class aggregation of noisy labellers | weighted vote + gold first; Dawid–Skene once overlap exists |

**No project was found where volunteers donate LLM subscription quota, or run LLM-as-judge for
someone else.** The nearest bring-your-own-key schemes (OpenRouter, OpenHands) spend a user's key
on that user's own task. This would be new, which is a reason to ask the vendor first.

## What we already have

More than expected. The map, by role:

**Delivery to the volunteer's Claude — the public MCP server.** `src/app/api/mcp/route.ts` is
already a one-click connector in the Claude directory
(https://claude.ai/directory/connectors/source-library) and works in Claude Code. It returns
images in tool results (the in-chat gallery). Its write tools (`submit_feedback`,
`share_findings`, `propose_collection`) already forward to rate-limited REST inboxes with
`guardPublicSubmission` and admin queues. **A connector inside claude.ai is the sanctioned
extension point**: the user's own app, the user's own login, the model calling our tools at the
user's request. Nothing we run touches their credentials. Two new tools —
`start_review_shift` and `submit_page_review` — fit the existing pattern exactly.

**The job pool — `src/lib/review-candidates.ts`.** Serves `/review/*` today: a precomputed pool
with stratum tags, `is_gold` items, `CONSENSUS_TARGET = 3`, "finish what's started first"
ordering, per-volunteer ids, note-only abstention and invite tokens. This is BOINC's scheduler,
already written. Issue #3635 records that the queue is stocked (8,767 items) and showed "Coming
soon". The closest live queue is `translation-check`: 305 audit pages across 15 languages,
served to invited scholars at `/check/[token]` (#5406, strategy #3560), built to calibrate the
Opus judge behind the corpus translation audit (#5274). A shift is that same task with the
volunteer's own Claude beside them; it should draw from the same queue and write the same row
shape, so the two populations can be compared.

**The review instrument — `scripts/eval/spot-check/REVIEWER.md`.** A frozen brief that reads each
page against its image and classes errors with `.claude/docs/page-error-taxonomy.md` codes, with
JSON packets, rights redaction (`redact-rights.mjs`) and agreement scoring
(`review-agreement.py`). The shift prompt is this brief, cut to one volunteer and five pages.

**The record — `page_reviews` as specified in `community-quality-review-design.md`.** Verdict
scale (`faithful | minor_issues | material_error | image_mismatch | not_assessable`), mandatory
abstention, and the rule that a review is bound to the `text_version` it judged. Reviews never
mutate public text.

**Identity and credit.** `src/lib/api-auth.ts` (session / API key / anonymous),
`dataset/api-keys.ts` (issue, rate-limit, revoke per key), `ROLE_LEVEL`. The volunteer pool:
`scripts/maintenance/volunteer-roster.mjs` joins three signup stores (184 signups), of whom the review
design notes 132 signed up and 0 were ever asked for a rating. Decided 2026-08-04: credit yes,
payment no, Spanish UI yes; **who answers volunteers' replies is still open**.

**Not to copy — `/contribute` (`src/app/api/contribute/process/route.ts`).** Volunteers paste a
Gemini API key; a Vercel function runs OCR/translation with it and **writes straight into
`pages`** (`ocr.source: 'contributor'`) with no quarantine, no engine block and no human-edit
guard. It routes a volunteer credential through our server and treats volunteer output as
publishable. This design is its replacement; it should be retired or quarantined separately.

## The design

### Two ways in, one tool surface

1. **claude.ai (the default, for scholars).** Turn on the Source Library connector, say "start a
   review shift". No install, works on the volunteer's Pro/Max plan, human present by construction.
2. **Claude Code plugin (for power users).** `/sourcelibrary-shift` — the same two MCP tools plus a
   skill carrying the brief, so it can open full-resolution images from disk. Still one shift at a
   time, still interactive. **No `--loop`, no headless mode, no `claude -p` recipe in our docs.**

### One shift

1. `start_review_shift({ languages, minutes })` → claims 5 pages (an expiring lease, mirroring
   `scripts/lib/ocr-submit-guard.mjs`): one hidden gold page, up to two pages that already have
   1–2 reviews, the rest fresh; matched to the languages the volunteer reads. Each page carries
   the image, transcription, translation and `text_version`, **with the engine and model hidden**.
2. **Verdict first, Claude second.** For each page the volunteer looks at the image and gives a
   verdict before asking Claude for its reading. Then Claude aligns image ↔ transcription ↔
   translation and lists candidate errors with taxonomy codes; the volunteer accepts, edits or
   rejects each. Both are stored. This ordering is the scientific core: it gives us a human verdict
   *not anchored on the model's* (usable as a calibration anchor) and a paired model judgment on
   the same page (a judge-vs-human agreement study for free). A volunteer who skips straight to
   Claude is still useful, but their rows are flagged `model_drafted` and kept out of the anchor
   set.
3. `submit_page_review(...)` per page → a `page_reviews` row: verdict or `passed_reason`, spans
   with codes, `model_drafted`, the volunteer's own model if they state it (unverified, for
   analysis only), `text_version`, shift id.

### Trust

- **Gold:** one hidden gold page per shift; per-volunteer gold accuracy weights their votes. Pages
  that reach consensus with high-trust reviewers become new gold.
- **Adaptive redundancy:** a page retires after 3 agreeing verdicts (`CONSENSUS_TARGET`), or 2 from
  trusted reviewers; disagreement routes to a `disputed` queue adjudicated by blind model readers on our own
  subscription CLIs (Opus / Fable / Gemini Pro, never the family that produced the text) and by
  proven volunteers — Distributed Proofreaders' later round. **No step waits on staff hours**
  (standing rule, 2026-10-10, #6388 Amendment 2).
- **Agreement on structured fields only** (verdict class, error codes, span location) — free text
  is not reproducible.
- **Blinding and caps:** engine hidden, order shuffled, sign-in required for credit, a daily cap per
  volunteer, no one reviewer can move a book-level figure alone.
- **Measure the cost:** our own CLI adjudication calls per accepted review, so we know what the
  redundancy costs (Transcribe Bentham's lesson, with model time in place of moderator time).

### What a review can change

Evidence, not edits — the same rule as the review design and the actuation rule in `CLAUDE.md`.
A settled `material_error` or `image_mismatch` with taxonomy codes is surfaced on the book's
admin page and in the quality instruments; **a by-eye finding of invented or wrong-leaf text
triggers containment** (`.claude/docs/invariants/containment-on-finding.md`) only after a second
reader — a trusted volunteer or our own model adjudicator opening the image — confirms it, because
one volunteer verdict is not yet "by eye" in our sense. Nothing a volunteer
submits writes to `pages`.

### Corrections (built 2026-10-10)

Reviews are evidence; **corrections change the page**, so they take two steps.

1. **Propose** (`propose_correction`, `POST /api/review/corrections`). During a shift the
   volunteer, with Claude, proposes **span edits** — `{find, replace, reason}` pairs applied to
   the stored raw text, each `find` unique on the page — against the `base_hash` the shift served.
   Span edits, not a retyped page, because the shift shows wrapper-stripped text and a whole-page
   replacement would delete the stored wrappers (page-type envelope, `<meta>`). Refused at once if
   the page changed since it was loaded, a span is absent or repeated, or the book is hidden.
   Stored in `page_corrections` as `proposed`; `pages` is untouched. `drafted_by` records whether
   the wording was the volunteer's, Claude's accepted by the volunteer, or mixed.
2. **Apply** (`scripts/maintenance/apply-page-correction.mjs`), by a **second reader** who has the
   scan open: re-checks the hash, refuses to patch a stale translation, saves a revision and
   confirms it, writes compare-and-set, stamps `source: 'volunteer-correction'` with the
   volunteer as `edited_by` (so the pipeline never overwrites it), logs a `correction_events`
   pair, closes the proposal. Dry run by default. **Actuation:** an OCR correction makes the
   page's machine translation stale, and the stale lane re-translates it under the spend dial.

The second reader is us for now (Derek or a session reading the scan). Phase 2 can let trusted
volunteers apply each other's proposals, Wikisource's two-person rule, or route proposals to a
blind model check against the image first.

### Credit

Named credit on a public methods page and in the TU Delft paper (#4916) for completed shifts,
after the escrow period. Reward is visibility and priority — e.g. a volunteer's own "translate this
book" request moves up the queue (AI Horde's kudos, without the currency). Never money, never
transferable credit.

## Build order

**Phase 0 — demand, no code.** *Decided 2026-10-10 (Derek): no vendor letters. A volunteer using
a connector in their own Claude session for an open-source project is ordinary use; we keep the
shift interactive and publish no headless recipe, and that is the whole precaution.*
1. ~~Write to Anthropic (the Claude for Open Source channel) describing exactly this: volunteers
   using the Source Library connector in their own claude.ai sessions to review pages, human in
   the loop, no credentials, no headless use. Ask whether it is within ordinary use and whether a
   Claude-for-Open-Source grant could extend it. Same note to Google for the Gemini CLI.~~ Dropped.
2. Close the open "who replies to volunteers" decision **without a person**: the shift itself
   replies (an end-of-shift summary with the volunteer's gold result and what happened to their
   pages), and free-text replies go to the feedback queue the `feedback` skill already triages.
3. Demand test: send the 184 signups the connector link and a one-page shift sheet through the
   existing invite-token mail (`/api/review/invite-submit`). If fewer than three people finish a
   shift, tooling will not change it (the review design's Phase 0 test, without the staff hours).

**Phase 1 — the two MCP tools (built).** No new table: a shift row is a `volunteer_ratings` row in
the `translation-check` queue, same verdicts as `/check`, with `detail.via = 'mcp-shift'` carrying
`verdict_before_assistant`, `first_verdict`, `assistant_verdict`, `assistant_findings`,
`text_version` (sha256 prefixes of the stored OCR and translation) and `shift_id`. So shift rows
land in the existing rollup and can be split from website rows by `detail.via`.
`nextCandidate()` gained an optional language filter (`stratum.language`). **Not yet:** a claim
lease (the "finish what's started" ordering spreads load well enough at current volume) and
hidden gold — the `translation-check` pool has **0 gold items** today (425 pages, 15 languages,
measured 2026-10-10), so gold is the first Phase 2 task.

**Phase 2 — aggregation and the anchor feed.** Weighted vote + gold, retirement and the disputed
queue; `calibration-scorecard.mjs` reads un-anchored human verdicts alongside the existing 32.

**Phase 3 — the plugin, credit page, Spanish shift brief.**

## Why volunteers at all, when evals now run on model adjudication

Since 2026-10-10 our own evals adjudicate with blind model readers on the CLIs and plan no human
hours. Volunteers do not reverse that; they add a signal the model panel structurally lacks.
**The family rule** says never score a reader against a key adjudicated by its own family —
every key we can make ourselves is some model family's. A verdict-first volunteer is the one
reader from *no* model family, so a few hundred of them are the check on the model adjudicators
themselves (does Opus-as-judge agree with readers of Latin who looked first?). The programme is
additive: nothing in the measurement pipeline waits for it.

## Open questions

- Anthropic's and Google's answer (Phase 0.1). Until then, nothing ships that encourages
  automated use; the claude.ai connector path alone is ordinary use of a product a user chose.
- Does a model-assisted verdict, given verdict-first, behave like an independent human verdict?
  Testable: compare verdict-first volunteers' agreement with gold against unassisted `/review`
  volunteers'.
- Which languages can the volunteer pool actually read? The roster says Spanish is large; Tibetan
  and Chinese — where anchors are zero — may need targeted recruiting, not a general call.

## Risks

- **Recruiting into silence** (the review design's main risk, already observed: 132 signups, 0
  ratings). Phase 0.2 answers it with automatic replies, not a person who has no hours.
- **The tool descriptions are the only guard on "verdict first".** Nothing stops a client from
  submitting the model's verdict as the user's. `verdict_before_assistant` is self-reported;
  Phase 2 compares its rows with gold before trusting the flag.
- **A grey-zone reading of the terms.** Mitigated by asking first and by never shipping a headless
  path.
- **Volunteer verdicts quoted as quality figures before aggregation.** Every figure carries n,
  date and method (`.claude/docs/quality-statements.md`).
- **The model's opinion laundered as a human's.** The `model_drafted` flag and verdict-first
  ordering exist for this; an anchor set that ignores them is contaminated.

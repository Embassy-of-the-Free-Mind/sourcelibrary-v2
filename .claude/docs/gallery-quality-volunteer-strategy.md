# Gallery quality improvement via volunteers

Date: 2026-05-28
Status: strategy draft, not yet shipped

## The problem this addresses

Source Library has ~128K `gallery_images` (after PR #2096 cleanup), each with AI-generated metadata: `description`, `type`, `gallery_quality`, `bbox`, sometimes `museum_description`, `iconclass_*`, etc. The AI is good enough to surface a gallery but consistently wrong in ways a human spots in two seconds:

- **Type mis-classification**: a chapter heading flagged as "frontispiece", a coat of arms as "diagram".
- **Mis-cropping**: the bbox includes a chunk of marginal text or misses an inset.
- **Generic descriptions**: "An illustration of figures in a landscape" for a recognizable iconographic scene.
- **Quality scoring miscalibrated**: AI gives the same `0.92` to a Maier emblem and to a Loeb library colophon.
- **Subject identification missed**: a Pico della Mirandola portrait labeled as "a man in academic dress".
- **Iconclass codes empty**: the standard art-history classifier we'd like to use isn't populated.

Volunteers can fix all of this *if* the UX makes it easier to verify than to create.

## Principles

1. **Verification > authoring.** Show the volunteer the AI's guess; let them confirm, correct, or skip. A "yes/no/skip" on AI output gets 50× more volunteer throughput than blank-form annotation.
2. **One image at a time.** Card-swiping UX (like Tinder for woodcuts). No "save and continue" forms.
3. **The volunteer's choice of collection.** Let them filter to topics they care about (alchemy, botany, Buddhist iconography, ...). Volunteers who pick their corpus annotate 5-10× faster.
4. **Multi-vote consensus, no single point of trust.** Default to 3 concurring votes before a human value overwrites the AI value. Disagreement queues into expert review.
5. **Attribution is the reward.** Real names (or pseudonyms they pick) credited per image. Source Library is a scholarly project — recognition matters more than badges.
6. **Mobile-first for the swipe layer.** Most volunteers are not at desktops when they have 10 minutes.

## Volunteer segments

| Segment | Time per session | Tasks they can do | Acquisition |
|---|---|---|---|
| **Drive-by** | 2–10 min | Swipe yes/no on AI quality scores. Flag dupes. Vote on crop boxes. | Social link from book pages: "help us label this image". |
| **Engaged hobbyist** | 30 min weekly | Type classification with controlled vocabulary. Subject ID with autocomplete. Better cropping. | Email digest of "books that need you" matched to their interests. |
| **Domain expert (scholar)** | Episodic, deep | Iconclass coding. Authority linking (Wikidata, VIAF). Resolve disagreement queue. Mentor newer volunteers. | Direct outreach. EFM / Ficino Society circles. |

The drive-by tier is where Source Library doesn't have anyone yet and is the highest-leverage to build first.

## Task catalog, ranked by leverage × ease

1. **Quality verify (drive-by)** — "Is this a good gallery image? yes / no / not sure." Sets `gallery_quality_human` after 3 votes. Replaces the AI score on the gallery render pipeline (`deduplicateGalleryImages` already prefers higher quality — it'll pick up automatically). **First to build.**
2. **Type re-classify (drive-by)** — "What is this? frontispiece / woodcut / engraving / map / diagram / portrait / decorative / other." Replaces AI `type`. Same 3-vote consensus.
3. **Dupe spotter (drive-by)** — Show 6-image grid of gallery_images from one book. "Mark any duplicates of each other." Surfaces recurring-template clusters that the bbox+desc-prefix dedup missed.
4. **Crop refine (hobbyist)** — Drag-edit the bbox over the source page image. Diffs above tolerance go into a queue for an admin to apply (since changing bbox triggers thumbnail regen).
5. **Subject ID (hobbyist + expert)** — Free text + Wikidata autocomplete. Writes to `gallery_images.subjects[]`. Backbone for cross-image search ("show me all Mercury figures").
6. **Iconclass coding (expert)** — Drop-in to existing `iconclass_*` schema; integrate the IconClass v3.0 browser as a search widget.
7. **Authority links (expert)** — VIAF / Wikidata / LCNAF on people depicted, places, works. Mirror of the author-authority work in `scripts/enrichment/viaf-author-linking.mjs`.

## Aggregation & data model

New collection `gallery_annotations`:

```
{
  _id, gallery_image_id, volunteer_id, task,           // 'quality_verify' | 'type_reclassify' | ...
  value,                                                // depends on task — bool, enum, free text, bbox
  confidence,                                           // 1-5 if asked
  created_at, ip_hash,
}
```

Materialized fields on `gallery_images`:

```
gallery_quality_human         number          // mean of 3+ votes
gallery_quality_human_n       number          // vote count, surfaced on dashboards
type_human                    string          // consensus value
type_human_disagree           boolean         // 3 votes, no majority — queue for review
subjects_human                Subject[]       // accumulating array
last_human_annotation_at      Date
```

Render order on book pages already prefers higher `gallery_quality`. Switching to `gallery_quality_human ?? gallery_quality` lets human-verified images bubble up automatically with no further pipeline changes.

## Anti-abuse

Lighter than typical wiki-style projects because Source Library is small and contributors are friendly:

- Throttle: 100 annotations / volunteer / day.
- Account required (existing NextAuth login).
- IP hash per annotation; flag clusters of votes from one IP across multiple accounts.
- Reputation: per task, after 3 disagreement-with-consensus votes, that user's votes weight half.
- Override: admins can revert annotations and ban accounts.

Don't build CAPTCHAs or bot-detection until there's evidence of abuse.

## Phase 1 — MVP (one engineer, ~1–2 weeks)

What ships:

- `/contribute/gallery` route — card-swipe UI for **quality verify** only.
- `POST /api/contribute/gallery-annotation` — write annotations.
- `gallery_annotations` Mongo collection + index `{ gallery_image_id, task }`.
- Aggregation worker (cron, 1h) that consensuses 3-vote groups and materializes `gallery_quality_human` onto `gallery_images`.
- `deduplicateGalleryImages` and the gallery render path read `gallery_quality_human ?? gallery_quality`.
- A single "Top contributors" leaderboard page.

Out of scope for phase 1: type re-classification, cropping, subject ID, expert layer.

Success metric: 10 volunteers, 1,000 annotations, ≥100 images with `gallery_quality_human` after first 30 days.

## Phase 2 — Type + dupe (one engineer, ~2 weeks)

Add type-reclassify and dupe-spotter cards to the same swipe UI. Annotation schema generalizes via `task` field. Dupe-spotter writes to a `gallery_dupe_clusters` collection that feeds back into the existing dedup maintenance script (`scripts/maintenance/dedup-book-gallery-images.mjs`) as an exceptions list.

## Phase 3 — Expert tools (open-ended)

Crop-refine UI (probably with Cropper.js or similar). Subject ID with Wikidata. Iconclass tagger. Authority linking. Each is its own surface; build only when there's an expert audience asking for it.

## Things to not build

- A general-purpose annotation framework. Use the simplest possible thing for each task; the whole point is verify-not-author.
- Real-time multiplayer review. Adds operational complexity, no clear ROI.
- A standalone mobile app. Mobile web is fine and removes the App Store overhead.
- Volunteer payments / bounties. Source Library is academic; the audience expects attribution as the reward.

## Integrations to leverage immediately

- **NextAuth sessions** already shared across subdomains (`.sourcelibrary.org` cookie) — volunteers logged in on bph.sourcelibrary.org can annotate from /contribute/gallery without re-logging.
- **Author authority pipeline** (`scripts/enrichment/viaf-author-linking.mjs`) is the template for subject-linking in phase 3.
- **Iconclass codes** already have schema slots in `gallery_images` (`iconclass_*` fields populated for ~few hundred rows from earlier enrichment).
- **Mongo Atlas search** already has gallery search indexed; volunteer-added subjects will be surface-searchable without infra changes.

## Open questions worth deciding before phase 1

1. **Do we let unauthenticated visitors annotate?** Lower friction = more volume, but spam risk and no attribution. Recommendation: require login for write, allow read-only "preview the queue" for unauthenticated.
2. **Which collections to launch with?** Recommendation: pick 2–3 with high quality scores and active interest signals — Alchemy, Hermetic Emblems, Botanical Illustration. Smaller, focused queues outperform "annotate anything".
3. **Default to mobile or desktop for phase 1?** Recommendation: build mobile-first card UI; desktop renders fine as a centered column.
4. **How aggressive should we be about pre-filtering low-quality images out of the queue?** Recommendation: surface them — the AI's `gallery_quality < 0.5` is often the most useful place for human input.

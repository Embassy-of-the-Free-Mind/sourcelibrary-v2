# Collection Exhibition System — Handoff 2026-03-19

## What Was Built

### 1. Curation Script (`scripts/curate-collection.mjs`)
- Inventory builder: pulls books, images, quotes, authors, timeline, sub-collections
- Component palette prompt: AI selects from 12 component types and orders them
- Batch mode: `--batch` runs all 15 core collections
- Save mode: `--save` writes to `curation_drafts` MongoDB collection
- Tested on Alchemy, Demonology, Classical Philosophy — all three selected different component orders based on collection character

### 2. ExhibitionLayout Component (`src/components/collections/ExhibitionLayout.tsx`)
- Renders component palette: hook, description, stats, sections, key_figures, quotes, timeline, featured_image, reading_paths, gallery_grid, cross_collections
- Each component is self-contained with consistent design
- Client component with Link/Image integration

### 3. Collection Page Wiring (`src/app/collections/[id]/page.tsx`)
- Fetches `curation_drafts` in parallel with existing data
- Resolves book references (thumbnails, slugs) for exhibition books
- Renders ExhibitionLayout when exhibition data exists
- Falls back to existing 3-tier highlights for un-curated collections

## Current State
- 3 collections curated and saved: alchemy, demonology, classical-philosophy
- Batch job running for all 15 core collections (may still be in progress)
- Code is committed and pushed to `dev/prototype`
- Preview deploys have been failing due to Atlas timeouts on `/api/dataset/v1/stats` (fixed with `force-dynamic`)

## What Needs Work

### Design Iteration
- The ExhibitionLayout components need visual polish — currently functional but not museum-quality
- The description component should auto-link book titles (like the existing `linkBookTitles` function)
- The timeline component is a simple vertical list — could use the existing `EraTimeline` histogram
- Featured image aspect ratio needs tuning per image
- Mobile responsiveness needs testing

### Curation Quality
- Reading path instructions sometimes come back as "undefined" — the model skips the `instruction` field
- Some sections only get 2-3 books (prompt asks for 4-8)
- The hook quality varies — Demonology was great, Alchemy was good, need to evaluate others
- Quotes are pulled from `reading_summary.quotes` which may not have the best passages

### Homepage Integration
- The featured collection carousel needs to pull from curated data
- The design-options page (Derek's entrypoint work) needs to connect to this data
- The hook/subtitle should feed into the homepage featured section

### Missing Components
- Sub-collections rendering (only Sacred Texts has subs currently)
- Map component (geographic spread) — mentioned but not built
- Social card generation (`/api/collections/[slug]/social-card`)

## Key Files
- `scripts/curate-collection.mjs` — curation script
- `src/components/collections/ExhibitionLayout.tsx` — palette renderer
- `src/app/collections/[id]/page.tsx` — collection page (modified)
- `src/components/collections/EraTimeline.tsx` — existing timeline (not yet integrated with exhibition)
- `.claude/docs/collection-curation-system.md` — full design document
- GitHub issue: #254

## Data
- `curation_drafts` collection in MongoDB — stores generated exhibitions
- `image_source.provider === "efm"` identifies 976 BPH/Embassy books
- `dublin_core.dc_source` has BPH catalog numbers (UBN)
- 48 embedding-based clusters with sub-clusters at 100% coverage
- Faceted tagger was running but may not have completed (check `faceted_tags` coverage)

## Commands
```bash
# Curate one collection
set -a; source .env.production.local; set +a; node scripts/curate-collection.mjs alchemy --save

# Curate all 15 core
set -a; source .env.production.local; set +a; node scripts/curate-collection.mjs --batch --save

# Check what's saved
set -a; source .env.production.local; set +a; node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const drafts = await client.db('bookstore').collection('curation_drafts').find({}, { projection: { collection_slug: 1, 'curation.subtitle': 1 } }).toArray();
  drafts.forEach(d => console.log(d.collection_slug, ':', d.curation?.subtitle));
  client.close();
});
"
```

## Rollback Context
- Featured collection on homepage was rolled back to March 13 version (book-cover carousel, no gallery images)
- The `dev/surgical-featured` branch has today's improvements minus the featured collection redesign (but builds kept failing due to Atlas timeouts)
- `force-dynamic` was added to `/api/dataset/v1/stats` and `/contribute/wikipedia` to fix build timeouts

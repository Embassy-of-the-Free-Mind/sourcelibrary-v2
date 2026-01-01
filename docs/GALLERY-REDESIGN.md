# Visual Encyclopedia of Early Modern Imagery

## Vision

Transform the image gallery from a detection cleanup tool into a scholarly resource for exploring iconographic traditions in early modern esoteric texts.

---

## Information Architecture

```
/gallery                    → Discovery hub (curated, searchable, browseable)
/gallery/image/[id]         → Single image view (detail, annotations, context)
/gallery/collection/[slug]  → Curated collection (e.g., "Alchemical Animals")
/gallery/symbol/[slug]      → All images featuring a symbol (e.g., "green-lion")
/gallery/compare            → Side-by-side comparison tool
```

---

## Core Pages

### 1. Discovery Hub (`/gallery`)

**Purpose:** Invite exploration, not cleanup.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  VISUAL ENCYCLOPEDIA                                        │
│  Early Modern Esoteric Imagery                              │
│                                                             │
│  [Search: symbols, concepts, books...]           [Explore]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  FEATURED                                                   │
│  ┌──────────────────────────────────────────┐              │
│  │                                          │              │
│  │     [Large hero image]                   │              │
│  │     Emblem 21: The Hermaphrodite         │              │
│  │     Atalanta Fugiens (1618)              │              │
│  │                                          │              │
│  └──────────────────────────────────────────┘              │
│                                                             │
│  COLLECTIONS                                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ Animals │ │ Vessels │ │ Planets │ │ Process │          │
│  │   42    │ │   28    │ │   35    │ │   67    │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│                                                             │
│  BROWSE BY BOOK                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │Atalanta │ │Splendor │ │Amphith- │ │Rosarium │          │
│  │Fugiens  │ │ Solis   │ │eatrum   │ │         │          │
│  │  50 img │ │  22 img │ │  89 img │ │  21 img │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│                                                             │
│  RECENT ADDITIONS                                           │
│  [grid of 8 recent images]                                  │
│                                                             │
│  RANDOM DISCOVERY                        [Shuffle →]        │
│  [3 random images with "Explore more" link]                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key features:**
- Featured image rotates (curated or random high-quality)
- Collections are human-curated thematic groupings
- Search works on: description, symbols, book title, encyclopedia terms
- "Random discovery" encourages exploration
- No delete buttons, no admin UI - that's separate

---

### 2. Single Image View (`/gallery/image/[id]`)

**Purpose:** Deep engagement with one image. Context, zoom, annotation, citation.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  ← Back to Gallery                              [Share] [↓] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────┐  SOURCE            │
│  │                                    │  Atalanta Fugiens  │
│  │                                    │  Michael Maier     │
│  │     [Large zoomable image]         │  Oppenheim, 1618   │
│  │     (pan, zoom, full-screen)       │  Page 87           │
│  │                                    │                    │
│  │                                    │  [Read in context →]│
│  │                                    │                    │
│  └────────────────────────────────────┘  SYMBOLS           │
│                                          • Green Lion       │
│  DESCRIPTION                             • Solar King       │
│  Emblem 21 depicts the philosophical     • Devouring        │
│  child nursing from the wolf, recalling                     │
│  the Romulus myth while encoding the     RELATED ENTRIES   │
│  solve et coagula process...             • Solve et Coagula │
│                                          • Philosophical    │
│  [Edit description]                        Mercury          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ANNOTATIONS                                    [+ Add]     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ "The wolf here represents antimony, which 'devours' │   │
│  │  other metals in the alchemical process."           │   │
│  │  — Dr. J. Smith, 2024                    [▲ 12]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  APPEARS ALSO IN                                            │
│  [Thumbnails of similar/related images from other books]    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  CITE THIS IMAGE                                            │
│  Maier, M. (1618). Atalanta Fugiens, p. 87. Source Library  │
│  Edition. https://sourcelibrary.org/gallery/image/abc123    │
│  DOI: 10.5281/zenodo.xxxxx                    [Copy]        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key features:**
- High-quality zoomable image (pan/zoom/fullscreen)
- Direct link to read surrounding text
- Symbols as clickable tags → see all images with this symbol
- Encyclopedia entry links
- Image-level annotations (scholars can contribute interpretations)
- Proper citation with DOI
- "Appears also in" shows iconographic connections
- Share button generates beautiful social card

---

### 3. Collection View (`/gallery/collection/[slug]`)

**Purpose:** Curated thematic groupings with editorial context.

**Example collections:**
- "Alchemical Animals" - lions, eagles, dragons, toads
- "Vessels & Apparatus" - athanors, alembics, furnaces
- "The Great Work" - stages of the opus (nigredo, albedo, rubedo)
- "Philosophers & Adepts" - portraits and figures
- "Cosmic Imagery" - sun, moon, planets, zodiac

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  ALCHEMICAL ANIMALS                                         │
│  42 images from 8 texts                                     │
│                                                             │
│  Animals carry profound symbolic weight in alchemical       │
│  imagery. The green lion devours the sun; the eagle and     │
│  toad represent volatile and fixed principles; the dragon   │
│  or ouroboros symbolizes the unity of opposites...          │
│                                                             │
│  [Read full introduction →]                                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  FILTER BY ANIMAL                                           │
│  [Lion] [Eagle] [Dragon] [Toad] [Wolf] [Serpent] [All]     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │     │ │     │ │     │ │     │ │     │ │     │          │
│  │     │ │     │ │     │ │     │ │     │ │     │          │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘          │
│  Green    Solar   Winged  Dragon  Double  Pelican          │
│  Lion     Eagle   Dragon  & Toad  Eagle                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 4. Symbol View (`/gallery/symbol/[slug]`)

**Purpose:** Track one symbol across the corpus.

```
┌─────────────────────────────────────────────────────────────┐
│  THE GREEN LION                                             │
│  12 appearances across 6 texts                              │
│                                                             │
│  [Encyclopedia entry excerpt about green lion symbolism]    │
│  [→ Full encyclopedia entry]                                │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  TIMELINE                                                   │
│  1550 ──●─────●───●●──────●────●●●───●──●── 1700           │
│         Rosarium  Atalanta     Amphitheatrum               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ALL APPEARANCES                                            │
│  [Grid of all images tagged with "green-lion"]              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Model Changes

### Image (enhanced detection)

```typescript
interface GalleryImage {
  id: string;
  page_id: string;
  book_id: string;

  // Visual data
  bbox: { x: number; y: number; width: number; height: number };
  cropped_url?: string;  // Pre-cropped high-res version

  // Core metadata
  title?: string;        // "Emblem 21: The Philosophical Child"
  description: string;   // Rich description of what's depicted
  type: 'emblem' | 'woodcut' | 'engraving' | 'diagram' | 'symbol' | 'portrait';

  // Iconographic tagging
  symbols: string[];     // ['green-lion', 'sun', 'devouring']
  figures: string[];     // ['king', 'queen', 'hermaphrodite']
  concepts: string[];    // ['solve-et-coagula', 'conjunction']

  // Linked data
  encyclopedia_ids: string[];  // Related encyclopedia entries
  iconclass?: string[];        // Iconclass codes for interoperability

  // Collections
  collection_ids: string[];    // Which curated collections include this

  // Quality/curation
  quality: 'featured' | 'verified' | 'unreviewed';
  featured_at?: Date;

  // Provenance
  detection_source: 'manual' | 'vision_model';
  detected_at: Date;
  verified_by?: string;
  verified_at?: Date;
}
```

### Collection

```typescript
interface Collection {
  id: string;
  slug: string;           // 'alchemical-animals'
  title: string;          // 'Alchemical Animals'
  description: string;    // Rich markdown introduction
  cover_image_id: string;

  // Can be manual curation or rule-based
  type: 'curated' | 'smart';

  // For smart collections
  filter?: {
    symbols?: string[];
    types?: string[];
    books?: string[];
  };

  // For curated collections
  image_ids?: string[];

  display_order: number;
  created_at: Date;
}
```

### Symbol (for iconographic tracking)

```typescript
interface Symbol {
  id: string;
  slug: string;              // 'green-lion'
  name: string;              // 'Green Lion'
  aliases: string[];         // ['leo viridis', 'vitriol']

  description: string;       // What this symbol means
  encyclopedia_id?: string;  // Link to encyclopedia entry
  iconclass_code?: string;   // For interoperability

  image_count: number;       // Denormalized count
}
```

---

## User Journeys

### Scholar researching lion symbolism

1. Search "lion" in gallery
2. See all lion images across corpus
3. Click "Green Lion" symbol tag
4. See 12 appearances with timeline
5. Compare variants side-by-side
6. Read encyclopedia entry on green lion
7. Click through to source texts
8. Add annotation connecting to their research
9. Copy citation for their paper

### Curious browser

1. Land on gallery, see featured emblem
2. Click "Random discovery"
3. Intrigued by strange image, click to view
4. Read description, click symbol tags
5. Fall into collection of related images
6. Click "Read in context" to see surrounding text
7. Now reading Atalanta Fugiens

### Student writing paper

1. Professor assigns Splendor Solis
2. Student browses book's images in gallery
3. Clicks image to see scholarly annotations
4. Reads encyclopedia entries for symbols
5. Uses citation generator for footnotes
6. Downloads high-res for presentation

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Create `gallery_images` collection (extract from page detections)
- [ ] Create `symbols` collection with initial vocabulary
- [ ] Build new single image view with zoom
- [ ] Add symbol tagging UI (admin)
- [ ] Basic symbol filtering

### Phase 2: Discovery
- [ ] Redesign gallery homepage (featured, collections, browse)
- [ ] Create collection system
- [ ] Build symbol tracking pages
- [ ] Add "related images" based on shared symbols
- [ ] Random discovery feature

### Phase 3: Scholarly Features
- [ ] Image-level annotations
- [ ] Citation generator with DOI
- [ ] Comparison tool
- [ ] Timeline visualization
- [ ] IIIF manifest generation

### Phase 4: Community
- [ ] User favorites/bookmarks
- [ ] Personal collections
- [ ] Annotation upvoting
- [ ] Contributor attribution

---

## Separation of Concerns

**Public gallery** (`/gallery/*`)
- Discovery, exploration, scholarship
- No delete buttons
- No "unverified" toggle
- Only shows quality >= 'verified'

**Admin tools** (`/gallery/admin/*`)
- Detection review and cleanup
- Symbol tagging interface
- Collection curation
- Quality control queue

---

## Visual Design Notes

- **Tone:** Scholarly but inviting. Think museum, not database.
- **Typography:** Serif for titles/descriptions (matches reading experience)
- **Color:** Warm stone palette, amber accents (consistent with main site)
- **Images:** Always high quality. Prefer showing fewer, better images.
- **Whitespace:** Generous. Let the art breathe.
- **Mobile:** Image-first. Large tappable targets. Swipe between images.

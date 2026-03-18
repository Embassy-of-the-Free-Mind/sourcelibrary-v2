# Collection Exhibition System: Agent Architecture & Design

## The Problem We're Solving

Source Library has 68 visible collections containing 5,355 books. Each collection currently has:
- An AI-generated description (generic, competent, forgettable)
- AI-ranked highlighted_books (good selections, generic notes)
- AI-selected featured_images (based on quality scores, no narrative intent)

This produces collections that feel like database categories, not curated exhibitions. The result: no reason to share a collection page, no community to target, no story to tell.

## The Vision

Each collection becomes a **publishable exhibition** — something you could tweet, post to a subreddit, or share with a scholarly mailing list. Not "here are 629 alchemy books" but a researched, narrative presentation that answers: *Why do these books exist together? What story do they tell? Why should you — specifically you — care?*

The system produces **complete collection content**, not just highlights:

1. **Narrative architecture** — sections/chapters that organize the collection thematically
2. **Book-level curation** — every significant book annotated in context
3. **Visual identity** — iconic images selected for narrative fit, not just quality
4. **Reading paths** — entry points for different audiences
5. **Community strategy** — who cares and how to reach them
6. **Social assets** — shareable hooks, hero images, tweet-ready copy

## What "Fully Curated" Means

Take Alchemy (533 books, 184K pages, 912 gallery images):

### Current State
```
Title: Alchemy
Subtitle: The Art of Transmutation
Description: "Alchemical treatises on the philosopher's stone, transmutation,
and the Great Work — Paracelsus, Basil Valentine, George Ripley, Nicolas Flamel,
and the practical and spiritual traditions of laboratory alchemy."
```
Generic. Lists names. Says nothing surprising.

### Curated State
```
Title: Alchemy
Subtitle: What the Alchemists Actually Wrote

Sections:
  1. "Before the Stone" — Arabic-Latin transmission (900s-1300s)
     Key texts: Geber's Summa Perfectionis, Turba Philosophorum
     Why it matters: Everything Europeans knew about alchemy came through
     12th-century translations of Arabic texts that were themselves translations
     of Greek texts. The telephone game that built a tradition.

  2. "The Paracelsian Revolution" (1500s)
     Key texts: Paracelsus's complete works, Crollius, Libavius
     Why it matters: Paracelsus threw Avicenna's Canon into a bonfire and
     declared that alchemy wasn't about making gold — it was about making
     medicine. This split the tradition permanently.

  3. "The Emblem Books" (1600s)
     Key texts: Atalanta Fugiens, Splendor Solis, Amphitheatre of Eternal Wisdom
     Why it matters: The most beautiful books in the collection. Maier's Atalanta
     is the only book in history that encodes chemical processes as musical fugues.

  4. "The Secret Fire" — Böhme and spiritual alchemy (1600s-1700s)
     Key texts: Aurora, Mysterium Magnum, Welling's Opus Mago-Cabbalisticum
     Why it matters: The tradition that Jung later called "the projection of
     psychic contents onto matter." These books aren't about chemistry at all.

  5. "Newton's Other Science" (1660s-1720s)
     Key texts: Newton's alchemical manuscripts, Boyle, Starkey
     Why it matters: Newton wrote more about alchemy than physics. Source Library
     has 88 books from this period showing alchemy wasn't fringe — it was the
     mainstream research program.

Reading Paths:
  - "I've never read a primary source" → Start with Hermetic Museum (1678),
    our most-read alchemy book. It's an anthology — like a greatest hits album.
  - "I know about Jung and alchemy" → Skip to section 4. Read Böhme's Aurora
    alongside Khunrath's Amphitheatre. Then go back and see what they were
    actually reading — section 1.
  - "I'm a chemist curious about history" → Start with section 2 (Paracelsus).
    Then read Libavius's Alchymia (1597) — arguably the first chemistry textbook.
  - "I just want to see the pictures" → Gallery: 261 emblems, 331 engravings,
    124 woodcuts. Start with Splendor Solis.

Community Targets:
  - r/alchemy (15K), r/occult (400K), r/Jung (50K)
  - History of Science Society mailing list
  - @AlchemyMuseum, @ChemHeritage on Twitter
  - WitchTok angle: "We translated 533 alchemy books. Here's what they
    actually say about the Philosopher's Stone."

Hook: "Newton wrote more about alchemy than physics. We translated his sources."
```

That's what curated means. It requires *knowing things* — about the field, about the books, about the audiences.

## Agent System Architecture

### Overview

Five specialized agents, run sequentially (each builds on the previous output):

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Inventory   │───▶│  Research   │───▶│  Narrative   │
│   Agent      │    │   Agent     │    │   Agent      │
└─────────────┘    └─────────────┘    └──────┬───────┘
                                             │
                                    ┌────────┴────────┐
                                    │                  │
                               ┌────▼─────┐    ┌──────▼──────┐
                               │  Visual   │    │  Community   │
                               │  Curator  │    │  Strategist  │
                               └────┬──────┘    └──────┬───────┘
                                    │                  │
                                    └────────┬─────────┘
                                             │
                                    ┌────────▼────────┐
                                    │   Compositor     │
                                    │  (assembles +    │
                                    │   renders page)  │
                                    └─────────────────┘
```

### Agent 1: Inventory Agent

**Purpose:** Produce a complete statistical and structural profile of the collection.

**Inputs:** Collection slug

**Process:**
1. Pull all books with full metadata (title, author, year, language, pages, translation %, readership, cross-collection memberships)
2. Pull all gallery images with metadata (type, quality, descriptions, dimensions)
3. Compute:
   - Chronological distribution (by decade/century)
   - Language distribution
   - Author frequency (who appears most?)
   - Translation completeness
   - Readership distribution (which books actually get read?)
   - Cross-collection overlap (what other collections share these books?)
   - Image type distribution (emblems, engravings, diagrams, etc.)
   - Gaps: books with 0% translation, books with no thumbnail

**Output:** Structured JSON profile + narrative summary. Example:
```json
{
  "slug": "alchemy",
  "book_count": 533,
  "chronological_center": "1620s",
  "dominant_languages": ["German (34%)", "Latin (33%)", "English (14%)"],
  "key_authors": ["Paracelsus (16)", "Böhme (15)", "Basilius Valentinus (7)"],
  "readership_top_10": [...],
  "cross_collections": {"hermetica": 391, "natural-philosophy": 259, ...},
  "gallery_profile": {"total": 912, "emblems": 261, "engravings": 331, ...},
  "notable_gaps": ["No Ripley Scroll", "Flamel texts are 19th-c compilations"],
  "unique_holdings": ["Newton alchemical MSS", "Complete Theatrum Chemicum"]
}
```

**Tools needed:** MongoDB queries only. No AI model needed.

### Agent 2: Research Agent

**Purpose:** Understand the scholarly context — what is this field, who studies it, what are the canonical texts, what's the current state of scholarship.

**Inputs:** Inventory profile + collection slug

**Process:**
1. Web search for:
   - "history of [field] primary sources"
   - "[field] canonical texts bibliography"
   - "best books about [field] scholarly"
   - "[field] reddit community" / "[field] twitter scholars"
   - Recent conferences, publications, debates in the field
2. Cross-reference search results against our inventory:
   - Which canonical texts do we have? Which are we missing?
   - How does our collection compare to what scholars consider essential?
3. Research the *people* in the collection:
   - Who are the key figures? What's their story?
   - What connections exist between authors? (teacher-student, rivals, contemporaries)
4. Research the *visual tradition*:
   - What are the iconic images of this field?
   - Do we have them? (e.g., Splendor Solis plates, Ripley Scroll)

**Output:** Research dossier including:
- Scholarly periodization (how experts divide the history of this field)
- Canonical texts checklist (have / don't have / have but untranslated)
- Key figures with brief bios
- Current communities and where they gather online
- What makes our collection special vs. what's available elsewhere
- Recommended reading order from scholarly sources

**Tools needed:** Web search, web fetch, Gemini/Claude for synthesis.

**Critical design need:** The research agent must actually KNOW things or LEARN things. Not just summarize our metadata. It needs to understand that Maier's Atalanta Fugiens contains musical scores for each emblem — that's not in our metadata, it's domain knowledge. The web search step is essential for this.

### Agent 3: Narrative Agent

**Purpose:** Design the exhibition — the thesis, sections, book-level notes, and reading paths.

**Inputs:** Inventory profile + Research dossier

**Process:**
1. Design 3 narrative variations (Scholar / Explorer / Connector)
2. For each variation:
   a. Write the subtitle (max 10 words)
   b. Write the description (2-3 sentences, museum-wall-text quality)
   c. Design 3-6 thematic sections that organize the collection
   d. For each section: select 3-8 key books with contextual notes
   e. Design 2-4 reading paths for different audiences
   f. Write the shareable hook

**Prompt design — this is the hardest part:**

```
You are the chief curator at Source Library, a digital library of 5,355
translated pre-modern texts. You're preparing an exhibition for the
"{collection_name}" collection.

## Your Materials

### Collection Inventory
{inventory_profile}

### Scholarly Context
{research_dossier}

### The Actual Books (sorted by reader engagement)
{full_book_list_with_stats}

## Your Task

Design an exhibition that organizes this collection into a narrative.
Not a database — a story.

### Rules

1. SECTIONS: Divide the collection into 3-6 thematic sections. Each section
   should have:
   - A title that tells you something (not "Early Works" — that's a filing
     cabinet, not a story)
   - A 2-3 sentence description explaining what unites these books
   - 3-8 key books from our actual holdings, with notes that explain why
     each book matters IN THIS SECTION (not a generic summary)

2. BOOK NOTES: Must reference specific content. Bad: "A comprehensive treatise
   on alchemical philosophy." Good: "The only book in history where chemical
   processes are encoded as musical fugues — each of 50 emblems has its own
   three-voice canon." You have the research dossier — use it.

3. READING PATHS: 2-4 paths for different audiences. Each path should name
   specific books and explain the order. Don't be generic — "start with this
   book BECAUSE [specific reason]."

4. DESCRIPTION: 2-3 sentences for the collection page. Write like a museum
   curator, not a marketing department. No "delve into", "rich tapestry",
   "fascinating journey", "comprehensive collection". Be specific. Be surprising.
   Mention something most people don't know.

5. HOOK: One tweet-length sentence that would make someone click. The best hooks
   contain a surprising fact. "Newton wrote more about alchemy than physics" is
   good. "Explore our alchemy collection" is nothing.

6. Every book you reference MUST exist in the book list provided. Do not
   hallucinate titles.

### Output THREE variations:

**A. "The Scholar"** — For researchers. Precise periodization, canonical works,
emphasis on primary sources now available in translation for the first time.
The person reading this has a PhD or is working on one.

**B. "The Explorer"** — For curious people who've heard of the topic but never
read primary sources. Sense of wonder. Accessible entry points. "You know
about X? Here's what the actual alchemists wrote about it."

**C. "The Connector"** — For people in adjacent fields who don't know this
collection exists. Emphasize cross-tradition links. "If you study [adjacent
field], you need to see this." Think: art historians, chemists, psychologists,
religious studies scholars.
```

**Output:** Three complete exhibition designs, each with sections, book selections, reading paths, description, and hook.

**Tools needed:** Gemini 2.5 Pro or Claude Opus (needs strong writing + factual accuracy + ability to follow complex instructions).

### Agent 4: Visual Curator

**Purpose:** Select images that define the collection's visual identity.

**Inputs:** Inventory profile + Narrative designs + all gallery images for collection

**Process:**
1. For each narrative variation, select:
   - 1 hero image (the single image that IS this collection)
   - 1 image per section (represents that section's theme)
   - 5-8 "gallery highlights" for the collection page showcase
2. Selection criteria:
   - Visual impact (would you stop scrolling?)
   - Narrative fit (does it represent what this section is about?)
   - Diversity (not all from the same book)
   - Technical quality (resolution, clarity)
3. For each selected image, write a 1-line curator's note explaining the choice

**Critical design need:** This agent needs VISION. It should actually look at the images, not just read their text descriptions. Use the `extracted_url` to fetch and evaluate images visually.

**Tools needed:** Multimodal model (Gemini 2.5 Pro with vision, or Claude with vision). Image fetching.

### Agent 5: Community Strategist

**Purpose:** Identify target audiences and design the release strategy.

**Inputs:** Narrative designs + collection profile

**Process:**
1. For each collection, identify 3-5 specific communities:
   - Academic communities (societies, journals, mailing lists, conferences)
   - Online communities (subreddits, Discord servers, Twitter accounts/hashtags)
   - Adjacent interest communities (unexpected connections)
   - Cultural/aesthetic communities (BookTok, DarkAcademia, WitchTok, etc.)
2. For each community:
   - What's the angle? (Why would THEY care?)
   - What's the specific share text? (Platform-appropriate)
   - What image works best for this audience?
   - What time of year / cultural moment to release? (e.g., Newton alchemy around Christmas, the anniversary of his death, etc.)
3. Design the release sequence:
   - Which collection to release first (viral potential × content readiness)
   - 1-2 releases per week cadence
   - Each release is a "moment" — coordinated social posts

**Tools needed:** Web search (to find actual communities, subreddit sizes, Twitter accounts), Gemini/Claude for strategy.

### Agent 6: Compositor

**Purpose:** Assemble everything into a reviewable format.

**Inputs:** All agent outputs

**Process:**
1. Assemble 3 complete exhibition packages
2. Save to `curation_drafts` collection in MongoDB
3. Render on comparison page at `/admin/curate/[slug]`
4. After human approval, save to collection document

## Data Schema

### What gets saved to each collection document:

```typescript
interface CuratedExhibition {
  // Identity
  subtitle: string;                    // "What the Alchemists Actually Wrote"
  description: string;                 // Museum-quality wall text
  hook: string;                        // Tweet-length shareable line

  // Narrative structure
  sections: Array<{
    title: string;                     // "The Paracelsian Revolution"
    description: string;               // 2-3 sentences
    period?: string;                   // "1500s-1600s"
    books: Array<{
      book_id: string;
      note: string;                    // Contextual note, not summary
      position: number;
    }>;
    hero_image?: {
      image_id: string;
      curator_note: string;
    };
  }>;

  // Reading paths
  reading_paths: Array<{
    audience: string;                  // "I've never read a primary source"
    description: string;               // Brief profile of who this is for
    steps: Array<{
      book_id: string;
      instruction: string;             // "Start here because..."
    }>;
  }>;

  // Visual identity
  hero_image: {
    image_id: string;
    curator_note: string;
  };
  gallery_highlights: Array<{
    image_id: string;
    curator_note: string;
    position: number;
  }>;

  // Community strategy
  target_audiences: Array<{
    name: string;                      // "Jungian psychologists"
    platform: string;                  // "reddit", "twitter", "academic"
    channels: string[];                // ["r/Jung", "r/alchemy"]
    angle: string;                     // "The texts Jung was reading..."
    share_text: string;                // Ready-to-post copy
    best_image_id?: string;            // Image that works for this audience
  }>;

  // Meta
  variation: string;                   // Which variation was approved
  curated_at: Date;
  curated_by: 'agent' | 'human' | 'mixed';
  research_dossier?: string;           // Markdown, for future reference
}
```

### What gets saved to `curation_drafts`:

```typescript
interface CurationDraft {
  collection_slug: string;
  created_at: Date;
  status: 'draft' | 'approved' | 'rejected';

  inventory_profile: object;           // Agent 1 output
  research_dossier: string;            // Agent 2 output (markdown)

  variations: {
    scholar: CuratedExhibition;
    explorer: CuratedExhibition;
    connector: CuratedExhibition;
  };

  approved_variation?: string;
  human_edits?: object;                // Tracked modifications
}
```

## Comparison Page Design (`/admin/curate/[slug]`)

Three columns, each showing a complete exhibition:

```
┌─────────────────┬─────────────────┬─────────────────┐
│   THE SCHOLAR   │   THE EXPLORER  │  THE CONNECTOR  │
├─────────────────┼─────────────────┼─────────────────┤
│  [Hero Image]   │  [Hero Image]   │  [Hero Image]   │
│  Subtitle       │  Subtitle       │  Subtitle       │
│  Description    │  Description    │  Description    │
│  Hook           │  Hook           │  Hook           │
├─────────────────┼─────────────────┼─────────────────┤
│  Section 1      │  Section 1      │  Section 1      │
│  - Book A       │  - Book C       │  - Book E       │
│  - Book B       │  - Book D       │  - Book F       │
│  Section 2...   │  Section 2...   │  Section 2...   │
├─────────────────┼─────────────────┼─────────────────┤
│  Reading Paths  │  Reading Paths  │  Reading Paths  │
├─────────────────┼─────────────────┼─────────────────┤
│  Communities    │  Communities    │  Communities    │
│  - r/alchemy    │  - WitchTok     │  - ChemHeritage │
│  [Approve]      │  [Approve]      │  [Approve]      │
└─────────────────┴─────────────────┴─────────────────┘
```

Also supports mixing: pick the Scholar's sections but the Explorer's description.

## Release Prioritization

### Tier 1: Largest communities, most visual collections
1. **Demonology & Witchcraft** (209 books) — WitchTok (millions), r/occult (400K), horror history. Hook: "We translated 209 books the Inquisition tried to destroy."
2. **Alchemy** (533 books) — r/alchemy, r/occult, r/Jung, chemistry history. The richest visual collection (912 images).
3. **Sacred Texts** (1,125 books) — r/AcademicBiblical (250K), r/religion, interfaith communities. Massive, needs strong sections.
4. **Art & Illustrated Books** (311 books) — r/ArtHistory, BookTok, museum communities. Visual goldmine.

### Tier 2: Passionate niche communities
5. **Kabbalah** (231 books) — Jewish mysticism communities, academic Jewish studies
6. **Classical Philosophy** (622 books) — r/philosophy (18M), academic classics
7. **Chinese Classics** (429 books) — r/ChineseHistory, sinology, martial arts philosophy
8. **Forbidden Books** (128 books) — Censorship history, intellectual freedom communities

### Tier 3: Surprising/viral potential
9. **Courts of Wonder** (39 books) — Wunderkammer aesthetic, design Twitter
10. **Theatres of Machines** (20 books) — Engineering history, maker community
11. **The Bestiary Tradition** (16 books) — Medieval art, fantasy illustration communities
12. **Strategy Games** (15 books) — r/chess, gaming history, Rithmomachia angle

## Infrastructure Needs

1. **Curation script** — `scripts/curate-collection.mjs [slug]`
   - Runs all 5 agents sequentially
   - Saves drafts to `curation_drafts` collection
   - Outputs comparison page URL

2. **Comparison page** — `/admin/curate/[slug]`
   - Server-rendered from `curation_drafts`
   - "Approve" button saves to collection document
   - "Mix" mode for combining elements across variations

3. **Collection page updates** — `/collections/[slug]`
   - Render sections, reading paths, gallery highlights from curated data
   - Graceful fallback to current layout for un-curated collections

4. **Homepage integration** — The featured collection carousel uses curated data:
   - Pulls from approved exhibitions
   - Uses the hook as tagline
   - Uses curator-selected hero image
   - Shows section-aware book selections (not random)

5. **Social sharing** — `/api/collections/[slug]/social-card`
   - Generate OG images with hero image + hook text
   - Platform-specific formats (Twitter card, Reddit preview)

## What This Changes

Before: "We have 68 categories of books."
After: "We're releasing a curated exhibition on [topic] with [surprising fact]. Here's what [historical figure] actually wrote about [thing you care about]."

The collection page goes from a filterable book list to an exhibition you'd want to share. Each release becomes a social media moment targeting a specific community. The content is the marketing.

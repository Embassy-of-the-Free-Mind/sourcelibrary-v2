# Curator Workflow

## Daily Operation

### During Acquisition Sessions

**Continue using `curatorreports.md` as master log:**
- Keep appending session reports to curatorreports.md
- Document all acquisitions, analysis, themes
- This is your working document - no changes to current workflow

### After Completing a Session

**Extract structured data (optional, can batch):**

1. **Create session file** (when convenient):
   ```bash
   # Extract session 026 content into separate file
   # This can be done manually or with a script
   cp portion_of_curatorreports.md curator-data/sessions/session-026.md
   ```

2. **Create collections** (when themes emerge):
   - Identify coherent thematic groupings
   - Create JSON metadata file
   - Create markdown narrative (optional)

## Creating a New Collection

### 1. Identify the Theme

Look for:
- Chronological narratives (e.g., "Ancient to Modern")
- Conceptual threads (e.g., "Spontaneous Order")
- Geographic/cultural traditions (e.g., "Brehon Law")
- Specific topics (e.g., "Music & Acoustics")
- Author networks (e.g., "Scottish Enlightenment")

### 2. Create JSON Metadata

```json
{
  "id": "unique-kebab-case-id",
  "title": "Full Descriptive Title",
  "shortTitle": "Short Title",
  "description": "1-2 sentence description",
  "dateRange": { "start": YYYY, "end": YYYY },
  "themes": ["Theme1", "Theme2"],
  "sections": [
    {
      "title": "Section Title",
      "period": "Historical Period",
      "bookIds": ["id1", "id2"],
      "keyAuthors": ["Author1"],
      "keyConcepts": ["Concept1"]
    }
  ],
  "featuredOn": "homepage",
  "displayOrder": 1
}
```

### 3. Update Master Index

Add entry to `curator-data/index.json`:

```json
{
  "collections": [
    // ... existing collections
    {
      "id": "new-collection-id",
      "title": "New Collection Title",
      "path": "collections/new-collection-id.json",
      "featured": true,
      "displayOrder": 4
    }
  ]
}
```

### 4. Create Narrative (Optional)

Create `collections/[id].md` with:
- Curatorial essay
- Context and significance
- Reading paths through the collection
- Research questions it enables

## Collection Ideas from Session 026

### Already Created
✅ Natural Law Genealogy (Ancient → Modern)
✅ Brehon Law & Stateless Order
✅ Royal Society Music & Acoustics

### Could Be Created

**"Harmony & Order Across Traditions"**
- Pythagorean harmony (Wallis, North)
- Physiocratic natural order (Quesnay)
- Moral harmony (Hutcheson, Shaftesbury)
- Economic harmony (Bastiat, Carey)
- Spontaneous order (Hayek)

**"Vibration Theory: Physics to Psychology"**
- Hooke's vibration experiments (1680s)
- Wallis on vibrating strings
- Hartley's vibration theory of association (1749)
- Connections to modern neuroscience

**"Scottish Enlightenment Lineage"**
- Shaftesbury → Hutcheson → Hume → Smith
- Teacher-student relationships
- Evolution of moral sense theory
- From moral philosophy to political economy

**"Ancient Virtue Ethics to Modern Economics"**
- Aristotle: Eudaimonia, virtue, exchange
- Aquinas: Natural law basis for property
- Smith: Moral sentiments, prudence
- Austrian school: Praxeology, human action

**"Alchemical Visual Tradition"**
- Splendor Solis
- Rosarium Philosophorum
- Mylius Basilica Philosophica
- Emblematic knowledge transmission

## Maintenance Schedule

### Monthly
- Review recent acquisitions for collection opportunities
- Update index.json with new collections
- Ensure featured collections are current

### Quarterly
- Extract recent sessions into session files
- Review collection metadata for accuracy
- Consider creating seasonal featured collections

### Annually
- Archive old curatorreports.md (rename to curatorreports-2026.md)
- Start fresh curatorreports.md for new year
- Update all collection statistics
- Review and refresh featured collections

## Tips for Good Collections

### Size
- **Small** (3-10 books): Focused, specific theme
- **Medium** (10-25 books): Thematic arc or tradition
- **Large** (25+ books): Comprehensive genealogy

### Narrative
- Tell a story of intellectual development
- Show evolution of ideas
- Highlight connections between authors
- Explain historical context

### Metadata
- Be specific with themes and concepts
- Include date ranges for quick filtering
- Tag geographic origins
- Note intellectual influences

### Research Value
- Explain what questions the collection enables
- Suggest research paths
- Note gaps or future acquisitions needed
- Connect to modern scholarship

## Example: Creating "Harmony Economics" Collection

1. **Identify books** from Session 026:
   - Quesnay: Tableau Oeconomique (1758)
   - Bastiat: Harmony of Interests (1850)
   - Carey: Harmony of Interests (1851)
   - Carey: Unity of Law (1872)
   - Plus connections to: Hutcheson (beauty/harmony/order), Smith (invisible hand)

2. **Define theme**: How "harmony" rhetoric appears across different economic traditions

3. **Structure sections**:
   - Pythagorean/Musical Harmony (Wallis, North)
   - Moral Harmony (Shaftesbury, Hutcheson)
   - Physiocratic Harmony (Quesnay)
   - Free Trade Harmony (Bastiat)
   - American System Harmony (Carey)
   - Spontaneous Order (Hayek)

4. **Write significance**: Traces how metaphor of "harmony" migrates from music → morals → economics

5. **Create files**:
   - `collections/harmony-economics.json`
   - Update `index.json`
   - Optional: `collections/harmony-economics.md`

## Tools & Scripts

### List all book IDs from a session
```bash
grep 'Book ID:' curatorreports.md | grep -A1 "Session 026" | awk '{print $4}'
```

### Validate JSON
```bash
jq empty curator-data/collections/*.json
jq empty curator-data/index.json
```

### Count collections
```bash
jq '.collections | length' curator-data/index.json
```

### Find collections by theme
```bash
jq '.collections[] | select(.themes[] | contains("Natural Law"))' curator-data/index.json
```

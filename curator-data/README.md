# Curator Data Structure

## Directory Layout

```
curator-data/
├── sessions/           # Individual session reports (markdown)
│   ├── session-001.md
│   ├── session-026.md
│   └── ...
├── collections/        # Featured thematic collections (JSON + markdown)
│   ├── natural-law-genealogy.json
│   ├── natural-law-genealogy.md
│   ├── brehon-law.json
│   └── ...
└── index.json         # Master index of all sessions and collections
```

## Format Specifications

### Session Files (`sessions/session-NNN.md`)
- Markdown format
- Contains: acquisitions list, analysis, thematic notes
- One file per session for easy retrieval

### Collection Files (`collections/`)
- **JSON file**: Machine-readable metadata
  - Collection ID, title, description
  - List of book IDs
  - Themes, date range, significance
- **Markdown file**: Human-readable narrative
  - Curatorial essay
  - Book descriptions
  - Research value

### Index File (`index.json`)
- List of all sessions with metadata
- List of all collections
- Quick lookup for LLM agents

## Usage

### For LLM Agents
- Read `index.json` to find relevant sessions/collections
- Load specific session or collection files as needed
- Avoids loading entire 214KB curator report

### For Frontend (Featured Collections)
- Read collection JSON files
- Display curated thematic groupings
- Link to individual books

### For Curator Reports
- Keep appending to `curatorreports.md` as master log
- Extract sessions periodically into separate files
- Create collections from notable acquisitions

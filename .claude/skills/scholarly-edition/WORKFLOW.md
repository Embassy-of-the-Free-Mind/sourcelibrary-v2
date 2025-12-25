# Scholarly Edition Workflow

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber

    participant User as Human Editor
    participant UI as Web Interface
    participant API as Source Library API
    participant AI as AI Models (Gemini)
    participant Zenodo as Zenodo (CERN)

    Note over User,Zenodo: Phase 1: Content Preparation (Human + AI)

    User->>UI: Upload book scans
    UI->>API: Store page images
    API-->>UI: Book created

    User->>UI: Start OCR processing
    UI->>API: POST /process (ocr)
    loop Each page
        API->>AI: Vision OCR request
        AI-->>API: Extracted Latin text
        API->>API: Store OCR result
    end
    API-->>UI: OCR complete

    User->>UI: Review OCR quality
    Note right of User: Human reviews<br/>AI transcription

    User->>UI: Start translation
    UI->>API: POST /process (translate)
    loop Each page
        API->>AI: Translation request
        AI-->>API: English translation
        API->>API: Store translation
    end
    API-->>UI: Translation complete

    User->>UI: Review translations
    User->>UI: Edit/correct if needed
    Note right of User: Human QA of<br/>AI translations

    Note over User,Zenodo: Phase 2: Indexing & Summary (AI)

    User->>UI: Generate index & summary
    UI->>API: POST /summarize
    API->>AI: Analyze all pages
    AI-->>API: Keywords, people, concepts, summary
    API-->>UI: Index complete

    Note over User,Zenodo: Phase 3: Edition Creation (Human + AI)

    User->>UI: Click "Create Edition"
    UI->>API: POST /front-matter
    API->>AI: Generate Introduction
    AI-->>API: Scholarly introduction
    API->>AI: Generate Methodology
    AI-->>API: Translation methodology
    API-->>UI: Front matter ready

    rect rgb(255, 250, 230)
        Note over User,UI: Human Review Gate
        User->>UI: Open Edition Review page
        UI->>API: GET edition preview
        API-->>UI: Full edition content

        User->>UI: Review Introduction
        User->>UI: Review Methodology
        User->>UI: Edit if needed
        User->>UI: Preview EPUB

        alt Approved
            User->>UI: Click "Approve & Publish"
        else Needs Changes
            User->>UI: Edit content
            User->>UI: Re-review
        end
    end

    Note over User,Zenodo: Phase 4: Publication (Software + External)

    UI->>API: POST /editions (create)
    API->>API: Calculate content hash
    API->>API: Snapshot page IDs
    API-->>UI: Edition created (draft)

    User->>UI: Click "Mint DOI"
    UI->>API: POST /editions/mint-doi

    API->>Zenodo: Create deposit
    Zenodo-->>API: Deposit ID

    API->>Zenodo: Upload metadata
    Note right of Zenodo: Title, authors,<br/>license, keywords
    Zenodo-->>API: OK

    API->>Zenodo: Upload translation file
    Zenodo-->>API: File stored

    API->>Zenodo: Publish deposit
    Zenodo->>Zenodo: Mint DOI
    Zenodo-->>API: DOI assigned

    API->>API: Store DOI in edition
    API-->>UI: DOI: 10.5281/zenodo.xxxxx

    UI-->>User: Edition published!

    Note over User,Zenodo: Phase 5: Distribution (Automated)

    User->>UI: Download Scholarly EPUB
    UI->>API: GET /download?format=scholarly
    API->>API: Generate EPUB with DOI
    API-->>UI: EPUB file
    UI-->>User: Download complete
```

## Responsibility Matrix

| Phase | Step | Who/What | Description |
|-------|------|----------|-------------|
| **Preparation** | Upload | Human | Scan and upload page images |
| | OCR | AI (Gemini Vision) | Extract text from images |
| | OCR Review | Human | Quality check transcription |
| | Translation | AI (Gemini) | Translate to English |
| | Translation Review | Human | Quality check, edit translations |
| **Indexing** | Analysis | AI (Gemini) | Extract keywords, people, concepts |
| | Summary | AI (Gemini) | Generate book summary |
| **Edition** | Front Matter | AI (Gemini) | Generate Introduction & Methodology |
| | Review | **Human** | **Approve content before publication** |
| | Edit | Human | Make corrections if needed |
| | Version | Software | Create edition snapshot, calc hash |
| **Publication** | DOI Request | Software | API call to Zenodo |
| | Metadata | Software | Upload citation metadata |
| | File Upload | Software | Upload translation text |
| | DOI Mint | Zenodo (CERN) | Assign permanent identifier |
| **Distribution** | EPUB | Software | Generate downloadable file |
| | Access | Zenodo | Host permanent record |

## Human Checkpoints

The workflow has **3 critical human review points**:

1. **OCR Quality Review** - After AI transcription, human verifies accuracy
2. **Translation Review** - After AI translation, human checks meaning & style
3. **Edition Approval** - Before DOI minting, human reviews complete package

The **Edition Approval** checkpoint is the final gate before permanent publication. Once a DOI is minted, the content cannot be changed (only new versions can be created).

## Color Legend

| Color | Meaning |
|-------|---------|
| Human Editor | Manual review and decisions |
| Web Interface | User-facing application |
| Source Library API | Backend processing |
| AI Models | Automated content generation |
| Zenodo | External DOI registry |

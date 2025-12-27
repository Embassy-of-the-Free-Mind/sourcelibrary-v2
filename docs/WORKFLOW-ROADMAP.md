# Source Library: Roadmap & Workflow

## Mission

Digitize, OCR, and translate the foundational texts of Western philosophy, mathematics, and science—prioritizing the **earliest printed editions** available on Internet Archive.

## Priority Framework

### 1. Chronological Priority (Earliest First)
- **Incunabula (pre-1501)**: Highest priority - these are the first printed editions
- **1501-1550**: High priority - early Renaissance
- **1551-1600**: Medium priority - late Renaissance
- **1601-1700**: Lower priority - early modern

### 2. Influence Priority
Works that shaped later intellectual history:
- Philosophy: Plato, Aristotle, Neoplatonists, Ficino
- Mathematics: Euclid, Archimedes, Apollonius
- Astronomy: Ptolemy, Copernicus, Kepler
- Natural Philosophy: Aristotle, Bacon, Galileo

### 3. Current Focus: Marsilio Ficino
Ficino is central to the Renaissance revival of ancient wisdom. His translations and commentaries made Plato, Plotinus, and the Hermetica accessible to the West.

**Active Digitization Queue:**

| Work | Date | IA Identifier | Pages | Status |
|------|------|---------------|-------|--------|
| Theologia Platonica | 1482 | `ita-bnc-in2-00001718-002` | 100 | Processing |
| De vita libri tres | 1489 | `ita-bnc-in2-00001718-001` | 379 | Processing |
| Epistolae | 1497 | `epistolaemarsili00fici` | 498 | In Library |
| Platonis Opera | 1518 | `bub_gb_QOkjvOBiQAUC` | 634 | Processing |
| Theologia Platonica | 1525 | `bub_gb_mLvcAyPxuQoC` | 306 | Processing |
| De Mysteriis | 1497 | (user upload) | ~200 | In Library |

---

## Workflow: Import → OCR → Translate

### Step 1: Find Source on Internet Archive

Search for early editions:
```bash
# Search archive.org for works
# Look for Latin editions from pre-1550
# Verify date from colophon/metadata
```

Key signals for authentic early editions:
- Colophon with printer name and date
- "incunabulum" or "incunabula" in metadata
- Library source (BnF, British Library, etc.)

### Step 2: Import from Internet Archive

```bash
curl -X POST "https://sourcelibrary.org/api/import/ia" \
  -H "Content-Type: application/json" \
  -d '{
    "ia_identifier": "ita-bnc-in2-00001718-002",
    "title": "Platonica theologia de immortalitate animorum",
    "display_title": "Platonic Theology (1482 First Edition)",
    "author": "Ficino, Marsilio (1433-1499)",
    "language": "Latin",
    "published": "1482",
    "categories": ["neoplatonism", "florentine-platonism", "philosophy"],
    "dublin_core": {
      "dc_identifier": ["IA:ita-bnc-in2-00001718-002"],
      "dc_source": "https://archive.org/details/ita-bnc-in2-00001718-002",
      "dc_publisher": "Antonio Miscomini",
      "dc_date": "1482-11-07"
    }
  }'
```

### Step 3: Create OCR Job

```bash
# Fetch book and get page IDs
BOOK_ID="YOUR_BOOK_ID"
curl -s "https://sourcelibrary.org/api/books/$BOOK_ID" > /tmp/book.json
OCR_IDS=$(jq '[.pages[] | select((.ocr.data // "") | length == 0) | .id]' /tmp/book.json)

# Create job
curl -X POST "https://sourcelibrary.org/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"batch_ocr\",
    \"book_id\": \"$BOOK_ID\",
    \"book_title\": \"Your Book Title\",
    \"model\": \"gemini-2.5-flash\",
    \"language\": \"Latin\",
    \"page_ids\": $OCR_IDS
  }"
```

### Step 4: Process OCR Job

```bash
# Start processing (runs in batches of 5)
curl -X POST "https://sourcelibrary.org/api/jobs/JOB_ID/process"

# Check status
curl "https://sourcelibrary.org/api/jobs/JOB_ID"
```

### Step 5: Create Translation Job

After OCR completes:
```bash
# Get pages with OCR but no translation
TRANS_IDS=$(jq '[.pages[] | select((.ocr.data // "") | length > 0) | select((.translation.data // "") | length == 0) | .id]' /tmp/book.json)

curl -X POST "https://sourcelibrary.org/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"batch_translate\",
    \"book_id\": \"$BOOK_ID\",
    \"book_title\": \"Your Book Title\",
    \"model\": \"gemini-2.5-flash\",
    \"language\": \"Latin\",
    \"page_ids\": $TRANS_IDS
  }"
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/import/ia` | POST | Import book from Internet Archive |
| `/api/books` | GET | List all books |
| `/api/books/[id]` | GET | Get book with pages |
| `/api/jobs` | POST | Create processing job |
| `/api/jobs/[id]` | GET | Check job status |
| `/api/jobs/[id]/process` | POST | Process next batch |
| `/api/process/batch-ocr` | POST | Direct OCR (5 pages max) |
| `/api/process/batch-translate` | POST | Direct translate (10 pages max) |

---

## Models

| Model | Use Case | Speed | Quality |
|-------|----------|-------|---------|
| `gemini-2.5-flash` | Default for most texts | Fast | Good |
| `gemini-3-flash-preview` | Complex layouts, tables | Medium | Best |
| `gemini-2.0-flash` | Simple, clear text | Fastest | Basic |

---

## Monitoring

### Check All Jobs
```bash
curl "https://sourcelibrary.org/api/jobs" | jq '.jobs[] | {id, type, status, progress}'
```

### Check Book Progress
```bash
curl "https://sourcelibrary.org/api/books/BOOK_ID" | jq '{
  title: .title,
  pages: (.pages | length),
  ocr: [.pages[] | select((.ocr.data // "") | length > 0)] | length,
  translated: [.pages[] | select((.translation.data // "") | length > 0)] | length
}'
```

### Jobs Dashboard
Visit: https://sourcelibrary.io/jobs

---

## Roadmap Page

The public roadmap is at `/roadmap` and includes:
- Ancient Foundations (Euclid, Plato, Aristotle, Ptolemy)
- Renaissance Philosophy (Ficino, Pico, Hermetica)
- Mathematics & Astronomy (Copernicus, Kepler)
- Natural Philosophy (Galileo, Vesalius, Bacon)
- Esoteric Traditions (Agrippa, Bruno, Kircher)

---

## Rate Limits & Troubleshooting

### Internet Archive
- IA may rate-limit image requests
- Failed pages can be retried
- Some scans have missing pages

### Gemini API
- API key rotation is automatic
- Rate limits: ~60 requests/minute per key
- Failed pages marked as `retryable: true`

### Retry Failed Pages
```bash
# Get failed page IDs from job
curl "https://sourcelibrary.org/api/jobs/JOB_ID" | jq '[.job.results[] | select(.status == "failed") | .pageId]'

# Create new job with just failed pages
```

---

## Next Steps

1. Complete OCR for current Ficino queue
2. Run translation jobs after OCR completes
3. Import Plato Opera (1484 Florence first edition - if available)
4. Import Plotinus Enneads (Ficino 1492)
5. Expand to Euclid Elements (1482 Ratdolt)

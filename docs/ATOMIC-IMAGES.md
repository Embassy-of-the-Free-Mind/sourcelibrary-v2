# Atomic Images: The Visual Knowledge Unit

This document describes Source Library's approach to making historical illustrations citable, searchable, and shareable as individual units.

## The Vision

Every illustration in a historical text becomes an **atomic unit** - a standalone, addressable piece of knowledge that can be:
- **Cited** with a permanent URL and scholarly reference
- **Searched** by description, type, and content
- **Shared** on social media with rich previews
- **Connected** to encyclopedia entries and other texts

## The Atomic Image

An atomic image is a single detected illustration with:

```typescript
interface AtomicImage {
  // Identity
  id: string;                    // Format: "{pageId}:{detectionIndex}"
  pageId: string;                // Parent page
  detectionIndex: number;        // Position in detected_images array

  // Content
  description: string;           // What it depicts
  type: 'emblem' | 'woodcut' | 'engraving' | 'diagram' | ...;

  // Location (for cropping)
  bbox: {
    x: number;      // 0-1 normalized, left edge
    y: number;      // 0-1 normalized, top edge
    width: number;  // 0-1 normalized
    height: number; // 0-1 normalized
  };

  // Provenance
  detection_source: 'ocr_tag' | 'vision_model' | 'manual';
  model?: 'gemini' | 'mistral' | 'grounding-dino';
  confidence?: number;           // 0-1, how confident the detection

  // Curation
  gallery_quality?: number;      // 0-1, how gallery-worthy
  gallery_rationale?: string;    // Why it scored high/low
  featured?: boolean;            // Human-approved for gallery

  // Context
  book: { id, title, author, year, doi };
  pageNumber: number;
}
```

## The Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│   DETECT    │ -> │   LOCALIZE   │ -> │   CURATE    │ -> │   SERVE     │
│             │    │              │    │             │    │             │
│ OCR tags    │    │ Bounding     │    │ Quality     │    │ Gallery     │
│ images in   │    │ boxes from   │    │ scoring     │    │ API serves  │
│ translation │    │ vision model │    │ decides     │    │ atomic      │
│             │    │ or manual    │    │ gallery-    │    │ images      │
│             │    │              │    │ worthiness  │    │             │
└─────────────┘    └──────────────┘    └─────────────┘    └─────────────┘
```

### 1. Detection (Finding Images)

**Automated via OCR:**
- OCR generates `<image-desc>` tags when it encounters illustrations
- Legacy: `[[image: description]]` syntax
- These create detection records with `detection_source: 'ocr_tag'`

**Example OCR output:**
```
<image-desc>An emblem showing a lion devouring a serpent</image-desc>
```

### 2. Localization (Bounding Boxes)

**Automated via Vision Models:**
```bash
POST /api/extract-images
{
  "bookId": "...",
  "model": "gemini",  // or "mistral", "grounding-dino"
  "limit": 20
}
```

**Batch Processing:**
```bash
POST /api/jobs
{
  "type": "batch_extract_images",
  "book_id": "...",
  "page_ids": ["page1", "page2", ...]
}
```

**Manual via Review UI:**
- `/gallery/review` - Draw boxes directly on page images
- Creates detections with `detection_source: 'manual'`

### 3. Curation (Gallery Quality)

**Automated Scoring (0.0 - 1.0):**
- `0.9-1.0`: Exceptional (striking emblems, significant scenes)
- `0.7-0.9`: Good (clear subject matter, interesting)
- `0.4-0.7`: Moderate (standard frontispieces, simple diagrams)
- `0.0-0.4`: Low (ornaments, borders, marbled papers)

**Scoring Criteria:**
- Visual appeal
- Historical/scholarly significance
- Uniqueness
- Composition quality
- Shareability on social media

**Manual Override:**
- Set `featured: true` to force gallery inclusion
- Set `featured: false` to exclude despite high score

### 4. Serving (Gallery API)

**List gallery images:**
```bash
GET /api/gallery?verified=true&bookId=...
```
- Returns images with bboxes from vision/manual sources
- Sorted by: manual first, then by confidence

**Single image with context:**
```bash
GET /api/gallery/image/{pageId}:{index}
```
- Returns full context including book, citation, cropped URL

**Social sharing:**
- `/gallery/image/{id}` - Detail page with zoom and share
- `/gallery/image/{id}/opengraph-image` - Generated preview cards

## Data Model

### Page Document
```typescript
page: {
  id: string;
  book_id: string;
  page_number: number;
  photo: string;                 // Full page image
  cropped_photo?: string;        // Cropped version (split pages)

  detected_images?: [{
    description: string;
    type?: string;
    bbox?: { x, y, width, height };
    confidence?: number;
    gallery_quality?: number;
    gallery_rationale?: string;
    featured?: boolean;
    detection_source: 'ocr_tag' | 'vision_model' | 'manual';
    model?: 'gemini' | 'mistral' | 'grounding-dino';
    detected_at?: Date;
  }];
}
```

### Gallery Item Response
```typescript
{
  pageId: string;
  bookId: string;
  pageNumber: number;
  detectionIndex: number;
  imageUrl: string;              // Cropped if bbox exists
  description: string;
  type?: string;
  bbox?: { x, y, width, height };
  confidence?: number;
  gallery_quality?: number;
  model?: string;
  bookTitle: string;
  author?: string;
  year?: number;
}
```

## Key Files

| Purpose | Path |
|---------|------|
| Types | `/src/lib/types.ts` (DetectedImage interface) |
| Gallery API | `/src/app/api/gallery/route.ts` |
| Single Image API | `/src/app/api/gallery/image/[id]/route.ts` |
| Extraction API | `/src/app/api/extract-images/route.ts` |
| Job Processing | `/src/app/api/jobs/[id]/process/route.ts` |
| Review UI | `/src/app/gallery/review/page.tsx` |
| Image Detail Page | `/src/app/gallery/image/[id]/page.tsx` |
| OpenGraph Image | `/src/app/gallery/image/[id]/opengraph-image.tsx` |
| Crop API | `/src/app/api/crop-image/route.ts` |

## Usage Examples

### Extract images for a book
```bash
# Create extraction job
curl -X POST /api/jobs \
  -d '{"type":"batch_extract_images","book_id":"abc123"}'

# Or direct API call (limited pages)
curl -X POST /api/extract-images \
  -d '{"bookId":"abc123","model":"gemini","limit":20}'
```

### Get gallery-worthy images
```bash
# All verified images
curl '/api/gallery?verified=true'

# Filter by quality (in gallery UI, threshold at 0.7)
# High-quality images shown first

# Specific book
curl '/api/gallery?verified=true&bookId=abc123'
```

### Share an image
```
https://sourcelibrary.org/gallery/image/69099f06cf28baa1b4caeb51:0
```

The page provides:
- Zoomable cropped image
- Book context and citation
- Twitter/Bluesky share buttons
- Link to source page for reading

## Design Decisions

1. **ID Format**: `{pageId}:{index}` allows stable references even as detections change. The index is the position in the `detected_images` array at time of creation.

2. **Normalized Coordinates**: Bounding boxes use 0-1 normalized values for cross-resolution compatibility. Cropping happens at display time.

3. **Gallery Quality vs Confidence**:
   - `confidence` = how sure we found an image
   - `gallery_quality` = how good it is for the gallery
   - High confidence + low quality = correctly detected boring image

4. **Manual Priority**: Manual detections sort before vision model ones. Human curation trumps AI scoring.

5. **Lazy Cropping**: Images are cropped on-demand via `/api/crop-image`. No pre-generated crops needed.

## Future Enhancements

- **Semantic Search**: Search images by visual similarity or symbolic content
- **Encyclopedia Links**: Connect images to encyclopedia entries (the Great Work, mercury, etc.)
- **Cross-References**: "Similar images in other texts"
- **Annotations**: Community annotations on specific images
- **Collections**: User-curated galleries of related images

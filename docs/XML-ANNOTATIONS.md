# XML Annotation System

Source Library uses XML-style tags for annotating OCR transcriptions and translations. This system is aligned with TEI (Text Encoding Initiative) conventions for scholarly text encoding.

## Tag Categories

### Metadata Tags (Hidden from readers)
These tags capture page-level information that's extracted and displayed in the metadata panel but not shown inline.

| Tag | Purpose | Example |
|-----|---------|---------|
| `<lang>` | Source language | `<lang>Latin</lang>` |
| `<page-num>` | Printed page number | `<page-num>42</page-num>` |
| `<folio>` | Folio reference | `<folio>12r</folio>` |
| `<sig>` | Printer's signature | `<sig>A2</sig>` |
| `<header>` | Running header | `<header>Chapter III</header>` |
| `<meta>` | Page metadata | `<meta>Fraktur script, good quality</meta>` |
| `<warning>` | OCR quality issues | `<warning>damaged page corner</warning>` |
| `<abbrev>` | Abbreviation expansion | `<abbrev>ꝙ → quod</abbrev>` |
| `<vocab>` | Key terms (OCR) | `<vocab>azoth, prima materia</vocab>` |
| `<summary>` | Page summary | `<summary>Discusses the three principles</summary>` |
| `<keywords>` | English keywords | `<keywords>alchemy, transmutation</keywords>` |

### Display Tags (Visible to readers)
These tags render as styled inline annotations in the reading view.

| Tag | Purpose | Styling |
|-----|---------|---------|
| `<note>` | Editorial note | Amber background |
| `<margin>` | Marginal note | Teal with left border |
| `<gloss>` | Interlinear gloss | Purple background |
| `<insert>` | Later insertion | Green background |
| `<unclear>` | Illegible text | Gray italic with ? |
| `<term>` | Technical term | Indigo background |
| `<image-desc>` | Image description | Amber block with [Image: ...] |

## Usage in Prompts

OCR prompts should instruct the model to use these tags:

```
**Metadata tags (hidden from readers):**
<meta>X</meta> <page-num>N</page-num> <header>X</header> <vocab>X</vocab>

**Inline annotations (visible to readers):**
<note>X</note> <margin>X</margin> <term>X</term> <image-desc>description</image-desc>
```

Translation prompts should preserve all XML tags from OCR and add:
- `<summary>` - 1-2 sentence page summary
- `<keywords>` - English keywords for indexing

## Backward Compatibility

The system supports both the new XML syntax and legacy bracket syntax:

| New (XML) | Legacy (Bracket) |
|-----------|------------------|
| `<note>text</note>` | `[[note: text]]` |
| `<margin>text</margin>` | `[[margin: text]]` |
| `<lang>Latin</lang>` | `[[language: Latin]]` |
| `<page-num>42</page-num>` | `[[page number: 42]]` |
| `<vocab>term1, term2</vocab>` | `[[vocabulary: term1, term2]]` |

All extraction and rendering functions handle both syntaxes.

## Validation

The QA system (`/book/[id]/qa`) validates:
- Unclosed XML tags
- Unknown tag types
- Empty tags
- Nested brackets (legacy)
- Unbalanced centering markers

## Migration

To migrate prompts stored in MongoDB to the new XML syntax:

```bash
# Check current prompt versions
GET /api/admin/migrate-prompts

# Dry run
POST /api/admin/migrate-prompts
Body: {}

# Execute migration
POST /api/admin/migrate-prompts
Body: { "dryRun": false }
```

This creates new versions of prompts with the updated syntax while preserving version history.

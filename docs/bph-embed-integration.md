# BPH Digital Catalogue — Integration Guide

> For the Webflow developer integrating the Bibliotheca Philosophica Hermetica
> digital catalogue into the Embassy of the Free Mind website.

**Base URL:** `https://bph.sourcelibrary.org` (pending DNS setup)
**Preview URL:** `https://sourcelibrary-v2-git-feat-bph-embed-api-dereklomas-projects.vercel.app`

---

## 1. Iframe Embed

The iframe renders the full reading experience — catalogue browsing, book reader,
page viewer, search. All navigation stays inside the iframe.

```html
<iframe
  id="bph-catalogue"
  src="https://bph.sourcelibrary.org/embed/bph"
  style="width: 100%; height: 80vh; border: none;"
  allow="clipboard-write"
  loading="lazy"
></iframe>
```

### Iframe Pages (slug-based routing)

| Page | iframe src path | Description |
|------|----------------|-------------|
| Catalogue | `/embed/bph` | Paginated grid of all BPH books with search |
| Catalogue + search | `/embed/bph?q=astrology` | Pre-filtered search results |
| Book detail | `/embed/bph/book/{slug}` | Single book with metadata + reader link |
| Book reader | `/book/{slug}` | Full page reader (OCR + translation) |
| Page viewer | `/book/{slug}/page/{pageId}` | Single page with image + text |
| Collection areas | `/embed/bph/collections` | Grid of subject areas |
| Collection area | `/embed/bph/collections/{slug}` | Books in a subject area |

### Listening for Navigation Events

When a user navigates inside the iframe, it sends a `postMessage` to the parent
window. Use this to update the browser URL bar on the Webflow side:

```javascript
window.addEventListener('message', (event) => {
  // Only accept messages from our embed
  if (event.origin !== 'https://bph.sourcelibrary.org') return;

  const { type, path, book, page } = event.data;

  if (type === 'sl-navigate') {
    // Update Webflow URL to reflect iframe state
    // e.g., /bibliotheca-philosophica-hermetica/catalogue?book=aurora-boehme
    const params = new URLSearchParams();
    if (book) params.set('book', book);
    if (page) params.set('page', page);
    const qs = params.toString();
    const newUrl = `/bibliotheca-philosophica-hermetica/catalogue${qs ? '?' + qs : ''}`;
    window.history.replaceState(null, '', newUrl);
  }
});
```

### Deep Linking into the Iframe

To open the iframe at a specific book (e.g., from a Webflow URL with `?book=aurora-boehme`):

```javascript
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const book = params.get('book');
  const page = params.get('page');
  const q = params.get('q');

  const iframe = document.getElementById('bph-catalogue');
  let src = 'https://bph.sourcelibrary.org/embed/bph';

  if (book) {
    src = `https://bph.sourcelibrary.org/embed/bph/book/${book}`;
    if (page) src += `/page/${page}`;
  } else if (q) {
    src += `?q=${encodeURIComponent(q)}`;
  }

  iframe.src = src;
});
```

---

## 2. REST API

All endpoints are **public, read-only, CORS-open**. No API key required.
Responses are JSON. All endpoints accept `GET` only.

### Base URL

```
https://bph.sourcelibrary.org/api/embed/bph
```

---

### `GET /api/embed/bph/stats`

Aggregate statistics for the BPH digital collection.

**Response:**

```json
{
  "total": 2317,
  "translated": 1842,
  "languages": 12,
  "language_list": ["Arabic", "Dutch", "English", "French", "German", "Greek", "Hebrew", "Italian", "Latin", "Portuguese", "Spanish", "Swedish"],
  "pages_total": 485230,
  "pages_translated": 312450
}
```

**Use case:** Display stats on the BPH overview page, e.g.:
- "2,317 digitized texts"
- "312,450 pages translated"
- "12 languages"

---

### `GET /api/embed/bph/books`

Paginated catalogue of all BPH books. Supports search and filtering.

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search query (min 2 chars). Searches title, author, display title. |
| `limit` | number | 24 | Results per page (max 100) |
| `offset` | number | 0 | Pagination offset |
| `sort` | string | `title` | Sort: `title`, `date_asc`, `date_desc`, `recent` |
| `language` | string | — | Filter by original language (e.g., `Latin`, `German`) |
| `category` | string | — | Filter by collection slug (e.g., `alchemy`, `hermetica`) |
| `year_from` | number | — | Min publication year |
| `year_to` | number | — | Max publication year |
| `translated` | `"true"` | — | Only show books with English translations |

**Response:**

```json
{
  "books": [
    {
      "id": "abc123",
      "slug": "aurora-boehme",
      "title": "Aurora, oder Morgenröthe im Auffgang",
      "display_title": "Aurora, or The Morning Redness in the Rising",
      "author": "Jacob Boehme",
      "language": "German",
      "published": "1634",
      "year": 1634,
      "pages_count": 312,
      "pages_translated": 312,
      "thumbnail": "https://cdn.sourcelibrary.org/thumbs/aurora-boehme.jpg",
      "catalogue_number": "BPH Catalogue (UBN: 1234)",
      "categories": ["alchemy", "mysticism", "theosophy"],
      "url": "/book/aurora-boehme"
    }
  ],
  "total": 2317,
  "limit": 24,
  "offset": 0
}
```

**Examples:**

```
# First page of all books
/api/embed/bph/books

# Search for "alchemy"
/api/embed/bph/books?q=alchemy

# Latin books, oldest first
/api/embed/bph/books?language=Latin&sort=date_asc

# Page 2 of results
/api/embed/bph/books?offset=24&limit=24

# Books with translations in the Hermetica collection
/api/embed/bph/books?category=hermetica&translated=true
```

---

### `GET /api/embed/bph/books/{slug}`

Look up a single BPH book by slug or ID.

**Response:**

```json
{
  "id": "abc123",
  "slug": "aurora-boehme",
  "title": "Aurora, oder Morgenröthe im Auffgang",
  "display_title": "Aurora, or The Morning Redness in the Rising",
  "author": "Jacob Boehme",
  "language": "German",
  "published": "1634",
  "year": 1634,
  "pages_count": 312,
  "pages_translated": 312,
  "pages_ocr": 312,
  "thumbnail": "https://cdn.sourcelibrary.org/thumbs/aurora-boehme.jpg",
  "catalogue_number": "BPH Catalogue (UBN: 1234)",
  "description": "First edition of Boehme's foundational theosophical work...",
  "summary": "A visionary cosmological text that describes the origin of all things...",
  "categories": ["alchemy", "mysticism", "theosophy"],
  "chapters": [
    { "title": "Chapter 1: Of the First Root of the Tree", "startPage": 5 }
  ],
  "doi": "10.5281/zenodo.12345",
  "is_first_translation": true,
  "provider": "Embassy of the Free Mind",
  "url": "/book/aurora-boehme"
}
```

---

### `GET /api/embed/bph/collections`

List all collection areas (subject categories) that contain BPH books.

**Response:**

```json
{
  "collections": [
    {
      "slug": "alchemy",
      "name": "Alchemy",
      "description": "The art of transformation — from Jabir ibn Hayyan to Isaac Newton.",
      "subtitle": "Transmutation & the Philosopher's Stone",
      "image": { "url": "https://cdn...", "alt": "..." },
      "item_count": 487
    },
    {
      "slug": "hermetica",
      "name": "Hermetica",
      "description": "Texts attributed to Hermes Trismegistus...",
      "subtitle": null,
      "image": null,
      "item_count": 234
    }
  ]
}
```

---

### `GET /api/embed/bph/collections?slug={slug}`

Get a single collection area with its BPH books (paginated).

**Additional parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `slug` | string | required | Collection slug |
| `limit` | number | 24 | Books per page |
| `offset` | number | 0 | Pagination offset |
| `sort` | string | `title` | Sort: `title`, `date_asc`, `date_desc` |

**Response:**

```json
{
  "collection": {
    "slug": "alchemy",
    "name": "Alchemy",
    "description": "The art of transformation...",
    "subtitle": "Transmutation & the Philosopher's Stone",
    "image": { "url": "...", "alt": "..." },
    "item_count": 487,
    "books": [ ... ],
    "total": 487,
    "limit": 24,
    "offset": 0
  }
}
```

---

## 3. Webflow Integration Recipes

### Stats Counter on Homepage

```html
<div id="bph-stats"></div>

<script>
fetch('https://bph.sourcelibrary.org/api/embed/bph/stats')
  .then(r => r.json())
  .then(data => {
    document.getElementById('bph-stats').innerHTML = `
      <div class="stat">${data.total.toLocaleString()} digitized texts</div>
      <div class="stat">${data.pages_translated.toLocaleString()} pages translated</div>
      <div class="stat">${data.languages} languages</div>
    `;
  });
</script>
```

### Search Box That Opens Catalogue

```html
<form onsubmit="searchBPH(event)">
  <input type="text" id="bph-search" placeholder="Search the collection..." />
  <button type="submit">Search</button>
</form>

<script>
function searchBPH(e) {
  e.preventDefault();
  const q = document.getElementById('bph-search').value;
  // Option A: Navigate to catalogue page with query
  window.location.href = `/bibliotheca-philosophica-hermetica/catalogue?q=${encodeURIComponent(q)}`;
  // Option B: Update iframe src directly
  // document.getElementById('bph-catalogue').src =
  //   `https://bph.sourcelibrary.org/embed/bph?q=${encodeURIComponent(q)}`;
}
</script>
```

### Collection Area Grid (Pure Webflow + API)

```html
<div id="collection-areas" class="w-dyn-list"></div>

<script>
fetch('https://bph.sourcelibrary.org/api/embed/bph/collections')
  .then(r => r.json())
  .then(({ collections }) => {
    const grid = document.getElementById('collection-areas');
    grid.innerHTML = collections.map(c => `
      <a href="/bibliotheca-philosophica-hermetica/collection-areas?area=${c.slug}"
         class="collection-card">
        <h3>${c.name}</h3>
        <p>${c.description || ''}</p>
        <span class="count">${c.item_count} items</span>
      </a>
    `).join('');
  });
</script>
```

---

## 4. Styling & Branding

The iframe content has **no Source Library header or footer**. It's a clean
content area designed to sit inside the EFM/BPH Webflow chrome.

The embed uses a neutral color palette that works with the EFM brand:
- Background: `#fafaf8` (warm white)
- Text: `#1c1917` (near-black)
- Accent: configurable via CSS custom property `--bph-accent`

To override styles from the parent page, pass a theme parameter:

```
/embed/bph?theme=dark    — dark background
/embed/bph?theme=light   — light background (default)
```

---

## 5. Preventing Link Escape

When users cmd+click or right-click → "Open in new tab" on a book link inside
the iframe, the browser opens the raw Source Library URL. We handle this with:

1. **All links inside the iframe use `target="_self"`** — normal clicks stay in the iframe.
2. **New-tab opens redirect to the Webflow parent.** If the server detects the request
   isn't inside an iframe (missing `Sec-Fetch-Dest: iframe`), it redirects to
   the configured Webflow parent URL with the book slug as a query parameter.

Configure the parent URL via environment variable:
```
EMBED_PARENT_URL=https://embassyofthefreemind.webflow.io/bibliotheca-philosophica-hermetica
```

So a new-tab open of `/book/aurora-boehme` redirects to:
```
https://embassyofthefreemind.webflow.io/bibliotheca-philosophica-hermetica/catalogue?book=aurora-boehme
```

---

## 6. URL Structure Mapping

| Webflow URL | iframe src | Notes |
|------------|------------|-------|
| `/bibliotheca-philosophica-hermetica` | — | BPH overview (Webflow native) |
| `/bibliotheca-philosophica-hermetica/catalogue` | `/embed/bph` | Full catalogue |
| `/bibliotheca-philosophica-hermetica/catalogue?q=alchemy` | `/embed/bph?q=alchemy` | Search |
| `/bibliotheca-philosophica-hermetica/catalogue?book=aurora-boehme` | `/embed/bph/book/aurora-boehme` | Single book |
| `/bibliotheca-philosophica-hermetica/collection-areas` | `/embed/bph/collections` | All areas |
| `/bibliotheca-philosophica-hermetica/collection-areas?area=alchemy` | `/embed/bph/collections/alchemy` | One area |

---

## 7. FAQ

**Q: Do we need an API key?**
A: No. The BPH embed API is public and read-only. It only exposes BPH books (filtered
by `image_source.provider === "bph"`). No Source Library content leaks through.

**Q: Can we use the same API for the current EFM website too?**
A: Yes. The API endpoints work from any origin. You can call them from
`embassyofthefreemind.com`, the Webflow staging site, or localhost.

**Q: What about rate limiting?**
A: The API is served via Vercel + Cloudflare with standard rate limits. For typical
website usage (a few hundred requests per minute), you won't hit any limits.

**Q: Can users search within a book?**
A: Yes. The book reader (inside the iframe) has built-in page-level search. The
API also supports `GET /api/books/{id}/search?q=...` for programmatic page search.

**Q: What about images/gallery?**
A: Gallery endpoints are planned for Phase 2. The current book reader already
displays all page images inline. Extracted illustrations with AI-generated
metadata will be available via `/api/embed/bph/gallery` in the next phase.

---

## Support

For integration questions: derek@sourcelibrary.org

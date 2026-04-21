# BPH Digital Catalogue — API Integration Guide

> For the Webflow developer integrating the Bibliotheca Philosophica Hermetica
> digital catalogue into the Embassy of the Free Mind website.

**Base URL:** `https://bph.sourcelibrary.org`
**All endpoints:** Public, read-only, CORS-open, no API key required.

---

## Quick Start

```javascript
// Fetch all BPH books
const res = await fetch('https://bph.sourcelibrary.org/api/embed/bph/books');
const { books, total } = await res.json();

// Search
const res = await fetch('https://bph.sourcelibrary.org/api/embed/bph/books?q=alchemy');

// Link to the reader
const readerUrl = `https://bph.sourcelibrary.org/book/${book.slug}`;
```

---

## API Reference

### `GET /api/embed/bph/stats`

Collection-wide statistics for counters and dashboards.

```json
{
  "total": 2279,
  "translated": 2278,
  "languages": 25,
  "language_list": ["Arabic", "Dutch", "English", "French", "German", "Latin", ...],
  "pages_total": 607260,
  "pages_translated": 594857
}
```

---

### `GET /api/embed/bph/books`

Paginated catalogue with search, sort, and filters.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search query (min 2 chars) |
| `limit` | number | 24 | Results per page (max 100) |
| `offset` | number | 0 | Pagination offset |
| `sort` | string | `title` | `title`, `date_asc`, `date_desc`, `recent` |
| `language` | string | — | Filter by language (e.g., `Latin`) |
| `category` | string | — | Filter by collection slug (e.g., `alchemy`) |
| `year_from` | number | — | Min publication year |
| `year_to` | number | — | Max publication year |
| `translated` | `"true"` | — | Only books with translations |

**Response:**

```json
{
  "books": [
    {
      "id": "abc123",
      "slug": "aurora-or-the-day-spring-boehme",
      "title": "Aurora, oder Morgenröthe im Auffgang",
      "display_title": "Aurora, or The Day-Spring",
      "author": "Jacob Boehme",
      "language": "German",
      "published": "1634",
      "year": 1634,
      "pages_count": 312,
      "pages_translated": 312,
      "thumbnail": "https://images.sourcelibrary.org/...",
      "catalogue_number": "BPH Catalogue (UBN: 1234)",
      "categories": ["alchemy", "mysticism", "theosophy"],
      "url": "/book/aurora-or-the-day-spring-boehme"
    }
  ],
  "total": 2279,
  "limit": 24,
  "offset": 0
}
```

**Examples:**

```
/api/embed/bph/books?q=alchemy
/api/embed/bph/books?language=Latin&sort=date_asc
/api/embed/bph/books?category=hermetica&translated=true
/api/embed/bph/books?offset=24&limit=24
```

---

### `GET /api/embed/bph/books/{slug}`

Single book lookup by slug.

```json
{
  "id": "abc123",
  "slug": "aurora-or-the-day-spring-boehme",
  "title": "Aurora, oder Morgenröthe im Auffgang",
  "display_title": "Aurora, or The Day-Spring",
  "author": "Jacob Boehme",
  "language": "German",
  "published": "1634",
  "year": 1634,
  "pages_count": 312,
  "pages_translated": 312,
  "pages_ocr": 312,
  "thumbnail": "https://images.sourcelibrary.org/...",
  "catalogue_number": "BPH Catalogue (UBN: 1234)",
  "description": "First edition of Boehme's foundational work...",
  "summary": "A visionary cosmological text...",
  "categories": ["alchemy", "mysticism"],
  "chapters": [
    { "title": "Chapter 1: Of the First Root of the Tree", "startPage": 5 }
  ],
  "doi": "10.5281/zenodo.12345",
  "is_first_translation": true,
  "provider": "Embassy of the Free Mind",
  "url": "/book/aurora-or-the-day-spring-boehme"
}
```

---

### `GET /api/embed/bph/featured`

Curated selection of the best BPH books. Prioritizes first translations and high-quality texts.

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 6 | Number of books (max 24) |
| `category` | — | Optional category filter |

```json
{
  "books": [
    {
      "slug": "aurora-or-the-day-spring-boehme",
      "title": "Aurora, or The Day-Spring",
      "author": "Jacob Boehme",
      "language": "German",
      "published": "1634",
      "thumbnail": "https://images.sourcelibrary.org/...",
      "is_first_translation": true,
      "summary": "A visionary cosmological text...",
      "reader_url": "https://bph.sourcelibrary.org/book/aurora-or-the-day-spring-boehme"
    }
  ]
}
```

---

### `GET /api/embed/bph/suggest?q=alch`

Autocomplete/typeahead for search. Returns up to 8 matches with minimal data.

```json
{
  "suggestions": [
    {
      "slug": "alchemiae-libri-libavius",
      "title": "Alchemiae Libri",
      "author": "Andreas Libavius",
      "language": "Latin",
      "published": "1597",
      "thumbnail": "https://..."
    }
  ]
}
```

---

### `GET /api/embed/bph/collections`

All collection areas (subject categories) that contain BPH books.

```json
{
  "collections": [
    {
      "slug": "alchemy",
      "name": "Alchemy",
      "description": "The art of transformation...",
      "subtitle": "Transmutation & the Philosopher's Stone",
      "image": { "extracted_url": "https://..." },
      "item_count": 560
    }
  ]
}
```

### `GET /api/embed/bph/collections?slug=alchemy`

Single collection with paginated BPH books.

| Param | Default | Description |
|-------|---------|-------------|
| `slug` | required | Collection slug |
| `limit` | 24 | Books per page (max 100) |
| `offset` | 0 | Pagination offset |
| `sort` | `title` | `title`, `date_asc`, `date_desc` |

---

### `GET /api/embed/bph/languages`

All languages in the BPH collection with book counts. For building filter dropdowns.

```json
{
  "languages": [
    { "language": "Latin", "count": 1247 },
    { "language": "German", "count": 412 },
    { "language": "French", "count": 198 }
  ]
}
```

---

## Linking to the Reader

When a user clicks a book in the Webflow catalogue, link them to the reader:

```
https://bph.sourcelibrary.org/book/{slug}
```

For a specific page:

```
https://bph.sourcelibrary.org/book/{slug}/page/{pageId}
```

The reader at `bph.sourcelibrary.org` shows the book without Source Library branding (header/footer hidden).

---

## Thumbnail Images

Book thumbnails are served from our CDN. They're stable URLs, cached, and fast.

- `thumbnail` field in API responses is always a direct URL
- Typical sizes: 200-400px wide
- Format: JPEG
- For higher resolution, the book detail endpoint returns the full cover image

---

## Webflow Integration Examples

### Stats Counter

```html
<script>
fetch('https://bph.sourcelibrary.org/api/embed/bph/stats')
  .then(r => r.json())
  .then(d => {
    document.getElementById('book-count').textContent = d.total.toLocaleString();
    document.getElementById('page-count').textContent = d.pages_translated.toLocaleString();
    document.getElementById('lang-count').textContent = d.languages;
  });
</script>
```

### Search with Autocomplete

```html
<input type="text" id="search" placeholder="Search the collection..." />
<div id="suggestions"></div>

<script>
let timer;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (e.target.value.length < 2) return;
    const res = await fetch(
      `https://bph.sourcelibrary.org/api/embed/bph/suggest?q=${encodeURIComponent(e.target.value)}`
    );
    const { suggestions } = await res.json();
    document.getElementById('suggestions').innerHTML = suggestions.map(s =>
      `<a href="https://bph.sourcelibrary.org/book/${s.slug}">${s.title} — ${s.author}</a>`
    ).join('');
  }, 300);
});
</script>
```

### Featured Books Grid

```html
<div id="featured"></div>

<script>
fetch('https://bph.sourcelibrary.org/api/embed/bph/featured?limit=6')
  .then(r => r.json())
  .then(({ books }) => {
    document.getElementById('featured').innerHTML = books.map(b => `
      <a href="${b.reader_url}" class="book-card">
        <img src="${b.thumbnail}" alt="${b.title}" loading="lazy" />
        <h3>${b.title}</h3>
        <p>${b.author}</p>
      </a>
    `).join('');
  });
</script>
```

### Paginated Catalogue

```html
<div id="catalogue"></div>
<button id="prev">Previous</button>
<span id="page-info"></span>
<button id="next">Next</button>

<script>
let page = 0;
const PAGE_SIZE = 24;

async function loadPage() {
  const res = await fetch(
    `https://bph.sourcelibrary.org/api/embed/bph/books?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&sort=title`
  );
  const { books, total } = await res.json();
  const totalPages = Math.ceil(total / PAGE_SIZE);

  document.getElementById('catalogue').innerHTML = books.map(b => `
    <a href="https://bph.sourcelibrary.org/book/${b.slug}" class="book-card">
      <img src="${b.thumbnail}" alt="${b.display_title || b.title}" loading="lazy" />
      <h3>${b.display_title || b.title}</h3>
      <p>${b.author} · ${b.published || ''}</p>
    </a>
  `).join('');

  document.getElementById('page-info').textContent = `Page ${page + 1} of ${totalPages}`;
  document.getElementById('prev').disabled = page === 0;
  document.getElementById('next').disabled = page >= totalPages - 1;
}

document.getElementById('prev').onclick = () => { page--; loadPage(); };
document.getElementById('next').onclick = () => { page++; loadPage(); };
loadPage();
</script>
```

---

## Reader Iframe (Optional)

For embedding the full book reader (OCR + translation + page images) in Webflow:

```html
<iframe
  src="https://bph.sourcelibrary.org/book/aurora-or-the-day-spring-boehme"
  style="width: 100%; height: 85vh; border: none;"
  allow="clipboard-write"
  loading="lazy"
></iframe>
```

The reader has no Source Library header/footer when loaded on `bph.sourcelibrary.org`.

---

## Support

Integration questions: derek@sourcelibrary.org

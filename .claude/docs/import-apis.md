# Import APIs Reference

Source Library supports importing from 14 digital library sources.

## Gallica (Bibliothque nationale de France)
```
POST /api/import/gallica
{ "ark": "bpt6k61073880", "title": "...", "author": "...", "year": 1617, "original_language": "Latin" }
```

## Internet Archive
```
POST /api/import/ia
{ "ia_identifier": "bookid123", "title": "...", "author": "...", "year": 1617, "original_language": "Latin" }
```

## MDZ (Bavarian State Library)
```
POST /api/import/mdz
{ "bsb_id": "bsb00029099", "title": "...", "author": "...", "year": 1473, "original_language": "Latin" }
```

## Wellcome Collection
```
POST /api/import/wellcome
{ "work_id": "pqusmy2a", "title": "...", "author": "...", "language": "Latin", "published": "1650" }
```
Find work IDs: `https://api.wellcomecollection.org/catalogue/v2/works?query=alchemy&availabilities=online`

## e-rara (Swiss rare books)
```
POST /api/import/e-rara
{ "erara_id": "8962689", "title": "...", "author": "...", "language": "German", "published": "1650" }
```
Browse: https://www.e-rara.ch/

## Generic IIIF
```
POST /api/import/iiif
{ "manifest_url": "https://example.org/iiif/manifest.json", "title": "...", "author": "...", "language": "Latin", "provider": "Some Library", "start_page": 1, "end_page": 100 }
```

## Bodleian Library (University of Oxford)
```
POST /api/import/bodleian
{ "uuid": "ae9f6cca-ae5c-4149-8fe4-95e6eca187f5", "title": "...", "author": "...", "language": "Latin", "published": "1550" }
```
Browse: https://digital.bodleian.ox.ac.uk/

## Cambridge Digital Library (CUDL)
```
POST /api/import/cambridge
{ "ms_id": "MS-ADD-03996", "title": "...", "author": "...", "language": "Latin", "published": "1500" }
```
Browse: https://cudl.lib.cam.ac.uk/

## HAB Wolfenbttel (Herzog August Bibliothek)
```
POST /api/import/hab
{ "hab_id": "cod-guelf-18-1-aug-2f", "title": "...", "author": "...", "language": "Latin", "published": "1450" }
```
HAB manifest URLs vary by collection. Provide `manifest_url` if the default pattern doesn't work:
```
{ "hab_id": "some-id", "manifest_url": "https://diglib.hab.de/drucke/some-id/manifest.json", "title": "...", "author": "..." }
```
Browse: https://diglib.hab.de/

## Vatican Library (DigiVatLib)
```
POST /api/import/vatican
{ "mss_id": "Pal.lat.235", "title": "...", "author": "...", "language": "Latin", "published": "1400" }
```
Browse: https://digi.vatlib.it/

## Google Books (via Internet Archive mirror)
```
POST /api/import/google-books
{ "google_books_id": "aTo6AQAAMAAJ", "title": "...", "author": "...", "language": "Latin", "published": "1617" }
```
Google Books has no IIIF access. This route imports via Internet Archive mirrors (`bub_gb_*` identifiers). Returns a 404 with guidance if the book isn't mirrored on IA.

## Europeana (aggregator)
```
POST /api/import/europeana
{ "record_id": "/2022704/lmu_bsb00029099", "title": "...", "author": "...", "language": "Latin", "published": "1473" }
```
Europeana aggregates metadata from thousands of institutions. This route fetches the record, extracts the IIIF manifest from the source provider, and imports via IIIF. Provide `manifest_url` directly if auto-detection fails.

Browse: https://www.europeana.eu/

Optional: set `EUROPEANA_API_KEY` env var for higher rate limits.

## Library of Congress
```
POST /api/import/loc
{ "lccn": "2012402109", "title": "...", "author": "...", "language": "Chinese", "published": "1465" }
```
LOC doesn't expose standard IIIF Presentation API manifests. This route fetches LOC's item JSON API (`/item/{LCCN}/?fo=json`), extracts image URLs from the `resources[].files[][]` 2D array, and creates book+page records. Handles multi-volume works automatically. Supports `start_page`/`end_page` for partial imports. All LOC Chinese rare books are public domain.

Browse: https://www.loc.gov/collections/chinese-rare-books/

## PDF (any source)
```
POST /api/import/pdf
{ "pdf_url": "https://example.org/book.pdf", "title": "...", "author": "...", "provider": "cmc_kloss", "provider_name": "CMC Prins Frederik — Bibliotheca Klossiana" }
```
Downloads a PDF, extracts pages with `pdftoppm` at configurable DPI (default 150), uploads page images to Vercel Blob, creates book+page records. Works with any publicly accessible PDF URL. Requires `pdftoppm` (poppler-utils) on the host — runs locally or on a server, not on Vercel serverless.

Optional fields: `language`, `published`, `categories`, `source_url`, `identifier`, `dpi`, `dublin_core`, `catalog_metadata`, `display_title`.

Batch import for Kloss Collection:
```bash
set -a; source .env.production.local; set +a; node scripts/import-kloss-collection.mjs --skip-existing --limit 50
```
Options: `--limit N`, `--start-from N`, `--dry-run`, `--skip-existing`, `--delay N` (ms), `--dpi N`.

Reads `kloss_catalog` collection (1,530 digitized CMC manuscripts), constructs PDF URLs from `digital_references`, imports with full provenance chain. As of March 2026: 16 Kloss books imported.

## Common behavior
All import routes: fetch manifests or provider APIs, create book+page records in MongoDB, queue split detection, return book ID and URL.

# Import APIs Reference

Source Library supports importing from five digital library sources.

## Gallica (Bibliothèque nationale de France)
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

## Common behavior
All import routes: fetch IIIF manifests, create book+page records in MongoDB, queue split detection, return book ID and URL.

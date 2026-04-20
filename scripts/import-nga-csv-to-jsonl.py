#!/usr/bin/env python3
"""
Pre-process NGA open data CSVs into JSONL for reliable Node.js consumption.
Python's csv module correctly handles multiline quoted fields that break
simple line-by-line parsers.

Usage:
  python3 scripts/import-nga-csv-to-jsonl.py

Prerequisites:
  curl -L https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/objects.csv -o /tmp/nga-data/objects.csv
  curl -L https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv -o /tmp/nga-data/published_images.csv
"""

import csv
import json
import sys

# Increase field size limit for provenancetext fields
csv.field_size_limit(sys.maxsize)

OBJECTS_CSV = '/tmp/nga-data/objects.csv'
IMAGES_CSV = '/tmp/nga-data/published_images.csv'
OBJECTS_JSONL = '/tmp/nga-data/objects.jsonl'
IMAGES_JSONL = '/tmp/nga-data/images.jsonl'

FIELDS_TO_KEEP = [
    'objectid', 'uuid', 'accessioned', 'title', 'displaydate',
    'beginyear', 'endyear', 'medium', 'dimensions',
    'attributioninverted', 'attribution', 'creditline',
    'classification', 'subclassification', 'wikidataid', 'provenancetext'
]

ART_CLASSIFICATIONS = {'painting', 'drawing', 'print', 'sculpture'}

print('Processing objects.csv...')
with open(OBJECTS_CSV, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    total = 0
    kept = 0
    by_class = {}
    with open(OBJECTS_JSONL, 'w') as out:
        for row in reader:
            total += 1
            if row.get('accessioned') != '1':
                continue
            begin = int(row.get('beginyear') or '0')
            end = int(row.get('endyear') or '0')
            if begin > 1600 or end < 1400:
                continue
            cls = (row.get('classification') or '').lower()
            if not any(x in cls for x in ART_CLASSIFICATIONS):
                continue

            obj = {k: row.get(k, '') for k in FIELDS_TO_KEEP if k in row}
            # Truncate provenance to save space
            if obj.get('provenancetext'):
                obj['provenancetext'] = obj['provenancetext'][:500]

            out.write(json.dumps(obj) + '\n')
            kept += 1
            by_class[row.get('classification', 'Other')] = by_class.get(row.get('classification', 'Other'), 0) + 1

print(f'  Total rows: {total}')
print(f'  Renaissance art kept: {kept}')
for cls, count in sorted(by_class.items(), key=lambda x: -x[1]):
    print(f'    {cls}: {count}')

print('\nProcessing published_images.csv...')
with open(IMAGES_CSV, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    count = 0
    with open(IMAGES_JSONL, 'w') as out:
        for row in reader:
            if row.get('openaccess') != '1':
                continue
            out.write(json.dumps({
                'uuid': row.get('uuid', ''),
                'iiifurl': row.get('iiifurl', ''),
                'iiifthumburl': row.get('iiifthumburl', ''),
                'viewtype': row.get('viewtype', ''),
                'width': row.get('width', ''),
                'height': row.get('height', ''),
                'depictstmsobjectid': row.get('depictstmsobjectid', ''),
            }) + '\n')
            count += 1

print(f'  Open-access images: {count}')
print('\nDone! Files written to:')
print(f'  {OBJECTS_JSONL}')
print(f'  {IMAGES_JSONL}')

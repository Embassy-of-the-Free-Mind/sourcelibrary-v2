#!/usr/bin/env python3
"""pero-collect.py — #7567 E1: PERO-OCR's PAGE XML → <out.jsonl> rows {page_id, text} (+ <out.jsonl>.run.json).

PRIOR ART: scripts/gpu/ocr-bakeoff-r3-5660/alto-lines.py reads Kraken ALTO line by line; PERO writes PAGE XML (2019
schema), so this reads TextRegion → TextLine → TextEquiv/Unicode in document order, which is the order PERO's
REGION_SORTER_SMART put them in. Lines join with newlines, regions with a blank line.

PERO ran with `parse-folder -c config_cpu.ini --device cpu` (pero_eu_cz_print_newspapers_2022-09-26, its CPU config),
8 threads, beside the GPU arms; pages/hour is the CPU rate from the first to the last XML written.
  pero-collect.py <xml dir> <out.jsonl> <t0 epoch file>
"""
import json, os, sys
import xml.etree.ElementTree as ET

src, out, t0f = sys.argv[1:4]
NS = '{http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15}'
rows, mt = [], []
for f in sorted(os.listdir(src)):
    if not f.endswith('.xml'): continue
    p = os.path.join(src, f); mt.append(os.path.getmtime(p))
    regions = []
    for reg in ET.parse(p).getroot().iter(NS + 'TextRegion'):
        lines = [u.text or '' for tl in reg.iter(NS + 'TextLine') for u in tl.iter(NS + 'Unicode')]
        if any(l.strip() for l in lines): regions.append('\n'.join(lines))
    rows.append({'page_id': f[:-4], 'text': '\n\n'.join(regions)})
with open(out, 'w') as o:
    for r in rows: o.write(json.dumps(r, ensure_ascii=False) + '\n')
t0 = float(open(t0f).read().strip()); wall = max(mt) - t0 if mt else 0
json.dump({'engine': 'pero-ocr pero_eu_cz_print_newspapers_2022-09-26', 'device': 'cpu (8 threads)', 'pages': len(rows),
           'wall_secs': round(wall), 'pages_per_hour': round(len(rows) / wall * 3600) if wall else None}, open(out + '.run.json', 'w'), indent=1)
print(len(rows), 'pages', round(wall), 's')

#!/usr/bin/env python3
"""surya-collect.py — the #7243 Surya arm's results.json → <out.jsonl> rows {page_id, text} (text_lines in Surya's order).
PRIOR ART: none in the repo reads Surya 2 output (`surya_ocr --output_dir` writes <dir>/<input name>/results.json).
  surya-collect.py <surya output dir> <out.jsonl>
"""
import glob, json, os, sys
src, out = sys.argv[1], sys.argv[2]; rows = {}
for f in glob.glob(os.path.join(src, '**', 'results.json'), recursive=True):
    for name, pages in json.load(open(f)).items():
        lines = [l.get('text', '') for p in (pages if isinstance(pages, list) else [pages]) for l in p.get('text_lines', [])]
        rows[name] = '\n'.join(lines)
with open(out, 'w') as o:
    for k in sorted(rows): o.write(json.dumps({'page_id': k, 'text': rows[k]}, ensure_ascii=False) + '\n')
print(len(rows), 'pages')

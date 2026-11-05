#!/usr/bin/env python3
"""surya-collect.py — the #7243 Surya arm's results.json → <out.jsonl> rows {page_id, text}.
PRIOR ART: none in the repo reads Surya 2 output. `surya_ocr --output_dir` writes <dir>/<input dir name>/results.json:
{<image name>: [{page, image_bbox, blocks: [{label, reading_order, html, skipped, error, ...}]}]}. Blocks are taken in
reading_order; each block's html becomes text (<br> and block tags → newlines, other tags dropped). (A first version read
Surya 1's `text_lines` and wrote 40 empty rows; fixed before scoring, no rerun needed.)
  surya-collect.py <surya output dir> <out.jsonl>
"""
import glob, html, json, os, re, sys
src, out = sys.argv[1], sys.argv[2]; rows = {}
def text_of(h):
    h = re.sub(r'(?i)<br\s*/?>|</(p|div|li|tr|h\d)>', '\n', h or '')
    return html.unescape(re.sub(r'<[^>]+>', ' ', h)).strip()
for f in glob.glob(os.path.join(src, '**', 'results.json'), recursive=True):
    for name, pages in json.load(open(f)).items():
        parts = []
        for p in (pages if isinstance(pages, list) else [pages]):
            for b in sorted(p.get('blocks', []), key=lambda b: b.get('reading_order', 0)):
                if not b.get('skipped') and b.get('html'): parts.append(text_of(b['html']))
            parts += [l.get('text', '') for l in p.get('text_lines', [])]   # Surya 1 layout, if ever present
        rows[name] = '\n'.join(x for x in parts if x)
with open(out, 'w') as o:
    for k in sorted(rows): o.write(json.dumps({'page_id': k, 'text': rows[k]}, ensure_ascii=False) + '\n')
print(len(rows), 'pages,', sum(1 for v in rows.values() if v.strip()), 'with text')

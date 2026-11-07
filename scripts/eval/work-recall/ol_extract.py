# PRIOR ART: none — the OL editions dump on Hetzner was parked unused since 2026-05 (#7761).
# usage: python3 ol_extract.py ocaids.txt /mnt/HC_Volume_105839809/ol-harvest/ol_dump_editions_2026-04-30.txt.gz ol-matches.jsonl
import gzip, json, sys
want = set(l.strip() for l in open(sys.argv[1]) if l.strip())
out = open(sys.argv[3], 'w'); n = hit = 0
with gzip.open(sys.argv[2], 'rt', encoding='utf-8', errors='replace') as f:
    for line in f:
        n += 1
        if '"ocaid"' not in line: continue
        rec = json.loads(line.split('\t', 4)[4])
        oc = rec.get('ocaid')
        if oc in want:
            hit += 1
            out.write(json.dumps({'ocaid': oc, 'edition': rec.get('key'), 'works': [w.get('key') for w in rec.get('works', [])],
              'title': rec.get('title'), 'langs': [l.get('key') for l in rec.get('languages', [])], 'translation_of': rec.get('translation_of'),
              'translated_from': [l.get('key') for l in rec.get('translated_from', [])]}) + '\n')
        if n % 5000000 == 0: print(n, hit, flush=True)
print('done', n, hit, flush=True)

#!/usr/bin/env python3
"""
Assemble /aliveness for the experience-atlas site (#6652) and add it to every page's nav.

The July builder (build-deploy.py) reads from a session scratchpad that no longer exists, so this works from the
LIVE site instead: download the five static pages (each is self-contained HTML) into SITE, then run this.
It borrows <head> styles + nav from peace.html, fills templates/aliveness-body.html with the data and the prose
file, and writes SITE/aliveness.html. Placeholders left unfilled abort the build.
PRIOR ART: build/build-deploy.py — same site, same shell; it cannot run without its July inputs.
  python3 build/assemble-aliveness-page.py <site-dir> <data-dir> <prose.json>
"""
import json, os, re, sys
SITE, DATA, PROSE = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, '..', 'templates', 'aliveness-body.html')).read()
prose = json.load(open(PROSE))
pts = open(os.path.join(DATA, 'aliveness-data.json')).read()
nums = json.load(open(os.path.join(DATA, 'aliveness-numbers.json')))
nums.pop('per_dim_rows', None)

LINK = '<a href="/aliveness">Aliveness</a>'
for f in ['index.html', 'atlas.html', 'compare.html', 'bodies.html', 'peace.html']:
    p = os.path.join(SITE, f); s = open(p).read()
    if LINK not in s:
        s = s.replace('<a href="/peace">PEACE response</a>', '<a href="/peace">PEACE response</a>\n  ' + LINK, 1)
        if LINK not in s: sys.exit(f'nav anchor not found in {f}')
        open(p, 'w').write(s)

peace = open(os.path.join(SITE, 'peace.html')).read()
head = peace[:peace.index('</head>')]
head = re.sub(r'<title>.*?</title>', '<title>An Atlas of Aliveness</title>', head, flags=re.S)
head = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="' + prose['DESCRIPTION'] + '">', head)
nav = peace[peace.index('<nav class="site">'):peace.index('</nav>') + 6].replace('<a href="#examples">Passages</a>', '<a href="#map-h">Map</a>')

body = tpl
for k, v in prose.items():
    body = body.replace(f'__{k}__', v)
body = body.replace('__POINTS__', pts.replace('</', '<\\/')).replace('__NUMBERS__', json.dumps(nums, ensure_ascii=False).replace('</', '<\\/'))
left = sorted(set(re.findall(r'__[A-Z_]+__', body)))
if left: sys.exit(f'unfilled placeholders: {left}')
out = head + '</head><body>' + nav + body + '</body></html>'
open(os.path.join(SITE, 'aliveness.html'), 'w').write(out)
if not os.path.exists(os.path.join(SITE, 'vercel.json')):
    json.dump({'cleanUrls': True}, open(os.path.join(SITE, 'vercel.json'), 'w'))
print(f'aliveness.html {len(out)//1024}KB; nav updated')

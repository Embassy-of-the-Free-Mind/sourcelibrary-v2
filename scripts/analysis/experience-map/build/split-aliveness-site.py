#!/usr/bin/env python3
"""
Give the aliveness atlas (#6652) its own site, apart from the map of conscious experiences and its PEACE / subtle-body
pages (Derek, 2026-10-16: "separate it from the other stuff, like the PEACE work").

Reads the pages assemble-aliveness-page.py and the ontology builder wrote into the experience-atlas site folder, and:
  1. writes OUT/index.html (the atlas) and OUT/vocabulary.html (the vocabulary) with their own nav, links into the
     experience-atlas site made absolute, and the data files beside them;
  2. removes the Aliveness and Vocabulary links from every experience-atlas page's nav, and adds redirects there
     (/aliveness, /aliveness-ontology, the two data files) so links already shared keep working.
PRIOR ART: build/assemble-aliveness-page.py builds the page INTO the experience-atlas shell; this separates it after.
  python3 build/split-aliveness-site.py <experience-atlas-site-dir> <out-dir> <new-site-url>
"""
import json, os, re, shutil, sys
SITE, OUT, NEW = sys.argv[1], sys.argv[2], sys.argv[3].rstrip('/')
OLD = 'https://experience-atlas.vercel.app'
os.makedirs(OUT, exist_ok=True)

def nav(here):
    links = [('/', 'The atlas'), ('/vocabulary', 'Vocabulary')]
    inner = '\n  '.join(f'<a href="{h}"{" aria-current=\"page\"" if h == here else ""}>{t}</a>' for h, t in links)
    return ('<nav class="site"><div class="inner">\n  <a class="brand" href="/">An Atlas of Aliveness</a>\n  ' + inner +
            '\n  <span class="spacer"></span>\n  <a href="' + OLD + '">A Map of Conscious Experiences&nbsp;↗</a>\n'
            '  <a href="https://sourcelibrary.org">Source Library&nbsp;↗</a>\n</div></nav>')

def standalone(src, here):
    s = open(os.path.join(SITE, src)).read()
    s = re.sub(r'<nav class="site">.*?</nav>', lambda m: nav(here), s, count=1, flags=re.S)
    # links into the old site become absolute; links between the two aliveness pages become local
    s = s.replace('href="/aliveness-ontology"', 'href="/vocabulary"').replace('href="/aliveness"', 'href="/"')
    s = s.replace('href="/aliveness#', 'href="/#').replace('href="/aliveness-ontology#', 'href="/vocabulary#')
    for p in ['/atlas', '/compare', '/bodies', '/peace']:
        s = s.replace(f'href="{p}"', f'href="{OLD}{p}"')
    s = re.sub(r'href="/"([^>]*)>map of conscious experiences', lambda m: f'href="{OLD}/"{m.group(1)}>map of conscious experiences', s)
    return s

open(os.path.join(OUT, 'index.html'), 'w').write(standalone('aliveness.html', '/'))
open(os.path.join(OUT, 'vocabulary.html'), 'w').write(standalone('aliveness-ontology.html', '/vocabulary'))
for f in ['aliveness-data.json', 'aliveness-numbers.json']:
    shutil.copy(os.path.join(SITE, f), os.path.join(OUT, f))
json.dump({'cleanUrls': True}, open(os.path.join(OUT, 'vercel.json'), 'w'))

# the experience-atlas site: drop the two nav links, redirect the old addresses
for f in ['index.html', 'atlas.html', 'compare.html', 'bodies.html', 'peace.html']:
    p = os.path.join(SITE, f); s = open(p).read()
    s = re.sub(r'\n\s*<a href="/aliveness">Aliveness</a>', '', s)
    s = re.sub(r'\n\s*<a href="/aliveness-ontology">Vocabulary</a>', '', s)
    open(p, 'w').write(s)
for f in ['aliveness.html', 'aliveness-ontology.html', 'aliveness-data.json', 'aliveness-numbers.json']:
    if os.path.exists(os.path.join(SITE, f)):
        os.makedirs(OUT + '-moved', exist_ok=True); shutil.move(os.path.join(SITE, f), os.path.join(OUT + '-moved', f))  # kept, not deleted
json.dump({'cleanUrls': True, 'redirects': [
    {'source': '/aliveness', 'destination': NEW + '/', 'permanent': True},
    {'source': '/aliveness-ontology', 'destination': NEW + '/vocabulary', 'permanent': True},
    {'source': '/aliveness-data.json', 'destination': NEW + '/aliveness-data.json', 'permanent': True},
    {'source': '/aliveness-numbers.json', 'destination': NEW + '/aliveness-numbers.json', 'permanent': True},
]}, open(os.path.join(SITE, 'vercel.json'), 'w'), indent=1)
print(f'aliveness site → {OUT} (index.html, vocabulary.html); experience-atlas nav cleaned, redirects to {NEW}')

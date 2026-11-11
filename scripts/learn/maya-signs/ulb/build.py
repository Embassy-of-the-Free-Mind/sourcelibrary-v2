"""Fetch ULB Bonn Maya archive records (METS/MODS over OAI-PMH) and their images into a load set (#6985).
PRIOR ART: ../twkm/build.py builds the TWKM sign catalog from its JSON; ../build.py parses PDF sign charts.
Neither reads METS, and this archive is a different source (the objects and their photographs, not signs).
  python3 build.py <out> <artifact-oai-number>...      e.g. build.py out 9605478   (Yaxchilan, Lintel 21)
One METS GetRecord per artifact carries the artifact's MODS plus one MODS per illustration (photo or
drawing) and a webcache image id for each. Output: <out>/archive.jsonl (one record per ULB record) and
<out>/img/<file> (originals, /download/webcache/0/<id>). Polite: one request at a time, 1 s apart."""
import sys, os, json, time, hashlib, re, urllib.request
import xml.etree.ElementTree as ET
OUT, IDS = sys.argv[1], sys.argv[2:]
os.makedirs(f'{OUT}/img', exist_ok=True)
HOST = 'https://digitale-sammlungen.ulb.uni-bonn.de'
NS = {'mets': 'http://www.loc.gov/METS/', 'mods': 'http://www.loc.gov/mods/v3', 'xlink': 'http://www.w3.org/1999/xlink'}
UA = {'User-Agent': 'SourceLibrary (sourcelibrary.org; #6985)'}
SOURCE = 'ulb-bonn-maya-archive'
SRC = {'title': 'Maya Hieroglyphic Text and Image Archive', 'publisher': 'Universitäts- und Landesbibliothek Bonn',
       'partner': 'Text Database and Dictionary of Classic Mayan (TWKM), University of Bonn',
       'url': f'{HOST}/maya', 'oai': f'{HOST}/maya/oai'}

def get(url):
    time.sleep(1)
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()

def text(el, path):
    x = el.find(path, NS)
    return x.text.strip() if x is not None and x.text else None

def licence(m):
    a = m.find('mods:accessCondition', NS)
    if a is None: return None
    return {'label': (a.text or '').strip(), 'url': a.get('{%s}href' % NS['xlink'])}

def names(m, role):
    return [text(n, 'mods:namePart') for n in m.findall('mods:name', NS)
            if text(n, 'mods:role/mods:roleTerm') == role and text(n, 'mods:namePart')]

recs = []
for aid in IDS:
    root = ET.fromstring(get(f'{HOST}/maya/oai?verb=GetRecord&metadataPrefix=mets&identifier=oai:digitale-sammlungen.ulb.uni-bonn.de:{aid}'))
    mods = {d.get('ID')[2:]: d.find('.//mods:mods', NS) for d in root.iter('{%s}dmdSec' % NS['mets'])}
    files = {f.get('ID'): f.find('mets:FLocat', NS).get('{%s}href' % NS['xlink']) for f in root.iter('{%s}file' % NS['mets'])}
    top = root.find('.//mets:structMap/mets:div', NS)
    children = []
    for div in [top] + top.findall('mets:div', NS):
        rid = div.get('ID')[3:]; m = mods[rid]
        fp = div.find('mets:fptr', NS)
        r = {'_id': f'ulb:{rid}', 'source': SOURCE, 'ulb_id': rid, 'url': f'{HOST}/maya/content/titleinfo/{rid}',
             'twkm_record': text(m, 'mods:recordInfo/mods:recordIdentifier'),
             'title': text(m, 'mods:titleInfo/mods:title'), 'licence': licence(m)}
        if div is top:
            dates = {d.get('calendar') or d.get('encoding'): d.text for d in m.findall('mods:originInfo/mods:dateCreated', NS)}
            r |= {'kind': 'artifact', 'type': text(m, 'mods:genre'),
                  'provenance': text(m, "mods:location/mods:physicalLocation[@type='provenance']"),
                  'current_location': text(m, "mods:location/mods:physicalLocation[@type='current']"),
                  'long_count': dates.get('Longcount'), 'calendar_round': dates.get('Calendar Round'),
                  'gregorian': dates.get('Gregorian'), 'year': dates.get('iso8601'),
                  'material': text(m, "mods:physicalDescription/mods:form[@type='material']"),
                  'technique': text(m, "mods:physicalDescription/mods:form[@type='technique']"),
                  'extent': [e.text for e in m.findall('mods:physicalDescription/mods:extent', NS)],
                  'textgrid': (r['twkm_record'] or '').replace('textgrid:', '') or None}
        else:
            creators = names(m, 'cre')
            r |= {'kind': 'drawing' if (r['title'] or '').endswith('drawing') else 'photograph', 'artifact': f'ulb:{aid}',
                  'creator': creators[0] if creators else None, 'date': text(m, 'mods:originInfo/mods:dateCreated')}
            if fp is not None:
                img_id = files[fp.get('FILEID')].rsplit('/', 1)[1]
                data = get(f'{HOST}/download/webcache/0/{img_id}'); h = hashlib.sha256(data).hexdigest()
                fn = f'ulb-{rid}-{h[:8]}.jpg'; open(f'{OUT}/img/{fn}', 'wb').write(data)
                r['image'] = {'file': fn, 'key': f'reference/maya/ulb-archive/{fn}', 'sha256': h, 'ulb_file': img_id,
                              'bytes': len(data)}
            lic = (r['licence'] or {}).get('label', '')
            r['rights'] = {'holder': r['creator'], 'terms': lic,
                           'permission': f'granted: {lic}' if re.match(r'(CC BY|PDM|CC0)', lic) else 'unknown',
                           'credit': (f"Photo: {r['creator']}, {r['date']}. " if r['kind'] == 'photograph' and r['creator'] else '')
                                     + f'Universitäts- und Landesbibliothek Bonn, {lic}'}
            children.append(r['_id'])
        r['source_ref'] = SRC
        recs.append(r)
    next(x for x in recs if x['_id'] == f'ulb:{aid}')['images'] = children

with open(f'{OUT}/archive.jsonl', 'w') as fo:
    for r in recs: fo.write(json.dumps(r, ensure_ascii=False) + '\n')
for r in recs: print(r['_id'], r['kind'], r['title'], (r.get('rights') or {}).get('permission'), (r.get('image') or {}).get('bytes'))

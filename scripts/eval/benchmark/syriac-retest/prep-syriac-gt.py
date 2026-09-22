# PRIOR ART: benchmark-score.mjs — scores the sealed strata against CBETA/Kanripo windows and the two house tiers; it has no PAGE-XML reader, no order-free line-level CER and no RTL normalisation, which this Syriac retest needs (#4746, #4883).
#!/usr/bin/env python3
"""Sample the two published Syriac ground-truth sets (HTR Winter School 2024 ÖNB Cod. Syr. 1; 2025 MS Jerusalem
SMMJ 36; both CC BY 4.0), export the images at ≤2400 px into the benchmark image tree (same input for every
engine, same size rule as the sealed strata) and extract the PAGE-XML transcription per page in reading order."""
import os, glob, random, re, json, xml.etree.ElementTree as ET
from PIL import Image
R = '/root/ocr-bench/syriac-retest'; OUT = '/root/ocr-bench/images/syriac-gt'; GTT = f'{R}/gt-text'
os.makedirs(OUT, exist_ok=True); os.makedirs(GTT, exist_ok=True)
N = 20
def page_text(xml):
    t = ET.parse(xml).getroot(); ns = {'p': t.tag.split('}')[0].strip('{')} if t.tag.startswith('{') else {}
    q = lambda e, x: e.findall(x, ns) if ns else e.findall(x.replace('p:', ''))
    lines = []
    for reg in q(t, './/p:TextRegion'):
        for tl in q(reg, './/p:TextLine'):
            te = q(tl, './p:TextEquiv/p:Unicode')
            if te and te[0].text: lines.append(te[0].text.strip())
    return '\n'.join(lines)
manifest = []
for setname, xmls in (('jerusalem36', sorted(glob.glob(f'{R}/gt/jerusalem36/*.xml'))), ('onb-syr1', sorted(glob.glob(f'{R}/gt/onb-syr1/page/*.xml')))):
    random.seed(4746 if setname == 'jerusalem36' else 4747)
    pick = sorted(random.sample(xmls, N))
    for x in pick:
        stem = os.path.splitext(os.path.basename(x))[0]
        imgs = [p for p in glob.glob(f'{R}/gt/{setname}/**/{stem}.*', recursive=True) if re.search(r'\.(jpe?g|png|tiff?)$', p, re.I)]
        if not imgs: print('no image for', stem); continue
        txt = page_text(x)
        if len(txt) < 40: print('short GT', stem, len(txt)); continue
        slug = f'{setname}-{stem}'
        im = Image.open(imgs[0]).convert('RGB'); w, h = im.size; s = min(1.0, 2400 / max(w, h))
        if s < 1: im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
        im.save(f'{OUT}/{slug}.jpg', quality=90)
        open(f'{GTT}/{slug}.txt', 'w').write(txt)
        manifest.append({'slug': slug, 'set': setname, 'stem': stem, 'gt_chars': len(txt), 'gt_lines': txt.count('\n') + 1, 'orig_px': [w, h]})
json.dump(manifest, open(f'{R}/gt-manifest.json', 'w'), indent=1)
print('pages', len(manifest), 'jerusalem', sum(m['set'] == 'jerusalem36' for m in manifest), 'onb', sum(m['set'] == 'onb-syr1' for m in manifest))
print('median gt chars', sorted(m['gt_chars'] for m in manifest)[len(manifest) // 2])

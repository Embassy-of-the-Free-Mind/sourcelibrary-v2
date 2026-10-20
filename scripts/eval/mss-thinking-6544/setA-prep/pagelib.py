# PRIOR ART: scripts/eval/replicate-6547/prep.py (bentham_gt: PAGE XML lines sorted top to bottom, reused for Bentham) — it reads one set; this prepares #6544 Set A (four open page-level sets, seed 6544, <= 2 pages per work). Data under $JOB_SCRATCH/setA, never the repo.
import xml.etree.ElementTree as ET, re
def pts(c):
    if c is None: return []
    if c.get('points'): return [tuple(int(float(v)) for v in p.split(',')) for p in c.get('points').split()]
    return [(int(p.get('x')),int(p.get('y'))) for p in c if p.tag.endswith('Point')]
def parse_page(path):
    """(regions, (w,h)); regions = [(region_type, [(text, (cx,cy,minx,miny,maxx,maxy))...])] in XML order."""
    t=ET.parse(path).getroot(); ns=t.tag.split('}')[0]+'}'
    page=t.find(ns+'Page'); regs=[]
    for r in page.iter(ns+'TextRegion'):
        m=re.search(r'type:([^;}]*)',r.get('custom') or ''); typ=m.group(1) if m else (r.get('type') or '')
        lines=[]
        for ln in r.findall(ns+'TextLine'):
            u=ln.find(f'{ns}TextEquiv/{ns}Unicode'); s=(u.text or '').strip() if u is not None else ''
            P=pts(ln.find(ns+'Coords'))
            xs=[x for x,_ in P] or [0]; ys=[y for _,y in P] or [0]
            lines.append((s,(sum(xs)/len(xs),sum(ys)/len(ys),min(xs),min(ys),max(xs),max(ys))))
        regs.append((typ,lines))
    return regs,(int(page.get('imageWidth')),int(page.get('imageHeight')))

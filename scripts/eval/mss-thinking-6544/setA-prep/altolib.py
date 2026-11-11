# PRIOR ART: scripts/eval/replicate-6547/prep.py (bentham_gt: PAGE XML lines sorted top to bottom, reused for Bentham) — it reads one set; this prepares #6544 Set A (four open page-level sets, seed 6544, <= 2 pages per work). Data under $JOB_SCRATCH/setA, never the repo.
import xml.etree.ElementTree as ET, re
def parse_alto(path):
    """Return list of (block_label, line_label, text, (x,y,w,h)) in XML order."""
    t=ET.parse(path).getroot()
    ns=t.tag.split('}')[0]+'}' if t.tag.startswith('{') else ''
    tags={o.get('ID'):o.get('LABEL') for o in t.iter(ns+'OtherTag')}
    out=[]
    for b in t.iter(ns+'TextBlock'):
        bl=tags.get((b.get('TAGREFS') or '').split(' ')[0],'')
        for ln in b.iter(ns+'TextLine'):
            ll=tags.get((ln.get('TAGREFS') or '').split(' ')[0],'')
            s=' '.join(x.get('CONTENT','') for x in ln.iter(ns+'String')).strip()
            box=tuple(int(float(ln.get(k,0))) for k in ('HPOS','VPOS','WIDTH','HEIGHT'))
            out.append((bl,ll,s,box))
    page=next(t.iter(ns+'Page'))
    fn=next((x.text for x in t.iter(ns+'fileName')),None)
    return out,(int(float(page.get('WIDTH'))),int(float(page.get('HEIGHT')))),fn

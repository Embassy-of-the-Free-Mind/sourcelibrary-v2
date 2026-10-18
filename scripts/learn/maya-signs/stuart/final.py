import sys, json
import numpy as np
from PIL import Image, ImageDraw
D=sys.argv[1]
cells=json.load(open(f'{D}/cells-d5.json'))
OVR=json.load(open(sys.argv[2])) if len(sys.argv)>2 else {}
def inside(a,b,t=4): return a[0]>=b[0]-t and a[1]>=b[1]-t and a[2]<=b[2]+t and a[3]<=b[3]+t
def area(b): return (b[2]-b[0])*(b[3]-b[1])
for c in cells:
    bs=[g['box'] for g in c['groups']]
    bs=[b for b in bs if not any(o is not b and area(o)>area(b) and inside(b,o) for o in bs)]
    q=[b for b in bs if (b[3]-b[1])<50 and (b[2]-b[0])<40]   # question marks
    c['uncertain']=len(q)
    bs=[b for b in bs if b not in q]
    o=OVR.get(c['syllable'])
    if o is not None:
        a=np.array(Image.open(f"{D}/{c['img']}").convert('L'))<110
        def tight(b):
            ys,xs=np.nonzero(a[b[1]:b[3],b[0]:b[2]]); return [int(b[0]+xs.min()),int(b[1]+ys.min()),int(b[0]+xs.max()),int(b[1]+ys.max())]
        bs=[tight(b) for b in o['boxes']]; c['note']=o.get('note')
    ch=(c['cell'][3]-c['cell'][1])/2
    n=len(bs)  # list.sort empties the list while the key runs, so len() must be read first
    bs.sort(key=lambda b:(int((b[1]+b[3])/2>c['cell'][1]+ch) if n>2 else 0, b[0]))
    c['variants']=bs
for p in range(5):
    im=Image.open(f'{D}/raw-00{p}.jpg').convert('RGB'); dr=ImageDraw.Draw(im)
    for c in cells:
        if c['page']!=p+2: continue
        for i,b in enumerate(c['variants']):
            dr.rectangle(b,outline=(255,0,0),width=2); dr.text((b[0],b[1]-12),f"{c['syllable']}.{i+1}"+('?'*c['uncertain']),fill=(0,0,255))
    im.save(f'{D}/final-{p}.png')
json.dump(cells,open(f'{D}/cells-final.json','w'),indent=1,ensure_ascii=False)
print(sum(len(c['variants']) for c in cells),'variants;',[(c['syllable'],c['uncertain']) for c in cells if c['uncertain']])

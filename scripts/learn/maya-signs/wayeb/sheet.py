import sys, json
from PIL import Image, ImageDraw
D=sys.argv[1]; kind=sys.argv[2]; out=sys.argv[3]
recs=[r for r in json.load(open(f'{D}/wayeb-records.json')) if r['kind']==kind]
items=[]
for r in recs:
    for im in (r.get('imgs') or [r['img']]):
        items.append((r.get('value') or r['transliteration'], im['src']))
T=100; cols=15; rows=-(-len(items)//cols)
S=Image.new('RGB',(cols*T,rows*(T+14)),'white'); dr=ImageDraw.Draw(S)
for k,(lab,src) in enumerate(items):
    im=Image.open(f'{D}/x/{src}').convert('RGBA'); bg=Image.new('RGBA',im.size,'white'); bg.alpha_composite(im); im=bg.convert('RGB')
    im.thumbnail((T-6,T-6)); x,y=(k%cols)*T,(k//cols)*(T+14)
    S.paste(im,(x+3,y+3)); dr.text((x+3,y+T-2),lab[:16],fill=(200,0,0))
S.save(out); print(len(items),S.size)

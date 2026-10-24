"""Labelled contact sheets of every crop next to its reading, for the by-eye check. Usage: sheet.py <work-dir>"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
W=sys.argv[1]; os.makedirs(f'{W}/sheets',exist_ok=True)
recs=[json.loads(l) for l in open(f'{W}/out/blocks.jsonl')]; recs=[r for r in recs if r['image']]
T=190; cols=8; per=40
try: F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
except: F=ImageFont.load_default()
for s in range(0,len(recs),per):
    chunk=recs[s:s+per]; rows=-(-len(chunk)//cols)
    S=Image.new('RGB',(cols*T,rows*(T+42)),'white'); dr=ImageDraw.Draw(S)
    for k,r in enumerate(chunk):
        im=Image.open(f'{W}/out/img/'+r['image']['file']); im.thumbnail((T-6,T-6))
        x,y=(k%cols)*T,(k//cols)*(T+42); S.paste(im,(x+3,y+3))
        dr.text((x+3,y+T-2),f"{r['monument'].replace('-main-tablet','')} {r['coord']}",fill=(200,0,0),font=F)
        dr.text((x+3,y+T+12),r['transliteration'][:26],fill=(0,0,0),font=F)
        dr.text((x+3,y+T+25),r['translation'][:28],fill=(0,0,160),font=F)
    S.save(f'{W}/sheets/sheet{s//per:02d}.png')
print(len(recs))

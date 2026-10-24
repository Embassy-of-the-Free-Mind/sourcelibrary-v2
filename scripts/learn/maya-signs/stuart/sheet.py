import sys, json
from PIL import Image, ImageDraw
D=sys.argv[1]; cells=json.load(open(f'{D}/cells-final.json'))
items=[(c,i,b) for c in cells for i,b in enumerate(c['variants'])]
T=110; cols=14; rows=-(-len(items)//cols)
S=Image.new('RGB',(cols*T,rows*(T+16)),'white'); dr=ImageDraw.Draw(S)
imgs={}
for k,(c,i,b) in enumerate(items):
    im=imgs.setdefault(c['img'],Image.open(f"{D}/{c['img']}").convert('L'))
    cr=im.crop((b[0]-3,b[1]-3,b[2]+3,b[3]+3)); cr.thumbnail((T-8,T-8))
    x,y=(k%cols)*T,(k//cols)*(T+16)
    S.paste(cr,(x+4,y+4)); dr.text((x+4,y+T),f"{c['syllable']}.{i+1}"+('?' if c['uncertain'] else ''),fill=(200,0,0))
S.save(f'{D}/contact.png'); print(S.size,len(items))

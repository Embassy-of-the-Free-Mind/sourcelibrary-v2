#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/mongol-synth-5664/freeze_eval.py column_image (the same 84 px crop, copied: that script
only crops the frozen sets).

Cuts every segmented column of the fetched leaves into an 84 px strip for the 05-mongol-realgt-read task (#5664).
  cd $JOB_SCRATCH && python3 crop_cols.py      (reads seg/*.json + leaves/*.jpg, writes readset/)
"""
import json,glob,os,sys
from PIL import Image
OUT_H=84
def column_image(im, box):
    x0,y0,x1,y1=box
    c=im.crop((x0,y0,x1,y1)).rotate(90,expand=True)
    return c.resize((max(32,int(c.width*OUT_H/c.height)),OUT_H),Image.LANCZOS)
os.makedirs('readset/img',exist_ok=True)
rows=[]
for f in sorted(glob.glob('seg/*.json')):
    b=os.path.basename(f)[:-5]; key=b.split('_v')[0]   # v002_10a
    try: d=json.load(open(f))
    except Exception: continue
    im=Image.open(f'leaves/{b}.jpg').convert('RGB')
    for i,box in enumerate(d['columns'],1):
        cid=f'{key}/c{i:02d}'; p=f'img/{key}_c{i:02d}.jpg'
        if not os.path.exists('readset/'+p): column_image(im,box).save('readset/'+p,quality=92)
        rows.append({'id':cid,'image':p,'set':'realgt','box':box})
with open('readset/columns.jsonl','w') as fo:
    for r in rows: fo.write(json.dumps(r)+'\n')
print(len(rows))

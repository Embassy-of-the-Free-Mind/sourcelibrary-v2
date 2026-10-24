"""Whole-leaf images (one per leaf, <= 2600 px wide) for the boundary probe (#7119). Run with the job venv."""
import json, os, sys
from pathlib import Path
from PIL import Image
S = Path(os.environ.get('JOB_SCRATCH', '/mnt/HC_Volume_105839809/jobs/whish147-best'))
b = json.loads((Path(__file__).parent / 'boxes.json').read_text())
(S / 'leaves').mkdir(exist_ok=True)
for n, r in b.items():
    im = None
    for name, h in r['leaves'].items():
        out = S / 'leaves' / f'{n}-{name}.jpg'
        if out.exists():
            continue
        im = im or Image.open(S / 'img' / f'{n}.jpg')
        x0, y0, _, y1 = h['L']; x1 = h['R'][2]
        c = im.crop((x0, y0, x1, y1))
        c = c.resize((2600, round(c.height * 2600 / c.width)), Image.LANCZOS)
        c.convert('RGB').save(out, quality=90)

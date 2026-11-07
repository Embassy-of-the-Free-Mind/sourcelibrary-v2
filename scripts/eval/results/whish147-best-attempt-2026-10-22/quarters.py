"""Quarter-leaf crops (native resolution) for leaves in the denser hand that half-leaf crops could not place (#7119).
Writes $JOB_SCRATCH/crops/<page>-<leaf>Q<1-4>.jpg, cut at quarter points with a 3% overlap. Run with the job venv:
  python quarters.py <page>-<leaf> ..."""
import json, os, sys
from pathlib import Path
from PIL import Image
S = Path(os.environ.get('JOB_SCRATCH', '/mnt/HC_Volume_105839809/jobs/whish147-best'))
B = json.loads((Path(__file__).parent / 'boxes.json').read_text())
for key in sys.argv[1:]:
    n, leaf = key.split('-')
    h = B[n]['leaves'][leaf]
    x0, y0, _, y1 = h['L']; x1 = h['R'][2]
    w = x1 - x0; ov = int(w * 0.03)
    im = Image.open(S / 'img' / f'{n}.jpg')
    for q in range(4):
        a = max(x0, x0 + q * w // 4 - ov); b = min(x1, x0 + (q + 1) * w // 4 + ov)
        im.crop((a, y0, b, y1)).convert('RGB').save(S / 'crops' / f'{key}Q{q + 1}.jpg', quality=92)

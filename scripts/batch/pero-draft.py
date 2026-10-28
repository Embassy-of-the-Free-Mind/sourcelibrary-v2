#!/usr/bin/env python3
"""pero-draft.py — PERO-OCR drafts of a folder of page images, for the GPU-draft correction lane (#7263).

PRIOR ART: scripts/eval/euro-gpu-correct-7567/pero-collect.py (#7567 E1) — the PAGE XML -> text reader this reuses
line for line (TextRegion -> TextLine -> TextEquiv/Unicode in document order; lines joined by newlines, regions by a
blank line), so a production draft is built exactly as the #7263 TEST's arm C draft was. It reads an eval folder and
writes jsonl for a scorer; this runs PERO itself on a lane's folder and writes the JSON the lane hands to
`cli-ocr.mjs read --gpu-draft`, with the engine's provenance.

  pero-draft.py <image dir> <out.json> [--threads=8]
  Images are <page_id>.jpg. Runs `parse-folder -c config_cpu.ini --device cpu` (pero_eu_cz_print_newspapers_2022-09-26,
  its CPU config: the configuration the TEST drafts were made with) from $PERO_HOME (default /root/pero-ocr: venv/ and
  the model folder). Writes {"_engine": {...}, "<page_id>": {"text", "image_sha256", "regions", "lines"}}.

  Not bit-reproducible: PERO's adaptive downsampling depends on the pages read before (on 8 TEST pages a rerun gave 6
  identical drafts). The draft actually corrected is the one recorded, by hash, in each write's provenance.
"""
import hashlib, json, os, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET

src, out = sys.argv[1], sys.argv[2]
opt = dict(a[2:].split('=', 1) for a in sys.argv[3:] if a.startswith('--') and '=' in a)
THREADS = opt.get('threads', '8')
HOME = os.environ.get('PERO_HOME', '/root/pero-ocr')
MODEL = 'pero_eu_cz_print_newspapers_2022-09-26'
MODEL_DIR = os.path.join(HOME, MODEL)
CONFIG = 'config_cpu.ini'
PERO_COMMIT = '4301bdffe9205dff11579dae27b3f80458c27e89'
NS = '{http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15}'


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


imgs = sorted(f for f in os.listdir(src) if f.endswith('.jpg'))
if not imgs:
    json.dump({'_engine': None}, open(out, 'w')); print('no images'); sys.exit(0)
xml_dir = tempfile.mkdtemp(prefix='pero-xml-', dir=os.environ.get('TMPDIR'))
t0 = time.time()
env = {**os.environ, 'OMP_NUM_THREADS': THREADS, 'MKL_NUM_THREADS': THREADS}
log = open(out + '.log', 'w')
r = subprocess.run([os.path.join(HOME, 'venv', 'bin', 'parse-folder'), '-c', CONFIG, '--device', 'cpu', '-i', os.path.abspath(src),
                    '--output-xml-path', xml_dir], cwd=MODEL_DIR, env=env, stdout=log, stderr=subprocess.STDOUT)
wall = time.time() - t0
res = {'_engine': {'name': 'pero-ocr', 'version': f'git {PERO_COMMIT}', 'model': MODEL, 'config': CONFIG,
                   'config_sha256': sha(os.path.join(MODEL_DIR, CONFIG)), 'ocr_weights_sha256': sha(os.path.join(MODEL_DIR, 'OCR_350000.pt.cpu')),
                   'device': f'cpu ({THREADS} threads)', 'exit': r.returncode, 'pages': len(imgs), 'wall_secs': round(wall, 1),
                   'secs_per_page': round(wall / len(imgs), 2), 'collect': 'pero-collect.py (#7567): regions in document order'}}
for f in imgs:
    pid = f[:-4]
    xp = os.path.join(xml_dir, pid + '.xml')
    if not os.path.exists(xp): continue
    regions, lines = [], 0
    for reg in ET.parse(xp).getroot().iter(NS + 'TextRegion'):
        ls = [u.text or '' for tl in reg.iter(NS + 'TextLine') for u in tl.iter(NS + 'Unicode')]
        if any(l.strip() for l in ls): regions.append('\n'.join(ls)); lines += len(ls)
    res[pid] = {'text': '\n\n'.join(regions), 'image_sha256': sha(os.path.join(src, f)), 'regions': len(regions), 'lines': lines}
for f in os.listdir(xml_dir): os.remove(os.path.join(xml_dir, f))
os.rmdir(xml_dir)
json.dump(res, open(out, 'w'), ensure_ascii=False)
print(f"pero: {len(res) - 1}/{len(imgs)} drafts, {wall:.0f}s ({res['_engine']['secs_per_page']} s/page), exit {r.returncode}")
sys.exit(0 if r.returncode == 0 else 1)

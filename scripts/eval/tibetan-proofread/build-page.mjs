#!/usr/bin/env node
// PRIOR ART: scripts/eval/build-gold-annotator.mjs — a self-contained HTML annotator built from a drawn sample,
// localStorage + JSON export. Same pattern; it labels books with a verdict, this edits page TEXT line by line
// beside the leaf image, so the page body is new. No /platform/admin text-correction UI exists to reuse
// (searched src/app/admin, src/app/platform; the reader's OCR editor writes to `pages`, which this must not).
//
// Builds the proofreading page for the Tibetan same-edition proofread set (#4523):
//   - reads scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl
//   - fetches each leaf image (R2 archived master, downscaled to 2400 px wide — the width Yigdzin read at)
//     into <out>/img/<seq>.jpg — the artifact frame blocks external image hosts, so images ship with the page
//   - writes <out>/index.html with the served text embedded
// Publish <out>/index.html as a private Artifact with files {"img/<seq>.jpg": ...} and capabilities
// {db:{}, user:{}, downloads:true}. Corrections are saved to the artifact's db collection `corrections`
// (one doc per page) and can be exported as JSON; `score.mjs ingest` turns that export into ground-truth files.
//
//   node scripts/eval/tibetan-proofread/build-page.mjs --out <dir> [--width 2400] [--skip-images]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const MANIFEST = arg('--manifest', path.join(REPO, 'scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl'));
const OUT = arg('--out');
const WIDTH = parseInt(arg('--width', '2400'), 10);
if (!OUT) throw new Error('--out <dir> required');

const rows = fs.readFileSync(MANIFEST, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });

// Source: our R2 archived master (`archived_photo`, full resolution) downscaled to WIDTH; where a page has none,
// the R2 display copy (2000 px). Not the BL IIIF server: it caps a whole-image request at 1200 px.
if (!process.argv.includes('--skip-images')) {
  const sharp = createRequire(path.join(process.env.SL_NODE_ROOT || REPO, 'package.json'))('sharp');
  for (const r of rows) {
    const dest = path.join(OUT, 'img', `${r.seq}.jpg`);
    const src = r.archived_photo || r.display_photo;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${r.id}: ${res.status} ${src}`);
    const info = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: WIDTH, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(dest);
    console.error(`img ${r.seq} ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB  ${src}`);
  }
}

const pages = rows.map((r) => ({
  seq: r.seq, id: r.id, title: r.title, page_number: r.page_number, leaf_seam: r.leaf_seam,
  reader_url: r.reader_url, full_img: r.archived_photo || r.display_photo, served_text_sha256: r.served_text_sha256,
  img: `img/${r.seq}.jpg`, lines: r.served_text.split('\n'),
}));
const data = JSON.stringify(pages).replace(/</g, '\\u003c');
const html = fs.readFileSync(path.join(HERE, 'page.template.html'), 'utf8').replace('/*__PAGES__*/[]', data);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.error(`wrote ${path.join(OUT, 'index.html')} (${(html.length / 1024).toFixed(0)} KB, ${pages.length} pages)`);

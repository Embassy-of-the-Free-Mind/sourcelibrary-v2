// #4747 secondary check, run on Hetzner as `node geometry.mjs <results dir>` (output: geometry.txt).
// (1) how often an arm reproduces flash-realtime's boxes exactly (IoU>=0.9 for every box) — the
// flash re-run is the noise floor; (2) median edge offsets vs flash on single-box pages, to tell a
// systematic unit/offset bias (fixable) from per-page noise (not fixable). The import path is the
// Hetzner worktree's; point it at scripts/lib/bbox.mjs wherever you run it.
import fs from 'node:fs';
const D = process.argv[2];
const { normalizeBbox } = await import('/root/bbox-eval-4747/repo/scripts/lib/bbox.mjs');
const read = (f) => new Map(fs.readFileSync(`${D}/raw-${f}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error).map((r) => [r.page_id, r]));
const box = (r) => {
  try {
    const j = JSON.parse((r.text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    return (j.extracted_images || []).map((d) => {
      if (r.format === 'box2d') { const v = d.box_2d; return v && { x: v[1] / 1000, y: v[0] / 1000, width: (v[3] - v[1]) / 1000, height: (v[2] - v[0]) / 1000 }; }
      if (r.format === 'bbox2d') { const v = d.bbox_2d; return v && { x: v[0] / 1000, y: v[1] / 1000, width: (v[2] - v[0]) / 1000, height: (v[3] - v[1]) / 1000 }; }
      return d.bbox && normalizeBbox(d.bbox);
    }).filter(Boolean);
  } catch { return []; }
};
const F = read('flash-realtime');
const iou = (a, b) => { const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / (a.width * a.height + b.width * b.height - i); };
for (const arm of ['flash-r2-realtime', 'flash-batch', 'lite-realtime', 'lite-batch']) {
  if (!fs.existsSync(`${D}/raw-${arm}.jsonl`)) continue;
  const A = read(arm); let n = 0, same = 0, sameCount = 0;
  for (const [pid, fr] of F) {
    const a = A.get(pid); if (!a) continue; n++;
    const fb = box(fr), ab = box(a);
    if (fb.length !== ab.length) continue; sameCount++;
    const used = new Set();
    const ok = fb.every((f) => { const j = ab.findIndex((b, k) => !used.has(k) && iou(f, b) >= 0.9); if (j < 0) return false; used.add(j); return true; });
    if (ok) same++;
  }
  console.log(`${arm.padEnd(22)} vs flash-realtime: ${n} pages; same box count ${sameCount}; every box matched at IoU>=0.9 ${same} (${((same / n) * 100).toFixed(1)}%)`);
}
for (const arm of ['flash-r2-realtime', 'lite-realtime', 'lite-batch', 'lite-box2d-realtime', 'lite35-realtime', 'qwen235-realtime']) {
  const A = read(arm); const rows = [];
  for (const [pid, fr] of F) {
    const a = A.get(pid); if (!a) continue;
    const fb = box(fr), ab = box(a); if (fb.length !== 1 || ab.length !== 1) continue;
    const f = fb[0], b = ab[0];
    rows.push({ dl: b.x - f.x, dt: b.y - f.y, dr: (b.x + b.width) - (f.x + f.width), db: (b.y + b.height) - (f.y + f.height), wr: b.width / f.width, hr: b.height / f.height });
  }
  const med = (k) => { const s = rows.map((r) => r[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const mad = (k) => { const m = med(k); const s = rows.map((r) => Math.abs(r[k] - m)).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  console.log(`${arm.padEnd(22)} n=${rows.length} median edge shift vs flash (+=right/down): L ${med('dl').toFixed(3)} T ${med('dt').toFixed(3)} R ${med('dr').toFixed(3)} B ${med('db').toFixed(3)} | w-ratio ${med('wr').toFixed(2)} h-ratio ${med('hr').toFixed(2)} | MAD L ${mad('dl').toFixed(3)} T ${mad('dt').toFixed(3)} R ${mad('dr').toFixed(3)} B ${mad('db').toFixed(3)}`);
}

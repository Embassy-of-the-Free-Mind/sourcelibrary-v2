// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
// Feature extraction for the #6388 table detector analysis (scratch; the shipped rule lives in scripts/lib).
import { longestCharRun } from '../../lib/paddle-zh-lane.mjs';
const HAN = /\p{Script=Han}/u;
export function bodyOf(text) {
  return String(text || '').replace(/<language>[\s\S]*?<\/language>|<script>[\s\S]*?<\/script>/g, '')
    .replace(/<(header|page-num)>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '').trim();
}
export function features(text, pp) {
  const body = bodyOf(text);
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const hanL = lines.map((l) => [...l].filter((c) => HAN.test(c)));
  const lens = hanL.map((x) => x.length);
  const han = lens.reduce((a, b) => a + b, 0);
  const n = lines.length;
  const short = lens.filter((x) => x <= 2).length;
  const mean = n ? han / n : 0;
  const sd = n ? Math.sqrt(lens.reduce((a, x) => a + (x - mean) ** 2, 0) / n) : 0;
  const seen = new Set(); let dup = 0;
  for (const h of hanL) { if (h.length < 2) continue; const k = h.join(''); if (seen.has(k)) dup++; else seen.add(k); }
  const freq = new Map(); for (const h of hanL) for (const c of h) freq.set(c, (freq.get(c) || 0) + 1);
  let top = 0; for (const v of freq.values()) if (v > top) top = v;
  const spaced = lines.filter((l) => (l.match(/ /g) || []).length >= 2).length;
  return {
    han, lines: n,
    short: n ? short / n : 0,
    cv: mean ? sd / mean : 0,
    run: longestCharRun(body),
    dup: n ? dup / n : 0,
    distinct: han ? freq.size / han : 0,
    top: han ? top / han : 0,
    topn: top,
    spaced: n ? spaced / n : 0,
    tables: pp?.tables_flattened ?? null,
    img: pp?.img_dropped ?? null,
  };
}

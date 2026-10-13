// PRIOR ART: scripts/eval/paddle-table-6388/{score-rev,cer}.mjs — review parsing (first parseable reply per uid) and
// the Kanripo over-count (repeats of characters the leaf prints, beyond its count). Reused here for the pilot gate:
// share of the 100 Opus reads on which the Gemini reviewer finds invented text, Wilson 95%, controls first.
// Usage (cwd = scratch): node score.mjs   (reads pilsample.json, pil-read-opus.jsonl, pil-review-req-*.json,
// pil-review-gem.jsonl, pil-align.jsonl; writes pilot-score.json)
import fs from 'node:fs';
import { bodyText, foldHan } from '../ground-truth-5935/lib.mjs';

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const S = JSON.parse(fs.readFileSync('pilsample.json', 'utf8'));
const reads = new Map(); for (const r of readJsonl('pil-read-opus.jsonl')) if (r.text) reads.set(r.uid, r);
const parsed = new Map(JSON.parse(fs.readFileSync('pil-review-req-parsed.json', 'utf8')).map((p) => [p.uid, p]));
const controls = JSON.parse(fs.readFileSync('pil-review-req-controls.json', 'utf8'));
const reviews = new Map();
for (const r of readJsonl('pil-review-gem.jsonl')) {
  if (reviews.has(r.uid) || !r.text) continue;
  const m = r.text.match(/\{[\s\S]*\}/); let j = null; try { j = JSON.parse(m[0]); } catch { /* unparseable */ }
  if (j?.verdict) reviews.set(r.uid, { ...j, secs: r.secs });
}
const align = new Map(readJsonl('pil-align.jsonl').map((a) => [a.key, a]));
const wilson = (k, n, z = 1.96) => { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+((c - s) / d).toFixed(3), +((c + s) / d).toFixed(3)]; };
const bag = (s) => { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) || 0) + 1); return m; };
const overCount = (text, leaf) => { const W = bag(leaf), Q = bag(foldHan(bodyText(text))); let oc = 0; for (const [ch, w] of W) oc += Math.max(0, (Q.get(ch) || 0) - w); return oc; };

// Controls: caught = verdict invented AND the planted line (≥ 4 of its characters, contiguous) is named.
const ctl = controls.map((c) => {
  const v = reviews.get(c.uid);
  const named = v && (v.invented || []).some((x) => { const w = String(x.what || ''); for (let i = 0; i + 4 <= [...c.inserted].length; i++) if (w.includes([...c.inserted].slice(i, i + 4).join(''))) return true; return false; });
  return { uid: c.uid, inserted: c.inserted, verdict: v?.verdict ?? null, caught: v?.verdict === 'invented' && !!named };
});

const pages = S.map((s) => {
  const r = reads.get(s.uid); const p = parsed.get(s.uid); const v = reviews.get(s.uid); const a = align.get(s.uid);
  const own = a?.status === 'aligned' && a.leaf === 'own' && [...(a.kanripo_text || '')].length >= 20;
  const body = p ? r.text.match(/===TRANSCRIPTION===\s*\n([\s\S]*?)\n?===END===/)[1] : '';
  return {
    uid: s.uid, pid: s.pid, bid: s.bid, pn: s.pn, iss: s.iss, title: s.title,
    read_ok: !!p, read_secs: r?.secs ?? null, layout: p?.layout ?? null, body_han: p?.body_han ?? null,
    drawing_only: p ? p.body_han === 0 : null,
    rods: p ? /[\u{1D360}-\u{1D371}〡-〩]|\[rod:/u.test(body) : null,
    review: v ? { verdict: v.verdict, invented: v.invented, invented_chars: v.invented_chars, note: v.note } : null,
    kanripo_own: own ? { pb: a.ref_pb, chars: [...a.kanripo_text].length, over_opus: overCount(body, a.kanripo_text), over_paddle: overCount(s.paddle, a.kanripo_text) } : null,
  };
});

const reviewed = pages.filter((p) => p.review);
const inv = reviewed.filter((p) => p.review.verdict === 'invented');
const by = (f) => { const o = {}; for (const p of reviewed) { const k = f(p); (o[k] ||= { n: 0, invented: 0 }).n++; if (p.review.verdict === 'invented') o[k].invented++; } return o; };
const K = pages.filter((p) => p.kanripo_own);
const secs = pages.map((p) => p.read_secs).filter((x) => x != null).sort((a, b) => a - b);
const out = {
  controls: { planted: ctl.length, caught: ctl.filter((c) => c.caught).length, rows: ctl },
  reads: { requested: S.length, ok: pages.filter((p) => p.read_ok).length, median_secs: secs[Math.floor((secs.length - 1) / 2)] ?? null, mean_secs: secs.length ? +(secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1) : null },
  layout: Object.fromEntries(Object.entries(pages.reduce((o, p) => ((o[p.layout] = (o[p.layout] || 0) + 1), o), {}))),
  drawing_only: pages.filter((p) => p.drawing_only).length,
  rods_written: pages.filter((p) => p.rods).length,
  reviewed: reviewed.length,
  verdicts: reviewed.reduce((o, p) => ((o[p.review.verdict] = (o[p.review.verdict] || 0) + 1), o), {}),
  invented: { k: inv.length, n: reviewed.length, rate: reviewed.length ? +(inv.length / reviewed.length).toFixed(3) : null, wilson95: wilson(inv.length, reviewed.length) },
  invented_on_transcribed: (() => { const t = reviewed.filter((p) => !p.drawing_only); const k = t.filter((p) => p.review.verdict === 'invented').length; return { k, n: t.length, wilson95: wilson(k, t.length) }; })(),
  by_run: by((p) => p.iss), by_layout: by((p) => p.layout),
  by_work: by((p) => (/子史精華/.test(p.title) ? '御定子史精華' : /清文鑑/.test(p.title) ? '御製增訂清文鑑' : 'other')),
  kanripo_own: { pages: K.length, over_opus: K.reduce((a, p) => a + p.kanripo_own.over_opus, 0), over_paddle: K.reduce((a, p) => a + p.kanripo_own.over_paddle, 0), pages_opus_ge3: K.filter((p) => p.kanripo_own.over_opus >= 3).length, pages_paddle_ge3: K.filter((p) => p.kanripo_own.over_paddle >= 3).length, printed_chars: K.reduce((a, p) => a + p.kanripo_own.chars, 0) },
  gate: null,
};
const controlsOk = out.controls.caught >= 4;
out.gate = !controlsOk ? 'NO VERDICT (reviewer missed controls)' : out.invented.rate <= 0.10 ? 'GO (ADOPT: invented on ≤ 10%)' : 'NO-GO (invented on > 10%)';
fs.writeFileSync('pilot-score.json', JSON.stringify({ summary: out, pages }, null, 1));
console.log(JSON.stringify(out, null, 1));

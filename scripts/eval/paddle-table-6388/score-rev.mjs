// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs';
const parse = t => parseFirst(t);
const last = f => { const m = {}; if (!fs.existsSync(f)) return m; for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (m[r.uid] && parse(m[r.uid].text)) continue; m[r.uid] = r; } return m; };
const parseFirst = t => { const s = String(t || ''); const i = s.indexOf('{'); if (i < 0) return null; let d = 0; for (let k = i; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) { try { return JSON.parse(s.slice(i, k + 1)); } catch { return null; } } } return null; };
const B = JSON.parse(fs.readFileSync('bake.json'));
const out = {};
for (const [name, f, ctlf] of [['gemini reviews Opus reads', 'review-by-gem.jsonl', 'gem-review-req-controls.json'], ['opus reviews Gemini reads', 'review-by-opus.jsonl', 'opus-review-req-controls.json']]) {
  const R = last(f); const ctl = JSON.parse(fs.readFileSync(ctlf));
  const res = { controls: [], pages: [] };
  for (const c of ctl) { const v = parse(R[c.uid]?.text); res.controls.push({ uid: c.uid, inserted: c.inserted, verdict: v?.verdict ?? 'no reply', caught: v?.verdict === 'invented' && (v.invented || []).some(x => (x.what || '').replace(/\s/g, '').includes(c.inserted.replace(/<[^>]+>/g, '').replace(/\s/g, '').slice(0, 4))), invented: v?.invented }); }
  for (const b of B) { const r = R[b.uid]; if (!r) continue; const v = parse(r.text); res.pages.push({ uid: b.uid, stratum: b.stratum, verdict: v?.verdict ?? (r.text ? 'unparsed' : 'empty'), layout: v?.layout, invented_chars: v?.invented_chars ?? null, omitted_chars: v?.omitted_chars ?? null, misread_chars: v?.misread_chars ?? null, invented: v?.invented || [], note: v?.note || '' }); }
  const vc = {}; for (const p of res.pages) vc[p.verdict] = (vc[p.verdict] || 0) + 1;
  res.summary = { n: res.pages.length, verdicts: vc, invented_pages: res.pages.filter(p => p.verdict === 'invented').length, invented_chars: res.pages.reduce((a, p) => a + (p.invented_chars || 0), 0), controls_caught: `${res.controls.filter(c => c.caught).length}/${res.controls.length}` };
  out[name] = res;
  console.log(name, JSON.stringify(res.summary)); for (const c of res.controls) console.log('  ctl', c.uid, c.verdict, c.caught, JSON.stringify(c.invented)?.slice(0, 150));
  for (const p of res.pages) console.log('  ', p.uid, p.stratum.padEnd(21), p.verdict.padEnd(9), String(p.invented_chars).padStart(4), p.note.slice(0, 110));
}
fs.writeFileSync('reviews.json', JSON.stringify(out, null, 1));

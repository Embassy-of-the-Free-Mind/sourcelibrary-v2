// PRIOR ART: scripts/eval/route-judge-6740/paired-arm.mjs score — it scores one judge per arm pair from its own recipe; this prints the
// v3#199 cell-test table (two judges, each scoring the other model's correction plus the stored text) from pj.mjs's key and verdicts.
import fs from 'node:fs';
const D = process.argv[2];
const key = JSON.parse(fs.readFileSync(D + '/key.json'));
const V = {}; for (const j of ['opus', 'fable']) { V[j] = new Map(); if (fs.existsSync(`${D}/verdicts-${j}.jsonl`)) for (const l of fs.readFileSync(`${D}/verdicts-${j}.jsonl`, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.verdict) V[j].set(r.id, r.verdict); } }
const wt = (v) => (v.defects || []).filter((d) => d.severity === 'wrong_text').length;
const out = { arms: {}, pages: [] };
const items = (arm) => key.filter((k) => k.kind === 'item' && k.route === arm);
const st = new Map(items('stored').map((k) => [k.page_id, k]));
for (const j of ['opus', 'fable']) {
  const ks = key.filter((k) => k.judges.includes(j));
  for (const arm of [...new Set(ks.map((k) => k.route))]) {
    const wp = ks.filter((k) => k.kind === 'wrong_page' && k.route === arm).map((k) => V[j].get(k.judged_as));
    const it = ks.filter((k) => k.kind === 'item' && k.route === arm).map((k) => V[j].get(k.judged_as)).filter(Boolean);
    console.log(`judge ${j} arm ${arm}: accept ${it.filter((v) => v.accept).length}/${it.length}, mean fidelity ${(it.reduce((a, v) => a + v.fidelity, 0) / it.length).toFixed(2)}, wrong_text defects ${it.reduce((a, v) => a + wt(v), 0)}; wrong-page controls: ${wp.map((v) => v ? `accept=${v.accept} f${v.fidelity}` : 'none').join(', ')}`);
  }
  const reps = ks.filter((k) => k.kind === 'repeat');
  let flips = 0, fd = 0; for (const k of reps) { const a = V[j].get(k.judged_as), b = V[j].get(st.get(k.page_id).judged_as); if (a && b) { if (a.accept !== b.accept) flips++; fd += Math.abs(a.fidelity - b.fidelity); } }
  console.log(`  noise floor ${j}: accept flips ${flips}/${reps.length}, mean |fidelity diff| ${(fd / reps.length).toFixed(2)}`);
}
for (const [arm, j] of [['opus', 'fable'], ['fable', 'opus']]) {
  let better = 0, worse = 0, same = 0, gain = 0, lose = 0, unchanged = 0; const worseP = [];
  for (const k of items(arm)) {
    const a = V[j].get(k.judged_as), s = V[j].get(st.get(k.page_id).judged_as); if (!a || !s) continue;
    if (k.unchanged) unchanged++;
    const w = a.fidelity < s.fidelity || (s.accept && !a.accept), b = !w && (a.fidelity > s.fidelity || (!s.accept && a.accept));
    if (w) { worse++; worseP.push(`${k.book_id.slice(0, 8)} p${k.page_number} (${s.accept ? 'A' : 'r'}${s.fidelity}→${a.accept ? 'A' : 'r'}${a.fidelity})`); } else if (b) better++; else same++;
    if (!s.accept && a.accept) gain++; if (s.accept && !a.accept) lose++;
    out.pages.push({ arm, judge: j, page_id: k.page_id, book_id: k.book_id, page_number: k.page_number, stored: { accept: s.accept, fidelity: s.fidelity, wt: wt(s) }, corr: { accept: a.accept, fidelity: a.fidelity, wt: wt(a) }, rel: w ? 'worse' : b ? 'better' : 'same', unchanged: !!k.unchanged });
  }
  out.arms[arm] = { judge: j, better, same, worse, accept_gained: gain, accept_lost: lose, unchanged, pass: worse <= 2 && gain > lose };
  console.log(`ARM ${arm} (judge ${j}): better ${better}, same ${same}, worse ${worse}; accepts gained ${gain}, lost ${lose}; unchanged ${unchanged}; PASS=${worse <= 2 && gain > lose}`); if (worseP.length) console.log('   worse:', worseP.join('; '));
}
fs.writeFileSync(D + '/pass-rule.json', JSON.stringify(out, null, 1));

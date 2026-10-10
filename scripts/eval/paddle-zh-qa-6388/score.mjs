#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-prereg-6388/score.mjs (scores engine reads by CER against a consensus key; this scores
// reviewer VERDICTS on a stored read, with planted-span controls) and scripts/eval/lib/agreement-stats.mjs (wilson, kappa
// helpers — imported).
//
// #6388 Paddle zh QA: score the reviewers. $0, no model call, no Mongo.
//   node scripts/eval/paddle-zh-qa-6388/score.mjs r3-packet   → $JOB_SCRATCH/requests-r3.jsonl (pages R1 and R2 disagree on)
//   node scripts/eval/paddle-zh-qa-6388/score.mjs report      → results.json + results.md
//
// CATCH RULE (fixed before the reviewers' output was read): a planted span is caught by a reviewer when one of its error
// entries on that request shares a run of ≥ 3 characters (≥ 2 for the 4-character substitution) with the planted text
// (for an insertion or substitution: the entry's "transcription"; for a deletion: the entry's "page") — or, for the
// substitution, with the original characters in the entry's "page". Entry type is not required to match.
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { parseReview } from './review-opus.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH || '/tmp/paddle-qa-6388';
const H = f => path.join(HERE, f);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const VERDICTS = ['clean', 'minor', 'material', 'unusable'];
const rank = v => VERDICTS.indexOf(v);

const map = readJson(H('packet-map.json')).items;
const ctl = readJson(H('controls.json'));
const draw = readJson(H('draw.json'));
const kan = new Map(readJsonl(H('kanripo.jsonl')).map(r => [r.uid, r]));
const lastBy = rows => { const m = new Map(); for (const r of rows) { const j = r.json ?? parseReview(r.text); if (j || !m.get(r.uid)?.json) m.set(r.uid, { ...r, json: j }); } return m; };
const R1 = lastBy(readJsonl(H('reads/R1.jsonl')));
const R2 = lastBy(readJsonl(H('reads/R2.jsonl')));
const R3 = lastBy(readJsonl(H('reads/R3.jsonl')));
const R = { R1, R2 };
const qOf = (uid, role) => map.find(m => m.uid === uid && m.role === role)?.qid;

function lcs(a, b) { // longest common substring length (by code point)
  const A = [...String(a || '')], B = [...String(b || '')]; let best = 0;
  const prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) { let diag = 0; for (let j = 1; j <= B.length; j++) { const tmp = prev[j]; prev[j] = A[i - 1] === B[j - 1] ? diag + 1 : 0; if (prev[j] > best) best = prev[j]; diag = tmp; } }
  return best;
}
function caught(span, errors) {
  const need = span.kind === 'substituted' ? 2 : 3;
  return (errors || []).some(e => span.kind === 'deleted'
    ? lcs(e.page, span.original) >= need
    : lcs(e.transcription, span.planted) >= need || (span.kind === 'substituted' && lcs(e.page, span.original) >= need));
}

const stage = process.argv[2];
const samples = map.filter(m => m.role === 'sample');

if (stage === 'r3-packet') {
  const base = fs.readFileSync(H('prompt.txt'), 'utf8');
  const texts = new Map(readJsonl(H('texts.jsonl')).map(r => [r.uid, r.text]));
  const reqs = [];
  for (const m of samples) {
    const a = R1.get(m.qid)?.json, b = R2.get(m.qid)?.json;
    if (a && b && a.verdict === b.verdict) continue;
    // Both lists, in a seeded order, labelled only "Reviewer X/Y".
    const flip = makeRng(6394 + Number(m.qid.slice(1)))() < 0.5;
    const [x, y] = flip ? [b, a] : [a, b];
    const show = j => j ? JSON.stringify({ verdict: j.verdict, error_chars: j.error_chars, errors: j.errors }) : '(no usable answer)';
    const extra = `\n\nTwo independent reviewers already checked this transcription against the image and DISAGREE on the verdict.\nReviewer X: ${show(x)}\nReviewer Y: ${show(y)}\nTheir lists may contain mistakes of their own. Check every listed error against the image yourself, look for any they both missed, and give your own final answer in the same JSON shape.`;
    const prompt = base.replace('{TRANSCRIPTION}', texts.get(m.uid)).replace(/\nThe page image:$/, `${extra}\n\nThe page image:`);
    reqs.push({ uid: m.qid, image: path.join(SCRATCH, 'packet', `${m.qid}.jpg`), prompt, x_is: flip ? 'R2' : 'R1' });
  }
  fs.writeFileSync(path.join(SCRATCH, 'requests-r3.jsonl'), reqs.map(r => JSON.stringify(r)).join('\n') + (reqs.length ? '\n' : ''));
  fs.writeFileSync(H('r3-order.json'), JSON.stringify(reqs.map(r => ({ qid: r.uid, x_is: r.x_is })), null, 1) + '\n');
  console.log('R3 requests', reqs.length);
} else if (stage === 'report') {
  const res = { reviewers: {}, controls: {}, stability: {}, sample: {} };
  res.reviewers = { R1: [...R1.values()][0]?.model, R2: [...R2.values()][0]?.model, R3: [...R3.values()][0]?.model ?? null };
  // Controls: planted spans
  for (const k of ['R1', 'R2']) {
    const rows = [];
    for (const p of ctl.plants) {
      const q = qOf(p.uid, 'plant'); const j = R[k].get(q)?.json;
      for (const s of p.spans) rows.push({ qid: q, plant: p.uid, span: s.id, kind: s.kind, caught: !!j && caught(s, j.errors), answered: !!j, verdict: j?.verdict ?? null });
    }
    const n = rows.length, c = rows.filter(r => r.caught).length;
    res.controls[k] = { spans: n, caught: c, missed: n - c, trusted: n - c <= 2, by_kind: Object.fromEntries(['inserted', 'deleted', 'substituted'].map(kd => [kd, `${rows.filter(r => r.kind === kd && r.caught).length}/${rows.filter(r => r.kind === kd).length}`])), plant_verdicts: ctl.plants.map(p => R[k].get(qOf(p.uid, 'plant'))?.json?.verdict ?? null), missed_list: rows.filter(r => !r.caught).map(r => `${r.qid} ${r.span}`) };
  }
  // Stability: repeats
  for (const k of ['R1', 'R2']) {
    const rows = ctl.repeats.map(u => { const a = R[k].get(qOf(u, 'sample'))?.json, b = R[k].get(qOf(u, 'repeat'))?.json; return { uid: u, first: a?.verdict ?? null, second: b?.verdict ?? null, same: !!a && !!b && a.verdict === b.verdict, err_chars: [a?.error_chars ?? null, b?.error_chars ?? null] }; });
    res.stability[k] = { pairs: rows.length, same_verdict: rows.filter(r => r.same).length, rows };
  }
  // Sample verdicts
  const pages = samples.map(m => {
    const d = draw.rows.find(r => r.uid === m.uid);
    const a = R1.get(m.qid)?.json, b = R2.get(m.qid)?.json, c = R3.get(m.qid)?.json;
    const agree = !!a && !!b && a.verdict === b.verdict;
    const final = agree ? a.verdict : c?.verdict ?? null;
    const finalErrs = agree ? null : c?.errors ?? null;
    const inv = j => (j?.errors || []).filter(e => e.type === 'invented' && [...String(e.transcription || '')].length >= 4);
    const k = kan.get(m.uid);
    return { qid: m.qid, uid: m.uid, stratum: d.stratum, title: d.title, page_number: d.page_number, r1: a?.verdict ?? null, r2: b?.verdict ?? null, r3: c?.verdict ?? null, agree, final,
      r1_err_chars: a?.error_chars ?? null, r2_err_chars: b?.error_chars ?? null, r3_err_chars: c?.error_chars ?? null,
      invented4_r1: inv(a).map(e => e.transcription), invented4_r2: inv(b).map(e => e.transcription), invented4_r3: inv(c).map(e => e.transcription),
      final_errors: finalErrs, kanripo: k?.status === 'scored' ? { cer: k.cer, leaf: k.leaf, dice: k.dice } : { status: k?.status } };
  });
  res.sample.pages = pages;
  const ex = (pp, w) => Object.fromEntries(VERDICTS.map(v => { const n = pp.length, x = pp.filter(p => p.final === v).length; const [lo, hi] = wilson(x, n); return [v, { x, n, rate: n ? x / n : null, ci95: [lo, hi] }]; }));
  const fin = pp => pp.filter(p => p.final);
  res.sample.rates = { all: ex(fin(pages.filter(p => p.stratum === 'all'))), stale: ex(fin(pages.filter(p => p.stratum === 'stale'))), pooled60: ex(fin(pages)) };
  const both = pages.filter(p => p.r1 && p.r2);
  res.sample.agreement = { both_answered: both.length, same_verdict: both.filter(p => p.agree).length, within_one: both.filter(p => Math.abs(rank(p.r1) - rank(p.r2)) <= 1).length, r3_needed: both.filter(p => !p.agree).length + pages.filter(p => !(p.r1 && p.r2)).length, r3_done: pages.filter(p => !p.agree && p.r3).length,
    r1_harsher: both.filter(p => rank(p.r1) > rank(p.r2)).length, r2_harsher: both.filter(p => rank(p.r2) > rank(p.r1)).length };
  // Kanripo vs verdicts
  const kp = pages.filter(p => p.final && p.kanripo.cer != null);
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  res.kanripo = { scored: kp.length, catastrophic_gt_0_5: kp.filter(p => p.kanripo.cer > 0.5).length, by_final: Object.fromEntries(VERDICTS.map(v => { const xs = kp.filter(p => p.final === v).map(p => p.kanripo.cer); return [v, { n: xs.length, median_cer: med(xs), max_cer: xs.length ? Math.max(...xs) : null }]; })) };
  // AUC: does Kanripo CER rank material/unusable pages above clean/minor ones?
  const pos = kp.filter(p => rank(p.final) >= 2).map(p => p.kanripo.cer), neg = kp.filter(p => rank(p.final) <= 1).map(p => p.kanripo.cer);
  let auc = 0; for (const x of pos) for (const y of neg) auc += x > y ? 1 : x === y ? 0.5 : 0;
  res.kanripo.auc_material_vs_not = pos.length && neg.length ? +(auc / pos.length / neg.length).toFixed(3) : null;
  res.kanripo.n_material_plus = pos.length;
  fs.writeFileSync(H('results.json'), JSON.stringify(res, null, 1) + '\n');
  // Markdown
  const pct = x => (x * 100).toFixed(1) + '%';
  const row = (name, r) => `| ${name} | ${VERDICTS.map(v => `${r[v].x}/${r[v].n} = ${pct(r[v].rate)} [${pct(r[v].ci95[0])}, ${pct(r[v].ci95[1])}]`).join(' | ')} |`;
  const md = [
    '# #6388 Paddle zh random-sample QA: results', '',
    `Reviewers: R1 ${res.reviewers.R1}; R2 ${res.reviewers.R2}; R3 (third read on disagreements) ${res.reviewers.R3 ?? '—'}.`, '',
    '## Page verdicts (final), Wilson 95% CI, one page per book', '',
    '| stratum | clean | minor (≤1%) | material | unusable |', '|---|---|---|---|---|',
    row('all books (n=50)', res.sample.rates.all), row('English marked stale (n=10)', res.sample.rates.stale), row('pooled 60 (not a frame-weighted rate)', res.sample.rates.pooled60), '',
    '## Controls', '',
    '| reviewer | planted spans caught | inserted | deleted | substituted | trusted (≤2 missed) | repeats: same verdict |', '|---|---|---|---|---|---|---|',
    ...['R1', 'R2'].map(k => `| ${k} | ${res.controls[k].caught}/${res.controls[k].spans} | ${res.controls[k].by_kind.inserted} | ${res.controls[k].by_kind.deleted} | ${res.controls[k].by_kind.substituted} | ${res.controls[k].trusted ? 'yes' : '**no**'} | ${res.stability[k].same_verdict}/${res.stability[k].pairs} |`), '',
    `R1–R2 agreement on the 60 pages: ${res.sample.agreement.same_verdict}/${res.sample.agreement.both_answered} same verdict, ${res.sample.agreement.within_one} within one step; R1 harsher on ${res.sample.agreement.r1_harsher}, R2 harsher on ${res.sample.agreement.r2_harsher}; third reads ${res.sample.agreement.r3_done}/${res.sample.agreement.r3_needed}.`, '',
    '## Kanripo CER by final verdict', '',
    '| verdict | n | median CER | max CER |', '|---|---:|---:|---:|',
    ...VERDICTS.map(v => `| ${v} | ${res.kanripo.by_final[v].n} | ${res.kanripo.by_final[v].median_cer ?? '—'} | ${res.kanripo.by_final[v].max_cer ?? '—'} |`), '',
    `Pages with Kanripo CER > 0.5 (the #5547 "catastrophic" line): ${res.kanripo.catastrophic_gt_0_5}/${res.kanripo.scored}. AUC of Kanripo CER for material-or-worse vs clean-or-minor: ${res.kanripo.auc_material_vs_not} (${res.kanripo.n_material_plus} material-or-worse pages).`, '',
    '## Pages', '', '| q | stratum | title | p | R1 | R2 | R3 | final | Kanripo CER | invented ≥4 chars (R1 / R2 / R3) |', '|---|---|---|---:|---|---|---|---|---:|---|',
    ...pages.map(p => `| ${p.qid} | ${p.stratum} | ${p.title.slice(0, 28)} | ${p.page_number} | ${p.r1} | ${p.r2} | ${p.r3 ?? ''} | **${p.final}** | ${p.kanripo.cer ?? p.kanripo.status} | ${[p.invented4_r1, p.invented4_r2, p.invented4_r3].map(x => x.join('、') || '·').join(' / ')} |`),
  ];
  fs.writeFileSync(H('results.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 22).join('\n'));
}

// PRIOR ART: scripts/eval/pro-translate-6545/score.py (unblinds a key, per-arm fidelity/spans, rank shares) — same
// job; this one applies the #6101 preregistered bar (paired non-inferiority on accuracy spans, pairwise ≥ 45 %,
// mechanical failures ≤ 5 %) and reads the GEX45 throughput log.
//
//   node scripts/eval/qwen-translate-6101/score.mjs --dir=$JOB_SCRATCH --round=1 [--out=report-r1.json]
import fs from 'fs';
import path from 'path';
import { bootstrapCI, mean, resetSeed } from '../lib/paired-stats.mjs';
import { krippendorffAlpha } from '../lib/agreement-stats.mjs';
import { validateTranslationTags, assessTranslationHealth } from '../../lib/translate-core.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { ARMS, loadArm, clean } from './packets.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const DIR = arg('dir'); const RARG = arg('round', '1'); const ROUND = RARG === 'pilot' ? 1 : Number(RARG); const BEST = arg('best');
const set = new Map(JSON.parse(fs.readFileSync(path.join(DIR, 'set', 'set.json'), 'utf8')).items.map(s => [s.id, s]));
const key = JSON.parse(fs.readFileSync(path.join(DIR, 'judge', `key-r${RARG}.json`), 'utf8'));
const jd = path.join(DIR, 'judge', `r${RARG}`);
const verdicts = new Map();   // `J|id` -> parsed line
for (const f of fs.readdirSync(jd).filter(f => /^out-J\d-\d+\.jsonl$/.test(f))) {
  const pass = f.slice(4, 6);
  for (const l of fs.readFileSync(path.join(jd, f), 'utf8').split('\n').filter(Boolean)) { const v = JSON.parse(l); verdicts.set(`${pass}|${v.id}`, v); }
}
const names = [...new Set(Object.values(key).flatMap(k => Object.values(k)))];
const QS = names.filter(n => n !== 'A');
const MEANING = new Set(['T1', 'T2', 'T5', 'T7', 'T8', 'T9', 'T10', 'T17', 'mistranslation', 'number', 'name']);

// per pass, per page, per candidate name → measures
function measures(pass, id) {
  const v = verdicts.get(`${pass}|${id}`), k = key[`${pass}|${id}`]; if (!v || !k) return null;
  const rankOf = {}; (v.ranking || []).forEach((tie, i) => tie.forEach(l => { rankOf[k[l]] = i; }));
  const m = {};
  for (const [lab, name] of Object.entries(k)) {
    const s = v.scores?.[lab] || {};
    const acc = (s.spans || []).filter(x => x.type === 'accuracy');
    m[name] = { acc: acc.length, major: acc.filter(x => x.severity === 'major').length, fid: s.fidelity ?? null,
      meaning_defects: (s.defects || []).filter(d => MEANING.has(d.class)).length,
      classes: (s.defects || []).map(d => d.class),
      fill: (s.invention || []).filter(x => x.kind === 'unreadable_fill').length,
      added: (s.invention || []).filter(x => x.kind === 'added_fact').length,
      reversal: s.reversal ? 1 : 0, omission: s.omission ? 1 : 0, rank: rankOf[name] ?? null };
  }
  return m;
}
const ids = [...new Set(Object.keys(key).map(k => k.split('|')[1]))].sort();
const per = ids.map(id => ({ id, stratum: set.get(id).stratum, J1: measures('J1', id), J2: measures('J2', id) })).filter(p => p.J1 && p.J2);
const avg = (p, name, f) => (p.J1[name][f] + p.J2[name][f]) / 2;
const pw = (m, q, base) => m[q].rank == null || m[base].rank == null ? 0.5 : m[q].rank < m[base].rank ? 1 : m[q].rank === m[base].rank ? 0.5 : 0;
const ci = xs => { resetSeed?.(6101); const c = bootstrapCI(xs); return c && c.map(x => +x.toFixed(3)); };
const r3 = x => x == null ? null : +x.toFixed(3);

// mechanical failures (no judge), on the raw outputs
const raw = {};
if (ROUND === 1) for (const [n, tag] of Object.entries(ARMS)) if (names.includes(n)) raw[n] = loadArm(path.join(DIR), tag);
const cjkShare = t => { const s = String(t).replace(/<(term|gloss|note|meta|warning)>[\s\S]*?<\/\1>/g, ''); const L = [...s].filter(c => /\p{L}/u.test(c)); return L.length ? L.filter(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c)).length / L.length : 0; };
function mech(name, id) {
  const s = set.get(id);
  const text = name === 'A' ? s.A.text : clean(raw[name]?.get(id)?.text);
  const r = name === 'A' ? null : raw[name]?.get(id);
  const f = [];
  if (r?.error) f.push('error');
  if (r?.finish === 'length') f.push('hit_cap');
  if (cjkShare(text) > 0.2) f.push('untranslated>20%');
  if (cliChatterReason(text)) f.push(`chatter:${cliChatterReason(text)}`);
  const h = assessTranslationHealth(s.source_text, text, { lang: s.language });
  return { prereg: f, tags_changed: validateTranslationTags(text).changes.length, health: h.healthy ? null : h.reason };
}

function summarise(pages, label) {
  const out = { label, n: pages.length, arms: {} };
  for (const n of names) {
    const acc = pages.map(p => avg(p, n, 'acc'));
    const fidPages = pages.map(p => [p.J1[n].fid, p.J2[n].fid].filter(x => x != null)).filter(x => x.length);
    out.arms[n] = { acc_mean: r3(mean(acc)), major_mean: r3(mean(pages.map(p => avg(p, n, 'major')))),
      fid_mean: r3(mean(fidPages.map(x => mean(x)))), meaning_defects_mean: r3(mean(pages.map(p => avg(p, n, 'meaning_defects')))),
      fill_pages: pages.filter(p => p.J1[n].fill + p.J2[n].fill > 0).length, added_fact_mean: r3(mean(pages.map(p => avg(p, n, 'added')))),
      reversal_pages: pages.filter(p => p.J1[n].reversal + p.J2[n].reversal > 0).length,
      omission_pages: pages.filter(p => p.J1[n].omission && p.J2[n].omission).length,
      top_rank_share: r3(mean(pages.map(p => ((p.J1[n].rank === 0) + (p.J2[n].rank === 0)) / 2))) };
    if (n === 'A') continue;
    const d = pages.map(p => avg(p, n, 'acc') - avg(p, 'A', 'acc'));
    const share = pages.map(p => (pw(p.J1, n, 'A') + pw(p.J2, n, 'A')) / 2);
    const margin = Math.max(0.25, 0.2 * mean(pages.map(p => avg(p, 'A', 'acc'))));
    const dci = ci(d);
    Object.assign(out.arms[n], { acc_diff_vs_A: r3(mean(d)), acc_diff_ci: dci, margin: r3(margin), bar1: !!dci && dci[1] <= margin,
      pairwise_vs_A: r3(mean(share)), pairwise_ci: ci(share), bar2: mean(share) >= 0.45,
      pairwise_wlt: ['J1', 'J2'].map(J => { const o = pages.map(p => pw(p[J], n, 'A')); return `${o.filter(x => x === 1).length}-${o.filter(x => x === 0.5).length}-${o.filter(x => x === 0).length}`; }) });
    if (ROUND === 1) {
      const mf = pages.map(p => mech(n, p.id));
      const failed = mf.filter(x => x.prereg.length).length;
      Object.assign(out.arms[n], { mech_fail: failed, mech_fail_rate: r3(failed / pages.length), bar3: failed / pages.length <= 0.05,
        mech_kinds: mf.flatMap(x => x.prereg).reduce((o, k) => (o[k] = (o[k] || 0) + 1, o), {}),
        production_guard_refusals: mf.filter(x => x.health).map(x => x.health).reduce((o, k) => (o[k] = (o[k] || 0) + 1, o), {}),
        tags_repaired_pages: mf.filter(x => x.tags_changed).length });
      out.arms[n].pass = out.arms[n].bar1 && out.arms[n].bar2 && out.arms[n].bar3;
    }
  }
  if (ROUND === 1) { const mfA = pages.map(p => mech('A', p.id)); out.arms.A.mech_fail = mfA.filter(x => x.prereg.length).length; out.arms.A.production_guard_refusals = mfA.filter(x => x.health).map(x => x.health); }
  return out;
}

// test-retest: the A-vs-Q outcome per page in J1 vs J2; α (interval) on fidelity over all candidates
const retest = {};
for (const q of QS) { const same = per.filter(p => pw(p.J1, q, 'A') === pw(p.J2, q, 'A')).length; retest[q] = `${same}/${per.length}`; }
const alphaFid = krippendorffAlpha(per.flatMap(p => names.map(n => [p.J1[n].fid, p.J2[n].fid])), 'interval');
const alphaAcc = krippendorffAlpha(per.flatMap(p => names.map(n => [p.J1[n].acc, p.J2[n].acc])), 'interval');

const report = { round: ROUND, best: BEST || null, judged_pages: per.length, missing_pages: ids.length - per.length,
  retest_A_vs_Q_same_outcome: retest, alpha_fidelity: r3(alphaFid), alpha_acc_spans: r3(alphaAcc),
  pooled: summarise(per, 'pooled'), zh: summarise(per.filter(p => p.stratum === 'zh'), 'zh'), ja: summarise(per.filter(p => p.stratum === 'ja'), 'ja') };
if (ROUND === 2) {   // Qbest_p1 vs Qbest (same model, the lane's source vs the clean one)
  const pg = per; report.p1_vs_clean = { acc_diff: r3(mean(pg.map(p => avg(p, 'Qbest_p1', 'acc') - avg(p, 'Qbest', 'acc')))),
    acc_diff_ci: ci(pg.map(p => avg(p, 'Qbest_p1', 'acc') - avg(p, 'Qbest', 'acc'))),
    pairwise_p1_over_clean: r3(mean(pg.map(p => (pw(p.J1, 'Qbest_p1', 'Qbest') + pw(p.J2, 'Qbest_p1', 'Qbest')) / 2))) };
}
// classes tally
report.classes = Object.fromEntries(names.map(n => [n, per.flatMap(p => [...p.J1[n].classes, ...p.J2[n].classes]).reduce((o, k) => (o[k] = (o[k] || 0) + 1, o), {})]));
const outF = arg('out', path.join(DIR, `report-r${RARG}.json`));
fs.writeFileSync(outF, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));

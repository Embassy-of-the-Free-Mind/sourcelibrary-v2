#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-gemini-reocr-7263/analyze.mjs (its per-stratum score, the evidence export shape, v4Verdict, per1k and
// judgeItems imported; it reads strata print and siku, has no pooled row, no second sitting and no arm that may serve nothing).
/**
 * #7263 job zh-print-arms-7263: score the arms on the pilot's 60 pages, overall and per set (results/prereg.md fixes the design).
 *   node scripts/eval/zh-print-arms-7263/analyze.mjs --scratch=DIR --results=DIR --evidence=DIR
 * A comparator row: O judged in the arm's own sitting (#retest, or #sitting2 for PFM). Sensitivity: the pilot's verdicts of O.
 * F with no text = refused: not accepted, not wrong text, nothing served.
 */
import fs from 'node:fs';
import path from 'node:path';
import { judgeItems, judgeArmIds, v4Verdict, per1k, DEFAULT_SEED } from '../router-confirm/confirm.mjs';
import { wrongText } from '../correction-pass-7818/lib.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const SCR = path.resolve(arg('scratch')), RES = path.resolve(arg('results')), EVID = path.resolve(arg('evidence'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const SEVERE = new Set(['misleads', 'wrong_text']);
const RULE = { within: 0.08, wrong_text_max: 0.04 };
const SETS = ['one', 'ten'];
const SITTING = { PFM: 'sitting2' };   // every other arm sits in the first sitting; prereg.md
const NEW_ARMS = ['PFL', 'PFM', 'F'];
const round = (x, n = 3) => +x.toFixed(n);

const pages = [], controls = { retest: [], sitting2: [] };
for (const set of SETS) {
  const OUT = path.join(SCR, set), P = rj(path.join(OUT, 'plan.json'));
  const T = (k, a) => { const f = path.join(OUT, 'texts', `${k}.${a}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const { items, controls: ctl } = judgeItems(P.selected, T, DEFAULT_SEED, judgeArmIds(P));
  const rows = jsonl(path.join(OUT, 'verdicts.jsonl')).filter((r) => r.verdict), last = new Map(rows.map((r) => [r.id, r]));
  const shape = (r) => { const d = r.verdict.defects || [];
    return { accept: !!r.verdict.accept, wrong: wrongText(r.verdict), fidelity: r.verdict.fidelity, severe: d.filter((x) => SEVERE.has(x.severity)).length, wrong_defects: d.filter((x) => x.severity === 'wrong_text').length, defects: d, reader_note: r.verdict.reader_note ?? null, id: r.id }; };
  const armRows = new Map(jsonl(path.join(OUT, 'arms.jsonl')).map((r) => [`${r.key}:${r.arm}`, r]));
  for (const c of ctl) for (const [tag, id] of [['retest', c.id], ['retest', `${c.id}#retest`], ['sitting2', `${c.id}#sitting2`]]) { const r = last.get(id); if (r) controls[tag].push({ set, id, accept: !!r.verdict.accept, fidelity: r.verdict.fidelity }); }
  for (const s of P.selected) {
    const texts = {}, v = {};
    for (const a of ['served', 'O', 'F', 'PFL', 'PFM']) texts[a] = T(s.key, a);
    const of = (arm, tag) => { if (texts[arm] == null) return null;
      const it = items.find((x) => x.key === s.key && x.arms.includes(arm)); if (!it) return null;
      const plain = last.get(it.id), r = tag ? last.get(`${it.id}#${tag}`) : plain?.pilot ? last.get(`${it.id}#retest`) : plain;   // a text equal to O's has only the pilot's row under its plain id
      return r ? shape(r) : null; };
    v.S = of('served');
    v.O_pilot = (() => { const it = items.find((x) => x.key === s.key && x.arms.includes('O')), r = it && last.get(it.id); return r ? shape(r) : null; })();
    v.O = of('O', 'retest'); v.O2 = of('O', 'sitting2');
    v.PFL = of('PFL'); v.PFM = of('PFM');
    v.F = of('F') ?? (texts.F == null && armRows.has(`${s.key}:F`) ? { accept: false, wrong: false, fidelity: null, severe: 0, wrong_defects: 0, defects: [], refused: true } : null);
    pages.push({ ...s, set, texts, v, why: Object.fromEntries(NEW_ARMS.map((a) => [a, armRows.get(`${s.key}:${a}`)?.why ?? null])) });
  }
}

const summary = (arm, sel) => { const r = sel.filter((p) => p.v[arm]);
  const k = r.filter((p) => p.v[arm].accept).length, judged = r.filter((p) => !p.v[arm].refused);
  const fid = judged.filter((p) => p.v[arm].fidelity != null);
  return { accepted: `${k}/${r.length}`, k, n: r.length, wrong_text_pages: r.filter((p) => p.v[arm].wrong).length, refused: r.length - judged.length,
    fidelity_mean: fid.length ? round(fid.reduce((t, p) => t + p.v[arm].fidelity, 0) / fid.length, 2) : null,
    per_1k_chars: judged.length ? per1k(judged.map((p) => ({ words: p.han, severe: p.v[arm].severe, wrong: p.v[arm].wrong_defects }))) : null }; };
const pair = (a, b, sel) => { const v = v4Verdict(sel.map((p) => (p.v[a] && p.v[b] ? { win: p.v[a], cur: p.v[b] } : null)), [], RULE);
  if (!v.n) return null;
  const R = sel.filter((p) => p.v[a] && p.v[b]);
  const wrA = v.winner.wrong_text / v.n, wrB = v.current.wrong_text / v.n, wrongOk = wrA <= wrB + RULE.wrong_text_max + 1e-12;
  return { n: v.n, d: round(v.d), d_ci95: v.ci95?.map((x) => round(x)) ?? null, gained: v.gained, lost: v.lost, sign_test_p: round(v.sign_test_p, 4), wrong: `${v.winner.wrong_text} vs ${v.current.wrong_text}`,
    made_wrong: R.filter((p) => p.v[a].wrong && !p.v[b].wrong).length, cleared_wrong: R.filter((p) => !p.v[a].wrong && p.v[b].wrong).length,
    severe_delta_per_1k: round(1000 * (R.reduce((t, p) => t + p.v[a].severe - p.v[b].severe, 0) / R.reduce((t, p) => t + p.han, 0)), 2),
    rule_pass: v.d >= -RULE.within - 1e-12 && wrongOk, strict_pass: !!v.ci95 && v.ci95[0] >= -RULE.within - 1e-12 && wrongOk }; };

const block = (sel) => { const arms = Object.fromEntries(['S', 'O', 'O_pilot', 'O2', 'PFL', 'PFM', 'F'].map((a) => [a, summary(a, sel)]).filter(([, s]) => s.n));
  const vs = {}; for (const a of NEW_ARMS) { const cmp = SITTING[a] ? 'O2' : 'O'; vs[`${a}_vs_O_own_sitting`] = pair(a, cmp, sel); vs[`${a}_vs_O_pilot`] = pair(a, 'O_pilot', sel); }
  vs.O_vs_S = pair('O', 'S', sel);
  return { n: sel.length, arms, vs, retest_O: (() => { const r = sel.filter((p) => p.v.O && p.v.O_pilot); return { n: r.length, accepted_pilot: r.filter((p) => p.v.O_pilot.accept).length, accepted_retest: r.filter((p) => p.v.O.accept).length, accept_agree: r.filter((p) => p.v.O.accept === p.v.O_pilot.accept).length, wrong_pilot: r.filter((p) => p.v.O_pilot.wrong).length, wrong_retest: r.filter((p) => p.v.O.wrong).length }; })() }; };

// The method of 2026-11-03-zh-reocr-cheap-arms-7263.md: subscription quota priced at the fee. Opus at $5.72 per 1K at 1 a call and $2.77 at 10
// (#8008); F by its list cost against the pilot's own 1-a-call list cost. Agy: $0.00055 x mean list cost / the #7611 Flash-low $0.0084; Paddle adds ~$0.09 per 1K.
const flashList = (u) => ((u.input - (u.cache_read || 0)) * 0.75 + (u.cache_read || 0) * 0.075 + (u.output + (u.thinking || 0)) * 3.75) / 1e6;
const calls = (set, arm) => jsonl(path.join(SCR, set, `set-${arm}`, 'calls.jsonl'));
const pilot = rj(path.join(path.dirname(new URL(import.meta.url).pathname), 'input/pilot-score.json'));
const pilotOne = pilot.sets.one.list_usd / pilot.sets.one.pages;
const price = (() => { const out = { method: 'the 2026-11-03 cheap-arms record: subscription priced at the fee', pilot_list_usd_per_page: { one: round(pilotOne, 4), ten: round(pilot.sets.ten.list_usd / pilot.sets.ten.pages, 4) }, per_1k_pages: { 'O@1': 5.72, 'O@10': 2.77 } };
  const F = SETS.flatMap((s) => calls(s, 'F')), fPages = pages.filter((p) => p.why.F).length || pages.length;
  if (F.length) { const list = F.reduce((t, c) => t + (c.usage?.list_cost_usd || 0), 0); out.F_list_usd = round(list, 2); out.F_calls = F.length; out.F_list_usd_per_page = round(list / fPages, 4); out.per_1k_pages.F = round(5.72 * (list / fPages) / pilotOne, 2); }
  for (const a of ['PFL', 'PFM']) { const c = SETS.flatMap((s) => calls(s, a)).filter((x) => x.usage); if (!c.length) continue; const m = c.reduce((t, x) => t + flashList(x.usage), 0) / c.length; const pg = pages.filter((p) => p.why[a]).length || pages.length;
    out[`${a}_mean_list_usd_a_call`] = round(m, 4); out[`${a}_calls`] = c.length; out.per_1k_pages[a] = round(1000 * 0.00055 * (m / 0.0084) * (c.length / pg) + 0.09, 2); }
  return out; })();
// $ per 1,000 accepted pages, as the cheap-arms table (2.77 at 26/30 = 3.20)
const perAccepted = (arm, sel, $1k) => { const s = summary(arm, sel); return s.k && $1k != null ? round(($1k * s.n) / s.k, 2) : null; };

const score = { at: new Date().toISOString(), issue: 7263, comparator: 'O judged in the arm\'s own sitting; sensitivity the pilot\'s verdicts', rule: RULE, controls, void: controls.retest.some((c) => c.accept) || controls.sitting2.some((c) => c.accept), price, overall: block(pages), sets: Object.fromEntries(SETS.map((s) => [s, block(pages.filter((p) => p.set === s))])) };
const P1k = price.per_1k_pages;
score.price.usd_per_accepted_page = Object.fromEntries(['F', 'PFL', 'PFM'].filter((a) => score.overall.arms[a] && P1k[a] != null).map((a) => [a, perAccepted(a, pages, P1k[a])]));
score.price.usd_per_accepted_page['O (set one, 1 a call)'] = perAccepted('O', pages.filter((p) => p.set === 'one'), 5.72);
score.price.usd_per_accepted_page['O (set ten, 10 a call)'] = perAccepted('O', pages.filter((p) => p.set === 'ten'), 2.77);

score.cells = Object.fromEntries(['all', ...SETS].map((c) => { const sel = c === 'all' ? pages : pages.filter((p) => p.set === c);
  return [c, Object.fromEntries(['S', 'O', 'PFL', 'PFM', 'F'].flatMap((a) => { const r = sel.filter((p) => p.v[a] && !p.v[a].refused); if (!r.length) return []; const W = r.reduce((t, p) => t + p.han, 0), per = (f) => round((1000 * r.reduce((t, p) => t + f(p.v[a]), 0)) / W, 2);
    return [[`zh-print-arms ${a}`, { route: a, pages: r.length, words: W, fidelity_mean: round(r.reduce((t, p) => t + p.v[a].fidelity, 0) / r.length, 2), misleads_per_1k: per((v) => v.severe - v.wrong_defects), wrong_text_per_1k: per((v) => v.wrong_defects), severe_per_1k: per((v) => v.severe), unit: 'defects in the judge verdict per 1,000 Han and kana characters of the stored page' }]]; }))]; }));

fs.mkdirSync(RES, { recursive: true });
fs.writeFileSync(path.join(RES, 'score.json'), JSON.stringify(score, null, 1) + '\n');

// Router evidence: every arm in k/n, the shape of router-table/evidence/zh-reocr-cheap-arms-7263.score.json.
const ROUTE = { S: 'gemini-stored', O: 'gemini>opus', PFL: 'paddle>agy-flash-low', PFM: 'paddle>agy-flash-medium', F: 'opus-read' };
const routeBlock = (a, sel) => { const r = sel.filter((p) => p.v[a]), cl = {}; for (const p of r) for (const c of new Set(p.v[a].defects.filter((d) => SEVERE.has(d.severity)).map((d) => d.class))) cl[c] = (cl[c] ?? 0) + 1;
  return { n: r.length, books: new Set(r.map((p) => p.book_id)).size, accept: `${r.filter((p) => p.v[a].accept).length}/${r.length}`, wrong_text_pages: `${r.filter((p) => p.v[a].wrong).length}/${r.length}`, classes_k_of_n: Object.fromEntries(Object.entries(cl).map(([c, n]) => [c, `${n}/${r.length}`])), served: ROUTE[a] }; };
const evCell = (sel) => ({ task: 'ocr', lang: 'Chinese', pages: sel.length, frame: 'the pilot\'s judged pages of Gemini-read printed Chinese', controls: { wrong_page: [...controls.retest, ...controls.sitting2].filter((c) => sel.some((p) => p.set === c.set)).map((c) => ({ accept: c.accept, fidelity: c.fidelity, passed: !c.accept })) }, routes: Object.fromEntries(Object.keys(ROUTE).filter((a) => sel.some((p) => p.v[a])).map((a) => [ROUTE[a], routeBlock(a, sel)])) });
const head = { generated_by: 'scripts/eval/zh-print-arms-7263/analyze.mjs', provenance: '#7263 zh-print-arms: the Opus correction pilot\'s 60 judged pages; arms on the same pages; Opus judge blind to arm against the image; O and controls judged again in each sitting', judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image', mapping: 'wrong_text = a wrong_text defect; accept = the judge accepts' };
const name = 'zh-print-arms-7263.score.json';
fs.writeFileSync(path.join(EVID, name), JSON.stringify({ ...head, cells: { 'chinese-gemini-print-arms-7263': evCell(pages) } }, null, 1) + '\n');
fs.writeFileSync(path.join(EVID, 'by-script', name), JSON.stringify({ ...head, cells: { 'chinese-gemini-print-arms-7263/print': evCell(pages) } }, null, 1) + '\n');

// side-by-side.md: each page, scan link, each arm's differences from O, the verdicts.
const lineDiff = (a, b) => { if (a == null || b == null) return []; const A = a.split('\n').map((x) => x.trim()).filter(Boolean), B = new Set(b.split('\n').map((x) => x.trim()).filter(Boolean)); return A.filter((l) => !B.has(l)); };
const vStr = (v) => (!v ? '—' : v.refused ? 'refused' : `${v.accept ? 'accept' : 'reject'} f${v.fidelity}${v.wrong ? ' WRONG-TEXT' : ''} sev ${v.severe}`);
const defects = (v) => (v?.defects || []).filter((d) => SEVERE.has(d.severity)).map((d) => `${d.severity} ${d.class}: ${String(d.what || d.note || d.description || '').replace(/\s+/g, ' ').slice(0, 160)}`);
const md = ['# zh-print-arms side by side (#7263)', '', 'Generated by analyze.mjs. Text lines that differ from the O text, capped at 6 lines an arm. O = the pilot\'s text; verdicts from the arm\'s own sitting.', ''];
for (const p of pages) {
  md.push(`## ${p.set} ${p.title ?? ''} · p.${p.page_number}`, '', `[scan](${p.image}) · [reader](https://sourcelibrary.org/book/${p.book_id}/page/${p.page_number}) · page ${p.page_id} · chars ${p.han}`, '', '| arm | verdict |', '|---|---|');
  for (const [a, l] of [['S', 'S stored'], ['O_pilot', 'O pilot verdict'], ['O', 'O first sitting'], ['O2', 'O second sitting'], ['F', 'F'], ['PFL', 'PFL'], ['PFM', 'PFM']]) if (p.v[a]) md.push(`| ${l} | ${vStr(p.v[a])} |`);
  md.push('');
  for (const a of ['served', 'F', 'PFL', 'PFM']) { const label = a === 'served' ? 'S' : a, t = p.texts[a]; if (t == null) continue; const d = lineDiff(t, p.texts.O);
    md.push(`**${label}** (${t.length} chars${a !== 'served' && p.why[a] ? `, ${p.why[a]}` : ''}): ${d.length ? `${d.length} lines differ from O` : 'same lines as O'}`);
    if (d.length) { md.push('```'); md.push(...d.slice(0, 6).map((l) => l.slice(0, 160))); md.push('```'); }
    const ds = defects(p.v[a === 'served' ? 'S' : a]); if (ds.length) md.push(...ds.slice(0, 5).map((x) => `- ${x}`));
    md.push(''); }
  const dO = defects(p.v.O); if (dO.length) md.push('**O defects (same sitting):**', ...dO.slice(0, 5).map((x) => `- ${x}`), '');
}
fs.writeFileSync(path.join(RES, 'side-by-side.md'), md.join('\n') + '\n');

// The verdict rows of the store's shape, for writeback.mjs. Controls and the pilot's seed rows are not rewritten as new judgements.
fs.writeFileSync(path.join(SCR, 'pages-v.json'), JSON.stringify(pages.map(({ texts, ...p }) => p)));

const show = (b, label) => { console.log(`\n== ${label} n=${b.n}`);
  for (const [a, s] of Object.entries(b.arms)) console.log(a.padEnd(8), s.accepted.padEnd(6), 'wrong', String(s.wrong_text_pages).padEnd(3), 'sev/1k', s.per_1k_chars?.severe_per_1k, JSON.stringify(s.per_1k_chars?.severe_per_1k_ci95), 'fid', s.fidelity_mean, s.refused ? `refused ${s.refused}` : '');
  for (const [k, v] of Object.entries(b.vs)) if (v) console.log(k.padEnd(24), 'd', v.d, JSON.stringify(v.d_ci95), `+${v.gained}/-${v.lost}`, 'wrong', v.wrong, `made ${v.made_wrong} cleared ${v.cleared_wrong}`, 'sevΔ', v.severe_delta_per_1k, 'rule', v.rule_pass, 'strict', v.strict_pass);
  console.log('retest O', JSON.stringify(b.retest_O)); };
show(score.overall, 'overall'); for (const s of SETS) show(score.sets[s], s);
console.log('\ncontrols', JSON.stringify(controls), 'void', score.void); console.log('price', JSON.stringify(score.price));

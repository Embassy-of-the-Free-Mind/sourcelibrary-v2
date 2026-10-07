#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs writes results.json per packet (arms, strata by style/canonical/lang, pairs) and gallery.mjs the 15-page gallery. Neither joins two packets, strata by PERIOD, per-arm cost, the image-check causes or the dimensions pass, nor emits one JSONL row per page × arm with licences for the quality dataset (#5531). This only joins and tabulates; every score comes from score.mjs output.
/** Join the #5695 T1 passes into rows.jsonl (one row per page × arm, with reference + licence metadata) and summary.json (period strata, cost per page, reversals/100 pp, image-check causes). */
//   node scripts/eval/xlref-t1/report.mjs <results-dir> <imgcheck-out-dir>
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCI, mean, resetSeed } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
const [DIR, IMG] = process.argv.slice(2);
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const p1 = J('results-pass1.json'); const p2 = fs.existsSync(path.join(DIR, 'results-pass2.json')) ? J('results-pass2.json') : null;
const dims = fs.existsSync(path.join(DIR, 'dimensions.json')) ? J('dimensions.json') : null;
const recs = Object.fromEntries(fs.readFileSync(path.join(DIR, 'records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map((r) => [`${r.book_id}_${r.page_number}`, r]));
const key = (p) => `${p.book_id}_${p.page_number}`;
const armFile = (arm, id) => { const f = path.join(DIR, 'arms', arm, `${id}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const img = {}; if (IMG && fs.existsSync(IMG)) for (const f of fs.readdirSync(IMG)) { const j = JSON.parse(fs.readFileSync(path.join(IMG, f), 'utf8')); const [b, n] = [j.id.slice(0, j.id.lastIndexOf('_')), Number(j.id.slice(j.id.lastIndexOf('_') + 1))]; img[`${b}_${n}`] = j; }
const dimRow = dims ? Object.fromEntries(dims.rows.map((r) => [r.id.replace(/_0*(\d+)$/, '_$1'), r])) : {};

const rows = [];
const add = (pass, res) => { for (const p of res.per_page) { const id = key(p); const r = recs[id]; for (const [arm, v] of Object.entries(p.arms)) {
  if (pass !== 'pass1' && (arm === 'prod-A' || arm === 'flash-0')) continue; // anchors: their pass-1 rows are the record
  const af = armFile(arm, id); const js = Object.values(v.by_judge || {}).filter(Boolean);
  if (!js.length || v.fidelity == null) continue; // the arm was not run on this page
  rows.push({ track: 'T1', lang: 'Latin', book_id: p.book_id, page_number: p.page_number, url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`, title: r.title, author: r.author, year: r.year, period: r.period, genre: r.genre, work: r.work,
    arm, pass, model: arm === 'served' ? r.candidates.find((c) => c.arm === 'served')?.model : arm === 'opus' ? 'claude-opus (subscription, X3 ceiling)' : af?.model || null, served_prompt_version: arm === 'served' ? r.candidates.find((c) => c.arm === 'served')?.prompt_version : undefined,
    fidelity: v.fidelity, fidelity_by_judge: Object.fromEntries(Object.entries(v.by_judge).map(([j, x]) => [j, x?.fidelity ?? null])), omission: js.some((x) => x.omission), reversal: js.some((x) => x.reversal), reversal_quotes: js.filter((x) => x.reversal).map((x) => x.reversal),
    invention_kinds: [...new Set(js.flatMap((x) => (x.invention || []).map((i) => i.kind)))], defect_classes: [...new Set(js.flatMap((x) => (x.defects || []).map((d) => `${d.class}:${d.severity}`)))],
    reference_fit: p.reference_fit, cost_usd_realtime: af?.cost_usd ?? null, thinking_tokens: af?.thinkingTokens ?? null,
    reference: { title: r.reference_meta.title, translator: r.reference_meta.translator, year: r.reference_meta.year, style: r.reference_meta.style, canonical: !!r.reference_meta.canonical, kind: r.reference_meta.reference_kind, located: r.reference_meta.located, url: r.reference_meta.url, licence: r.reference_meta.licence, publishable: r.licences.reference_publishable },
    licences: r.licences, leaf_check: r.leaf_check, alignment_confidence: r.alignment_confidence,
    image_check: arm === 'served' && img[id] ? { page_cause: img[id].page_cause, share_from_ocr: img[id].share_of_served_error_from_ocr, ocr_word_errors: img[id].ocr_word_errors, ocr_words: img[id].ocr_words_approx, note: img[id].note } : undefined,
    dimensions: arm === 'served' && dimRow[id] ? { served: dimRow[id].served, reference: dimRow[id].reference, legit_choice: dimRow[id].legit_choice, legit_note: dimRow[id].legit_note } : undefined });
} } };
add('pass1', p1); if (p2) add('pass2', p2);
const p3 = fs.existsSync(path.join(DIR, 'results-pass3.json')) ? J('results-pass3.json') : null; if (p3) add('pass3', p3);
fs.writeFileSync(path.join(DIR, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

resetSeed(5695);
const stat = (xs) => { const ci = bootstrapCI(xs); return { n: xs.length, mean: +mean(xs).toFixed(2), ci: ci ? ci.map((x) => +x.toFixed(2)) : null }; };
const rate = (k, n) => { const w = wilson(k, n); return { k, n, per100: +(100 * k / n).toFixed(1), ci95: [w.lo ?? w[0], w.hi ?? w[1]].map((x) => +(100 * x).toFixed(1)) }; };
const P1 = rows.filter((r) => r.pass === 'pass1');
const arms = [...new Set(P1.map((r) => r.arm))];
const strata = {};
for (const [name, f] of Object.entries({ period: (r) => r.period, style: (r) => r.reference.style, canonical: (r) => (r.reference.canonical ? 'canonical' : 'non-canonical'), genre: (r) => r.genre, served_model: (r) => null })) {
  if (name === 'served_model') continue;
  strata[name] = {}; for (const v of [...new Set(P1.map(f))]) { strata[name][v] = {}; for (const a of arms) { const sel = P1.filter((r) => r.arm === a && f(r) === v); strata[name][v][a] = { ...stat(sel.map((r) => r.fidelity)), reportable: sel.length >= 10 }; } }
}
const servedByModel = {}; for (const r of P1.filter((x) => x.arm === 'served')) { const m = /lite/.test(r.model || '') ? 'lite' : 'flash'; (servedByModel[m] ||= []).push(r.fidelity); }
const perArm = {}; for (const a of arms) { const sel = P1.filter((r) => r.arm === a); const cost = sel.map((r) => r.cost_usd_realtime).filter((x) => x != null);
  perArm[a] = { fidelity: stat(sel.map((r) => r.fidelity)), share_fidelity_le3: rate(sel.filter((r) => r.fidelity <= 3).length, sel.length), reversal: rate(sel.filter((r) => r.reversal).length, sel.length), omission: rate(sel.filter((r) => r.omission).length, sel.length), boundary: rate(sel.filter((r) => r.invention_kinds.includes('boundary')).length, sel.length), unreadable_fill: rate(sel.filter((r) => r.invention_kinds.includes('unreadable_fill')).length, sel.length),
    cost_per_page_realtime: cost.length ? +mean(cost).toFixed(5) : null, cost_per_page_batch: cost.length ? +(mean(cost) / 2).toFixed(5) : null, thinking_tokens_per_page: sel[0]?.thinking_tokens != null ? Math.round(mean(sel.map((r) => r.thinking_tokens || 0))) : null }; }
const ic = Object.values(img); const ids = fs.existsSync('/data/scratch/sl/xlref-t1/imgcheck-ids.json') ? JSON.parse(fs.readFileSync('/data/scratch/sl/xlref-t1/imgcheck-ids.json')) : null;
const causes = (sel) => { const c = {}; for (const j of sel) c[j.page_cause] = (c[j.page_cause] || 0) + 1; return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, rate(v, sel.length)])); };
const summary = { generated: new Date().toISOString(), n_pages: new Set(P1.map((r) => `${r.book_id}_${r.page_number}`)).size, judges: p1.judges, agreement: p1.agreement, gate: { pass1: p1.gate?.gate_pass ?? p1.gate, pass2: p2?.gate?.gate_pass ?? p2?.gate ?? null }, reference_fit: p1.reference_fit,
  per_arm: perArm, strata, served_by_model: Object.fromEntries(Object.entries(servedByModel).map(([k, v]) => [k, stat(v)])),
  pairs_pass1: p1.pairs, pairs_pass2: p2?.pairs || null, arms_pass2: p2 ? Object.fromEntries(Object.entries(p2.arms).map(([a, v]) => [a, { fidelity: v.fidelity, reversal: v.reversal, omission: v.omission }])) : null,
  pairs_pass3: p3?.pairs || null, arms_pass3: p3 ? Object.fromEntries(Object.entries(p3.arms).map(([a, v]) => [a, { fidelity: v.fidelity, reversal: v.reversal, omission: v.omission }])) : null,
  image_check: ids ? { low: causes(ic.filter((j) => ids.low.includes(j.id))), random: causes(ic.filter((j) => ids.random.includes(j.id))), ocr_share_low: ic.filter((j) => ids.low.includes(j.id)).reduce((a, j) => { a[j.share_of_served_error_from_ocr] = (a[j.share_of_served_error_from_ocr] || 0) + 1; return a; }, {}) } : null,
  dimensions: dims ? { profile: dims.profile, by_style: dims.by_style, stance: dims.stance, disagreements: dims.disagreements, legit_choice_pages: dims.legit_choice_pages.length } : null };
fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`${rows.length} rows; arms ${arms.join(',')}`);
for (const a of arms) console.log(a, JSON.stringify(perArm[a]));
console.log('period', JSON.stringify(Object.fromEntries(Object.entries(strata.period).map(([k, v]) => [k, v.served]))));
console.log('style', JSON.stringify(Object.fromEntries(Object.entries(strata.style).map(([k, v]) => [k, v.served]))));
console.log('canonical', JSON.stringify(Object.fromEntries(Object.entries(strata.canonical).map(([k, v]) => [k, v.served]))));
console.log('served_by_model', JSON.stringify(summary.served_by_model));
console.log('image', JSON.stringify(summary.image_check));

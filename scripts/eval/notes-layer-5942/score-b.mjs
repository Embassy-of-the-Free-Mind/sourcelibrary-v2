#!/usr/bin/env node
// PRIOR ART: scripts/eval/plain-6728/score.py (#6728) — per-arm fidelity with by-page bootstrap, error pages, plant
// controls; it reads #6545's packet layout and scores two arms against a reference. This scores Part B's three arms
// (the same quantities), plus the measures only a layered output has: S's JSON and anchors, T's malformed tags, the
// note verdicts, and tokens.
/**
 * #5942 Part B — $0. node scripts/eval/notes-layer-5942/score-b.mjs
 * Writes scripts/eval/results/notes-layer-5942/part-b.json (numbers only; no page text).
 */
import fs from 'node:fs';
import { unwrapRead } from '../../lib/agy-cli.mjs';
import { bootstrapCI, mean, resetSeed } from '../lib/paired-stats.mjs';
import { W, readJsonl, layersOf, COMMENTARY_TYPES } from './arms.mjs';

const R = new URL('../results/notes-layer-5942/', import.meta.url).pathname;
const pages = JSON.parse(fs.readFileSync(`${W}/pages.json`, 'utf8'));
const ARMS = ['T', 'S', 'P'];
const out = Object.fromEntries(ARMS.map((a) => [a, new Map(readJsonl(`${W}/out/${a}.jsonl`).filter((r) => r.text).map((r) => [r.uid, r]))]));
const key = fs.existsSync(`${W}/judge/key.json`) ? JSON.parse(fs.readFileSync(`${W}/judge/key.json`, 'utf8')) : {};
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const ci = (xs) => { resetSeed(5942); const c = bootstrapCI(xs, 2000); return c ? c.map(r2) : null; };
const res = { date: new Date().toISOString().slice(0, 10), pages: pages.length };

// (a) fidelity, per judge.
function judgeRows(file) {
  return readJsonl(file).filter((r) => r.text).map((r) => {
    let j = null;
    const t = unwrapRead(r.text).text.replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { j = JSON.parse(t); } catch { const a = t.indexOf('{'), b = t.lastIndexOf('}'); try { j = JSON.parse(t.slice(a, b + 1)); } catch { /* unparsed */ } }
    return { uid: r.uid, j, usage: r.usage };
  });
}
for (const [name, file] of [['opus', `${W}/judge/out-opus.jsonl`], ['gemini', `${W}/judge/out-gemini.jsonl`]]) {
  const rows = judgeRows(file);
  if (!rows.length) continue;
  const per = { T: {}, S: {}, P: {} };
  const errs = Object.fromEntries(ARMS.map((a) => [a, { omission: 0, reversal: 0, invention: 0, gloss: 0, major_spans: 0, pages: 0 }]));
  const plant = { n: 0, caught: 0, lower_than_T: 0 };
  let unparsed = 0;
  for (const { uid, j } of rows) {
    if (!j?.scores || !key[uid]) { unparsed++; continue; }
    const labels = key[uid].labels;
    for (const [lab, arm] of Object.entries(labels)) {
      const s = j.scores[lab];
      if (!s) continue;
      if (arm === 'PLANT') {
        plant.n++;
        const planted = key[uid].plant?.[0];
        const text = JSON.stringify([s.spans || [], s.defects || [], s.reversal || null, s.omission]);
        const tFid = j.scores[Object.keys(labels).find((l) => labels[l] === 'T')]?.fidelity;
        const words = String(planted?.new ?? planted?.dropped ?? '').toLowerCase().match(/[a-z]{4,}/g) || [];
        if (s.reversal || (s.spans || []).some((x) => x.type === 'accuracy' && words.some((w) => String(x.quote).toLowerCase().includes(w))) || (planted?.kind === 'clause' && s.omission)) plant.caught++;
        if (tFid != null && s.fidelity != null && s.fidelity < tFid) plant.lower_than_T++;
        continue;
      }
      if (s.fidelity != null) per[arm][uid] = s.fidelity;
      const e = errs[arm];
      e.pages++;
      if (s.omission) e.omission++;
      if (s.reversal) e.reversal++;
      if ((s.invention || []).some((x) => x.kind !== 'gloss')) e.invention++;
      if ((s.invention || []).some((x) => x.kind === 'gloss')) e.gloss++;
      e.major_spans += (s.spans || []).filter((x) => x.type === 'accuracy' && x.severity === 'major').length;
    }
  }
  const uids = Object.keys(per.T).filter((u) => per.S[u] != null && per.P[u] != null);
  const arm = (a) => ({ mean: r2(mean(uids.map((u) => per[a][u]))), ci: ci(uids.map((u) => per[a][u])) });
  const diff = (a, b) => { const d = uids.map((u) => per[a][u] - per[b][u]); return { mean: r2(mean(d)), ci: ci(d), wins: d.filter((x) => x > 0).length, losses: d.filter((x) => x < 0).length, ties: d.filter((x) => x === 0).length }; };
  const byLang = {};
  for (const lang of ['Latin', 'German', 'Greek', 'Chinese']) {
    const lu = uids.filter((u) => pages.find((p) => p.uid === u)?.lang === lang);
    byLang[lang] = { n: lu.length, ...Object.fromEntries(ARMS.map((a) => [a, r2(mean(lu.map((u) => per[a][u])))])) };
  }
  res[`fidelity_${name}`] = { n: uids.length, unparsed, T: arm('T'), S: arm('S'), P: arm('P'), S_minus_T: diff('S', 'T'), P_minus_T: diff('P', 'T'), S_minus_P: diff('S', 'P'), errors: errs, plant, by_language: byLang };
}

// (b) S form, (c) T form, (e) tokens.
const sForm = { replies: 0, valid_json: 0, json_after_strip: 0, markup_left_pages: 0, markup_left_tags: {}, annotations: 0, by_type: {}, anchored: 0, exact_not_in_text: 0, resolved: 0, resolved_by: {}, ambiguous_exact: 0, empty_exact_commentary: 0, page_level: { summary: 0, keywords: 0, meta: 0 } };
const tForm = { replies: 0, pages_malformed: 0, malformed: {}, commentary: 0, by_type: {} };
const tally = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
for (const p of pages) {
  const s = out.S.get(p.uid);
  if (s) {
    sForm.replies++;
    const L = layersOf('S', s.text);
    if (L.ok) sForm.valid_json++;
    if (L.problem === 'json after stripping text around it') sForm.json_after_strip++;
    if (L.markupLeft?.length) { sForm.markup_left_pages++; for (const t of L.markupLeft) tally(sForm.markup_left_tags, t.replace(/\s.*>$/, '>').toLowerCase()); }
    for (const a of L.annotations) {
      sForm.annotations++;
      tally(sForm.by_type, a.type);
      if (a.kind === 'page') { if (a.type in sForm.page_level) sForm.page_level[a.type]++; continue; }
      if (!a.anchor.exact) { if (a.kind === 'commentary') sForm.empty_exact_commentary++; continue; }
      sForm.anchored++;
      if (a.occurrences === 0) sForm.exact_not_in_text++;
      if (a.occurrences > 1) sForm.ambiguous_exact++;
      if (a.resolved) { sForm.resolved++; tally(sForm.resolved_by, a.resolved.how); }
    }
  }
  const t = out.T.get(p.uid);
  if (t) {
    tForm.replies++;
    const L = layersOf('T', t.text);
    if (L.malformed.length) tForm.pages_malformed++;
    for (const m of L.malformed) tally(tForm.malformed, `${m.malformed}:${m.tag || m.type}`);
    for (const a of L.annotations) if (a.kind === 'commentary' && !a.malformed) { tForm.commentary++; tally(tForm.by_type, a.type); }
  }
}
res.s_form = sForm;
res.t_form = tForm;
res.tokens = Object.fromEntries(ARMS.map((a) => {
  const rows = [...out[a].values()];
  const f = (k) => r2(mean(rows.map((r) => r.usage?.[k] ?? 0)));
  return [a, { pages: rows.length, input_tokens: f('input_tokens'), cache_read: f('cache_read'), cache_creation: f('cache_creation'), output_tokens: f('output_tokens'), secs: r2(mean(rows.map((r) => r.secs || 0))), body_chars: r2(mean(rows.map((r) => layersOf(a, r.text).body.length))) }];
}));

// (d) note verdicts.
if (fs.existsSync(`${W}/notes/out.jsonl`)) {
  const items = JSON.parse(fs.readFileSync(`${W}/notes/items.json`, 'utf8'));
  const v = { T: { notes: 0, judged: 0, right: 0, wrong: 0, invented: 0, misattached: 0, by_type: {} }, S: { notes: 0, judged: 0, right: 0, wrong: 0, invented: 0, misattached: 0, by_type: {}, unresolved_anchor: 0 } };
  const judged = new Map(readJsonl(`${W}/notes/out.jsonl`).filter((r) => r.verdicts).map((r) => [r.uid, r.verdicts]));
  for (const [uid, notes] of Object.entries(items)) {
    if (!judged.has(uid)) continue;
    for (const n of notes) {
      const x = v[n.arm];
      x.notes++;
      if (n.arm === 'S' && !n.resolved) x.unresolved_anchor++;
      const verdict = judged.get(uid)[n.id];
      if (!verdict) continue;
      x.judged++;
      const k = ['right', 'wrong', 'invented'].includes(verdict.verdict) ? verdict.verdict : 'other';
      x[k] = (x[k] || 0) + 1;
      if (verdict.attached === false) x.misattached++;
      const bt = (x.by_type[n.type] ||= { n: 0, right: 0, wrong: 0, invented: 0 });
      bt.n++; if (bt[k] != null) bt[k]++;
    }
  }
  v.pages_judged = judged.size;
  res.notes = v;
}
fs.mkdirSync(R, { recursive: true });
fs.writeFileSync(`${R}part-b.json`, JSON.stringify(res, null, 1) + '\n');
console.log(JSON.stringify(res, null, 1));

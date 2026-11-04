#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/german-cheaper-7701/run.mjs (#7701: the 18 Fraktur pages, gpuAloneWritten,
// the blind packet keyed by `cell:page:sha256(text)`, wrong-page and planted controls, its score) — copied and cut to
// GPU-alone arms only. It does not fit as is: its ROUTES are fixed, it has no judging rounds, no agreement with an
// accepted read and no DTA CER. judge.mjs `judge` is used unchanged; scripts/eval/fraktur-paired-7835/lib.mjs gives
// levelCers / scoreText (#7835 T3) and #7824's words(), imported unchanged.
/**
 * #7845 (job fraktur-models-7845): open OCR models trained on 15th–19th-century print, zero-shot, on our Fraktur.
 * Rules: scripts/eval/experiments/2026-10-31-fraktur-open-models-7845.md (preregistered, PR #7847).
 *
 *   node run.mjs sample   --out=P1 [--from=/root/jobs/german-cheaper-7701/rt]   the 18 Fraktur pages, gate set, read@4, c0
 *   node run.mjs written  --out=P1                     each arm's text as a GPU-alone route would write it
 *   node run.mjs packet   --out=P1 --round=1|2|3 [--arms=a,b]  the round's blind items (+ controls); keeps earlier
 *                                                     rounds. Amendment 2's arms (aw, a2w, b2w) were judged in their own
 *                                                     OUT (p1w: sample.json copied, arms/ and seg/ linked) with --arms.
 *   ROUTE_JUDGE_WEEKLY_MAX=85 node ../judge.mjs judge --out=P1
 *   node run.mjs score    --out=P1                     gate, wrong text per 1,000 words, agreement, coverage, speed
 *   node run.mjs p2       --out=P2 --t3=DIR            phase 2: Level-2 / Level-1 CER against the DTA typed pages
 * Read-only: nothing is written anywhere but --out.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeRng } from '../../lib/paired-stats.mjs';
import { plantError, scorePlant } from '../../lib/plant-ocr-errors.mjs';
import { levelCers, baseText, scoreText, words7824 } from '../../fraktur-paired-7835/lib.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = path.resolve(arg('out') || '.');
const FROM = path.resolve(arg('from') || '/root/jobs/german-cheaper-7701/rt');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const JF = (f) => JSON.parse(fs.readFileSync(path.join(FROM, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const CELL = 'de-fraktur-open';
const SEED = { order: 78451, wrongPage: 78452, planted: 78453, boot: 78454 };

// The preregistered arms (experiment file §Arms). c0 = the #7701 Kraken run, judged there; it is not re-judged.
export const ARMS = {
  a: { engine: 'calamari 2.3.1', model: 'deep3_lsh4 (calamari_models_experimental v0.0.3), 5 checkpoints voting', seg: 'S1' },
  a2: { engine: 'calamari 2.3.1', model: 'deep3_fraktur-hist (calamari_models_experimental v0.0.3), 5 voting', seg: 'S1' },
  // Amendment 1: b emits blanks on every checkpoint (not judged; its phase-2 CER is reported as "did not run");
  // b2, deep3_fraktur19 from LSH-4's release, is the period control.
  b: { engine: 'calamari 2.3.1', model: 'fraktur_historical (calamari_models 2.2, GT4HistOCR Fraktur), 5 voting', seg: 'S1', judge: false },
  b2: { engine: 'calamari 2.3.1', model: 'deep3_fraktur19 (calamari_models_experimental v0.0.3), 5 voting', seg: 'S1' },
  c1: { engine: 'kraken 7.1.1', model: 'austriannewspapers.mlmodel (zenodo 7933402)', seg: 'S1' },
  c2: { engine: 'kraken 7.1.1', model: 'austriannewspapers.mlmodel (zenodo 7933402)', seg: 'S2' },
  d: { engine: 'kraken 7.1.1', model: 'McCATMuS_nfd_nofix_V1.mlmodel (zenodo 13788177)', seg: 'S1' },
  e: { engine: 'kraken 7.1.1', model: 'CATMuS-Gothic-Print-1.0.0.mlmodel (zenodo 10599911)', seg: 'S1' },
  // Amendment 2: the Calamari arms on the SAME S1 polygons cut with the outside filled with paper tone (lines/S1w);
  // round 1's a / a2 / b2 read black-filled crops, which Calamari takes for ink. Judged afresh in their own packet.
  aw: { engine: 'calamari 2.3.1', model: 'deep3_lsh4, 5 voting, paper-filled S1 crops', seg: 'S1' },
  a2w: { engine: 'calamari 2.3.1', model: 'deep3_fraktur-hist, 5 voting, paper-filled S1 crops', seg: 'S1' },
  b2w: { engine: 'calamari 2.3.1', model: 'deep3_fraktur19, 5 voting, paper-filled S1 crops', seg: 'S1' },
  bw: { engine: 'calamari 2.3.1', model: 'fraktur_historical, paper-filled S1 crops', seg: 'S1', judge: false },
};
const LIVE = 'agy-flash-low@4';

/** #7701's gpuAloneWritten, unchanged: the GPU-draft floor (30 word characters) and the loop guards. */
function gpuAloneWritten(d) {
  if (!d?.text || d.text.replace(/\W/g, '').length < 30) return { why: 'GPU draft under 30 word characters' };
  if (d.finish === 'length') return { why: 'GPU draft cut at the token limit (loop)' };
  const lines = d.text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 3; i < lines.length; i++) if (lines[i].length > 3 && lines[i] === lines[i - 1] && lines[i] === lines[i - 2] && lines[i] === lines[i - 3]) return { why: 'GPU draft repeats a line 4 times (loop)' };
  return { text: d.text.trim() };
}

// ── sample: the 18 Fraktur pages from #7701, the gate set (read@4 wrote it), read@4's text and verdict, c0's ──
function sample() {
  const s = JF('sample.json'), wr = JF('written.json')['de-cheap'], key = JF('key.json'), pk = JF('packet.json');
  const V = new Map(jsonl(path.join(FROM, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const img = new Map(pk.items.map((it) => [it.id, it.image_url]));
  const vOf = (route, id) => { const k = key.find((x) => x.route === route && x.kind === 'item' && x.page_id === id); return k ? { v: V.get(k.judged_as) ?? null, image_url: img.get(k.judged_as) } : null; };
  const pages = s.cells['de-cheap'].pages.filter((p) => p.script_face === 'fraktur').map((p) => {
    const live = vOf(LIVE, p.page_id), kr = vOf('kraken', p.page_id), lo = vOf('lighton', p.page_id);
    const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
    return { page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, provider: p.provider,
      image_url: live?.image_url ?? kr?.image_url ?? lo?.image_url,
      gate: !!wr[LIVE]?.[p.page_id]?.text,
      live: { text: wr[LIVE]?.[p.page_id]?.text ?? null, accept: !!live?.v?.accept, wrong_text: wt(live?.v) },
      c0: { text: wr.kraken?.[p.page_id]?.text ?? null, accept: !!kr?.v?.accept, wrong_text: wt(kr?.v) },
      context: Object.fromEntries(['lighton', 'pero'].map((r) => [r, wr[r]?.[p.page_id]?.text ?? null])) };
  });
  if (pages.some((p) => !p.image_url)) throw new Error('a page has no image url in the #7701 packet');
  W('sample.json', { from: FROM, cell: CELL, made_at: new Date().toISOString(), gate_pages: pages.filter((p) => p.gate).length, pages });
  console.log(`${pages.length} Fraktur pages, ${pages.filter((p) => p.gate).length} in the gate set, read@4 accepted on ${pages.filter((p) => p.live.accept).length}`);
}

// ── written ──
function written() {
  const s = J('sample.json'), out = {};
  for (const arm of Object.keys(ARMS)) {
    out[arm] = Object.fromEntries(s.pages.map((p) => {
      const f = path.join(OUT, 'arms', arm, `${p.page_id}.txt`);
      return [p.page_id, fs.existsSync(f) ? gpuAloneWritten({ text: fs.readFileSync(f, 'utf8') }) : { why: 'no draft' }];
    }));
    console.log(`${arm}: written ${Object.values(out[arm]).filter((x) => x.text).length}/${s.pages.length}`);
  }
  W('written.json', out);
}

// ── rounds ──
function roundsOf(s) {
  const rng = makeRng(SEED.order);
  const gate = s.pages.filter((p) => p.gate).map((p) => p.page_id).sort();
  for (let i = gate.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [gate[i], gate[j]] = [gate[j], gate[i]]; }
  return { 1: gate.slice(0, 6), 2: gate.slice(6), 3: s.pages.filter((p) => !p.gate).map((p) => p.page_id) };
}
const verdicts = () => new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
const isWt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
/** An arm's gate status after the rounds judged so far: a gate page fails when not written, not accepted, or wrong text. */
function gateStatus(arm, s, key, V, wr, upTo) {
  const R = roundsOf(s), ids = [...(upTo >= 1 ? R[1] : []), ...(upTo >= 2 ? R[2] : [])];
  let fail = 0, ok = 0, pending = 0, wt = 0;
  for (const id of ids) {
    if (!wr[arm][id]?.text) { fail++; continue; }
    const k = key.find((x) => x.route === arm && x.kind === 'item' && x.page_id === id), v = k && V.get(k.judged_as);
    if (!v) { pending++; continue; }
    if (isWt(v)) wt++;
    if (v.accept && !isWt(v)) ok++; else fail++;
  }
  // the gate: >= 11 of the 15 accepted and NO wrong text on any gate page (experiment file §Gate)
  return { judged_pages: ids.length, ok, fail, wt, pending, alive: fail < 5, passed: upTo >= 2 && pending === 0 && ok >= 11 && wt === 0 };
}

function packet() {
  const round = Number(arg('round'));
  if (![1, 2, 3].includes(round)) throw new Error('--round=1|2|3');
  const s = J('sample.json'), wr = J('written.json'), R = roundsOf(s);
  const prev = fs.existsSync(path.join(OUT, 'packet.json')) ? J('packet.json') : { items: [] }, key = fs.existsSync(path.join(OUT, 'key.json')) ? J('key.json') : [];
  if (key.some((k) => k.round === round)) { console.log(`round ${round} already in the packet`); return; }
  const V = verdicts(), P = new Map(s.pages.map((p) => [p.page_id, p]));
  const items = new Map(prev.items.map((it) => [it.id, it]));
  const add = (route, p, kind, text, extra = {}) => {
    const tag = kind === 'item' ? `${CELL}:${p.page_id}:${h(text.trim())}` : `${kind}:${CELL}:${route}:${p.page_id}:${extra.other ?? extra.plant?.kind ?? ''}`;
    const id = `j${h(tag).slice(0, 10)}`;
    if (!items.has(id)) items.set(id, { id, task: 'ocr', lang: 'German', image_url: p.image_url, text });
    key.push({ id: `k${h(`${kind}:${CELL}:${route}:${p.page_id}:${extra.other ?? ''}:${round}`).slice(0, 10)}`, judged_as: id, cell: CELL, route, kind, round, page_id: p.page_id, book_id: p.book_id, ...extra });
  };
  // which arms go on: round 1 all; round 2 those that can still reach 11/15; round 3 those that passed the gate
  const only = arg('arms')?.split(',');   // --arms=aw,a2w,b2w: one packet (its own OUT) for Amendment 2's arms
  const JUDGED = Object.keys(ARMS).filter((a) => ARMS[a].judge !== false && (!only || only.includes(a)));
  const alive = JUDGED.filter((arm) => {
    if (round === 1) return true;
    const g = gateStatus(arm, s, key, V, wr, round - 1);
    if (g.pending) throw new Error(`${arm}: round ${round - 1} not fully judged (${g.pending} pending)`);
    return round === 2 ? g.alive : g.passed;
  });
  for (const arm of alive) for (const id of R[round]) if (wr[arm][id]?.text) add(arm, P.get(id), 'item', wr[arm][id].text);
  // wrong-page controls: round 1 four (seeded arms), round 2 two for each arm that goes on; another book's text
  const rng = makeRng(SEED.wrongPage + round);
  const wp = round === 1 ? Array.from({ length: 4 }, () => JUDGED[Math.floor(rng() * JUDGED.length)]) : round === 2 ? alive.flatMap((a) => [a, a]) : [];
  for (const arm of wp) {
    const ok = R[round].filter((id) => wr[arm][id]?.text), all = s.pages.filter((p) => wr[arm][p.page_id]?.text);
    if (!ok.length || all.length < 2) continue;
    const a = P.get(ok[Math.floor(rng() * ok.length)]); let b = a;
    while (b.book_id === a.book_id) b = all[Math.floor(rng() * all.length)];
    add(arm, a, 'wrong_page', wr[arm][b.page_id].text, { other: b.page_id });
  }
  // planted (round 1): two on #7701's read@4 texts of round-1 pages it accepted with no wrong text, kinds B and C
  if (round === 1) {
    const prng = makeRng(SEED.planted);
    const cands = R[1].map((id) => P.get(id)).filter((p) => p.live.accept && !p.live.wrong_text && p.live.text);
    let got = 0;
    for (const kind of ['B', 'C']) {
      for (const p of cands.slice(got)) {
        const pl = plantError(p.live.text, { kind, lang: 'German', seed: Math.floor(prng() * 2 ** 31) });
        if (!pl) continue;
        add(LIVE, p, 'planted', pl.text, { plant: pl.plant }); got++; break;
      }
    }
  }
  const order = [...items.values()].sort((x, y) => h(`fm7845-${round}${x.id}`).localeCompare(h(`fm7845-${round}${y.id}`)));
  W('packet.json', { built_at: new Date().toISOString(), items: order });
  W('key.json', key);
  const mine = key.filter((k) => k.round === round);
  console.log(`round ${round}: arms ${alive.join(', ') || 'none'}; ${mine.filter((k) => k.kind === 'item').length} items, ${mine.filter((k) => k.kind === 'wrong_page').length} wrong-page, ${mine.filter((k) => k.kind === 'planted').length} planted; packet ${items.size} unique texts`);
}

// ── score ──
const bodyLineCount = (t) => String(t || '').replace(/<(scan-quality|language|script|page-type|meta|note|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '').split('\n').filter((l) => /\p{L}/u.test(l)).length;
function timing(arm) {
  const rows = jsonl(path.join(OUT, 'arms', arm, 'timing.jsonl'));
  return rows.length ? rows.reduce((t, r) => t + r.secs, 0) / rows.length : null;
}
function score() {
  const s = J('sample.json'), wr = J('written.json'), key = fs.existsSync(path.join(OUT, 'key.json')) ? J('key.json') : [], V = verdicts();
  const pk = fs.existsSync(path.join(OUT, 'packet.json')) ? new Map(J('packet.json').items.map((it) => [it.id, it])) : new Map();
  const R = roundsOf(s), seg = jsonl(path.join(OUT, 'seg', 'timing.jsonl'));
  const segSecs = { S1: seg.reduce((t, r) => t + r.S1_secs, 0) / Math.max(1, seg.length), S2: seg.reduce((t, r) => t + r.S2_secs, 0) / Math.max(1, seg.length) };
  const ref = s.pages.filter((p) => p.live.accept && !p.live.wrong_text);           // agreement reference: accepted read@4
  // the accepted read is OCR: its tags are stripped first (levelCers treats its reference as a DTA page)
  const agreeOf = (getText) => {
    const v = ref.map((p) => { const t = getText(p); return t ? levelCers(baseText(p.live.text), t).l1.cer : null; }).filter((x) => x != null);
    return { n: v.length, mean_l1_cer: r3(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)), median_l1_cer: r3([...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]) };
  };
  const out = { scored_at: new Date().toISOString(), rule: 'scripts/eval/experiments/2026-10-31-fraktur-open-models-7845.md', judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image, blind', rounds: R, arms: {}, context: {} };
  for (const arm of Object.keys(ARMS)) {
    const rows = s.pages.map((p) => {
      const k = key.find((x) => x.route === arm && x.kind === 'item' && x.page_id === p.page_id), v = k ? V.get(k.judged_as) : null, text = wr[arm][p.page_id]?.text ?? null;
      return { page_id: p.page_id, gate: p.gate, written: !!text, judged: !!v, accept: !!v?.accept, wt: isWt(v), words: text ? words7824(text) : 0,
        wt_defects: (v?.defects || []).filter((d) => d.severity === 'wrong_text').length, misleads: (v?.defects || []).filter((d) => d.severity === 'misleads').length,
        examples: (v?.defects || []).filter((d) => d.severity === 'wrong_text').slice(0, 2).map((d) => `${d.class}: ${String(d.quote).slice(0, 60)} — ${String(d.what ?? '').slice(0, 80)}`) };
    });
    const j = rows.filter((r) => r.judged), w = j.reduce((t, r) => t + r.words, 0);
    const g = gateStatus(arm, s, key, V, wr, 2);
    const ctrl = key.filter((k) => k.route === arm && k.kind === 'wrong_page').map((k) => V.get(k.judged_as)).map((v) => (v ? { accept: v.accept, fidelity: v.fidelity } : null));
    const lines = s.pages.map((p) => (wr[arm][p.page_id]?.text ?? '').split('\n').filter(Boolean).length);
    out.arms[arm] = { ...ARMS[arm], written: `${rows.filter((r) => r.written).length}/${rows.length}`,
      judged: `${j.length}`, accepted: `${j.filter((r) => r.accept).length}/${j.length}`, wrong_text_pages: `${j.filter((r) => r.wt).length}/${j.length}`,
      wrong_text_per_1000_words: w ? r3(1000 * j.reduce((t, r) => t + r.wt_defects, 0) / w) : null, misleads_per_1000_words: w ? r3(1000 * j.reduce((t, r) => t + r.misleads, 0) / w) : null, words_judged: w,
      gate: { ...g, stopped_after_round: g.alive ? null : (key.some((k) => k.route === arm && k.round === 2) ? 2 : 1) },
      wrong_page_controls: ctrl, agreement_with_accepted_read4: agreeOf((p) => wr[arm][p.page_id]?.text),
      lines_mean: r3(lines.reduce((a, b) => a + b, 0) / lines.length),
      secs_per_page: { segment: r3(segSecs[ARMS[arm].seg]), recognise: r3(timing(arm)), pages_per_hour: timing(arm) ? Math.round(3600 / (segSecs[ARMS[arm].seg] + timing(arm))) : null, threads: ARMS[arm].engine.startsWith('kraken') ? 6 : 8 },
      rows };
  }
  // context: c0 (the #7701 Kraken run, its own verdicts), read@4, LightOnOCR, PERO — agreement only, nothing re-judged
  out.context.c0 = { accepted_7701: `${s.pages.filter((p) => p.c0.accept).length}/18`, wrong_text_7701: `${s.pages.filter((p) => p.c0.wrong_text).length}/18`, agreement_with_accepted_read4: agreeOf((p) => p.c0.text) };
  for (const r of ['lighton', 'pero']) out.context[r] = { agreement_with_accepted_read4: agreeOf((p) => p.context[r]) };
  // line coverage: S1 / S2 lines against the accepted read@4's text lines (preregistered window 0.9–1.2)
  out.line_coverage = ref.map((p) => { const t = seg.find((x) => x.id === p.page_id), n = bodyLineCount(p.live.text);
    return { page_id: p.page_id, read4_lines: n, S1: t?.S1_lines, S2: t?.S2_lines, S1_ratio: r3(t?.S1_lines / n), S2_ratio: r3(t?.S2_lines / n) }; });
  out.line_coverage_summary = { pages: ref.length, S1_in_window: out.line_coverage.filter((x) => x.S1_ratio >= 0.9 && x.S1_ratio <= 1.2).length, S2_in_window: out.line_coverage.filter((x) => x.S2_ratio >= 0.9 && x.S2_ratio <= 1.2).length };
  // controls
  const pl = key.filter((k) => k.kind === 'planted').map((k) => ({ kind: k.plant.kind, page_id: k.page_id, ...(V.get(k.judged_as) ? scorePlant(V.get(k.judged_as), k.plant) : { unjudged: true }) }));
  const wps = key.filter((k) => k.kind === 'wrong_page').map((k) => V.get(k.judged_as));
  out.controls = { wrong_page: { n: wps.length, refused: wps.filter((v) => v && !v.accept && Number(v.fidelity) <= 2).length }, planted: { n: pl.length, caught: pl.filter((x) => x.caught).length, detail: pl },
    judge_valid: wps.length > 0 && wps.every((v) => v && !v.accept && Number(v.fidelity) <= 2) && pl.length > 0 && pl.filter((x) => x.caught).length >= Math.ceil(pl.length * 0.75) };
  out.opus_calls = jsonl(path.join(OUT, 'verdicts-opus.jsonl')).length;
  out.segmentation = { S1_secs_per_page: r3(segSecs.S1), S2_secs_per_page: r3(segSecs.S2), spreads: 0, note: 'all 18 pages are single pages (stored image width/height 0.57–0.80)' };
  W('score.json', out);
  for (const [a, x] of Object.entries(out.arms)) console.log(`${a}: written ${x.written} judged ${x.judged} acc ${x.accepted} wt ${x.wrong_text_pages} wt/1000w ${x.wrong_text_per_1000_words} | gate ok ${x.gate.ok} fail ${x.gate.fail} pend ${x.gate.pending} passed ${x.gate.passed} | agree L1 ${x.agreement_with_accepted_read4.mean_l1_cer} (median ${x.agreement_with_accepted_read4.median_l1_cer}) | ${x.secs_per_page.pages_per_hour} p/h`);
  for (const [a, x] of Object.entries(out.context)) console.log(`${a}: agree L1 ${x.agreement_with_accepted_read4.mean_l1_cer} (median ${x.agreement_with_accepted_read4.median_l1_cer})`);
  console.log(`lines in window: S1 ${out.line_coverage_summary.S1_in_window}/${out.line_coverage_summary.pages}, S2 ${out.line_coverage_summary.S2_in_window}/${out.line_coverage_summary.pages}`);
  console.log(`controls: wrong-page ${out.controls.wrong_page.refused}/${out.controls.wrong_page.n}, planted ${out.controls.planted.caught}/${out.controls.planted.n}, valid ${out.controls.judge_valid}; opus calls ${out.opus_calls}`);
}

// ── p2: Level-2 / Level-1 CER on #7835 T3's DTA pages ──
function bootCI(xs, seed) {
  if (xs.length < 2) return null;
  const rng = makeRng(seed), m = [];
  for (let i = 0; i < 4000; i++) { let t = 0; for (let j = 0; j < xs.length; j++) t += xs[Math.floor(rng() * xs.length)]; m.push(t / xs.length); }
  m.sort((a, b) => a - b); return [r3(m[100]), r3(m[3899])];
}
function p2() {
  const T3 = path.resolve(arg('t3'));
  const sel = JSON.parse(fs.readFileSync(path.join(T3, arg('selected') || 't3/candidates.json'), 'utf8'));
  const cand = sel.selected ?? sel.candidates;
  const faces = new Map(jsonl(path.join(T3, 't3', 'tags.jsonl')).filter((r) => r.tag).map((r) => [r.key, r.tag.face]));
  const pero = fs.existsSync(arg('pero') || '') ? JSON.parse(fs.readFileSync(arg('pero'), 'utf8')) : {};
  const arms = ['lite', 'pero', ...Object.keys(ARMS)];
  const textOf = (c, arm) => {
    if (arm === 'lite') { const f = path.join(T3, 'texts', `T3-${c.page_id}.lite.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }
    if (arm === 'pero') return pero[c.page_id]?.text ?? null;
    const f = path.join(OUT, 'arms', arm, `${c.page_id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  const rows = [], excluded = [];
  for (const c of cand) {
    const rf = path.join(T3, 'texts', `T3-${c.page_id}.ref.txt`); if (!fs.existsSync(rf)) { excluded.push({ page_id: c.page_id, why: 'no reference' }); continue; }
    const ref = fs.readFileSync(rf, 'utf8'), row = { page_id: c.page_id, book_id: c.book_id, year: c.year, face: faces.get(c.key) ?? null };
    for (const arm of arms) { const t = textOf(c, arm); if (!t) continue; const lv = levelCers(ref, t), fold = scoreText(ref, t); row[arm] = { l2: r3(lv.l2.cer), l1: r3(lv.l1.cer), aligned: fold.aligned, wer_fold: r3(fold.wer) }; }
    if (!arms.some((a) => row[a]?.aligned)) { excluded.push({ page_id: c.page_id, why: 'nothing aligns (fold WER > 0.35): leaf or edition differs' }); continue; }
    rows.push(row);
  }
  const summ = (g) => Object.fromEntries(arms.map((a, i) => { const v1 = g.filter((r) => r[a]).map((r) => r[a].l1), v2 = g.filter((r) => r[a]).map((r) => r[a].l2);
    return [a, { n: v1.length, l2_mean: r3(v2.reduce((x, y) => x + y, 0) / Math.max(1, v2.length)), l1_mean: r3(v1.reduce((x, y) => x + y, 0) / Math.max(1, v1.length)), l1_median: r3([...v1].sort((x, y) => x - y)[Math.floor(v1.length / 2)]), l1_ci95: bootCI(v1, SEED.boot + i) }]; }));
  const paired = (g, a, b, i) => { const gg = g.filter((r) => r[a] && r[b]); const d = gg.map((r) => r[a].l1 - r[b].l1); return { n: gg.length, mean_l1_diff: r3(d.reduce((x, y) => x + y, 0) / Math.max(1, d.length)), ci95: bootCI(d, SEED.boot + 100 + i), a_better: d.filter((x) => x < -0.001).length, b_better: d.filter((x) => x > 0.001).length }; };
  const strata = { all: rows, fraktur: rows.filter((r) => r.face === 'fraktur'), antiqua: rows.filter((r) => r.face === 'antiqua'), untagged: rows.filter((r) => !r.face) };
  const out = { scored_at: new Date().toISOString(), t3_from: T3, excluded, strata: {} };
  for (const [k, g] of Object.entries(strata)) out.strata[k] = { n: g.length, arms: summ(g), paired: Object.fromEntries(Object.keys(ARMS).flatMap((a, i) => [[`${a}_vs_pero`, paired(g, a, 'pero', i)], [`${a}_vs_lite`, paired(g, a, 'lite', 50 + i)]])), segmentation: { c2_vs_c1: paired(g, 'c2', 'c1', 90) } };
  W('p2-score.json', { ...out, rows });
  for (const [k, x] of Object.entries(out.strata)) { console.log(`[${k}] n=${x.n}`); for (const [a, y] of Object.entries(x.arms)) console.log(`  ${a}: L2 ${y.l2_mean} L1 ${y.l1_mean} (median ${y.l1_median}, CI ${JSON.stringify(y.l1_ci95)}) n ${y.n}`); }
  console.log(`excluded ${excluded.length}: ${JSON.stringify(excluded)}`);
}

const stages = { sample, written, packet, score, p2 };
if (!stages[STAGE]) { console.error(`usage: run.mjs ${Object.keys(stages).join('|')} --out=DIR`); process.exit(2); }
await stages[STAGE]();

#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-stale-english-6388/{prepare,score}.mjs (#6518: opaque seeded request ids, planted
// controls caught by span overlap, reviewer JSON parsing) and scripts/eval/paddle-zh-qa-6388/prompt.txt (the OCR
// check's error types and variant-form rule). What is new: the rotating referee, the diff-scoped correction with its
// edit-contract check, and the three-arm blind MQM judging. No Mongo, no writes to pages/books. $0.
//
//   node scripts/eval/stale-gate-6567/gate.mjs <stage>
// Stages, in order (each reads $JOB_SCRATCH/pages.json from draw.mjs and the reads/ written by the stage before):
//   ocr-prep       packet-map.json; $JOB_SCRATCH/req/ocr.jsonl (one request per page, same prompt for both families)
//   referee-prep   $JOB_SCRATCH/req/ref-O.jsonl (Opus settles Gemini-only claims), ref-P.jsonl (Pro settles Opus-only)
//   ocr-final      ocr-final.json: per page, material OCR error yes/no and how it was settled
//   step2-prep     $JOB_SCRATCH/req/retranslate.jsonl, diffcorrect.jsonl (pages that passed step 1; plants applied)
//   diff-check     reads/diffcorrect-checked.jsonl: each diff-correct output applied under the edit contract, or rejected
//   judge-prep     judge-map.json; $JOB_SCRATCH/req/judge.jsonl (candidates deduplicated, shuffled per page)
//   score          results.json, results.md
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH;
const REQ = path.join(SCRATCH, 'req');
const READS = path.join(HERE, 'reads');
fs.mkdirSync(REQ, { recursive: true }); fs.mkdirSync(READS, { recursive: true });
const R = f => fs.readFileSync(path.join(HERE, f), 'utf8');
const J = f => JSON.parse(R(f));
const W = (f, x) => fs.writeFileSync(path.join(HERE, f), JSON.stringify(x, null, 1) + '\n');
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const writeJsonl = (f, xs) => fs.writeFileSync(f, xs.map(x => JSON.stringify(x)).join('\n') + '\n');
// last row per uid wins (both runners retry a failed row by appending)
const lastRows = f => { const m = new Map(); for (const r of readJsonl(f)) m.set(r.uid, r); return m; };
const IMG = id => path.join(SCRATCH, 'img', `${id}.jpg`);
export const BIN_ORDER = ['0–0.05', '0.05–0.1', '0.1–0.2', '0.2–0.5', '0.5–1'];

/** The JSON object a reply carries: the block between the sentinels if present, else the outermost braces. */
export function parseReply(text) {
  let t = String(text || '');
  const a = t.indexOf('<<<BEGIN>>>'), b = t.lastIndexOf('<<<END>>>');
  if (a >= 0 && b > a) t = t.slice(a + 11, b);
  t = t.replace(/^```(?:json)?\s*|```\s*$/gm, '');
  const x = t.indexOf('{'), y = t.lastIndexOf('}');
  if (x < 0 || y <= x) return null;
  try { return JSON.parse(t.slice(x, y + 1)); } catch { return null; }
}

const pages = () => JSON.parse(fs.readFileSync(path.join(SCRATCH, 'pages.json'), 'utf8'));
const pmap = () => new Map(J('packet-map.json').items.map(i => [i.page_id, i.qid]));
const byQid = () => { const m = pmap(); return new Map(pages().map(p => [m.get(p.page_id), p])); };

const stage = process.argv[2];

if (stage === 'ocr-prep') {
  const ps = pages();
  const order = ps.map(p => p.page_id);
  const rng = makeRng(6568);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const items = order.map((id, i) => { const p = ps.find(x => x.page_id === id); return { qid: `p${String(i + 1).padStart(2, '0')}`, page_id: id, book_id: p.book_id, bin: p.bin }; });
  W('packet-map.json', { seed: 6568, items });
  const tpl = R('prompt-ocr-check.txt');
  writeJsonl(path.join(REQ, 'ocr.jsonl'), items.map(it => ({ uid: it.qid, image: IMG(it.page_id), prompt: tpl.replace('{TRANSCRIPTION}', ps.find(x => x.page_id === it.page_id).paddle) })));
  console.log('ocr requests', items.length);
}

/** Per page and reviewer: {ok, material, errors} from an OCR-check read. */
function ocrReads() {
  const O = lastRows(path.join(READS, 'ocr-O.jsonl')), G = lastRows(path.join(READS, 'ocr-G.jsonl'));
  const one = r => { const j = r?.text ? parseReply(r.text) : null; if (!j || !Array.isArray(j.errors)) return { ok: false }; const errors = j.errors.map((e, i) => ({ ...e, id: `c${i + 1}` })); return { ok: true, errors, material: errors.some(e => e.severity === 'material'), verdict: j.verdict }; };
  return { O: q => one(O.get(q)), G: q => one(G.get(q)), rowO: q => O.get(q), rowG: q => G.get(q) };
}

if (stage === 'referee-prep') {
  const tpl = R('prompt-ocr-referee.txt'), bq = byQid(), rd = ocrReads();
  const refO = [], refP = [];
  for (const [q, p] of bq) {
    const o = rd.O(q), g = rd.G(q);
    if (!o.ok || !g.ok || o.material === g.material) continue;
    // Rotating referee: the family that did NOT raise the material claims settles them. All of the raising reviewer's
    // material claims go to the referee; its minor ones do not decide the page.
    const raiser = o.material ? o : g;
    const claims = raiser.errors.filter(e => e.severity === 'material').map(e => `${e.id}: ${e.type}; transcription "${e.transcription || ''}" ; page "${e.page || ''}" ; after "${e.context || ''}" (${e.why || ''})`).join('\n');
    const req = { uid: q, image: IMG(p.page_id), prompt: tpl.replace('{TRANSCRIPTION}', p.paddle).replace('{CLAIMS}', claims) };
    (o.material ? refP : refO).push(req);
  }
  writeJsonl(path.join(REQ, 'ref-O.jsonl'), refO); writeJsonl(path.join(REQ, 'ref-P.jsonl'), refP);
  console.log('Opus settles Gemini-only:', refO.map(r => r.uid).join(',') || 'none', '| Pro settles Opus-only:', refP.map(r => r.uid).join(',') || 'none');
}

if (stage === 'ocr-final') {
  const bq = byQid(), rd = ocrReads();
  const RO = lastRows(path.join(READS, 'ref-O.jsonl')), RP = lastRows(path.join(READS, 'ref-P.jsonl'));
  const out = [];
  for (const [q, p] of bq) {
    const o = rd.O(q), g = rd.G(q);
    const row = { qid: q, page_id: p.page_id, bin: p.bin, O: o.ok ? (o.material ? 'material' : o.errors.length ? 'minor' : 'clean') : 'failed', G: g.ok ? (g.material ? 'material' : g.errors.length ? 'minor' : 'clean') : 'failed', secs: (rd.rowO(q)?.secs || 0) + (rd.rowG(q)?.secs || 0), calls: (rd.rowO(q) ? 1 : 0) + (rd.rowG(q)?.attempts || 0) };
    if (!o.ok && !g.ok) { row.material = null; row.settled = 'both reads failed'; }
    else if (!o.ok || !g.ok) { const s = o.ok ? o : g; row.material = s.material; row.settled = `one read only (${o.ok ? 'O' : 'G'})`; }
    else if (o.material === g.material) { row.material = o.material; row.settled = 'agree'; }
    else {
      const ref = o.material ? RP.get(q) : RO.get(q);
      const j = ref?.text ? parseReply(ref.text) : null;
      row.referee = o.material ? 'P (settles O)' : 'O (settles G)';
      row.calls += ref ? (ref.attempts || 1) : 0; row.secs += ref?.secs || 0;
      if (!j || !Array.isArray(j.claims)) { row.material = null; row.settled = 'referee failed'; }
      else { row.material = j.claims.some(c => c.confirmed && c.severity === 'material'); row.settled = 'referee'; row.referee_confirmed = j.claims.filter(c => c.confirmed).map(c => `${c.id}:${c.severity}`); }
    }
    out.push(row);
  }
  out.sort((a, b) => a.qid < b.qid ? -1 : 1);
  W('ocr-final.json', out);
  for (const b of BIN_ORDER) { const xs = out.filter(r => r.bin === b); console.log(b, 'material', xs.filter(r => r.material === true).length, 'clean', xs.filter(r => r.material === false).length, 'unresolved', xs.filter(r => r.material === null).length); }
}

// Plants: written by hand in plants.json BEFORE step 2 ran ({page_id, edits:[{from,to,kind}]}), on 8 seeded step-2 pages.
const plantsFor = () => fs.existsSync(path.join(HERE, 'plants.json')) ? new Map(J('plants.json').items.map(x => [x.page_id, x])) : new Map();
export function storedEnglish(p, plants) {
  let en = p.english;
  for (const e of plants.get(p.page_id)?.edits || []) { if (en.split(e.from).length !== 2) throw new Error(`plant span not unique on ${p.page_id}: ${e.from}`); en = en.replace(e.from, e.to); }
  return en;
}
const hunkLines = p => p.hunks.map(h => `${h.id}: …${h.before}[${h.old || '∅'} → ${h.new || '∅'}]${h.after}…`).join('\n') || '(none)';
const SENT = '\n\nWrite the translation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary.';

if (stage === 'step2-prep') {
  const bq = byQid(), fin = new Map(J('ocr-final.json').map(r => [r.qid, r])), plants = plantsFor();
  const tpl = R('prompt-diff-correct.txt');
  const rt = [], dc = [];
  for (const [q, p] of bq) {
    if (fin.get(q)?.material !== false) continue;
    // RETRANSLATE: the production single-page prompt, snapshotted by draw.mjs, + cli-translate.mjs's CLI suffix + the #6523 sentinels.
    rt.push({ uid: q, prompt: p.retranslate_prompt + '\n\nOutput only the English translation in the format above. Do not open, read or write any file, do not use any tool, and add no preamble or commentary.' + SENT });
    dc.push({ uid: q, image: IMG(p.page_id), prompt: tpl.replace('{NEW}', p.paddle).replace('{HUNKS}', hunkLines(p)).replace('{ENGLISH}', storedEnglish(p, plants)) });
  }
  writeJsonl(path.join(REQ, 'retranslate.jsonl'), rt); writeJsonl(path.join(REQ, 'diffcorrect.jsonl'), dc);
  console.log('step 2 pages', rt.length, 'planted', [...plants.keys()].length);
}

/** Text between the sentinels (a translation), or the whole reply when there are none. */
export const sentinelText = t => { const s = String(t || ''); const a = s.indexOf('<<<BEGIN>>>'), b = s.lastIndexOf('<<<END>>>'); return (a >= 0 && b > a ? s.slice(a + 11, b) : s).trim(); };

/**
 * The edit contract (#6567): apply a diff-correct reply to the stored English. Rejects the WHOLE reply if any edit
 * cites no real change id, quotes a span that is not in the English exactly once, overlaps another edit, or replaces
 * more English than the cited changes can account for (25 words + 6 per Han character in the cited hunks). Text outside
 * the edited spans is then byte-identical by construction; `outside_ok` re-checks that against a word diff.
 */
export function applyContract(english, hunks, reply) {
  const j = parseReply(reply);
  if (!j || !Array.isArray(j.edits)) return { ok: false, reason: 'unparsed' };
  const ids = new Map(hunks.map(h => [h.id, h]));
  const spans = [];
  for (const e of j.edits) {
    if (typeof e.from !== 'string' || typeof e.to !== 'string' || !e.from) return { ok: false, reason: 'malformed edit' };
    const cited = (e.changes || []).filter(c => ids.has(c));
    if (!cited.length) return { ok: false, reason: `edit cites no real change: ${JSON.stringify(e.changes)}` };
    const at = english.indexOf(e.from);
    if (at < 0) return { ok: false, reason: `span not found: ${e.from.slice(0, 60)}` };
    if (english.indexOf(e.from, at + 1) >= 0) return { ok: false, reason: `span not unique: ${e.from.slice(0, 60)}` };
    const hanN = cited.reduce((n, c) => n + [...ids.get(c).old].length + [...ids.get(c).new].length, 0);
    const words = e.from.trim().split(/\s+/).length;
    if (words > 25 + 6 * hanN) return { ok: false, reason: `edit too large for its changes: ${words} words for ${hanN} Han` };
    spans.push({ at, end: at + e.from.length, to: e.to, cited });
  }
  spans.sort((a, b) => a.at - b.at);
  for (let i = 1; i < spans.length; i++) if (spans[i].at < spans[i - 1].end) return { ok: false, reason: 'overlapping edits' };
  let out = '', pos = 0;
  for (const s of spans) { out += english.slice(pos, s.at) + s.to; pos = s.end; }
  out += english.slice(pos);
  return { ok: true, text: out, edits: spans.length, cited: [...new Set(spans.flatMap(s => s.cited))].length };
}

if (stage === 'diff-check') {
  const bq = byQid(), plants = plantsFor(), rows = lastRows(path.join(READS, 'diffcorrect.jsonl'));
  const out = [];
  for (const [q, r] of rows) {
    const p = bq.get(q), stored = storedEnglish(p, plants);
    const c = r.text ? applyContract(stored, p.hunks, r.text) : { ok: false, reason: 'failed read' };
    out.push({ uid: q, ok: c.ok, reason: c.reason || null, edits: c.edits ?? null, hunks_cited: c.cited ?? null, hunks: p.hunks.length, text: c.ok ? c.text : null });
  }
  writeJsonl(path.join(READS, 'diffcorrect-checked.jsonl'), out);
  console.log('diff-correct: accepted', out.filter(x => x.ok).length, 'rejected', out.filter(x => !x.ok).map(x => `${x.uid}:${x.reason}`).join(' | '));
}

const ARMS = ['stored', 'retranslate', 'diffcorrect'];
function armTexts(q, p, plants) {
  const rt = lastRows(path.join(READS, 'retranslate.jsonl')).get(q);
  const dc = new Map(readJsonl(path.join(READS, 'diffcorrect-checked.jsonl')).map(r => [r.uid, r])).get(q);
  const rtText = rt?.text ? sentinelText(rt.text) : '';
  return { stored: storedEnglish(p, plants), retranslate: rtText.length > 20 ? rtText : null, diffcorrect: dc?.ok ? dc.text : null };
}

if (stage === 'judge-prep') {
  const bq = byQid(), fin = new Map(J('ocr-final.json').map(r => [r.qid, r])), plants = plantsFor(), tpl = R('prompt-judge.txt');
  const reqs = [], map = [];
  for (const [q, p] of bq) {
    if (fin.get(q)?.material !== false) continue;
    const t = armTexts(q, p, plants);
    // Identical texts are shown once (a diff-correct reply with no edits is the stored English); the label maps back to every arm.
    const uniq = [];
    for (const a of ARMS) { if (t[a] == null) continue; const u = uniq.find(x => x.text === t[a]); if (u) u.arms.push(a); else uniq.push({ text: t[a], arms: [a] }); }
    const rng = makeRng(6569 + Number(q.slice(1)));
    for (let i = uniq.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [uniq[i], uniq[j]] = [uniq[j], uniq[i]]; }
    const labels = uniq.map((_, i) => 'ABC'[i]);
    map.push({ qid: q, labels: Object.fromEntries(uniq.map((u, i) => [labels[i], u.arms])) });
    const cands = uniq.map((u, i) => `\n===== CANDIDATE ${labels[i]} =====\n${u.text}\n`).join('');
    reqs.push({ uid: q, image: IMG(p.page_id), prompt: tpl.replace('{N}', String(uniq.length)).replaceAll('{LABELS}', labels.join(', ')).replace('{READING}', p.paddle).replace('{CANDIDATES}', cands) });
  }
  W('judge-map.json', { seed: '6569+qid', items: map });
  writeJsonl(path.join(REQ, 'judge.jsonl'), reqs);
  console.log('judge requests', reqs.length);
}

// Word-level edit distance between two English texts, over the words of the first (edit size).
function wordEdit(a, b) {
  const x = a.split(/\s+/).filter(Boolean), y = b.split(/\s+/).filter(Boolean);
  let prev = new Int32Array(y.length + 1), cur = new Int32Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) { cur[0] = i; for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  return prev[y.length] / Math.max(1, x.length);
}
const norm = s => String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A judge error "hits" a planted span when their normalised words overlap by 2+ words, or one contains the other. */
export function overlaps(quote, planted) {
  const a = norm(quote), b = norm(planted);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(' ').filter(w => w.length > 2)); const common = b.split(' ').filter(w => w.length > 2 && wa.has(w));
  return common.length >= 2;
}

if (stage === 'score') {
  const bq = byQid(), fin = J('ocr-final.json'), plants = plantsFor(), jmap = new Map(J('judge-map.json').items.map(x => [x.qid, x.labels]));
  const judges = { O: lastRows(path.join(READS, 'judge-O.jsonl')), P: lastRows(path.join(READS, 'judge-P.jsonl')) };
  const rt = lastRows(path.join(READS, 'retranslate.jsonl')), dcRaw = lastRows(path.join(READS, 'diffcorrect.jsonl'));
  const dcc = new Map(readJsonl(path.join(READS, 'diffcorrect-checked.jsonl')).map(r => [r.uid, r]));
  const MATERIAL = e => ['mistranslation', 'omission', 'addition', 'untranslated'].includes(e.category) && ['major', 'critical'].includes(e.severity);
  const STYLE = e => ['fluency', 'terminology', 'style', 'markup'].includes(e.category);
  const perPage = [];
  for (const [q, labels] of jmap) {
    const p = bq.get(q), t = armTexts(q, p, plants), pl = plants.get(p.page_id)?.edits || [];
    const row = { qid: q, bin: p.bin, planted: pl.length > 0, arms: {} };
    for (const a of ARMS) row.arms[a] = { present: t[a] != null, edit: t[a] != null && a !== 'stored' ? +wordEdit(t.stored, t[a]).toFixed(4) : null, still_planted: t[a] != null ? pl.filter(x => t[a].includes(x.to)).length : null };
    row.arms.retranslate.secs = rt.get(q)?.secs ?? null; row.arms.retranslate.calls = rt.get(q)?.attempts ?? null;
    row.arms.diffcorrect.secs = dcRaw.get(q)?.secs ?? null; row.arms.diffcorrect.calls = dcRaw.get(q)?.attempts ?? null;
    row.arms.diffcorrect.rejected = dcc.get(q) && !dcc.get(q).ok ? dcc.get(q).reason : null;
    row.arms.diffcorrect.n_edits = dcc.get(q)?.edits ?? null;
    for (const [jn, rows] of Object.entries(judges)) {
      const r = rows.get(q), j = r?.text ? parseReply(r.text) : null;
      row[`judge_${jn}_ok`] = !!(j && j.candidates);
      row[`judge_${jn}_secs`] = r?.secs ?? null;
      if (!row[`judge_${jn}_ok`]) continue;
      for (const [lab, arms] of Object.entries(labels)) {
        const errs = j.candidates[lab]?.errors || [];
        for (const a of arms) {
          // planted spans this candidate still carries; an error that overlaps one is a catch, and is not counted against the arm
          const carried = pl.filter(x => t[a].includes(x.to));
          const caught = carried.filter(x => errs.some(e => overlaps(e.english, x.to)));
          const own = errs.filter(e => !carried.some(x => overlaps(e.english, x.to)));
          row.arms[a][jn] = { material: own.filter(MATERIAL).length, accuracy_minor: own.filter(e => !MATERIAL(e) && !STYLE(e)).length, style: own.filter(STYLE).length, planted_carried: carried.length, planted_caught: caught.length };
        }
      }
    }
    perPage.push(row);
  }
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const f2 = x => x == null ? '–' : x.toFixed(2);
  const bins = {};
  for (const b of BIN_ORDER) {
    const ocr = fin.filter(r => r.bin === b), pp = perPage.filter(r => r.bin === b);
    const s = { pages: ocr.length, ocr_material: ocr.filter(r => r.material === true).length, ocr_clean: ocr.filter(r => r.material === false).length, ocr_unresolved: ocr.filter(r => r.material === null).length, ocr_secs_per_page: mean(ocr.map(r => r.secs)), ocr_calls_per_page: mean(ocr.map(r => r.calls)), step2_pages: pp.length };
    for (const a of ARMS) {
      s[a] = { present: pp.filter(r => r.arms[a].present).length };
      if (a !== 'stored') { const e = pp.filter(r => r.arms[a].edit != null).map(r => r.arms[a].edit); s[a].edit_mean = mean(e); s[a].edit_median = e.length ? e.sort((x, y) => x - y)[Math.floor(e.length / 2)] : null; s[a].secs_per_page = mean(pp.filter(r => r.arms[a].secs != null).map(r => r.arms[a].secs)); s[a].calls_per_page = mean(pp.filter(r => r.arms[a].calls != null).map(r => r.arms[a].calls)); }
      for (const jn of ['O', 'P']) { const xs = pp.filter(r => r.arms[a][jn]); s[a][jn] = { scored: xs.length, material_per_page: mean(xs.map(r => r.arms[a][jn].material)), style_per_page: mean(xs.map(r => r.arms[a][jn].style)) }; }
    }
    s.diffcorrect.rejected = pp.filter(r => r.arms.diffcorrect.rejected).length;
    // paired: pages where all three arms were scored by the judge
    for (const jn of ['O', 'P']) { const xs = pp.filter(r => ARMS.every(a => r.arms[a][jn])); s[`paired_${jn}`] = { n: xs.length, ...Object.fromEntries(ARMS.map(a => [a, mean(xs.map(r => r.arms[a][jn].material))])) }; }
    bins[b] = s;
  }
  const catchRate = {};
  for (const jn of ['O', 'P']) for (const a of ['stored', 'diffcorrect']) {
    const xs = perPage.filter(r => r.planted && r.arms[a][jn]);
    catchRate[`${jn}_${a}`] = { carried: xs.reduce((n, r) => n + r.arms[a][jn].planted_carried, 0), caught: xs.reduce((n, r) => n + r.arms[a][jn].planted_caught, 0) };
  }
  const judgeFails = Object.fromEntries(['O', 'P'].map(jn => [jn, perPage.filter(r => !r[`judge_${jn}_ok`]).map(r => r.qid)]));
  const plantsSurvived = perPage.filter(r => r.planted && r.arms.diffcorrect.present).map(r => ({ qid: r.qid, carried: r.arms.diffcorrect.still_planted }));
  const res = { bins, catch_rate: catchRate, judge_failed: judgeFails, plants_kept_by_diffcorrect: plantsSurvived, per_page: perPage };
  W('results.json', res);
  const L = ['| bin | pages | OCR material | → step 2 | stored O / P | retranslate O / P | diff-correct O / P | diff-correct rejected | edit (median) RT / DC | s/page RT / DC |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const b of BIN_ORDER) { const s = bins[b]; L.push(`| ${b} | ${s.pages} | ${s.ocr_material}${s.ocr_unresolved ? ` (+${s.ocr_unresolved} unresolved)` : ''} | ${s.step2_pages} | ${f2(s.stored.O.material_per_page)} / ${f2(s.stored.P.material_per_page)} | ${f2(s.retranslate.O.material_per_page)} / ${f2(s.retranslate.P.material_per_page)} | ${f2(s.diffcorrect.O.material_per_page)} / ${f2(s.diffcorrect.P.material_per_page)} | ${s.diffcorrect.rejected} | ${f2(s.retranslate.edit_median)} / ${f2(s.diffcorrect.edit_median)} | ${Math.round(s.retranslate.secs_per_page || 0)} / ${Math.round(s.diffcorrect.secs_per_page || 0)} |`); }
  L.push('', 'Planted-error catch (caught / carried): ' + Object.entries(catchRate).map(([k, v]) => `${k} ${v.caught}/${v.carried}`).join(', '));
  L.push('Judge failed reads: ' + Object.entries(judgeFails).map(([k, v]) => `${k} ${v.length}${v.length ? ' (' + v.join(',') + ')' : ''}`).join(', '));
  fs.writeFileSync(path.join(HERE, 'results.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
}

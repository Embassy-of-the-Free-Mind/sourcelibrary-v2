#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-correct-6560/score.py readoff_prep()/parse_readoff() — the image read-off the
// 30-folio test used (Opus settled 57/60 of its known-answer controls). That builds spans "toward Derge" from a
// fixed manifest; the volume pass has no Derge window per page, so this builds the same READOFF requests from
// (a) the ya-btags guard's held changes and (b) every changed span of a sampled page, for the blind audit.
/**
 * Leaf checks for the #6560 Flash correction pass. Requests run through scripts/eval/replicate-6547/run-claude-arm.py
 * (sealed `claude -p --restricted`, Read only, image in the folder); replies are parsed here.
 *
 *   yatags-req     --emit=E.jsonl --req=R.jsonl --key=K.json
 *       E is cli-ocr.mjs apply --emit-yatags output. One request per held page: each ya-btags change, the draft's and
 *       the correction's syllable as A/B in random order, plus 2 known-answer controls (an unchanged syllable against a
 *       one-letter change). The judge is not told which reading is the draft.
 *   yatags-verdicts --key=K.json --replies=O.jsonl --out=V.jsonl [--append]
 *       V rows {page_id, hits, keep, checked_by, answers}: a change is KEPT only where the judge saw the correction's
 *       syllable. V is cli-ocr.mjs apply --yatags-verdicts input.
 *   audit-req      --dir=READ_DIR --verdicts=V.jsonl --n=40 --seed=6560 --req=R.jsonl --key=K.json [--changed=IDS.json] [--drafts=D.jsonl]
 *                  [--pages=IDS.json --spans=S.jsonl]   (#6740 diff-QA: these pages, only their RISKY spans)
 *       Samples n pages that apply would write with a change, rebuilds the text apply would write (guard reverts
 *       applied), and asks a FRESH judge, per changed span, which of draft / written the leaf shows (A/B random).
 *   page-req       --key=K.json --dir=READ_DIR --req=R.jsonl
 *       The route-judge whole-page judge (#6740) on the audit's pages: draft and written text, one call each, blind.
 *   gate           --key=K.json --span=S.json --page-replies=O.jsonl [--n=40|10] [--out=G.json]
 *       Both judges per page and the pooled verdict; the production gate's bar (see the mode).
 *   audit-score    --key=K.json --replies=O.jsonl [--guard-key=K.json --guard-replies=O.jsonl] [--out=S.json]
 *       Per page: spans where the leaf shows the draft (worse), the written text (better), neither, unclear. A page is
 *       WORSE when it has more draft-wins than written-wins. With the guard files, Krippendorff's alpha between the
 *       guard's judge and the audit's judge on the ya-btags changes both judged.
 *
 * SEVERITY (#6740, Derek 2026-10-26: "per page, errors fixed vs introduced, by severity"). `audit-req --severity`
 * asks the judge, per item, whether the two readings differ SEVERELY (another word or meaning, a negation, a number, a
 * mantra syllable or vowel, words or a line in one and not the other) or in a MINOR way (particle, spelling,
 * punctuation, a syllable split or joined), whichever is right. `--only=IDS.json` limits the draw to a batch, and
 * `--n` pages are drawn from it. `audit-score` then counts per page severe/minor errors FIXED (leaf shows the
 * correction) and INTRODUCED (leaf shows the draft); the batch rule is: a severe error introduced on fewer than 2 of
 * 10 pages. Because the judge misses up to 1 in 7 of its known-answer controls, and a page carries about ten spans,
 * one judge's "the leaf shows the draft" is not enough to call a severe error introduced:
 *   confirm-req    --key=K.json --replies=O.jsonl --dir=READ_DIR --req=R.jsonl --ckey=CK.json [--tiles-dir=D]
 *       One request per page holding a severe draft-win: only those spans, fresh A/B order, 2 new controls, frame +
 *       full-resolution tiles. A second fresh Opus answers.
 *   audit-score ... --confirm-key=CK.json --confirm-replies=CO.jsonl
 *       A severe error counts as introduced only where both judges saw the draft. Both counts are reported.
 *   severity-gate  --span=S.json --page-replies=P.jsonl [--out=G.json]
 *       The batch verdict under the rule: a page has a severe error introduced when (a) a confirmed severe span shows
 *       the draft on the leaf or (b) the whole-page judge (page-req) finds wrong text only in the written text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { diffSyllables, yatagsHits, revertHits } from '../../../lib/tibetan-yatags-guard.mjs';
import { judgeReliability, reliabilityLine, wilson } from '../../lib/agreement-stats.mjs';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

// Seeded PRNG (mulberry32 over a string hash), so a request set is rebuilt identically.
function rngFor(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, rng) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };

// score.py READOFF word for word (it names a Kangyur manuscript: the pass runs on Kangyurs, as the 30 folios were).
const READOFF = 'You are checking a transcription of a Tibetan Kangyur manuscript against its image. Below are numbered '
  + 'items. Each gives the approximate line (counting from the top of the image; a frame may show two leaves '
  + 'of about 7 lines each, upper leaf first), the syllables just before the spot, and two or more candidate '
  + 'readings for the spot. Look at the image and say which candidate the manuscript actually shows. Judge '
  + 'only by what is written on this leaf, not by what the text ought to say. If none of the candidates '
  + 'matches, answer "other" and write what you see. If you cannot find or read the spot, answer "unclear".\n\n'
  + 'Reply with one JSON object per line, one per item, between two marker lines <<<BEGIN>>> and <<<END>>>, '
  + 'nothing outside the markers: {"item": <n>, "answer": "A"|"B"|"other"|"unclear", "seen": "<what the '
  + 'leaf shows, in Tibetan Unicode>"}\n\nItems:\n';
// --severity: one more field per item. Asked of both candidates, not of the one the leaf shows, so it names the kind of
// difference; the leaf side (above) says which way it went.
const SEVERITY = '\n\nFor each item, also say how the candidates differ from EACH OTHER, whichever one is right: "severe" if '
  + 'they are different words or meanings (another word, a negation added or lost, a different number, a different mantra '
  + 'or dhāraṇī syllable or vowel length, or words or a line present in one and missing in the other); "minor" if they are '
  + 'the same word written another way (a particle variant such as ཀྱི/གྱི/གི, a particle added or dropped, a spelling or '
  + 'abbreviation variant, tsheg or shad punctuation, a syllable split or joined). Add "diff": "severe"|"minor" to each '
  + 'JSON object.';
const NOTHING = '(nothing: the syllables before go straight on to the syllables after)';
const SWAPS = [['པ', 'བ'], ['བ', 'པ'], ['ད', 'ང'], ['ང', 'ད'], ['ས', 'མ'], ['མ', 'ས'], ['ི', 'ེ'], ['ེ', 'ི'], ['ུ', 'ོ'], ['ོ', 'ུ'], ['ག', 'ཀ'], ['ན', 'ཏ']];

// Line counted from the top, tag lines (<leaf-break/>) not counted.
const lineOf = (text, off) => text.normalize('NFC').slice(0, off).split('\n').filter((l) => !/^\s*<[^>]+>\s*$/.test(l)).length;

function controls(d, rng, n = 2) {
  const eq = d.pairs.filter(([i, j]) => i !== null && j !== null && d.A[i].syl === d.B[j].syl);
  const out = [];
  for (let t = 0; t < 20 && out.length < n && eq.length > 12; t++) {
    const [, j] = eq[5 + Math.floor(rng() * (eq.length - 10))];
    const s = d.B[j].syl;
    const sw = SWAPS.find(([a]) => s.includes(a));
    if (!sw || out.some((c) => c.j === j)) continue;
    out.push({ kind: 'control', j, base: s, arm: s.replace(sw[0], sw[1]), line: lineOf(d.nextText, d.B[j].start),
      before: d.B.slice(Math.max(0, j - 4), j).map((x) => x.syl).join('་'), after: d.B.slice(j + 1, j + 5).map((x) => x.syl).join('་') });
  }
  return out;
}

function buildPrompt(items, rng, { severity = false } = {}) {
  shuffle(items, rng);
  const lines = items.map((it, n) => {
    const flip = rng() < 0.5;
    const opts = flip ? [it.arm || NOTHING, it.base || NOTHING] : [it.base || NOTHING, it.arm || NOTHING];
    Object.assign(it, { item: n + 1, A_is: flip ? 'arm' : 'base' });
    return `${n + 1}. line ≈ ${it.line || '?'}; just before: ${it.before || '(start)'}; A: ${opts[0]}   B: ${opts[1]}; just after: ${it.after || '(end)'}`;
  });
  return READOFF.replace('\n\nItems:\n', (severity ? SEVERITY : '') + '\n\nItems:\n') + lines.join('\n');
}
const diffOf = (ans) => { const d = String(ans?.diff || '').trim().toLowerCase(); return d === 'severe' || d === 'minor' ? d : null; };

function parseReply(text) {
  const m = String(text || '').match(/<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)/);
  const body = m ? m[1] : String(text || '');
  const out = {};
  for (let l of body.split('\n')) {
    l = l.trim().replace(/,$/, '');
    if (!l.startsWith('{')) continue;
    try { const j = JSON.parse(l); out[Number(j.item)] = j; } catch { /* a malformed line is an unanswered item */ }
  }
  return out;
}
// What the judge saw for an item: 'arm' (the correction), 'base' (the draft), 'other', 'unclear', or null (no answer).
function sideOf(it, ans) {
  const a = String(ans?.answer || '').trim().toUpperCase();
  if (a === 'A' || a === 'B') return (a === 'A') === (it.A_is === 'arm') ? 'arm' : 'base';
  if (a === 'OTHER') return 'other';
  if (a === 'UNCLEAR') return 'unclear';
  return null;
}

if (CMD === 'yatags-req') {
  const reqs = [], key = {};
  for (const e of readJsonl(arg('emit'))) {
    const rng = rngFor(`6560|yatags|${e.page_id}`);
    const d = { ...diffSyllables(e.draft, e.next), nextText: e.next.normalize('NFC') };
    // context from the DRAFT (as score.py's read-off), so the correction's other ya-btags spellings do not prime the judge
    const iOf = new Map(d.pairs.filter(([i, j]) => i !== null && j !== null).map(([i, j]) => [j, i]));
    const ctx = (i) => ({ before: d.A.slice(Math.max(0, i - 4), i).map((x) => x.syl).join('་'), after: d.A.slice(i + 1, i + 5).map((x) => x.syl).join('་') });
    const items = e.hits.map((h) => ({ kind: 'hit', k: h.k, j: h.j, base: h.draft, arm: h.next, line: lineOf(d.nextText, d.B[h.j].start), ...ctx(iOf.get(h.j)) }));
    items.push(...controls(d, rng));
    reqs.push({ uid: e.page_id, image: e.image, prompt: buildPrompt(items, rng) });
    key[e.page_id] = { book_id: e.book_id, page_number: e.page_number, hits: e.hits.map(({ k, j, draft, next }) => ({ k, j, draft, next })), items };
  }
  writeJsonl(arg('req'), reqs);
  fs.writeFileSync(arg('key'), JSON.stringify(key));
  console.log(`yatags-req: ${reqs.length} pages, ${Object.values(key).reduce((s, k) => s + k.hits.length, 0)} changes`);
} else if (CMD === 'yatags-verdicts') {
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const replies = Object.fromEntries(readJsonl(arg('replies')).filter((r) => r.text).map((r) => [r.uid, r]));
  const rows = [], t = { pages: 0, hits: 0, kept: 0, base: 0, other: 0, unclear: 0, unanswered: 0, ctl: 0, ctl_right: 0, no_reply: 0 };
  for (const [pid, k] of Object.entries(key)) {
    const r = replies[pid];
    if (!r) { t.no_reply++; continue; }
    const ans = parseReply(r.text);
    const keep = [], answers = [];
    for (const it of k.items) {
      const s = sideOf(it, ans[it.item]);
      if (it.kind === 'control') { t.ctl++; if (s === 'base') t.ctl_right++; continue; }
      t.hits++; answers.push({ k: it.k, seen: s, said: ans[it.item]?.seen ?? null });
      if (s === 'arm') { keep.push(it.k); t.kept++; } else if (s === 'base') t.base++; else if (s === 'other') t.other++; else if (s === 'unclear') t.unclear++; else t.unanswered++;
    }
    t.pages++;
    rows.push({ page_id: pid, hits: k.hits, keep, checked_by: `claude -p ${r.model} (${r.model_resolved ?? '?'}) ${r.date}`, answers });
  }
  if (process.argv.includes('--append')) fs.appendFileSync(arg('out'), rows.map((r) => JSON.stringify(r) + '\n').join('')); else writeJsonl(arg('out'), rows);
  console.log(JSON.stringify(t));
} else if (CMD === 'audit-req') {
  const DIR = arg('dir'), N = Number(arg('n') || 40), seed = arg('seed') || '6560';
  const SEV = process.argv.includes('--severity');
  const ONLY = arg('only') ? new Set(JSON.parse(fs.readFileSync(arg('only'), 'utf8'))) : null;
  const verdicts = new Map(readJsonl(arg('verdicts')).map((v) => [v.page_id, v]));
  const metas = fs.readdirSync(DIR).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).filter((m) => m.mode === 'correct' && m.exit === 0 && !m.wrapper && (!ONLY || ONLY.has(m.page_id)));
  // --drafts=F (JSONL {key, text}): the drafts as they were before a write, for an audit run after the apply
  // (#6740 rolling audit: the stored OCR is then the correction itself).
  let pages;
  if (arg('drafts')) pages = new Map(readJsonl(arg('drafts')).map((r) => [r.key, { id: r.key, ocr: { data: r.text } }]));
  else {
    const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
    pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: metas.map((m) => m.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
    await c.close();
  }
  const cands = [];
  for (const m of metas.sort((a, b) => a.page_number - b.page_number)) {
    const draft = m.draft && pages.get(m.page_id)?.ocr?.data;
    let text = fs.readFileSync(path.join(DIR, `${m.page_id}.txt`), 'utf8').trim();
    if (!draft || !text) continue;
    const hits = yatagsHits(draft, text);
    if (hits.length) { const v = verdicts.get(m.page_id); if (!v) continue; text = revertHits(text, hits, new Set(v.keep)); }
    const d = { ...diffSyllables(draft, text), nextText: text.normalize('NFC') };
    if (!d.hunks.length || d.changed / Math.max(1, d.draftN) > 0.25) continue;
    cands.push({ m, d, hits, kept: hits.length ? verdicts.get(m.page_id).keep : [] });
  }
  // --changed=F: every page apply would write with a change (the volume's re-translation list when --mark-stale is off)
  if (arg('changed')) fs.writeFileSync(arg('changed'), JSON.stringify(cands.map((x) => x.m.page_id)));
  // --pages=F (JSON ids): judge exactly these pages, no draw. --spans=F (diffqa.mjs spans JSONL): only their RISKY hunks.
  const onlyPages = arg('pages') ? new Set(JSON.parse(fs.readFileSync(arg('pages'), 'utf8'))) : null;
  const risky = arg('spans') ? readJsonl(arg('spans')).filter((x) => x.cls === 'RISKY').reduce((m, x) => m.set(x.page_id, (m.get(x.page_id) || new Set()).add(x.k)), new Map()) : null;
  const rng0 = rngFor(`6560|audit|${seed}`);
  const pick = onlyPages ? cands.filter((c) => onlyPages.has(c.m.page_id) && (!risky || risky.has(c.m.page_id))) : shuffle([...cands], rng0).slice(0, N);
  const reqs = [], key = {};
  for (const { m, d, hits, kept } of pick) {
    const rng = rngFor(`6560|audit|${seed}|${m.page_id}`);
    const items = d.hunks.map((h, hunk) => ({ h, hunk })).filter(({ hunk }) => !risky || risky.get(m.page_id)?.has(hunk)).map(({ h, hunk }) => {
      const j0 = h.b.length ? h.b[0] : (d.pairs.find(([i, j]) => i !== null && i > h.a[h.a.length - 1] && j !== null)?.[1] ?? d.B.length);
      const off = d.B[h.b[0]]?.start ?? d.B[j0]?.start ?? d.nextText.length;
      const prevJ = h.b.length ? h.b[0] - 1 : j0 - 1;
      const nextJ = h.b.length ? h.b[h.b.length - 1] + 1 : j0;
      // a kept ya-btags change, so the audit judge's answer can be set beside the guard judge's
      const hit = h.a.length === 1 && h.b.length === 1 ? hits.find((x) => x.j === h.b[0] && kept.includes(x.k)) : null;
      return { kind: 'span', hunk, base: h.a.map((i) => d.A[i].syl).join('་'), arm: h.b.map((j) => d.B[j].syl).join('་'), line: lineOf(d.nextText, off),
        before: d.B.slice(Math.max(0, prevJ - 3), prevJ + 1).map((x) => x.syl).join('་'), after: d.B.slice(nextJ, nextJ + 4).map((x) => x.syl).join('་'),
        ...(hit && { yatags_k: hit.k }) };
    });
    items.push(...controls(d, rng));
    reqs.push({ uid: m.page_id, image: path.join(DIR, `ws-${m.page_id}`, `${m.page_id}.jpg`), prompt: buildPrompt(items, rng, { severity: SEV }) });
    // draft and written: the whole-page judge (page-req) reads each of them against the image
    key[m.page_id] = { book_id: m.book_id, page_number: m.page_number, changed: d.changed, draftN: d.draftN, items, draft: pages.get(m.page_id).ocr.data, written: d.nextText, severity: SEV };
  }
  writeJsonl(arg('req'), reqs);
  fs.writeFileSync(arg('key'), JSON.stringify(key));
  console.log(`audit-req: ${cands.length} changed pages apply would write; sampled ${pick.length}; ${reqs.reduce((s, r) => s + (r.prompt.match(/\n\d+\. line/g) || []).length, 0)} items`);
} else if (CMD === 'audit-score') {
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const replies = Object.fromEntries(readJsonl(arg('replies')).filter((r) => r.text).map((r) => [r.uid, r]));
  const pages = [], tot = { spans: 0, arm: 0, base: 0, other: 0, unclear: 0, unanswered: 0, ctl: 0, ctl_right: 0 };
  const audYat = {};
  // A severe draft-win is confirmed when a second judge (confirm-req) also saw the draft at that span.
  const conf = {};
  if (arg('confirm-key') && arg('confirm-replies')) {
    const ck = JSON.parse(fs.readFileSync(arg('confirm-key'), 'utf8'));
    const cr = Object.fromEntries(readJsonl(arg('confirm-replies')).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)]));
    for (const [pid, k] of Object.entries(ck)) for (const it of k.items) {
      if (it.kind === 'control') { conf[`${pid}|ctl`] ??= { n: 0, right: 0 }; conf[`${pid}|ctl`].n++; if (sideOf(it, cr[pid]?.[it.item]) === 'base') conf[`${pid}|ctl`].right++; continue; }
      conf[`${pid}|${it.orig_item}`] = cr[pid] ? sideOf(it, cr[pid][it.item]) ?? 'unanswered' : 'no_reply';
    }
  }
  const hasConf = Object.keys(conf).length > 0;
  for (const [pid, k] of Object.entries(key)) {
    const r = replies[pid];
    if (!r) { pages.push({ page_id: pid, page_number: k.page_number, no_reply: true }); continue; }
    const ans = parseReply(r.text);
    const p = { page_id: pid, page_number: k.page_number, book_id: k.book_id, changed: k.changed, arm: 0, base: 0, other: 0, unclear: 0, unanswered: 0, worse_spans: [],
      ...(k.severity && { severe_fixed: 0, severe_introduced: 0, severe_introduced_confirmed: 0, minor_fixed: 0, minor_introduced: 0, unlabelled: 0, severe_spans: [] }) };
    for (const it of k.items) {
      const s = sideOf(it, ans[it.item]);
      if (it.kind === 'control') { tot.ctl++; if (s === 'base') tot.ctl_right++; continue; }
      tot.spans++;
      const slot = s ?? 'unanswered';
      p[slot]++; tot[slot]++;
      if (s === 'base') p.worse_spans.push(`${it.base || '∅'}→${it.arm || '∅'} (line ${it.line}; leaf: ${ans[it.item]?.seen ?? ''})`);
      if (k.severity && (s === 'arm' || s === 'base')) {
        const dv = diffOf(ans[it.item]);
        if (!dv) p.unlabelled++;
        else p[`${dv}_${s === 'arm' ? 'fixed' : 'introduced'}`]++;
        if (dv === 'severe' && s === 'base') {
          const cv = conf[`${pid}|${it.item}`];
          if (cv === 'base') p.severe_introduced_confirmed++;
          p.severe_spans.push({ item: it.item, draft: it.base, correction: it.arm, line: it.line, leaf: ans[it.item]?.seen ?? null, confirm: cv ?? null });
        }
      }
      if (it.yatags_k !== undefined) audYat[`${pid}|${it.yatags_k}`] = s;
    }
    p.verdict = p.base > p.arm ? 'worse' : p.arm > p.base ? 'better' : 'same';
    pages.push(p);
  }
  const judged = pages.filter((p) => !p.no_reply);
  const worse = judged.filter((p) => p.verdict === 'worse').length;
  const out = { pages: pages.length, judged: judged.length, no_reply: pages.length - judged.length, better: judged.filter((p) => p.verdict === 'better').length, same: judged.filter((p) => p.verdict === 'same').length, worse,
    go: judged.length >= 38 && worse <= 2, spans: tot,
    ...(judged.some((p) => key[p.page_id].severity) && (() => {
      const sev = judged.filter((p) => key[p.page_id].severity);
      const intro = sev.filter((p) => p.severe_introduced > 0).length, introC = sev.filter((p) => p.severe_introduced_confirmed > 0).length;
      const sum = (f) => sev.reduce((a, p) => a + p[f], 0);
      // Derek's rule (#6740): a severe error introduced on fewer than 2 of 10 pages, i.e. under 20% of the audited pages.
      const bar = (x) => x < 0.2 * sev.length;
      return { severity: { pages: sev.length, severe_introduced_pages: intro, severe_introduced_pages_confirmed: hasConf ? introC : null,
        severe_fixed: sum('severe_fixed'), severe_introduced: sum('severe_introduced'), minor_fixed: sum('minor_fixed'), minor_introduced: sum('minor_introduced'), unlabelled: sum('unlabelled'),
        pages_with_severe_fixed: sev.filter((p) => p.severe_fixed > 0).length,
        confirm_controls: hasConf ? Object.entries(conf).filter(([k]) => k.endsWith('|ctl')).reduce((a, [, v]) => `${Number(a.split('/')[0]) + v.right}/${Number(a.split('/')[1]) + v.n}`, '0/0') : null,
        pass_one_judge: bar(intro), pass: hasConf ? bar(introC) : null } };
    })()), span_correction_right: tot.arm / Math.max(1, tot.arm + tot.base), span_correction_right_ci: wilson(tot.arm, tot.arm + tot.base),
    controls_right: `${tot.ctl_right}/${tot.ctl}`, page_rows: pages };
  // Two judges on the same items: the guard's judge and the audit's judge on the kept ya-btags changes they both saw.
  if (arg('guard-key') && arg('guard-replies')) {
    const gk = JSON.parse(fs.readFileSync(arg('guard-key'), 'utf8'));
    const gr = Object.fromEntries(readJsonl(arg('guard-replies')).filter((r) => r.text).map((r) => [r.uid, r]));
    const units = [];
    for (const [pid, k] of Object.entries(gk)) {
      const ans = gr[pid] ? parseReply(gr[pid].text) : {};
      for (const it of k.items) if (it.kind === 'hit' && `${pid}|${it.k}` in audYat) units.push({ cluster: k.book_id, values: [sideOf(it, ans[it.item]), audYat[`${pid}|${it.k}`]] });
    }
    const rel = judgeReliability(units, { level: 'nominal', rng: rngFor('6560|alpha') });
    out.judge_agreement = { ...rel, line: reliabilityLine('ya-btags leaf side (guard judge vs audit judge)', rel, 'changes') };
  }
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  const { page_rows, ...head } = out;
  console.log(JSON.stringify(head, null, 1));
  for (const p of page_rows.filter((x) => x.verdict === 'worse')) console.log('WORSE', p.page_number, p.page_id, p.worse_spans.join(' | '));
  for (const p of page_rows.filter((x) => x.severe_spans?.length)) console.log('SEVERE-INTRODUCED?', p.page_number, p.page_id, p.severe_spans.map((x) => `${x.draft || '∅'}→${x.correction || '∅'} (line ${x.line}; confirm: ${x.confirm ?? '-'})`).join(' | '));
} else if (CMD === 'confirm-req') {
  // The second judge on every severe draft-win: only those spans, a fresh A/B order and 2 fresh controls, the frame
  // plus four full-resolution tiles (tiles-req's cut), a fresh sealed Opus.
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const replies = Object.fromEntries(readJsonl(arg('replies')).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)]));
  const DIR = arg('dir');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: Object.keys(key) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const reqs = [], ckey = {};
  for (const [pid, k] of Object.entries(key)) {
    const ans = replies[pid]; if (!ans) continue;
    const pick = k.items.filter((it) => it.kind === 'span' && sideOf(it, ans[it.item]) === 'base' && diffOf(ans[it.item]) === 'severe');
    if (!pick.length) continue;
    const rng = rngFor(`6740|confirm|${pid}`);
    const items = pick.map(({ item, A_is, ...it }) => ({ ...it, orig_item: item }));
    const text = fs.readFileSync(path.join(DIR, `${pid}.txt`), 'utf8').trim();
    const draft = pages.get(pid)?.ocr?.data;
    if (draft) items.push(...controls({ ...diffSyllables(draft, text), nextText: text.normalize('NFC') }, rng));
    reqs.push({ uid: pid, image: path.join(DIR, `ws-${pid}`, `${pid}.jpg`), prompt: buildPrompt(items, rng) });
    ckey[pid] = { book_id: k.book_id, page_number: k.page_number, items };
  }
  writeJsonl(arg('req'), reqs);
  fs.writeFileSync(arg('ckey'), JSON.stringify(ckey));
  console.log(`confirm-req: ${reqs.length} pages, ${Object.values(ckey).reduce((s, k) => s + k.items.filter((i) => i.kind !== 'control').length, 0)} severe draft-wins`);
} else if (CMD === 'tiles-req') {
  // A second judge on the SAME items: the request as built, plus the frame cut into four overlapping tiles at full
  // resolution. The Read tool shows a 3888 px frame at about 2000 px, where a subscribed ya or a vowel sign can be too
  // small to see (the full-frame audit judge abstained on 46% of spans, 2026-10-15).
  const sharp = (await import('sharp')).default;
  const TILE_NOTE = '\n\nThe same frame is also cut into four overlapping tiles at full resolution: tile-ul.jpg (upper left), '
    + 'tile-ur.jpg (upper right), tile-ll.jpg (lower left) and tile-lr.jpg (lower right), in this folder. Open the tile '
    + 'that holds a spot to read small marks such as a subscribed letter or a vowel sign.';
  const out = [];
  for (const r of readJsonl(arg('req'))) {
    const dir = path.join(arg('tiles-dir'), r.uid);
    fs.mkdirSync(dir, { recursive: true });
    const img = sharp(r.image); const { width: W, height: H } = await img.metadata();
    const files = [];
    for (const [nm, x0, y0] of [['ul', 0, 0], ['ur', 0.45, 0], ['ll', 0, 0.45], ['lr', 0.45, 0.45]]) {
      const f = path.join(dir, `tile-${nm}.jpg`);
      if (!fs.existsSync(f)) await sharp(r.image).extract({ left: Math.round(x0 * W), top: Math.round(y0 * H), width: Math.round(0.55 * W), height: Math.round(0.55 * H) }).jpeg({ quality: 92 }).toFile(f);
      files.push(f);
    }
    out.push({ ...r, prompt: r.prompt + TILE_NOTE, extra_images: files });
  }
  writeJsonl(arg('out'), out);
  console.log(`tiles-req: ${out.length} requests`);
} else if (CMD === 'judges') {
  // Two judges on the same audit items: alpha per judged measure, and the GO rule on the pooled verdict.
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const load = (f) => Object.fromEntries(readJsonl(f).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)]));
  const J = [load(arg('a')), load(arg('b'))];
  const spanUnits = [], decisiveUnits = [], ctl = [{ right: 0, wrong: 0, unclear: 0 }, { right: 0, wrong: 0, unclear: 0 }];
  const pages = [];
  for (const [pid, k] of Object.entries(key)) {
    const p = { page_id: pid, page_number: k.page_number, arm: 0, base: 0, spans: 0, both_unclear: 0, worse_spans: [] };
    for (const it of k.items) {
      const s = J.map((j) => sideOf(it, j[pid]?.[it.item]));
      if (it.kind === 'control') { s.forEach((x, i) => { if (x === 'base') ctl[i].right++; else if (x === 'arm' || x === 'other') ctl[i].wrong++; else ctl[i].unclear++; }); continue; }
      spanUnits.push({ cluster: k.book_id, values: s.map((x) => x ?? 'unclear') });
      decisiveUnits.push({ cluster: k.book_id, values: s.map((x) => (x === 'arm' || x === 'base' ? x : null)) });
      // pooled: a span counts for the side a judge saw; two judges who saw opposite sides cancel out
      p.spans++;
      const seen = s.filter((x) => x === 'arm' || x === 'base');
      if (!seen.length) p.both_unclear++;
      else if (seen.every((x) => x === 'arm')) p.arm++;
      else if (seen.every((x) => x === 'base')) { p.base++; p.worse_spans.push(`${it.base || '∅'}→${it.arm || '∅'} (line ${it.line})`); }
    }
    p.verdict = p.base > p.arm ? 'worse' : p.arm > p.base ? 'better' : 'same';
    pages.push(p);
  }
  const rng = rngFor('6560|alpha|judges');
  const r1 = judgeReliability(spanUnits, { rng }), r2 = judgeReliability(decisiveUnits, { rng });
  const tot = pages.reduce((t, p) => ({ arm: t.arm + p.arm, base: t.base + p.base, spans: t.spans + p.spans, unclear: t.unclear + p.both_unclear }), { arm: 0, base: 0, spans: 0, unclear: 0 });
  const worse = pages.filter((p) => p.verdict === 'worse');
  const out = { pages: pages.length, better: pages.filter((p) => p.verdict === 'better').length, same: pages.filter((p) => p.verdict === 'same').length, worse: worse.length, go: worse.length <= 2,
    spans: tot, correction_right: tot.arm / Math.max(1, tot.arm + tot.base), correction_right_ci: wilson(tot.arm, tot.arm + tot.base), controls: ctl,
    alpha_span_answer: { ...r1, line: reliabilityLine('span answer (draft / correction / other / unclear)', r1, 'spans') },
    alpha_span_side: { ...r2, line: reliabilityLine('leaf side where both judges saw one (draft / correction)', r2, 'spans') },
    worse_pages: worse.map((p) => ({ page_number: p.page_number, page_id: p.page_id, spans: p.worse_spans })) };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ ...out, page_rows: pages }, null, 1));
  console.log(JSON.stringify(out, null, 1));
} else if (CMD === 'page-req') {
  // The second instrument (#6560 production gate, 2026-10-26): the route-judge whole-page judge (#6740,
  // route-judge-6740/judge.mjs judgePrompt, the prompt that judged the router cell), one output per call against the
  // image, on the SAME sampled pages: the draft and the text apply would write, each judged blind and on its own.
  const { judgePrompt } = await import('../../route-judge-6740/judge.mjs');
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const reqs = [];
  for (const [pid, k] of Object.entries(key)) {
    if (!k.draft || !k.written) throw new Error(`${pid}: key has no draft/written text (rebuild it with audit-req)`);
    const image = path.join(arg('dir'), `ws-${pid}`, `${pid}.jpg`);
    for (const [side, text] of [['draft', k.draft], ['written', k.written]])
      reqs.push({ uid: `${pid}|${side}`, image, prompt: judgePrompt({ task: 'ocr', lang: 'Tibetan', text }, 'the file ./page.jpg in your working directory (open it with Read before you answer)') });
  }
  writeJsonl(arg('req'), reqs);
  console.log(`page-req: ${reqs.length} requests (${reqs.length / 2} pages)`);
} else if (CMD === 'gate') {
  // The production gate (brief, 2026-10-26), fixed before the gate volume's data was seen:
  //   tiled span judge (audit-score over the tiles replies) and whole-page judge (page-req replies), per page.
  //   whole page: WORSE when fidelity drops, accept is lost or a wrong_text defect is added (judge.mjs made_worse);
  //   BETTER when fidelity rises and it is not worse; else SAME.
  //   pooled: the judges agree -> that verdict; worse against better -> same (they cancel, as span pooling did in
  //   #6758); one says same -> the other's verdict. A page a judge did not answer takes the other judge's verdict.
  //   PASS (gate, --n=40): pooled worse <= 4 AND better >= 3 x worse. Per volume (--n=10): STOP when pooled worse > 2.
  const span = JSON.parse(fs.readFileSync(arg('span'), 'utf8'));
  const sv = Object.fromEntries(span.page_rows.filter((p) => p.verdict).map((p) => [p.page_id, p.verdict]));
  const parseJ = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { const v = JSON.parse(m[0]); return typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 ? v : null; } catch { return null; } };
  const V = Object.fromEntries(readJsonl(arg('page-replies')).filter((r) => r.text).map((r) => [r.uid, parseJ(r.text)]));
  const wt = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const rows = [];
  for (const [pid, k] of Object.entries(key)) {
    const a = V[`${pid}|draft`], b = V[`${pid}|written`];
    let pv = null;
    if (a && b) {
      const d = Number(b.fidelity) - Number(a.fidelity);
      pv = d < 0 || (a.accept && !b.accept) || (!wt(a) && wt(b)) ? 'worse' : d > 0 ? 'better' : 'same';
    }
    const s = sv[pid] ?? null;
    const both = [s, pv].filter(Boolean);
    const pooled = !both.length ? null : both.length === 1 ? both[0] : s === pv ? s : s === 'same' ? pv : pv === 'same' ? s : 'same';
    rows.push({ page_id: pid, page_number: k.page_number, span: s, page: pv, pooled,
      ...(a && b && { fidelity: `${a.fidelity}->${b.fidelity}`, accept: `${a.accept}->${b.accept}`, wrong_text: `${wt(a)}->${wt(b)}`, note: b.reader_note }) });
  }
  const count = (f) => ({ better: rows.filter((r) => r[f] === 'better').length, same: rows.filter((r) => r[f] === 'same').length, worse: rows.filter((r) => r[f] === 'worse').length, judged: rows.filter((r) => r[f]).length });
  const n = Number(arg('n') || rows.length), P = count('pooled');
  const pass = n >= 40 ? P.worse <= 4 && P.better >= 3 * P.worse : P.worse <= 2;
  const out = { n: rows.length, rule: n >= 40 ? 'pooled worse <= 4/40 and better >= 3 x worse' : 'pooled worse <= 2/10', pass,
    span_judge: count('span'), page_judge: count('page'), pooled: P, rows };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  const { rows: _r, ...head } = out;
  console.log(JSON.stringify(head));
  for (const r of rows.filter((x) => x.pooled === 'worse')) console.log('WORSE', r.page_number, r.page_id, `span=${r.span} page=${r.page}`, r.fidelity ?? '', r.note ?? '');
} else if (CMD === 'severity-gate') {
  // Derek's rule (#6740, 2026-10-26), per page: errors FIXED vs INTRODUCED, by severity; a batch is written when a
  // severe error is introduced on fewer than 2 of 10 audited pages. A page has a severe error INTRODUCED when
  //   (a) the tiled span judge (audit-req --severity) saw the draft at a span it called severe, and the second judge
  //       (confirm-req) saw the draft there too, or
  //   (b) the whole-page judge (page-req) finds more wrong_text defects in the written text than in the draft, or one
  //       of a class the draft has none of: what
  //       the span judge cannot see, a line Flash dropped or doubled (#7477 p. 488, 78, 218).
  // FIXED is the mirror: a severe span where the leaf shows the correction, or a wrong_text defect only the draft has.
  const span = JSON.parse(fs.readFileSync(arg('span'), 'utf8'));
  const parseJ = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { const v = JSON.parse(m[0]); return typeof v.accept === 'boolean' ? v : null; } catch { return null; } };
  const V = arg('page-replies') ? Object.fromEntries(readJsonl(arg('page-replies')).filter((r) => r.text).map((r) => [r.uid, parseJ(r.text)])) : {};
  const wt = (v) => (v?.defects || []).filter((d) => d.severity === 'wrong_text');
  const rows = span.page_rows.filter((p) => !p.no_reply).map((p) => {
    const a = V[`${p.page_id}|draft`], b = V[`${p.page_id}|written`];
    // More wrong-text defects, or one of a class the other side has none of (a duplicate line removed and a line dropped
    // leaves the count level and changes the class).
    const cl = (v) => new Set(wt(v).map((d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2'));
    const more = (x, y) => wt(y).length > wt(x).length || [...cl(y)].some((c2) => !cl(x).has(c2));
    const pageAdded = !!(a && b && more(a, b)), pageFixed = !!(a && b && more(b, a));
    const spanIntro = p.severe_introduced_confirmed > 0, spanIntro1 = p.severe_introduced > 0;
    return { page_id: p.page_id, page_number: p.page_number, book_id: p.book_id,
      severe_introduced: spanIntro || pageAdded, severe_introduced_one_judge: spanIntro1 || pageAdded,
      severe_fixed: p.severe_fixed > 0 || pageFixed, span_severe_fixed: p.severe_fixed, span_severe_introduced: p.severe_introduced,
      span_severe_introduced_confirmed: p.severe_introduced_confirmed, minor_fixed: p.minor_fixed, minor_introduced: p.minor_introduced,
      page_wrong_text: a && b ? `${wt(a).length}->${wt(b).length}` : null, page_note: pageAdded ? wt(b).map((d) => `${d.class ?? d.code ?? ''} ${d.note ?? d.what ?? ''}`.trim()).join('; ') : null,
      severe_spans: p.severe_spans };
  });
  const n = rows.length, intro = rows.filter((r) => r.severe_introduced).length;
  const out = { n, rule: 'a severe error introduced on fewer than 2 of 10 pages (< 20%)', pass: n > 0 && intro < 0.2 * n,
    severe_introduced_pages: intro, severe_introduced_pages_one_judge: rows.filter((r) => r.severe_introduced_one_judge).length,
    pass_one_judge: n > 0 && rows.filter((r) => r.severe_introduced_one_judge).length < 0.2 * n,
    severe_fixed_pages: rows.filter((r) => r.severe_fixed).length, controls: span.controls_right, confirm_controls: span.severity?.confirm_controls ?? null,
    spans: span.severity ?? null, rows };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  const { rows: _r, ...head } = out;
  console.log(JSON.stringify(head));
  for (const r of rows.filter((x) => x.severe_introduced_one_judge)) console.log(r.severe_introduced ? 'SEVERE' : 'severe?(1 judge)', r.page_number, r.page_id, r.page_note ?? '', (r.severe_spans || []).map((x) => `${x.draft || '∅'}→${x.correction || '∅'} [${x.confirm ?? '-'}]`).join(' | '));
} else {
  console.error('usage: leafcheck.mjs yatags-req|yatags-verdicts|audit-req|audit-score|confirm-req|tiles-req|judges|page-req|gate|severity-gate (see the header)');
  process.exit(2);
}

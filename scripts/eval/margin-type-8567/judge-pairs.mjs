#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — its opusCall (claude -p, Read only, the image in the workspace),
// TAXONOMY and judgePrompt's accept/fidelity/defects questions are reused as they are, and this writes its key.json and
// verdicts-opus.jsonl so paired-arm.mjs check/score read the run unchanged. It does not fit as is: it judges one output a
// call and asks nothing about how margin notes and footnotes are TAGGED, which is the question of #8567. Here one call
// sees the image and both arms' reads as X/Y (seeded order) and lists the page's margin notes and footnotes from the
// image first, then says how each read tagged each one.
/**
 * Paired blind judge for the OCR margin-type prompt test (#8567).
 *
 *   node scripts/eval/margin-type-8567/judge-pairs.mjs packet --out=DIR --a=READDIR_A --b=READDIR_B --pages=pages.json --images=IMGDIR
 *   node scripts/eval/margin-type-8567/judge-pairs.mjs judge  --out=DIR [--concurrency=3]
 *   node scripts/eval/margin-type-8567/judge-pairs.mjs tally  --out=DIR
 *
 * packet: one call per page (kind item), five pages again with X/Y swapped (kind repeat: the noise floor), and two
 * wrong-page calls (an A read and a B read of OTHER pages, shown with this image: both must be refused).
 * judge: Opus through claude -p; raw replies in judge-raw.jsonl, per-side verdicts in verdicts-opus.jsonl.
 * tally: the pass bar of the brief: B's margin type right, B's footnotes in <footnote>, body-defect pages A vs B.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { opusCall, TAXONOMY } from '../route-judge-6740/judge.mjs';
import { parseJson } from '../translate-cli-lane-7075/sample.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
if (!OUT || !['packet', 'judge', 'tally'].includes(STAGE)) { console.error('usage: judge-pairs.mjs packet|judge|tally --out=DIR ...'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1) + '\n');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// mulberry32: a seeded order, so the packet is the same on a re-run
const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ARMS = { a: 'live-v19.1', b: 'cand-v19.2-margin' };
const TAGS = ['margin_printed', 'margin_handwritten', 'margin_unsure', 'margin_untyped', 'footnote', 'footnote_apparatus', 'note', 'body', 'other_tag', 'dropped'];

if (STAGE === 'packet') {
  const pages = JSON.parse(fs.readFileSync(arg('pages'), 'utf8'));
  const read = (dir, id) => { const f = path.join(dir, `${id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : ''; };
  const R = rng(8567);
  const calls = [], key = [];
  const add = (kind, p, x, y, extra = {}) => {
    const cid = `c${String(calls.length + 1).padStart(2, '0')}`;
    calls.push({ id: cid, kind, page_id: p.page_id, stratum: p.stratum, image_file: path.join(path.resolve(arg('images')), `${p.page_id}.jpg`), x: x.text, y: y.text, ...extra });
    for (const [side, s] of [['x', x], ['y', y]]) key.push({ id: `${cid}${side}`, judged_as: `${cid}${side}`, cell: 'ocr', route: ARMS[s.arm], kind, page_id: s.page_id ?? p.page_id, book_id: s.book_id ?? p.book_id, stratum: p.stratum, side });
  };
  const usable = pages.filter((p) => read(arg('a'), p.page_id) && read(arg('b'), p.page_id));
  for (const p of pages.filter((q) => !usable.includes(q))) console.log(`  not judged (an arm has no read): ${p.page_id}`);
  for (const p of usable) {
    const a = { arm: 'a', text: read(arg('a'), p.page_id) }, b = { arm: 'b', text: read(arg('b'), p.page_id) };
    const [x, y] = R() < 0.5 ? [a, b] : [b, a];
    add('item', p, x, y);
  }
  // repeats: five pages, one from each stratum first, the same two reads with X/Y swapped
  const firstCall = new Map(calls.map((c) => [c.page_id, c]));
  const pick = [];
  for (const s of ['printed', 'footnote', 'handwritten', 'control', 'printed']) { const c = usable.filter((p) => p.stratum === s && !pick.includes(p)); if (c.length) pick.push(c[Math.floor(R() * c.length)]); }
  for (const p of pick) {
    const ks = key.filter((k) => k.kind === 'item' && k.page_id === p.page_id);
    const xRoute = ks.find((k) => k.side === 'x').route;
    const a = { arm: 'a', text: read(arg('a'), p.page_id) }, b = { arm: 'b', text: read(arg('b'), p.page_id) };
    const [x, y] = xRoute === ARMS.a ? [b, a] : [a, b];
    add('repeat', p, x, y, { repeat_of: firstCall.get(p.page_id).id });
  }
  // wrong-page controls: this image, an A read and a B read of two other pages (different books)
  for (let i = 0; i < 2; i++) {
    const p = usable[Math.floor(R() * usable.length)];
    const others = usable.filter((q) => q.book_id !== p.book_id);
    const q1 = others[Math.floor(R() * others.length)], q2 = others.filter((q) => q !== q1)[Math.floor(R() * (others.length - 1))];
    const a = { arm: 'a', text: read(arg('a'), q1.page_id), page_id: p.page_id, book_id: p.book_id }, b = { arm: 'b', text: read(arg('b'), q2.page_id), page_id: p.page_id, book_id: p.book_id };
    const [x, y] = R() < 0.5 ? [a, b] : [b, a];
    add('wrong_page', p, x, y, { texts_from: [q1.page_id, q2.page_id] });
  }
  W('calls.json', calls);
  W('key.json', key);
  console.log(`${calls.length} calls: ${calls.filter((c) => c.kind === 'item').length} item, ${calls.filter((c) => c.kind === 'repeat').length} repeat, ${calls.filter((c) => c.kind === 'wrong_page').length} wrong_page`);
}

export function pairPrompt(c, imageRef) {
  return `You are checking two candidate transcriptions, X and Y, of one page of a historical book against the page image, for a library that publishes the transcription beside the image. The image is the only authority: read the leaf yourself, closely, and compare.

The page image is attached: ${imageRef}

The library's markup tells readers what kind of text they are reading. Relevant tags: <margin> (text in the side or top margin; it may carry type="printed", type="handwritten" or type="unsure"), <footnote> (a footnote printed at the foot of the page by the edition; <footnote type="apparatus"> for a critical apparatus), <note> (the transcriber's own remark, NOT text on the page), <header>, <page-num>, <sig>, <meta>, and plain body text.

CANDIDATE X:
"""
${c.x}
"""

CANDIDATE Y:
"""
${c.y}
"""

Do this in order.

1. From the IMAGE, list the page's marginal and foot-of-page material: every side note, marginal summary, marginal citation, marginal reference letter/number group, and every reader's handwritten annotation, ownership mark or library mark in a margin (kind "margin"); every footnote (kind "footnote"); a critical apparatus block (kind "apparatus", ONE item per apparatus block). Running line numbers or Stephanus/Bekker/section numbers down one margin count as ONE item per margin side. A running head or page number at the top is not an item. For each item say whether it is printed (typeset, part of the edition) or handwritten (a later hand, ink, pencil, stamp text written by hand), from what you SEE.
   Then for each item say how X and how Y rendered it, with one of: ${TAGS.join(', ')}.
   (margin_untyped = in <margin> with no type; margin_unsure = type="unsure"; footnote_apparatus = <footnote type="apparatus">; body = run into the main text; other_tag = some other tag such as <header> or <meta>; dropped = not in the candidate at all.)
   A page with no such material gets an empty list.

2. Judge each candidate's TRANSCRIPTION of everything else (body text, headings), the way a reader would: margin/footnote tagging is already scored in step 1, so do not count it again here.
   - accept: would a reader be served by publishing this candidate as the page's transcription (every line of the page, in order, the right words and numerals; spelling conventions and markup aside)? true or false.
   - fidelity: 1-5 (5 = faithful and complete, 4 = small slips that mislead no one, 3 = usable with real errors, 2 = substantially wrong or incomplete, 1 = not this page's text at all).
   - defects: every body-text defect, each tagged with ONE class code from this list (E2 only if nothing fits):
${TAXONOMY}
     with a short verbatim quote from the candidate and a severity: "cosmetic", "misleads" or "wrong_text" (says something the page does not: invented, duplicated, dropped, another page, a wrong word that changes the sense).

3. prefer: "X", "Y" or "same" — which would you publish, all things considered (tagging included)?

Answer with one JSON object only:
{"items": [{"what": "a few words locating it", "kind": "margin|footnote|apparatus", "hand": "printed|handwritten", "x": "<one of the codes>", "y": "<one of the codes>"}],
 "x": {"accept": bool, "fidelity": n, "defects": [{"class": "O6", "quote": "...", "severity": "misleads", "what": "..."}], "reader_note": "..."},
 "y": {"accept": bool, "fidelity": n, "defects": [], "reader_note": "..."},
 "prefer": "X|Y|same", "why": "one line"}`;
}

const okSide = (v) => v && typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 && Array.isArray(v.defects ?? []);
const parsePair = (t) => parseJson(t, (v) => Array.isArray(v.items) && okSide(v.x) && okSide(v.y));

if (STAGE === 'judge') {
  const calls = J('calls.json');
  const rawF = path.join(OUT, 'judge-raw.jsonl'), vF = path.join(OUT, 'verdicts-opus.jsonl');
  const done = new Set(jsonl(rawF).filter((r) => r.parsed).map((r) => r.id));
  const tries = new Map(); for (const r of jsonl(rawF)) if (!r.parsed) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = calls.filter((c) => !done.has(c.id) && (tries.get(c.id) ?? 0) < 3);
  console.log(`${todo.length} of ${calls.length} calls to judge`);
  let i = 0, stop = false;
  const one = async (c) => {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mt8567-'));
    try {
      fs.copyFileSync(c.image_file, path.join(ws, 'page.jpg'));
      const t0 = Date.now();
      const r = await opusCall(pairPrompt(c, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
      if (r.cls === 'quota') { console.log(`QUOTA at ${c.id}: ${r.text.slice(0, 160)}`); stop = true; return; }
      const v = parsePair(r.text);
      fs.appendFileSync(rawF, JSON.stringify({ id: c.id, kind: c.kind, page_id: c.page_id, model: r.model, cls: r.cls, parsed: v ?? null, raw: v ? undefined : String(r.text).slice(0, 800), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      if (v) for (const side of ['x', 'y']) fs.appendFileSync(vF, JSON.stringify({ id: `${c.id}${side}`, judge: 'opus', model: r.model, verdict: { accept: v[side].accept, fidelity: Number(v[side].fidelity), defects: v[side].defects || [] } }) + '\n');
      console.log(`  ${c.id} ${c.kind} ${c.page_id}: ${v ? `items ${v.items.length} prefer ${v.prefer} X ${v.x.accept}/${v.x.fidelity} Y ${v.y.accept}/${v.y.fidelity}` : `unparsed ${r.cls ?? ''}`} (${Math.round((Date.now() - t0) / 1000)}s)`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) process.exit(3);
}

if (STAGE === 'tally') {
  const calls = new Map(J('calls.json').map((c) => [c.id, c]));
  const key = J('key.json');
  const raw = new Map(jsonl(path.join(OUT, 'judge-raw.jsonl')).filter((r) => r.parsed).map((r) => [r.id, r.parsed]));
  const routeOf = (cid, side) => key.find((k) => k.judged_as === `${cid}${side}`).route;
  const serious = (v) => (v.defects || []).filter((d) => d.severity !== 'cosmetic' && d.class !== 'O12');
  const out = { per_page: [], margin: {}, footnote: {}, body: {}, prefer: { [ARMS.a]: 0, [ARMS.b]: 0, same: 0 }, controls: [], repeats: [] };
  for (const arm of Object.values(ARMS)) {
    out.margin[arm] = { notes: 0, type_right: 0, unsure: 0, untyped: 0, wrong_type: 0, not_margin: 0, by_hand: { printed: [0, 0], handwritten: [0, 0] } };
    out.footnote[arm] = { n: 0, in_footnote: 0, apparatus_typed: 0, as: {} };
    out.body[arm] = { pages: 0, accept: 0, defect_pages: 0, wrong_text_pages: 0, defects: 0 };
  }
  for (const [cid, v] of raw) {
    const c = calls.get(cid);
    const side = { x: routeOf(cid, 'x'), y: routeOf(cid, 'y') };
    if (c.kind === 'wrong_page') { out.controls.push({ id: cid, x: { route: side.x, accept: v.x.accept, fidelity: v.x.fidelity }, y: { route: side.y, accept: v.y.accept, fidelity: v.y.fidelity }, passed: !v.x.accept && !v.y.accept && v.x.fidelity <= 2 && v.y.fidelity <= 2 }); continue; }
    if (c.kind === 'repeat') continue;
    const row = { id: cid, page_id: c.page_id, stratum: c.stratum, items: v.items.length, prefer: v.prefer === 'same' ? 'same' : side[v.prefer?.toLowerCase()] ?? v.prefer, why: v.why };
    out.prefer[row.prefer] = (out.prefer[row.prefer] ?? 0) + 1;
    for (const s of ['x', 'y']) {
      const arm = side[s], M = out.margin[arm], F = out.footnote[arm], B = out.body[arm];
      for (const it of v.items) {
        const t = it[s];
        if (it.kind === 'margin') {
          M.notes++; const h = it.hand === 'handwritten' ? 'handwritten' : 'printed'; M.by_hand[h][1]++;
          if (t === `margin_${h}`) { M.type_right++; M.by_hand[h][0]++; } else if (t === 'margin_unsure') M.unsure++; else if (t === 'margin_untyped') M.untyped++; else if (t === 'margin_printed' || t === 'margin_handwritten') M.wrong_type++; else M.not_margin++;
        } else {
          F.n++; F.as[t] = (F.as[t] ?? 0) + 1;
          if (t === 'footnote' || t === 'footnote_apparatus') F.in_footnote++;
          if (it.kind === 'apparatus' && t === 'footnote_apparatus') F.apparatus_typed++;
        }
      }
      const ser = serious(v[s]);
      B.pages++; if (v[s].accept) B.accept++; if (ser.length) B.defect_pages++; if (ser.some((d) => d.severity === 'wrong_text')) B.wrong_text_pages++; B.defects += ser.length;
      row[arm] = { accept: v[s].accept, fidelity: v[s].fidelity, serious_defects: ser.map((d) => `${d.class}/${d.severity}: ${String(d.quote).slice(0, 60)}`), tags: v.items.map((it) => `${it.kind}:${it.hand}->${it[s]}`) };
    }
    out.per_page.push(row);
  }
  for (const [cid, v] of raw) {
    const c = calls.get(cid); if (c.kind !== 'repeat') continue;
    const o = raw.get(c.repeat_of); if (!o) continue;
    const side = { x: routeOf(cid, 'x'), y: routeOf(cid, 'y') }, oside = { x: routeOf(c.repeat_of, 'x'), y: routeOf(c.repeat_of, 'y') };
    const byArm = (vv, sd) => Object.fromEntries(['x', 'y'].map((s) => [sd[s], vv[s]]));
    const now = byArm(v, side), was = byArm(o, oside);
    out.repeats.push({ page_id: c.page_id, items: [o.items.length, v.items.length], prefer: [o.prefer === 'same' ? 'same' : oside[o.prefer?.toLowerCase()], v.prefer === 'same' ? 'same' : side[v.prefer?.toLowerCase()]],
      ...Object.fromEntries(Object.values(ARMS).map((a) => [a, { accept: [was[a].accept, now[a].accept], fidelity: [was[a].fidelity, now[a].fidelity], serious: [serious(was[a]).length, serious(now[a]).length] }])) });
  }
  const b = ARMS.b, a = ARMS.a;
  const rate = (k, n) => (n ? +(k / n).toFixed(3) : null);
  out.pass = {
    margin_type_right: { k: out.margin[b].type_right, n: out.margin[b].notes, rate: rate(out.margin[b].type_right, out.margin[b].notes), bar: 0.85 },
    footnote_in_tag: { k: out.footnote[b].in_footnote, n: out.footnote[b].n, rate: rate(out.footnote[b].in_footnote, out.footnote[b].n), bar: 0.8 },
    body_defect_pages: { a: out.body[a].defect_pages, b: out.body[b].defect_pages, n: out.body[b].pages, rule: 'B <= A; a one-page difference is noise at this n' },
  };
  out.pass.margin_type_right.ok = out.pass.margin_type_right.rate >= 0.85;
  out.pass.footnote_in_tag.ok = out.pass.footnote_in_tag.rate >= 0.8;
  out.pass.body_defect_pages.ok = out.body[b].defect_pages <= out.body[a].defect_pages + 1;
  out.pass.all = out.pass.margin_type_right.ok && out.pass.footnote_in_tag.ok && out.pass.body_defect_pages.ok;
  W('tally.json', out);
  console.log(JSON.stringify({ pass: out.pass, margin: out.margin, footnote: out.footnote, body: out.body, prefer: out.prefer, controls: out.controls.map((c) => c.passed) }, null, 1));
}

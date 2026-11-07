#!/usr/bin/env node
// PRIOR ART: none — earlier write-ups (#5919, #6728) quoted judge reasons, never an arm's page as a reader sees it.
// Looked in scripts/eval/notes-layer/ (by-eye-sheet.mts prints parser spans for a checker, not a reader view).
/**
 * #5942 Part B: five pages per arm as a reader would see them. $0.
 *   node scripts/eval/notes-layer-5942/render-examples.mjs > $JOB_SCRATCH/b/examples.md
 * T: today's inline form, notes on (a note shown where it stands, in ⟨angle quotes⟩; marks unwrapped).
 * S: the text, a superscript number after each anchored phrase, the notes listed below it (a layered reader).
 * P: the text alone. Each page excerpted to its first ~600 characters of text.
 */
import fs from 'node:fs';
import { makeRng } from '../lib/paired-stats.mjs';
import { W, readJsonl, layersOf, COMMENTARY_TYPES } from './arms.mjs';

const CUT = 600;
const pages = JSON.parse(fs.readFileSync(`${W}/pages.json`, 'utf8'));
const out = Object.fromEntries(['T', 'S', 'P'].map((a) => [a, new Map(readJsonl(`${W}/out/${a}.jsonl`).filter((r) => r.text).map((r) => [r.uid, r.text]))]));
const sup = (n) => String(n).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('');

function inlineT(raw) {
  const L = layersOf('T', raw);
  // Put each commentary annotation back after its phrase as ⟨type: body⟩; everything else stays out.
  const ins = [];
  for (const a of L.annotations) {
    if (a.kind !== 'commentary' || a.malformed || !COMMENTARY_TYPES.has(a.type) || !a.anchor) continue;
    const at = a.gap && L.body.startsWith(a.gap, a.anchor.end) ? a.anchor.end + a.gap.length : a.anchor.end;
    ins.push([at, ` ⟨${a.type === 'note' ? '' : a.type + ': '}${a.body}⟩`]);
  }
  ins.sort((x, y) => x[0] - y[0]);
  let s = '', pos = 0;
  for (const [at, t] of ins) { if (at > CUT) break; s += L.body.slice(pos, at) + t; pos = at; }
  return s + L.body.slice(pos, Math.max(pos, CUT)) + (L.body.length > CUT ? ' […]' : '');
}

function layeredS(raw) {
  const L = layersOf('S', raw);
  if (!L.ok) return `(reply was not valid JSON)\n\n${L.body.slice(0, CUT)}`;
  const notes = L.annotations.filter((a) => a.kind === 'commentary' && a.resolved && a.anchor.end <= CUT).sort((a, b) => a.anchor.end - b.anchor.end);
  let s = '', pos = 0;
  notes.forEach((a, i) => { s += L.text.slice(pos, a.anchor.end) + sup(i + 1); pos = a.anchor.end; });
  s += L.text.slice(pos, Math.max(pos, CUT)) + (L.text.length > CUT ? ' […]' : '');
  const list = notes.map((a, i) => `${i + 1}. *${a.anchor.exact}* — ${a.type === 'note' ? '' : `(${a.type}) `}${a.body}`).join('\n');
  const page = L.annotations.filter((a) => a.kind === 'page' && a.type === 'summary').map((a) => `Summary: ${a.body}`).join('\n');
  return `${s}\n\n**Notes**\n${list || '(none in this excerpt)'}${page ? `\n\n${page}` : ''}`;
}

const rng = makeRng(5942 + 31);
const pool = pages.filter((p) => ['T', 'S', 'P'].every((a) => out[a].has(p.uid)));
const chosen = [];
for (const lang of ['Latin', 'German', 'Greek', 'Chinese', null]) {
  const l = pool.filter((p) => (lang ? p.lang === lang : true) && !chosen.includes(p));
  chosen.push(l[Math.floor(rng() * l.length)]);
}
let md = '';
for (const p of chosen) {
  md += `#### ${p.uid} · ${p.lang} · ${p.title} p. ${p.page_number}\n\n`;
  md += `**T (today, notes on)**\n\n${inlineT(out.T.get(p.uid))}\n\n`;
  md += `**S (text + notes as their own layer)**\n\n${layeredS(out.S.get(p.uid))}\n\n`;
  md += `**P (plain)**\n\n${layersOf('P', out.P.get(p.uid)).body.slice(0, CUT)}${layersOf('P', out.P.get(p.uid)).body.length > CUT ? ' […]' : ''}\n\n---\n\n`;
}
process.stdout.write(md);

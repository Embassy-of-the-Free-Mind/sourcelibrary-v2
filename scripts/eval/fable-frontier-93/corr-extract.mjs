#!/usr/bin/env node
// PRIOR ART: /root/jobs/fable-translate/emend.py (#72 stage 1: a regex over <note> text that COUNTED notes in which an
// arm departs from the transcription; 48 Fable, 38 Opus on 50 pages). A regex can count them but not say WHAT the two
// readings are, which the image check needs, so this hands every note to a screen model that returns the two readings.
/**
 * #93 correction check, step 1 of 2: extract every note in which a translation says the transcription reads one thing
 * and it translated another. One sealed `claude -p --model sonnet` text call per page (a screen, JOB-HOSTS.md), all the
 * page's notes and metas from every arm shuffled together under opaque labels: the screen never sees an arm name.
 * A row is kept only when the transcription's reading it quotes is in the page's OCR.
 *
 *   node scripts/eval/fable-frontier-93/corr-extract.mjs --out=DIR --set=new|s1 [--concurrency=2]
 *     new: DIR/pages.jsonl + DIR/arms/{OPUS2,OPUSX,FABLE}.jsonl + LIVE;  s1: #72 stage 1 (/root/jobs/fable-translate/w)
 * Appends DIR/corr/extract-<set>.jsonl (one row per page call) and writes DIR/corr/notes-<set>.json (kept corrections).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { call, meterStop } from './judge-run.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out'), SET = arg('set');
if (!OUT || !['new', 's1'].includes(SET)) { console.error('--out=DIR --set=new|s1'); process.exit(2); }
const h = (s) => crypto.createHash('sha256').update(`f93c:${s}`).digest('hex');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
fs.mkdirSync(path.join(OUT, 'corr'), { recursive: true });
const S1 = '/root/jobs/fable-translate/w';

export function loadSet(set) {
  const pages = new Map();   // uid -> { lang, ocr, arms: { ARM: text } }
  if (set === 'new') {
    for (const r of jsonl(path.join(OUT, 'pages.jsonl'))) pages.set(r.uid, { lang: r.lang, ocr: r.ocr, arms: { LIVE: r.live } });
    for (const a of ['OPUS2', 'OPUSX', 'FABLE']) for (const r of jsonl(path.join(OUT, 'arms', `${a}.jsonl`))) if (r.text && pages.has(r.uid)) pages.get(r.uid).arms[a] = r.text;
  } else {
    const uids = JSON.parse(fs.readFileSync(path.join(S1, 'follow-up-uids.json'), 'utf8'));
    const recs = new Map(jsonl('/root/pareto-6182/xl/records.jsonl').filter((r) => uids[r.id]).map((r) => [r.id, r]));
    for (const [u, x] of Object.entries(uids)) pages.set(u, { lang: x.lang, ocr: recs.get(u).ocr_text, book_id: recs.get(u).book_id, arms: {} });
    for (const a of ['OPUS2', 'OPUSX', 'FABLE']) for (const r of jsonl(path.join(S1, 'arms', `${a}.jsonl`))) if (r.text && pages.has(r.uid)) pages.get(r.uid).arms[a] = r.text;
  }
  return pages;
}
const NOTE = /<(note|meta|warning)>([\s\S]*?)<\/\1>/g;
const norm = (s) => String(s || '').normalize('NFC').replace(/[֑-ׇً-ٰٟ]/g, '').replace(/\s+/g, '');

const prompt = (lang, ocr, notes) => `Below are the OCR transcription of one page of a historical ${lang} book and a list of notes that English translators of the page wrote. Some notes say that the transcription reads one thing and that the translator read or translated something else (an OCR error, a misprint, an emendation, a different reading of a damaged word). Find exactly those.

For EVERY note in the list, return one entry:
- "n": the note's label
- "departs": true only if the note says the translation follows a reading DIFFERENT from what the transcription has (a correction or emendation of the transcription). false for glosses, explanations, cross-references, notes that keep the transcription's reading, or notes that only say a passage is unclear.
- if departs is true, also:
  - "transcription_reading": the transcription's word or words, copied EXACTLY, character for character, from the TRANSCRIPTION below (not from the note, if they differ); keep it short: the word(s) in question, at most 8 words
  - "proposed_reading": the reading the translator followed, in the ${lang} script, if the note gives it or makes it plain; else null
  - "proposed_gloss": what the translator's reading means, in a few English words
  - "transcription_gloss": what the transcription's reading means or would mean, in a few English words (or "nonsense")
  - "count": 1, or more if one note corrects several separate places (then give the first; list the others in "others" as [{transcription_reading, proposed_reading, proposed_gloss, transcription_gloss}])

TRANSCRIPTION:
"""
${ocr}
"""

NOTES:
${notes.map((n) => `[${n.label}] ${n.text.replace(/\s+/g, ' ').trim()}`).join('\n')}

Answer with one JSON array only, no prose: [{"n": "...", "departs": false}, {"n": "...", "departs": true, "transcription_reading": "...", "proposed_reading": "...", "proposed_gloss": "...", "transcription_gloss": "...", "count": 1}]`;

const parseArr = (t) => { const m = String(t).match(/\[[\s\S]*\]/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const pages = loadSet(SET);
  const file = path.join(OUT, 'corr', `extract-${SET}.jsonl`);
  const done = new Set(jsonl(file).filter((r) => r.result).map((r) => r.uid));
  const todo = [...pages].filter(([u]) => !done.has(u));
  console.log(`${SET}: ${pages.size} pages, ${todo.length} to extract`);
  let stop = null, i = 0;
  const one = async ([uid, p]) => {
    const notes = [];
    for (const [arm, t] of Object.entries(p.arms)) { let k = 0; for (const m of t.matchAll(NOTE)) notes.push({ arm, k: k++, tag: m[1], text: m[2] }); }
    notes.sort((a, b) => h(`${uid}:${a.arm}:${a.k}`).localeCompare(h(`${uid}:${b.arm}:${b.k}`)));
    notes.forEach((n, j) => { n.label = `n${j + 1}`; });
    if (!notes.length) { fs.appendFileSync(file, JSON.stringify({ uid, notes: [], result: [] }) + '\n'); return; }
    if (meterStop()) { stop = meterStop(); return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f93x-'));
    try {
      let res = null, r = null;
      for (let t = 0; t < 2 && !res; t++) { r = await call(prompt(p.lang, p.ocr, notes), ws, 'sonnet'); if (r.cls === 'quota') { stop = 'quota'; return; } res = parseArr(r.text); }
      fs.appendFileSync(file, JSON.stringify({ uid, notes, result: res, models: r.models, usage: r.usage, list_usd: r.cost, raw: res ? undefined : r.text.slice(0, 400) }) + '\n');
      console.log(`  ${uid}: ${notes.length} notes, ${res ? res.filter((x) => x.departs).length : '?'} departs`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Number(arg('concurrency') || 2);
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`STOPPED: ${stop}`); process.exit(3); }
  // kept corrections
  const kept = [], dropped = [];
  for (const row of jsonl(file).filter((r) => r.result)) {
    const p = pages.get(row.uid), byLabel = new Map(row.notes.map((n) => [n.label, n]));
    for (const e of row.result.filter((x) => x.departs)) {
      const n = byLabel.get(e.n); if (!n) continue;
      for (const [j, c] of [e, ...(e.others || [])].entries()) {
        const rec = { set: SET, uid: row.uid, lang: p.lang, arm: n.arm, note_k: n.k, sub: j, note: n.text.trim(), transcription_reading: c.transcription_reading, proposed_reading: c.proposed_reading ?? null, proposed_gloss: c.proposed_gloss ?? null, transcription_gloss: c.transcription_gloss ?? null };
        (c.transcription_reading && norm(p.ocr).includes(norm(c.transcription_reading)) ? kept : dropped).push(rec);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'corr', `notes-${SET}.json`), JSON.stringify({ kept, dropped }, null, 1));
  const t = {}; for (const k of kept) t[k.arm] = (t[k.arm] ?? 0) + 1;
  console.log(`kept ${kept.length} (reading found in the OCR), dropped ${dropped.length}`, t);
}

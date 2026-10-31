#!/usr/bin/env node
// #6740 read-surface, Amendment 6.9: export dataset `read-surface-6740 v1` (one row per run × target page, every agy
// call, the panel and confirmation draws, the judge verdicts, the typed references split by licence).
//
// PRIOR ART: scripts/eval/export-refusal-census.mjs (manifest with sha256, CANARY.txt, DATASHEET.md beside the files;
//   its layout is kept) and the quality-v1 bundle of #5531 (references split by their own licence, our data CC BY-SA
//   4.0). Neither knows a factorial run or its calls.
//
//   node scripts/eval/read-surface-6740/dataset/export.mjs --work=DIR --confirm=DIR[,DIR] --out=DIR
// Writes DIR/{rows.jsonl.gz, calls.jsonl.gz, runs.json, panel.json, confirmation/, references/<licence>/refs.jsonl.gz,
// frame/, DATASHEET.md, SCHEMA.md, LICENSES.md, CANARY.txt, manifest.json}. Reads only files; no database, no model.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { CANARY_GUID, CANARY_TEXT } from '../../../lib/dataset-canary.mjs';
import { RATE } from '../score.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const WORK = path.resolve(arg('work'));
const OUT = path.resolve(arg('out'));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CONFIRMS = (arg('confirm', '') || '').split(',').filter(Boolean).map((d) => path.resolve(d));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const gz = (f, rows) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { level: 9 })); };
fs.mkdirSync(OUT, { recursive: true });

const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
const score = JSON.parse(fs.readFileSync(path.join(WORK, 'score.json'), 'utf8'));
const cacheSha = (id) => { const f = path.join(WORK, 'cache', `${id}.jpg`); return fs.existsSync(f) ? sha(fs.readFileSync(f)) : null; };

// ── rows: one per run × target page ──
const rows = [], calls = [], runsOut = [];
for (const [lang, L] of Object.entries(score.langs)) {
  const excluded = new Set(L.excluded.map((e) => e.slug));
  const T = new Map(panel.langs[lang].targets.map((t) => [t.slug, t]));
  for (const r of L.runs) {
    const dir = path.join(WORK, 'runs', lang, r.id);
    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    const unread = new Map(jsonl(path.join(dir, 'not-read.jsonl')).map((x) => [x.page_id, x]));
    runsOut.push({ lang, run: r.id, pages_a_call: r.ppc, long_edge: r.edge, thinking: r.think, live: r.live, pool: run.agy_home === 'default' ? 'default' : path.basename(run.agy_home), started_at: run.started_at, model: `gemini-3.8-flash-${r.think}`, pages_in_run: r.pages_in_run, pages_read: r.pages_read, pages_unread: r.pages_unread, calls: r.calls, tokens: r.tokens, cuts: r.cuts });
    for (const c of jsonl(path.join(dir, 'calls.jsonl'))) calls.push({ lang, run: r.id, call_id: c.call_id, ts: c.ts, book_id: c.book_id, pages: c.pages, page_ids: c.page_ids, model: c.model, secs: c.secs, refusal: c.cls, calls: c.calls, nudged: c.nudged, usage: c.usage });
    for (const p of r.targets) {
      const t = T.get(p.slug);
      const mf = path.join(dir, `${t.page_id}.meta.json`), m = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
      const txt = m && fs.existsSync(path.join(dir, `${t.page_id}.txt`)) ? fs.readFileSync(path.join(dir, `${t.page_id}.txt`), 'utf8') : null;
      if (!m?.call_id && m) calls.push({ lang, run: r.id, call_id: `${r.id}:${t.page_id}`, ts: m.finished_at, book_id: t.book_id, pages: [t.page_number], page_ids: [t.page_id], model: m.model, secs: Math.round((Date.parse(m.finished_at) - Date.parse(m.started_at)) / 1000), refusal: m.error_class, calls: m.calls, nudged: m.nudged, usage: m.usage });
      rows.push({
        lang, run: r.id, pages_a_call: r.ppc, long_edge: r.edge, thinking: r.think, pool: run.agy_home === 'default' ? 'default' : path.basename(run.agy_home), live: r.live,
        slug: p.slug, book_id: t.book_id, page_id: t.page_id, page_number: t.page_number, period: t.period, source: t.source, source_id: t.source_id, licence_reference: t.licence,
        in_analysis: !excluded.has(p.slug), exclusion: L.excluded.find((e) => e.slug === p.slug)?.why ?? null,
        image_url: m?.image_url ?? null, image_sha256_source: cacheSha(t.page_id), image_sha256_sent: m?.image_sha256 ?? null, image_fit: m?.image_fit ?? null,
        status: p.status, not_read_from: unread.get(t.page_id)?.from ?? null, refusal: m?.error_class ?? null, chatter: m?.chatter ?? null, write_guard: m?.write_guard ?? null,
        read_text: txt, cer: p.cer ?? null, cer_unwindowed: p.cer_free ?? null, identity_aligned: p.aligned ?? null, identity_guard: p.guard ?? null, wrong_text: p.wrong_text ?? null, loop: p.loop ?? null, cut: p.cut ?? null,
        call_id: m?.call_id ?? null, call_pages: m?.call_pages ?? 1, call_position: m?.call_position ?? null, calls: m?.calls ?? null, usage_of_call: m?.usage ?? null,
        wall_secs_of_call: m ? Math.round((Date.parse(m.finished_at) - Date.parse(m.started_at)) / 1000) : null,
      });
    }
  }
}
gz(path.join(OUT, 'rows.jsonl.gz'), rows);
gz(path.join(OUT, 'calls.jsonl.gz'), calls);
fs.writeFileSync(path.join(OUT, 'runs.json'), JSON.stringify({ rates_usd_per_token: RATE, runs: runsOut }, null, 1));
// The panel without typed text (it never held any): the draw, its windows, the reference's source id, letters, sha256.
fs.writeFileSync(path.join(OUT, 'panel.json'), JSON.stringify(panel, null, 1));

// ── references, split by licence ──
const LIC = { 'dta-cc-by-sa-4.0': 'cc-by-sa-4.0', 'dta-other:http://creativecommons.org/licenses/by-sa/3.0/de/': 'cc-by-sa-3.0-de', 'dta-other:http://creativecommons.org/licenses/by-sa/2.0/de/': 'cc-by-sa-2.0-de', 'dta-other:http://creativecommons.org/publicdomain/zero/1.0/': 'cc0-1.0', 'camena-cc-by-sa': 'cc-by-sa-camena' };
const refText = new Map(zlib.gunzipSync(fs.readFileSync(path.join(WORK, 'refs.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => { const x = JSON.parse(l); return [x.slug, x.ref_text]; }));
const byLic = {};
for (const L of Object.values(panel.langs)) for (const t of L.targets) {
  const lic = LIC[t.licence];
  const row = { slug: t.slug, source: t.source, source_id: t.source_id, typed_facs: t.typed_facs ?? null, typed_page: t.typed_page ?? null, ref_letters: t.ref_letters, ref_sha256: t.ref_sha256 ?? null, licence: t.licence };
  if (lic) (byLic[lic] ||= []).push({ ...row, ref_text: refText.get(t.slug) ?? null });
  else (byLic.pointer_only ||= []).push(row);
}
for (const [lic, rs] of Object.entries(byLic)) gz(path.join(OUT, 'references', lic, 'refs.jsonl.gz'), rs);

// ── frame (6.8), confirmations ──
for (const f of ['table.json', 'sample-de.json', 'sample-la.json', 'faces-de.jsonl', 'weights.json']) if (fs.existsSync(path.join(WORK, 'frame', f))) { fs.mkdirSync(path.join(OUT, 'frame'), { recursive: true }); fs.copyFileSync(path.join(WORK, 'frame', f), path.join(OUT, 'frame', f)); }
for (const d of CONFIRMS) {
  const name = path.basename(d);
  for (const f of ['sample.json', 'key.json', 'packet.json', 'written.json', 'score.json', 'verdicts-opus.jsonl']) if (fs.existsSync(path.join(d, f))) { fs.mkdirSync(path.join(OUT, 'confirmation', name), { recursive: true }); fs.copyFileSync(path.join(d, f), path.join(OUT, 'confirmation', name, f)); }
}

// ── documents ──
for (const f of ['DATASHEET.md', 'SCHEMA.md', 'LICENSES.md']) fs.copyFileSync(path.join(HERE, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'CANARY.txt'), `${CANARY_TEXT}\n`);
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f !== 'manifest.json') files.push(path.relative(OUT, p)); } };
walk(OUT);
const git = (() => { try { return execSync('git rev-parse HEAD', { cwd: HERE }).toString().trim(); } catch { return null; } })();
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ dataset: 'read-surface-6740', version: 'v1', built_at: new Date().toISOString(), git_sha: git, built_by: 'scripts/eval/read-surface-6740/dataset/export.mjs', canary: CANARY_GUID,
  counts: { rows: rows.length, calls: calls.length, runs: runsOut.length, references: Object.fromEntries(Object.entries(byLic).map(([k, v]) => [k, v.length])) },
  sha256: Object.fromEntries(files.sort().map((f) => [f, sha(fs.readFileSync(path.join(OUT, f)))])) }, null, 1));
console.log(`${rows.length} rows, ${calls.length} calls, ${runsOut.length} runs; references ${JSON.stringify(Object.fromEntries(Object.entries(byLic).map(([k, v]) => [k, v.length])))} -> ${OUT}`);

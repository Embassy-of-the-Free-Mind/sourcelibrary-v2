#!/usr/bin/env node
// #6740 read-surface: score every run of the Box-Behnken design against the typed references (the preregistered
// responses: CER, wrong text, loop/cut, production-equivalent agy calls a page, wall seconds a page, tokens).
//
// PRIOR ART: scripts/eval/euro-gpu-correct-7567/score.py (infix CER against typed references; this keeps its list of
//   header tags dropped with their content, and its loop/cut rule against the page's median arm); scripts/eval/lib/
//   metrics.mjs scoreAgainstReference (the windowed CER and the identity guard, used unchanged). score.py reads one
//   jsonl per arm and knows nothing of calls, blocks or pages left unread.
//
//   node scripts/eval/read-surface-6740/score.mjs --work=DIR [--out=FILE] [--frozen=results/exclusions-frozen.json]
// Amendment 6: --frozen keeps the panel's exclusions as they stood after the first 10 runs a language (new one-a-call
// runs do not re-open the "unreadable by the route" list), and every run carries its tokens by type, priced (usdOf).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { scoreAgainstReference } from '../lib/metrics.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const WORK = path.resolve(arg('work', '.'));
const OUTF = arg('out', path.join(WORK, 'score.json'));
const FROZEN = arg('frozen') && JSON.parse(fs.readFileSync(path.resolve(arg('frozen')), 'utf8'));
// Amendment 6.2: gemini-3.8-flash list rates (scripts/lib/model-pricing.mjs), US $ a token; cached input at 10 % of input
// (an assumption). agy's `output` already includes thinking, so thinking is not priced again.
export const RATE = { input: 0.75e-6, cached: 0.075e-6, output: 3.75e-6 };
export const usdOf = (t, { cachedAtFull = false } = {}) => (t.input - t.cache_read) * RATE.input + t.cache_read * (cachedAtFull ? RATE.input : RATE.cached) + t.output * RATE.output;
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// The read's header and apparatus, dropped with their content: the typed body has no running head, page number,
// catchword, signature or notes (the panel takes typed pages with no notes), so neither may the read.
const DROP = 'scan-quality|language|script|page-type|page-num|header|meta|vocab|margin|footnote|note|warning|columns|image-desc|header-type|signature|catchword';
export function bodyOf(t) {
  t = t || '';
  t = t.replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  // The live prompt's centring marks (->Margarethe.<-) first: left in, `<- … ->` reads as a tag and eats the text
  // between two centred lines (eval-design §6, "->TITLE<- ate a page body"; seen on Faust here, CER 0.88 → 0).
  t = t.replace(/->|<-/g, ' ');
  t = t.replace(new RegExp(`<(${DROP})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ');
  t = t.replace(new RegExp(`<(${DROP})\\b[^>]*/?>`, 'gi'), ' ');
  t = t.replace(/<[^>\n]{1,200}>/g, ' ');
  t = t.replace(/[-¬⸗=]\s*\n\s*/g, '');   // a word broken at a line end is one word (the typed text joins them)
  return t;
}
const letters = (t) => (t.normalize('NFC').toLowerCase().match(/\p{L}|\p{N}/gu) || []).length;

// Run only when called as a script (prior-score.mjs imports bodyOf).
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();

function main() {
  const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(WORK, 'runs.json'), 'utf8'));
  const refs = new Map(zlib.gunzipSync(fs.readFileSync(path.join(WORK, 'refs.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.slug, r.ref_text]; }));

  // By-eye check of each target image (eye/verdicts-<lang>.jsonl: face, leaf_match). A leaf that is not the typed page
  // (eval-design §4.1: no reference without a leaf check) leaves every run.
  const eye = new Map();
  for (const lang of Object.keys(panel.langs)) {
    const items = JSON.parse(fs.readFileSync(path.join(WORK, 'eye', `items-${lang}.json`), 'utf8'));
    const v = new Map(jsonl(path.join(WORK, 'eye', `verdicts-${lang}.jsonl`)).map((r) => [r.item, r]));
    for (const it of items) eye.set(it.slug, v.get(it.item) || null);
  }
  const out = { scored_at: new Date().toISOString(), scorer: 'metrics.mjs scoreAgainstReference latin, windowed; read body per score.mjs bodyOf', langs: {} };
  for (const lang of Object.keys(panel.langs)) {
    const targets = panel.langs[lang].targets;
    const runs = [];
    for (const run of plan.runs[lang]) {
      const dir = path.join(WORK, 'runs', lang, run.id);
      if (!fs.existsSync(path.join(dir, 'page-ids.json'))) continue;
      const ids = JSON.parse(fs.readFileSync(path.join(dir, 'page-ids.json'), 'utf8'));
      const exits = jsonl(path.join(dir, 'exits.jsonl'));
      const unread = new Map(jsonl(path.join(dir, 'not-read.jsonl')).map((r) => [r.page_id, r.from]));
      // Calls this job killed by mistake (killed-calls.jsonl) are not a cost of the setting: dropped.
    const killed = new Set(jsonl(path.join(WORK, 'killed-calls.jsonl')).map((k) => `${k.call_id}|${k.ts}`));
    const blockCalls = jsonl(path.join(dir, 'calls.jsonl')).filter((c) => !killed.has(`${c.call_id}|${c.ts}`));
      let calls = 0, secs = 0, read = 0, missing = 0;
      const tok = { input: 0, output: 0, thinking: 0, cache_read: 0, no_usage: 0 };
      const T0 = () => ({ input: 0, output: 0, thinking: 0, cache_read: 0, no_usage: 0 });
      // A call with no recorded usage is counted (no_usage); fit.mjs prices it at the run's mean for a call of its size.
      const addTo = (t, u, n = 1) => { const xs = (u || []).filter(Boolean); if (xs.length < n) t.no_usage += n - xs.length; for (const x of xs) { t.input += x.input || 0; t.output += x.output || 0; t.thinking += x.thinking || 0; t.cache_read += x.cache_read || 0; } };
      const addUsage = (u, n) => addTo(tok, u, n);
      let cuts = 0;
      // Per book (each book's window is its own block, so calls, seconds and pages split cleanly by book).
      const byBook = {};
      const bk = (b) => (byBook[b] ||= { calls: 0, secs: 0, pages: 0, unread: 0, thinking: 0, tokens: T0(), cuts: 0 });
      const thinkOf = (u) => (u || []).reduce((a, x) => a + (x?.thinking || 0), 0);
      for (const c of blockCalls) { calls += c.calls; secs += c.secs; addUsage(c.usage, c.calls); const b = bk(c.book_id); b.calls += c.calls; b.secs += c.secs; b.thinking += thinkOf(c.usage); addTo(b.tokens, c.usage, c.calls); if (c.cls) { cuts++; b.cuts++; } }
      for (const r of jsonl(path.join(dir, 'not-read.jsonl'))) bk(r.book_id).unread++;
      const metas = new Map();
      for (const id of ids) {
        const mf = path.join(dir, `${id}.meta.json`);
        if (!fs.existsSync(mf)) { if (!unread.has(id)) missing++; continue; }
        const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
        metas.set(id, m);
        read++;
        // A page read alone (1 a call, or a remainder) carries its own calls; a block's pages carry the block's.
        if (!m.call_id) { const sec = (Date.parse(m.finished_at) - Date.parse(m.started_at)) / 1000; calls += m.calls || 0; secs += sec; addUsage(m.usage, m.calls || 0); const b = bk(m.book_id); b.calls += m.calls || 0; b.secs += sec; b.thinking += thinkOf(m.usage); addTo(b.tokens, m.usage, m.calls || 0); if (m.error_class || m.chatter) { cuts++; b.cuts++; } }
      }
      for (const t of targets) bk(t.book_id).pages += run.ppc;
      const pages = targets.map((t) => {
        const m = metas.get(t.page_id);
        const base = { slug: t.slug, book_id: t.book_id };
        if (!m) return { ...base, status: unread.has(t.page_id) ? `unread:${unread.get(t.page_id)}` : 'missing' };
        // Amendment 1: a read cli-ocr's own guards refuse (a Gemini filter stub, a restarted or cut reply) is not
        // usable: apply would never write it, so it counts as a page the setting did not deliver, not as a misread.
        if (m.chatter || ['truncated', 'loop', 'empty'].includes(m.write_guard)) return { ...base, status: 'unusable', chatter: m.chatter, write_guard: m.write_guard };
        const txt = fs.readFileSync(path.join(dir, `${t.page_id}.txt`), 'utf8');
        const body = bodyOf(txt);
        if (!body.trim()) return { ...base, status: 'empty', exit: m.exit, error_class: m.error_class };
        const s = scoreAgainstReference(refs.get(t.slug), body, 'latin');
        const cerW = s.charAccuracyWindowed == null ? 1 : Math.min(1, Math.max(0, 1 - s.charAccuracyWindowed));
        return { ...base, status: 'read', cer: cerW, cer_free: Math.min(1, 1 - s.charAccuracy), aligned: s.aligned, guard: s.guard?.value ?? null, letters: letters(body), fit: m.image_fit ?? null, call_position: m.call_position ?? null, block_fallback: m.block_fallback ?? null };
      });
      runs.push({ id: run.id, phase: run.phase, x1: run.x1, x2: run.x2, x3: run.x3, ppc: run.ppc, edge: run.edge, think: run.think, live: run.live,
        finished: exits.some((e) => e.code === 0), pages_in_run: ids.length, pages_read: read, pages_unread: unread.size, pages_missing: missing,
        calls, secs: Math.round(secs), tokens: tok, usd: usdOf(tok), cuts, agy_home: (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).agy_home; } catch { return null; } })(), by_book: byBook, targets: pages });
    }
    // Loop / cut against the page's median over runs (score.py's rule); wrong text = guard failed where most runs pass.
    for (const t of targets) {
      const rows = runs.map((r) => r.targets.find((p) => p.slug === t.slug)).filter((p) => p?.status === 'read');
      const med = rows.map((p) => p.letters).sort((a, b) => a - b)[rows.length >> 1] || 0;
      const passShare = rows.length ? rows.filter((p) => p.aligned).length / rows.length : 0;
      for (const p of rows) {
        p.loop = med > 0 && p.letters > 2 * med; p.cut = med > 0 && p.letters < 0.5 * med;
        p.wrong_text = passShare > 0.5 && !p.aligned;
      }
      t._pass_share = passShare;
    }
    // Amendment 1: a target no 1-a-call run read usably cannot be read by this route at all (production leaves it
    // scans-only); it leaves the CER analysis and is counted as unreadable.
    const oneRuns = runs.filter((r) => r.ppc === 1 && r.finished);
    const unreadable = oneRuns.length ? targets.filter((t) => oneRuns.every((r) => r.targets.find((p) => p.slug === t.slug)?.status !== 'read')).map((t) => t.slug) : [];
    const excluded = FROZEN?.[lang] ? FROZEN[lang] : [
      ...targets.filter((t) => eye.get(t.slug)?.leaf_match === 'no').map((t) => ({ slug: t.slug, why: `by eye: the image is not the typed page (${eye.get(t.slug).note})` })),
      ...unreadable.filter((sl) => eye.get(sl)?.leaf_match !== 'no').map((sl) => ({ slug: sl, why: 'unreadable by the route: no usable read in any 1-a-call run (Gemini filter cut or a refused reply)' })),
      ...targets.filter((t) => eye.get(t.slug)?.leaf_match !== 'no' && !unreadable.includes(t.slug) && runs.length >= 3 && t._pass_share <= 0.5).map((t) => ({ slug: t.slug, pass_share: t._pass_share, why: 'most runs fail the identity guard: a reference or leaf problem, not a read' })),
    ];
    if (FROZEN) for (const sl of unreadable) if (!excluded.some((e) => e.slug === sl)) console.log(`${lang}: ${sl} would now be unreadable by the route; frozen list kept (Amendment 6)`);
    const faces = Object.fromEntries(targets.map((t) => [t.slug, eye.get(t.slug)?.face ?? null]));
    out.langs[lang] = { n_targets: targets.length, excluded, faces, runs };
  }
  fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
  for (const [lang, L] of Object.entries(out.langs)) {
    console.log(`${lang}: excluded ${L.excluded.length} (${L.excluded.map((e) => e.slug).join(', ')})`);
    const ex = new Set(L.excluded.map((e) => e.slug));
    for (const r of L.runs) {
      const rs = r.targets.filter((p) => p.status === 'read' && !ex.has(p.slug));
      const mean = rs.length ? rs.reduce((a, p) => a + p.cer, 0) / rs.length : NaN;
      const med = rs.map((p) => p.cer).sort((a, b) => a - b)[rs.length >> 1];
      console.log(`  ${r.id.padEnd(4)} ppc ${r.ppc} edge ${String(r.edge ?? 'srv').padEnd(4)} ${r.think.padEnd(6)} ${r.finished ? 'done' : 'part'}  read ${r.pages_read}/${r.pages_in_run} unread ${r.pages_unread} miss ${r.pages_missing}  calls ${r.calls}  $/1k ${(1000 * r.usd / r.pages_in_run).toFixed(2)}${r.tokens.no_usage ? ` (${r.tokens.no_usage} no usage)` : ''}  targets ${rs.length}  CER mean ${(100 * mean).toFixed(2)}% med ${(100 * (med ?? NaN)).toFixed(2)}%  wrong ${rs.filter((p) => p.wrong_text).length}`);
    }
  }
}

#!/usr/bin/env node
// PRIOR ART: ./judge.mjs score (accept k/n, wrong-text PAGES k/n, classes k/n, made_worse by fidelity / accept / a
// wrong-text page added) and scripts/eval/estimator/router-table/build.py (Beta-binomial on accepted k of n, the
// wrong-text page bar). Both count PAGES: a page with one misleading number and a page with ten count the same, and a
// page's size does not enter. This re-reads the same stored verdicts and counts DEFECTS per 1,000 words by severity;
// it makes no model call and changes neither. scripts/eval/judge-planted-7611/run.mjs scores the planted items as
// "caught = not accepted OR named"; here the positive control asks the narrower question: is the planted span QUOTED
// in a defect, and at what severity. Searched: `gh issue list --search "defect rate router"`, `gh pr list --search
// severity`, scripts/eval/INDEX.md, scripts/eval/estimator/: no per-word defect rate existed (#6740).
/**
 * Defect rates from stored judge verdicts (#6740, job defect-rate-6740). Stage 1 of 2 (stage 2: defect-rate.py).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/defect-rate.mjs inventory --out=DIR
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/defect-rate.mjs recheck --out=DIR [--per=40] [--concurrency=4]
 *
 * RECHECK (Derek's steer, 2026-10-30: "calibrate before weighting"): 40 OCR defects tagged misleads and 40 tagged
 * wrong_text, drawn round-robin across defect classes (seeded, one defect a page), each re-read by a FRESH Opus call that
 * sees only the quoted span and the leaf, never the judge's verdict or reason. Writes DIR/recheck.jsonl; the relabel
 * rate is computed in defect-rate.py. Paced like judge.mjs (model-limits claudeBlocked, ROUTE_JUDGE_WEEKLY_MAX).
 *
 * Reads every stored verdict that carries the route judge's schema (accept, fidelity 1-5, defects[{class, quote,
 * severity cosmetic|misleads|wrong_text}]):
 *   - scripts/eval/route-judge-6740/results/<run>/verdicts-opus.jsonl.gz with its key.json (lane-accept: sample.json.gz)
 *   - scripts/eval/agy-ocr-per-call-6740 (judge-key.json), scripts/eval/siku-percall-5600 (judge-key-all.json)
 *   - Mongo lane_judge_verdicts (the #7611 lane sampler's store)
 *   - scripts/eval/judge-planted-7611 and the Tibetan planted items: the positive control only
 * and, per keyed row, the CANDIDATE TEXT the judge read, to count its words. The text comes from, in order: the run's
 * packet.json in any job scratch dir on this box (/root/jobs/<job>/**), the files that built the packet (corr/ reads,
 * kept reads in the repo, Mongo pages and page_revisions), each accepted only when it reproduces the verdict's id
 * (judge.mjs: j + sha256(`cell:page:sha256(text.trim())`)) or the store's text_hash. A row whose own text cannot be
 * recovered takes the word count of another text of the same page (words_src: page) and says so; none: no words.
 *
 * Words: tags that are not page content (<scan-quality>, <language>, <script>, <page-type>, <page-num>, <meta>, <note>,
 * <image-desc>) are dropped with their content, other tags are dropped and their content kept. A word is a
 * whitespace token with a letter or digit; Chinese / Japanese: one Han character; Tibetan: one syllable (tsheg).
 * Rates are therefore comparable WITHIN a script, not across scripts.
 *
 * Writes DIR/rows.jsonl.gz (one row per keyed item: the verdict's defect counts, words, provenance; quotes kept for
 * the controls and the correction-introduced check) and DIR/coverage.json. Read-only: no writes anywhere but DIR.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || '/tmp', 'defect-rate'));
const RJ = path.join(ROOT, 'scripts/eval/route-judge-6740/results');
const JOBS = arg('jobs') || '/root/jobs';
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ch16 = (t) => h(t || '').slice(0, 16);   // write-provenance.mjs contentHash
const rd = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8'));
const jl = (f) => rd(f).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const js = (f) => JSON.parse(rd(f));
const ex = (f) => fs.existsSync(f);
const SEV = ['cosmetic', 'misleads', 'wrong_text'];
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';

// ---- words --------------------------------------------------------------------------------------------------------
const NONCONTENT = /<(scan-quality|language|script|page-type|page-num|meta|note|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi;
export function words(t) {
  if (!t) return 0;
  const b = String(t).replace(NONCONTENT, ' ').replace(/<[^>]*>/g, ' ').replace(/^\s*#+\s*/gm, ' ').replace(/\|/g, ' ');
  const han = (b.match(/[㐀-鿿豈-﫿\u{20000}-\u{2ffff}]/gu) || []).length;
  const tib = (b.match(/[ཀ-ྼ]/g) || []).length;
  const lat = (b.match(/\p{L}/gu) || []).length - han - tib;
  if (han > lat && han >= tib) return han;
  if (tib > lat) return b.split(/[་།༎\s]+/).filter((x) => /[ཀ-ྼ]/.test(x)).length;
  return b.split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
}

// ---- the judge prompt's versions (git log of judge.mjs, TAXONOMY .. parseVerdict, comments dropped) ----------------
// p1 = 0409ac386 (2026-10-26 08:57Z); e33ace440 (2026-10-26 18:28Z) adds the Kanripo REFERENCE block, sent only when an
// item has a reference, so every item without one saw p1's text; 937e8727c only exports parseVerdict. siku-percall
// appends its own spot-check lines to judgePrompt (p1+siku).
const promptOf = (src, it) => (src === 'siku-percall-5600' ? 'p1+siku' : it?.reference ? 'p1+kanripo-ref' : 'p1');

function summarise(v) {
  const ds = Array.isArray(v?.defects) ? v.defects : [];
  const by = Object.fromEntries(SEV.map((s) => [s, ds.filter((d) => d.severity === s).length]));
  const other = ds.length - SEV.reduce((a, s) => a + by[s], 0);
  const classes = {}; for (const d of ds) { const k = `${cls(d)}:${SEV.includes(d.severity) ? d.severity : 'other'}`; classes[k] = (classes[k] ?? 0) + 1; }
  return { accept: !!v.accept, fidelity: Number(v.fidelity), n_cosmetic: by.cosmetic, n_misleads: by.misleads, n_wrong_text: by.wrong_text, n_other_sev: other, classes,
    defects: ds.map((d) => ({ c: cls(d), s: d.severity, q: String(d.quote ?? '').slice(0, 300), w: String(d.what ?? '').slice(0, 300) })) };
}

// ---- text pools ---------------------------------------------------------------------------------------------------
function walk(dir, pred, out = [], depth = 0) {
  if (depth > 7) return out;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'tree' || e.name === 'venv' || e.name === 'img' || e.name === 'images') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out, depth + 1); else if (pred(p, e.name)) out.push(p);
  }
  return out;
}

async function inventory() {
  fs.mkdirSync(OUT, { recursive: true });
  const cov = { generated_at: new Date().toISOString(), sources: [], unreachable: [], not_this_schema: [], text: {} };
  // 1. Every packet.json on this box: id -> {text, reference}.
  console.log('scanning job scratch for packets and corrector reads ...');
  const packetFiles = walk(JOBS, (p, n) => n === 'packet.json');
  const PK = new Map();
  for (const f of packetFiles) { try { for (const it of js(f).items || []) if (it?.id && typeof it.text === 'string' && !PK.has(it.id)) PK.set(it.id, { text: it.text, reference: it.reference, from: f }); } catch { /* not a judge packet */ } }
  // Corrector / reader outputs kept as <page_id>.txt (judge.mjs correct, cli-ocr.mjs read): page -> [texts].
  const pageTexts = new Map();
  const addT = (pid, t, from) => { if (!pid || typeof t !== 'string' || !t.trim()) return; const l = pageTexts.get(pid) ?? []; if (!l.some((x) => x.t === t)) l.push({ t, from }); pageTexts.set(pid, l); };
  for (const f of walk(JOBS, (p, n) => /^[0-9a-f]{24}\.txt$/.test(n) && /\/(corr|opus-de|agy-opus-de|opus-de-7545|agy-opus-de-7545|reads|stored|out)\//.test(p))) {
    try { const t = fs.readFileSync(f, 'utf8'); if (t.length < 2e6) addT(path.basename(f, '.txt'), t, 'scratch-txt'); } catch { /* unreadable */ }
  }
  // Repo kept reads.
  const tryJl = (f, fn) => { if (ex(f)) for (const r of jl(f)) fn(r); };
  tryJl(path.join(ROOT, 'scripts/eval/flash-reread-5924/results/oc-reads.jsonl.gz'), (r) => addT(r.page_id, r.text, 'oc-reads-5924'));
  tryJl(path.join(RJ, 'pilot-2026-10-26/opus-de-reads.jsonl.gz'), (r) => addT(r.page_id, r.text, 'opus-de-reads'));
  const tibM = path.join(ROOT, 'scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl');
  const tibUid = new Map();   // pilot Tibetan rows key by uid
  tryJl(tibM, (r) => { tibUid.set(r.id, r); addT(r.id, r.served_text, 'tib-manifest'); if (r.page_id) addT(r.page_id, r.served_text, 'tib-manifest'); });
  const sentinelBody = (t) => { const b = t.indexOf('<<<BEGIN>>>'), e = t.lastIndexOf('<<<END>>>'); return b < 0 ? t : t.slice(b + 11, e > b ? e : undefined).trim(); };
  for (const a of ['flash-low-corr', 'opus-corr']) tryJl(path.join(ROOT, `scripts/eval/results/tibetan-correct-6560/out/${a}.jsonl.gz`), (r) => { if (r.text && !r.error) addT(r.uid, sentinelBody(r.text), `tib-${a}`); });
  const gd = path.join(RJ, 'router-tests-2026-10-28/gpu-drafts.json.gz');
  if (ex(gd)) for (const [pid, t] of Object.entries(js(gd).drafts || js(gd).pages || {})) addT(pid, typeof t === 'string' ? t : t?.text, 'gpu-drafts');

  // 2. Sources and their keyed rows.
  const rows = [];
  const need = new Map();   // row index -> {page ids to try, match fn}
  const runDirs = walk(RJ, (p, n) => n === 'verdicts-opus.jsonl.gz').map((f) => path.dirname(f));
  for (const dir of runDirs) {
    const run = path.relative(RJ, dir);
    const V = new Map(jl(path.join(dir, 'verdicts-opus.jsonl.gz')).filter((r) => r.verdict).map((r) => [r.id, r]));
    let keyRows;
    if (ex(path.join(dir, 'key.json'))) keyRows = js(path.join(dir, 'key.json'));
    else if (run.startsWith('lane-accept')) {
      const s = js(path.join(dir, 'sample.json.gz'));
      keyRows = [];
      for (const p of s.pages) {
        const cell = `${p.lang === 'German' ? 'de' : p.lang === 'French' ? 'fr' : p.lang}-lite`;
        const sid = `j${h(`served:${p.page_id}:${p.text_sha}`).slice(0, 10)}`;
        keyRows.push({ judged_as: sid, cell, route: 'lite>agy-flash-low', kind: 'item', page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, _text: p.text, script: p.script, outcome: p.outcome });
        if (p.draft) keyRows.push({ judged_as: `j${h(`draft:${p.page_id}:${h(p.draft)}`).slice(0, 10)}`, cell, route: 'lite', kind: 'item', page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, _text: p.draft, script: p.script, paired_with: sid });
      }
    } else { cov.not_this_schema.push({ run, why: 'no key.json' }); continue; }
    const sample = ex(path.join(dir, 'sample.json')) ? js(path.join(dir, 'sample.json')) : null;
    let n = 0;
    for (const k of keyRows) {
      const vr = V.get(k.judged_as); if (!vr) continue;
      const cs = sample?.cells?.[k.cell];
      const pkt = PK.get(k.judged_as);
      const row = { source: 'route-judge', run, at: vr.at ?? null, cell: k.cell, route: k.route, kind: k.kind, task: cs?.task ?? (k.route?.includes('-tr') || k.cell === 'german' || k.cell?.startsWith('german-7545') ? 'translation' : 'ocr'), lang: cs?.lang ?? null,
        page_id: k.page_id, uid: k.uid ?? null, book_id: k.book_id, page_number: k.page_number, verdict_id: k.judged_as, unchanged: !!k.unchanged, served: k.served ?? null, plant: k.plant ?? null, paired_with: k.paired_with ?? null, script: k.script ?? null,
        prompt: promptOf('route-judge', pkt), ...summarise(vr.verdict) };
      if (k._text != null) { row._text = k._text; row.words_src = 'candidate'; }
      else if (pkt) { row._text = pkt.text; row.words_src = 'candidate'; }
      else need.set(rows.length, { pids: [k.page_id, k.uid].filter(Boolean), match: (t) => `j${h(`${k.cell}:${k.page_id}:${h(t.trim())}`).slice(0, 10)}` === k.judged_as });
      rows.push(row); n++;
    }
    cov.sources.push({ source: 'route-judge', run, verdicts: V.size, keyed_rows: n });
  }
  // agy-ocr-per-call-6740
  {
    const d = path.join(ROOT, 'scripts/eval/agy-ocr-per-call-6740');
    const K = js(path.join(d, 'judge-key.json')), V = new Map(jl(path.join(d, 'verdicts-opus.jsonl.gz')).filter((r) => r.verdict).map((r) => [r.id, r]));
    const reads = jl(path.join(d, 'reads.jsonl.gz'));
    const byKey = new Map(); for (const r of reads) if (r.text) byKey.set(`j${h(`6740-ppc-item${r.task}|${r.page_id}|${h(r.text)}`).slice(0, 10)}`, r.text);
    let n = 0;
    for (const [id, k] of Object.entries(K)) {
      const vr = V.get(id); if (!vr) continue;
      for (const arm of k.arms ?? []) {
        rows.push({ source: 'agy-ocr-per-call-6740', run: 'agy-ocr-per-call-6740', at: vr.at ?? null, cell: `zh-${k.task}`, route: arm, kind: k.control ? 'wrong_page' : 'item', task: 'ocr', lang: 'Chinese', page_id: k.page_id, book_id: k.book_id, verdict_id: id,
          prompt: k.task === 'T1' ? 'p1+kanripo-ref' : 'p1', _text: byKey.get(id) ?? null, words_src: byKey.has(id) ? 'candidate' : null, ...summarise(vr.verdict) });
        if (!byKey.has(id)) need.set(rows.length - 1, { pids: [k.page_id], match: () => false });
        n++;
      }
    }
    cov.sources.push({ source: 'agy-ocr-per-call-6740', run: 'agy-ocr-per-call-6740', verdicts: V.size, keyed_rows: n });
  }
  // siku-percall-5600 (Classical Chinese translation)
  {
    const d = path.join(ROOT, 'scripts/eval/siku-percall-5600/results');
    const K = js(path.join(d, 'judge-key-all.json')), V = new Map(jl(path.join(d, 'verdicts-opus.jsonl.gz')).filter((r) => r.verdict).map((r) => [r.id, r]));
    const byId = new Map(); for (const r of jl(path.join(d, 'reads.jsonl.gz'))) if (r.text) byId.set(h(`${r.page_id}|${r.arm}|${r.text}`).slice(0, 16), r.text);
    let n = 0;
    for (const [id, k] of Object.entries(K)) {
      const vr = V.get(id); if (!vr) continue;
      rows.push({ source: 'siku-percall-5600', run: 'siku-percall-5600', at: vr.at ?? null, cell: 'zh-siku-tr', route: k.arm, kind: k.control ? 'wrong_page' : 'item', task: 'translation', lang: 'Classical Chinese', page_id: k.page_id, book_id: k.book_id, verdict_id: id,
        prompt: 'p1+siku', _text: byId.get(id) ?? null, words_src: byId.has(id) ? 'candidate' : null, ...summarise(vr.verdict) });
      if (!byId.has(id)) need.set(rows.length - 1, { pids: [k.page_id], match: () => false });
      n++;
    }
    cov.sources.push({ source: 'siku-percall-5600', run: 'siku-percall-5600', verdicts: V.size, keyed_rows: n });
  }
  // judge-planted-7611 (positive control)
  {
    const d = path.join(ROOT, 'scripts/eval/judge-planted-7611/results/2026-10-29');
    const items = js(path.join(d, 'items.json')), plants = js(path.join(d, 'plants.json')), texts = js(path.join(d, 'texts.json.gz'));
    const V = new Map(jl(path.join(d, 'verdicts-opus.jsonl.gz')).filter((r) => r.verdict).map((r) => [r.id, r]));
    let n = 0;
    for (const it of items) {
      const vr = V.get(it.id); if (!vr) continue;
      const t = texts[it.page_id]?.[it.kind] ?? (it.kind === 'A' ? texts[it.page_id]?.original : null);
      rows.push({ source: 'judge-planted-7611', run: 'judge-planted-7611', at: vr.at ?? null, cell: `planted-${it.lang}`, route: 'accepted-lane-text', kind: it.kind === 'A' ? 'control_unchanged' : 'planted', task: 'ocr', lang: it.lang, page_id: it.page_id, verdict_id: it.id,
        prompt: 'p1', plant: plants[it.page_id]?.[it.kind] ?? null, _text: typeof t === 'string' ? t : t?.text ?? null, words_src: t ? 'candidate' : null, ...summarise(vr.verdict) });
      n++;
    }
    cov.sources.push({ source: 'judge-planted-7611', run: 'judge-planted-7611', verdicts: V.size, keyed_rows: n });
  }
  // Mongo: lane_judge_verdicts, pages, page_revisions.
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const lane = await db.collection('lane_judge_verdicts').find({ verdict: { $ne: null } }).toArray();
  for (const r of lane) {
    rows.push({ source: 'lane-judge-sampler', run: `lane:${r.run_id ?? '?'}`, at: r.judged_at ?? null, cell: r.cell, route: r.route, kind: r.kind, task: /-tr$/.test(r.cell) ? 'translation' : 'ocr', lang: r.lang ?? null, page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
      verdict_id: r._id, prompt: `lane:${r.judge?.prompt_template_sha ?? '?'}`, script: r.script_type ?? null, lane: r.lane, plant: r.plant ?? null, ...summarise(r.verdict) });
    need.set(rows.length - 1, { pids: [r.page_id], match: (t) => ch16(t) === r.text_hash || ch16(t.trim()) === r.text_hash, lane: true });
  }
  cov.sources.push({ source: 'lane-judge-sampler', run: 'mongo lane_judge_verdicts', verdicts: lane.length, keyed_rows: lane.length });
  // Recovery from Mongo for every row still without text.
  const pids = [...new Set([...need.values()].flatMap((x) => x.pids))];
  console.log(`recovering text for ${need.size} rows over ${pids.length} pages from Mongo ...`);
  for (let i = 0; i < pids.length; i += 300) {
    const ids = pids.slice(i, i + 300);
    for (const p of await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray()) { addT(p.id, p.ocr?.data, 'pages.ocr'); addT(p.id, p.translation?.data, 'pages.translation'); }
    for (const r of await db.collection('page_revisions').find({ page_id: { $in: ids }, field: { $in: ['ocr', 'translation'] } }, { projection: { page_id: 1, data: 1, field: 1 } }).toArray()) addT(r.page_id, r.data, `page_revisions.${r.field}`);
  }
  await c.close();
  const stat = {};
  for (const [i, nd] of need) {
    const row = rows[i];
    const cands = nd.pids.flatMap((p) => pageTexts.get(p) ?? []);
    const hit = cands.find((x) => { try { return nd.match(x.t); } catch { return false; } });
    if (hit) { row._text = hit.t; row.words_src = 'candidate'; row.text_from = hit.from; }
    else {
      // another text of the same page (the draft, the stored text) gives the page's size: the denominator, not the defects
      const same = cands.filter((x) => (row.task === 'translation') === /translation|opus-de/.test(x.from));
      const pick = same.length ? same : cands;
      if (pick.length) { row._words_page = Math.round(pick.map((x) => words(x.t)).sort((a, b) => a - b)[Math.floor((pick.length - 1) / 2)]); row.words_src = 'page'; row.text_from = pick.map((x) => x.from).join(','); }
      else row.words_src = 'none';
    }
  }
  for (const r of rows) {
    r.words = r._text != null ? words(r._text) : r._words_page ?? null;
    r.text_sha = r._text != null ? ch16(r._text) : null;
    // keep the candidate's lines for the correction-introduced check (draft vs corrected quotes): only for the rows
    // whose text we hold, gz in scratch, never committed.
    stat[`${r.source}:${r.words_src}`] = (stat[`${r.source}:${r.words_src}`] ?? 0) + 1;
  }
  cov.text = stat;
  cov.unreachable = [
    { where: 'hetzner (main) and l7a job scratch', why: 'ssh: hostnames do not resolve from gex45 (2026-10-30); packets and corrector reads made there are not read. Rows from those runs take the page size from Mongo (words_src: page).' },
  ];
  cov.not_this_schema.push(
    { where: 'scripts/eval/gpu-flash-vs-opus-7263 (score-e2-7567, score-test-7263) and /root/jobs/gpu-flash-vs-opus-7263/judge-*', why: 'versions A-E with omissions / additions / misreads lists and usable: no severity' },
    { where: 'router-table/evidence derived from #5924, #6553, #7568, #7341, #6567, #6361, tibetan profiles-diffqa', why: 'k of n only (derive_backfill*.py): their source verdicts carry no defects with severity' },
    { where: '/root/jobs/siku-kanripo-check-7503/verdicts-pilot.jsonl (35)', why: 'no key file: cell and route cannot be named' });
  const z = zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'rows-with-text.jsonl.gz'), z);
  const slim = rows.map(({ _text, _words_page, ...r }) => r);
  fs.writeFileSync(path.join(OUT, 'rows.jsonl.gz'), zlib.gzipSync(slim.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  fs.writeFileSync(path.join(OUT, 'coverage.json'), JSON.stringify(cov, null, 1));
  console.log(JSON.stringify(cov.sources), '\n', JSON.stringify(stat, null, 1));
}

export function recheckPrompt(lang, quote) {
  return `You are checking one short excerpt of a transcription of a page of a historical ${lang} book against the page image, for a library that publishes the transcription beside the image. The page image is attached: the file ./page.jpg in your working directory (open it with Read before you answer). The image is the only authority.

EXCERPT:
"""
${quote}
"""

Find where on the leaf this excerpt belongs and read that place closely. Compare the excerpt with what the leaf prints there; spelling conventions, abbreviations expanded or kept, long s, line breaks and markup tags do not matter.

Answer with one JSON object only: {"located": bool, "leaf_reads": "what the leaf prints there, verbatim", "verdict": "same" | "cosmetic" | "misleads" | "wrong_text", "why": "a few words"}
- same: the excerpt is what the leaf says.
- cosmetic: it differs, but no reader is misled.
- misleads: a reader would understand something not quite on the page.
- wrong_text: the excerpt says something the leaf does not (text not on this leaf, a word or numeral that changes the sense, a duplicated or misplaced passage), or the leaf has words inside this span that the excerpt leaves out.`;
}

async function recheck() {
  const { opusCall, QUOTA } = await import('./judge.mjs');
  const limits = await import('../../lib/model-limits.mjs');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const { parseJson } = await import('../translate-cli-lane-7075/sample.mjs');
  const PER = Number(arg('per') || 40), WEEKLY = Number(process.env.ROUTE_JUDGE_WEEKLY_MAX || 85);
  const rows = jl(path.join(OUT, 'rows-with-text.jsonl.gz')).filter((r) => (r.kind === 'item' || r.kind === 'draft') && r.task === 'ocr' && r.page_id && /^[0-9a-f]{24}$/.test(r.page_id) && r.lang);
  const file = path.join(OUT, 'recheck.jsonl');
  const done = new Set(ex(file) ? jl(file).filter((r) => r.verdict).map((r) => r.key) : []);
  const rank = (s) => h(`recheck-6740:${s}`);
  const pick = [];
  for (const sev of ['misleads', 'wrong_text']) {
    const pool = new Map();   // class -> defects, in seeded order
    for (const r of rows) r.defects.forEach((d, i) => { if (d.s === sev && d.q && d.q.trim().length >= 3) { const k = `${r.verdict_id}:${r.page_id}:${i}`; (pool.get(d.c) ?? pool.set(d.c, []).get(d.c)).push({ key: k, r, d }); } });
    for (const l of pool.values()) l.sort((a, b) => rank(a.key).localeCompare(rank(b.key)));
    const classes = [...pool.keys()].sort((a, b) => rank(a).localeCompare(rank(b)));
    const pages = new Set(); let got = 0;
    for (let round = 0; got < PER && classes.some((c) => pool.get(c).length); round++)
      for (const c of classes) {
        if (got >= PER) break;
        const l = pool.get(c); let x;
        while ((x = l.shift()) && pages.has(x.r.page_id));
        if (!x) continue;
        pages.add(x.r.page_id); got++;
        pick.push({ key: x.key, severity: sev, cls: c, class_pool: pool.get(c).length + 1, page_id: x.r.page_id, book_id: x.r.book_id, lang: x.r.lang, cell: x.r.cell, route: x.r.route, run: x.r.run, quote: x.d.q, judge_what: x.d.w });
      }
  }
  // class sizes, to weight the stratified draw back to the population
  const sizes = {}; for (const r of rows) for (const d of r.defects) if (d.s === 'misleads' || d.s === 'wrong_text') sizes[`${d.s}:${d.c}`] = (sizes[`${d.s}:${d.c}`] ?? 0) + 1;
  fs.writeFileSync(path.join(OUT, 'recheck-draw.json'), JSON.stringify({ drawn_at: new Date().toISOString(), per: PER, class_sizes: sizes, items: pick }, null, 1));
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: pick.map((p) => p.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  let stop = null, i = 0;
  const todo = pick.filter((p) => !done.has(p.key));
  console.log(`recheck: ${todo.length} of ${pick.length} to call`);
  const one = async (it) => {
    const b = limits.claudeBlocked({ weeklyMax: WEEKLY, sessionMax: Number(process.env.ROUTE_JUDGE_SESSION_MAX || 95) });
    if (b) { stop = b; return; }
    const url = pages.get(it.page_id) && getPageSource(pages.get(it.page_id));
    if (!url) { fs.appendFileSync(file, JSON.stringify({ key: it.key, verdict: null, raw: 'no image' }) + '\n'); return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'dr-recheck-'));
    try {
      const res = await fetch(url);
      if (!res.ok) { fs.appendFileSync(file, JSON.stringify({ key: it.key, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
      const t0 = Date.now();
      const r = await opusCall(recheckPrompt(it.lang, it.quote), ws);
      if (r.cls === 'quota' || QUOTA.test(r.text || '')) { stop = { reason: 'quota reply' }; return; }
      const v = parseJson(r.text, (x) => ['same', 'cosmetic', 'misleads', 'wrong_text'].includes(x.verdict));
      fs.appendFileSync(file, JSON.stringify({ ...it, verdict: v, model: r.model, raw: v ? undefined : String(r.text).slice(0, 400), secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.severity} ${it.cls} -> ${v?.verdict ?? 'unparsed'}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 4)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`BLOCKED (${stop.reason})`); process.exit(3); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const st = process.argv[2];
  if (st === 'inventory') await inventory();
  else if (st === 'recheck') await recheck();
  else { console.error('stages: inventory | recheck'); process.exit(2); }
}

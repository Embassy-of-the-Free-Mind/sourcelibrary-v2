#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/driver.mjs runSealed (the sealed `claude -p --restricted --tools Read Write`
// Opus call on the subscription with ANTHROPIC_* stripped — copied here unchanged in shape) and judge-6694.mjs (X/Y
// drawn per page by hash, key kept apart from the judge, book-clustered summaries). Neither builds a full-leaf
// reference and scores both engines against it with a metric, nor judges a translation against the leaf, which the
// #6553 untested-language cells need. Brief: ./JUDGE-CELLS.md.
/**
 *   node judge.mjs packets --work=DIR [--per=3]
 *   node judge.mjs run --work=DIR [--parallel=6] [--model=opus]
 *   node judge.mjs score --work=DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const R = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { stripWrappers, normalizeForScript, normalizeCJK, levenshtein, SCRIPT_DEFS } = await import(`${R}/eval/lib/metrics.mjs`);

const STEP = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const WORK = path.resolve(arg('work')); const J = path.join(WORK, 'judge');
const HERE = path.dirname(new URL(import.meta.url).pathname); const BRIEF = 'JUDGE-CELLS.md';
const rl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const wl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const jf = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const xIsLite = (id) => parseInt(createHash('sha1').update(`cells-6553:${id}`).digest('hex').slice(0, 8), 16) % 2 === 0;
const show = (t) => stripWrappers(t || '').replace(/<\/?(page-type|language|meta)[^>]*>/gi, '').trim();

function liteRead(id) { const j = jf(path.join(WORK, 'ocr', `${id}.json`)); if (!j) return null; return { text: j.text || '', finish: j.finishReason }; }
function agyRead(id) { const m = jf(path.join(WORK, 'agy', `${id}.meta.json`)); if (!m) return null; const t = fs.existsSync(path.join(WORK, 'agy', `${id}.txt`)) ? fs.readFileSync(path.join(WORK, 'agy', `${id}.txt`), 'utf8') : ''; return { text: t, exit: m.exit ?? null, model: m.model || m.cli_model || null }; }

function packets() {
  const per = Number(arg('per', 3)); const draw = rl(path.join(WORK, 'draw.jsonl'));
  fs.mkdirSync(path.join(J, 'chunks'), { recursive: true }); fs.mkdirSync(path.join(J, 'images'), { recursive: true });
  const items = [], key = [];
  for (const p of draw) {
    const lite = liteRead(p.page_id); const img = ['jpg', 'png'].map((e) => path.join(WORK, 'images', `${p.page_id}.${e}`)).find((f) => fs.existsSync(f));
    if (!lite || !img) { key.push({ page_id: p.page_id, cell: p.cell, skipped: !img ? 'no image fetched' : 'no lite read' }); continue; }
    const agy = p.non_latin ? agyRead(p.page_id) : null;
    const tr = jf(path.join(WORK, 'tr', `${p.page_id}.json`));
    const liteX = agy ? xIsLite(p.page_id) : true;
    const imgName = `images/${p.page_id}${path.extname(img)}`; fs.copyFileSync(img, path.join(J, imgName));
    const it = { item_id: p.page_id, language: p.cell_name, book: { title: p.title, year: p.year }, image_file: imgName,
      text_x: show(liteX ? lite.text : agy.text) };
    if (agy) it.text_y = show(liteX ? agy.text : lite.text);
    if (tr?.text) it.translation = tr.text;
    items.push(it); key.push({ page_id: p.page_id, cell: p.cell, x: liteX ? 'lite' : 'agy', y: agy ? (liteX ? 'agy' : 'lite') : null, has_tr: !!tr?.text });
  }
  // Chunks mix cells (seeded order), so no chunk is one language end to end.
  const order = [...items].sort((a, b) => createHash('sha1').update(a.item_id).digest('hex').localeCompare(createHash('sha1').update(b.item_id).digest('hex')));
  for (let i = 0; i < order.length; i += per) fs.writeFileSync(path.join(J, 'chunks', `c${String(i / per).padStart(3, '0')}.json`), JSON.stringify(order.slice(i, i + per), null, 1));
  wl(path.join(J, 'key.jsonl'), key);
  console.log(`${items.length} items in ${Math.ceil(items.length / per)} chunks; skipped ${key.filter((k) => k.skipped).length}; with Y ${key.filter((k) => k.y).length}; with translation ${key.filter((k) => k.has_tr).length}`);
}

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function runSealed(chunkFile, outFile, metaDir, model) {
  const name = path.basename(chunkFile, '.json');
  const sealed = path.join(process.env.TMPDIR || '/tmp', 'cells-6553-sealed', name);
  fs.rmSync(sealed, { recursive: true, force: true }); fs.mkdirSync(path.join(sealed, 'images'), { recursive: true });
  fs.copyFileSync(path.join(HERE, BRIEF), path.join(sealed, BRIEF));
  const items = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
  fs.writeFileSync(path.join(sealed, 'items.json'), JSON.stringify(items, null, 1));
  for (const it of items) fs.copyFileSync(path.join(J, it.image_file), path.join(sealed, it.image_file));
  const prompt = `Your instructions are the full text of \`${BRIEF}\` in this folder (skip the leading \`<!-- … -->\` comment); follow them exactly. Work only inside this folder.\nITEMS_FILE: \`items.json\`\nOUTPUT_FILE: \`review.json\``;
  return new Promise((resolve) => {
    const t0 = Date.now(); const out = fs.openSync(path.join(metaDir, `${name}.jsonl`), 'w');
    const child = spawn('claude', ['-p', prompt, '--model', model, '--restricted', '--tools', 'Read', 'Write', '--allowedTools', 'Read', 'Write', '--strict-mcp-config', '--output-format', 'stream-json', '--verbose'], { cwd: sealed, stdio: ['ignore', out, out], env: claudeEnv() });
    const timer = setTimeout(() => child.kill('SIGKILL'), 40 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(out); const rv = path.join(sealed, 'review.json'); let ok = false;
      if (fs.existsSync(rv)) { try { const j = JSON.parse(fs.readFileSync(rv, 'utf8')); if (Array.isArray(j) && j.length) { fs.writeFileSync(outFile, JSON.stringify(j, null, 1)); ok = true; } } catch { /* retried */ } }
      resolve({ name, ok, code, secs: Math.round((Date.now() - t0) / 1000) });
    });
  });
}
async function run() {
  const model = arg('model', 'opus'); const par = Number(arg('parallel', 6));
  fs.mkdirSync(path.join(J, 'reviews'), { recursive: true }); fs.mkdirSync(path.join(J, 'meta'), { recursive: true });
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(J, 'meta', 'run.json'), JSON.stringify({ model, cli_version: version, brief: `${BRIEF} v1`, brief_sha256: createHash('sha256').update(fs.readFileSync(path.join(HERE, BRIEF))).digest('hex'), started: new Date().toISOString() }));
  const queue = fs.readdirSync(path.join(J, 'chunks')).filter((f) => f.endsWith('.json') && !fs.existsSync(path.join(J, 'reviews', f))).sort();
  console.log(`${queue.length} chunks with ${model}, ${par} at a time`);
  await Promise.all(Array.from({ length: par }, async () => {
    while (queue.length) {
      const f = queue.shift();
      let r = await runSealed(path.join(J, 'chunks', f), path.join(J, 'reviews', f), path.join(J, 'meta'), model);
      if (!r.ok) r = await runSealed(path.join(J, 'chunks', f), path.join(J, 'reviews', f), path.join(J, 'meta'), model);
      console.log(`  ${r.name} ${r.ok ? 'ok' : `FAILED (exit ${r.code})`} ${r.secs}s`);
    }
  }));
}

// ── score ────────────────────────────────────────────────────────────────
const SCRIPT_OF = { Latn: 'latin', Cyrl: 'cyrillic', Hebr: 'hebrew', Deva: 'devanagari', Grek: 'greek', Armn: 'armenian', Kore: 'cjk', Hang: 'cjk' };
const generic = (s) => stripWrappers(s || '').replace(/<[^>]*>/g, ' ').replace(/\[\?\]/g, ' ').normalize('NFC').toLowerCase()
  .split(/\s+/).map((w) => [...w].filter((c) => /[\p{L}\p{M}\p{N}]/u.test(c)).join('')).filter(Boolean).join(' ');
const SCRIPT_RES = { Latn: /\p{Script=Latin}/u, Cyrl: /\p{Script=Cyrillic}/u, Hebr: /\p{Script=Hebrew}/u, Arab: /\p{Script=Arabic}/u, Deva: /\p{Script=Devanagari}/u,
  Grek: /\p{Script=Greek}/u, Kore: /[\p{Script=Han}\p{Script=Hangul}]/u, Taml: /\p{Script=Tamil}/u, Telu: /\p{Script=Telugu}/u, Guru: /\p{Script=Gurmukhi}/u, Gujr: /\p{Script=Gujarati}/u, Samr: /\p{Script=Samaritan}/u, Avst: /\p{Script=Avestan}/u };
function observedScript(t) {
  const c = {}; for (const ch of stripWrappers(t).replace(/<[^>]*>/g, '')) for (const [k, re] of Object.entries(SCRIPT_RES)) if (re.test(ch)) { c[k] = (c[k] || 0) + 1; break; }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top && top[1] >= 10 ? top[0] : null;
}
// Arabic script with the Persian/Urdu/Ottoman letters kept (SCRIPT_DEFS.arabic keeps only ء-ي and would drop پ چ ژ گ ک ی ے ہ).
const arabicExt = (s) => stripWrappers(s || '').replace(/<[^>]*>/g, ' ').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه').replace(/[ۀ]/g, 'ه')
  .split(/\s+/).map((w) => [...w].filter((c) => /\p{L}|\p{N}/u.test(c)).join('')).filter(Boolean).join(' ');
function norm(s, script) {
  if (script === 'arabic-ext') { const t = arabicExt((s || '').replace(/\[\?\]/g, ' ')); return { chars: [...t.replace(/ /g, '')], words: t.split(' ').filter(Boolean) }; }
  s = (s || '').replace(/\[\?\]/g, ' ');
  if (script === 'cjk') { const t = normalizeCJK(s).replace(/[^\p{L}\p{N}]/gu, ''); return { chars: [...t], words: [...t] }; }   // Korean: char = word unit
  const t = script && SCRIPT_DEFS[script] ? normalizeForScript(s, script) : generic(s);
  return { chars: [...t.replace(/ /g, '')], words: t.split(' ').filter(Boolean) };
}
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => { const s = xs.filter((x) => x != null); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
function score() {
  const draw = Object.fromEntries(rl(path.join(WORK, 'draw.jsonl')).map((d) => [d.page_id, d]));
  const key = rl(path.join(J, 'key.jsonl'));
  const verdicts = {}; for (const f of fs.existsSync(path.join(J, 'reviews')) ? fs.readdirSync(path.join(J, 'reviews')) : []) for (const v of jf(path.join(J, 'reviews', f))) verdicts[v.item_id] = v;
  const { SCRIPTS_BY_CODE } = { SCRIPTS_BY_CODE: null };
  const rows = [];
  for (const k of key) {
    const d = draw[k.page_id]; const v = verdicts[k.page_id];
    // The script is OBSERVED from the judge's reference (eval-design §3.2), not taken from the catalogue: the ten
    // "Turkish" books are Arabic-script Ottoman/Persian, and a Latin normaliser would score them as empty.
    const obs = observedScript(v?.reference || liteRead(k.page_id)?.text || ''); const scriptCode = obs || d.script; const script = SCRIPT_OF[scriptCode] || (scriptCode === 'Arab' ? 'arabic-ext' : null);
    const row = { page_id: k.page_id, book_id: d.book_id, cell: k.cell, cell_name: d.cell_name, catalogue_script: d.script, script: scriptCode, scorer: script || 'generic', skipped: k.skipped || null, judged: !!v };
    if (k.skipped || !v) { rows.push(row); continue; }
    Object.assign(row, { leaf: v.leaf, can_read: v.can_read, confidence: v.confidence });
    const ref = v.reference || ''; const R = norm(ref, script);
    for (const slot of ['x', 'y']) {
      const eng = k[slot]; if (!eng) continue;
      const text = eng === 'lite' ? liteRead(k.page_id)?.text : agyRead(k.page_id)?.text;
      const O = norm(stripWrappers(text || ''), script); const st = v[slot] || {};
      const scorable = v.leaf !== 'no-text' && v.can_read !== 'no' && R.chars.length >= 20;
      row[eng] = { status: st.status || null, serious: st.serious ?? null, note: st.note || null,
        cer: scorable ? r3(Math.min(1, levenshtein(O.chars, R.chars) / R.chars.length)) : null,
        wer: scorable ? r3(Math.min(1, levenshtein(O.words, R.words) / Math.max(1, R.words.length))) : null, ref_chars: R.chars.length };
    }
    if (v.translation) row.translation = v.translation;
    rows.push(row);
  }
  wl(path.join(WORK, 'scored.jsonl'), rows);
  const cells = {};
  for (const r of rows) (cells[r.cell] ??= []).push(r);
  const table = [];
  for (const [cell, rs] of Object.entries(cells)) {
    const j = rs.filter((r) => r.judged);
    const eng = (e) => ({ n: j.filter((r) => r[e]).length, scored: j.filter((r) => r[e]?.cer != null).length, median_cer: median(j.map((r) => r[e]?.cer)), median_wer: median(j.map((r) => r[e]?.wer)),
      serious: j.filter((r) => r[e]?.serious).length, non_text: j.filter((r) => r[e] && r[e].status && r[e].status !== 'text').length });
    const tr = j.filter((r) => r.translation);
    const sc = {}; for (const r of j) sc[r.script] = (sc[r.script] || 0) + 1;
    table.push({ cell, name: rs[0].cell_name, catalogue_script: rs[0].catalogue_script, observed_scripts: sc, drawn: rs.length, skipped: rs.filter((r) => r.skipped).length, judged: j.length,
      judge_cannot_read: j.filter((r) => r.can_read === 'no').length, judge_partly: j.filter((r) => r.can_read === 'partly').length, no_text_leaf: j.filter((r) => r.leaf === 'no-text').length,
      lite: eng('lite'), agy: eng('agy'),
      tr: { n: tr.length, fidelity_mean: r3(mean(tr.map((r) => r.translation.fidelity))), le2: tr.filter((r) => r.translation.fidelity <= 2).length, invention: tr.filter((r) => r.translation.invention).length, inherited: tr.filter((r) => r.translation.inherited).length } });
  }
  table.sort((a, b) => b.drawn - a.drawn);
  fs.writeFileSync(path.join(WORK, 'cells-summary.json'), JSON.stringify(table, null, 1));
  const pct = (x) => (x == null ? '–' : (100 * x).toFixed(1));
  console.log('| cell | observed script | n drawn/judged | lite med CER/WER % (scored n) | agy Flash med CER/WER % (n) | lite non-text/serious | tr n, fidelity mean (≤2) | judge can\'t read/partly |');
  for (const t of table) console.log(`| ${t.name} | ${Object.entries(t.observed_scripts).map(([k, n]) => `${k}${n}`).join(' ')} | ${t.drawn}/${t.judged} | ${pct(t.lite.median_cer)}/${pct(t.lite.median_wer)} (${t.lite.scored}) | ${t.agy.n ? `${pct(t.agy.median_cer)}/${pct(t.agy.median_wer)} (${t.agy.scored})` : '–'} | ${t.lite.non_text}/${t.lite.serious} | ${t.tr.n ? `${t.tr.n}, ${t.tr.fidelity_mean} (${t.tr.le2})` : '–'} | ${t.judge_cannot_read}/${t.judge_partly} |`);
}

const S = { packets, run, score };
if (!S[STEP]) { console.error('usage: judge.mjs packets|run|score --work=DIR'); process.exit(2); }
await S[STEP]();

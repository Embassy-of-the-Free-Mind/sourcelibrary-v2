// PRIOR ART: scripts/eval/paddle-table-6388/opus.mjs and leaf-shift judges (`claude -p --model opus` with a page image
// per call); the paired-arm-judge skill's recipe (blind ids, wrong-page and shuffled controls). None rates individual
// punctuation breaks, so this builds that packet and runs it.
/**
 * #8140 frame B: blind Opus judge of the arm's breaks against the page image.
 *   node judge.mjs build --priv=DIR --arm=O|G   → <priv>/B/packet.json (real 30 + 6 shuffled + 4 wrong-page, blind ids)
 *   node judge.mjs run --priv=DIR [--conc=4]    → <priv>/B/judge/<id>.json
 *   node judge.mjs score --priv=DIR             → scores JSON on stdout (no text)
 */
import fs from 'fs'; import path from 'path'; import os from 'os'; import crypto from 'crypto'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { breaksOf, repairBreaks, mulberry32 } from './lib.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2]; const PRIV = path.join(argOf('priv'), 'B'); const PK = path.join(PRIV, 'packet.json');
const draw = JSON.parse(fs.readFileSync(path.join(here, 'draw-B.json'), 'utf8')).pages;

// Served string under policy K: the INPUT with each kept position's marks inserted (marks taken from the output run).
function served(input, output) {
  const K = repairBreaks(input, output); const ob = breaksOf(output);
  // map input index → mark run via the same LCS pairing: recompute pairs cheaply by walking K.any with ob.kinds
  // repairBreaks keeps a position only when the output char at the paired index carries the run, so re-pair here.
  const A = [...input], O = [...ob.chars]; const n = A.length, m = O.length; const W = m + 1; const L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = A[i] === O[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const runAt = new Map(); let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === O[j]) { if (K.any.has(i) && ob.kinds.has(j)) runAt.set(i, ob.kinds.get(j)); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++; else j++; }
  return runAt; // Map<input index, mark run>
}
const render = (input, runAt) => { const A = [...input]; let s = '', k = 0; A.forEach((c, i) => { s += c; if (runAt.has(i)) { k++; s += runAt.get(i) + `⟨${k}⟩`; } }); return { text: s, n: k }; };

const PROMPT = (text) => `You are a philologist checking punctuation (句读) added by a machine to one page of a classical Chinese book from the Siku Quanshu. The page image is the file ./page.jpg: open it with the Read tool first and read the page.

Below is the machine-punctuated text of that page. Each break carries a number in ⟨⟩ right after its mark. The text came from OCR, so it may contain misread characters, double-line small notes run into the main text, or lines out of order. Judge each break against the text AS GIVEN and the sense of the page.

Rate every break:
- fine: a reasonable place to break, with a reasonable mark.
- debatable: an editor might well not break here, or would use another mark, but the sense survives.
- harmful: the break cuts a phrase or a name, joins what must be separate, or otherwise changes or destroys the sense a reader would take.
If a bad break is caused by an OCR error (a wrong character, a note run into the text, lines out of order) rather than by the punctuation itself, still rate it, and set ocr_caused to true.

Also say whether the text is a transcription of THIS page image (true/false): it is false if it is the text of some other page.

Answer with one JSON object and nothing else:
{"matches_image": true|false, "not_fine": [{"n": <number>, "rating": "debatable"|"harmful", "ocr_caused": true|false, "why": "<short reason>"}], "overall": "<one sentence>"}
List only the breaks that are not fine; every break you do not list counts as fine.

Text:
${text}`;

if (CMD === 'build') {
  const ARM = argOf('arm');
  const real = [];
  for (const d of draw) {
    const input = fs.readFileSync(path.join(PRIV, `${d.slug}.input.txt`), 'utf8');
    const o = JSON.parse(fs.readFileSync(path.join(PRIV, `out-${ARM}`, `${d.slug}.json`), 'utf8'));
    const ob = o.answer ? breaksOf(o.answer) : null;
    const runAt = o.answer ? served(input, o.answer) : new Map();
    real.push({ slug: d.slug, input, runAt, changed: ob ? ob.chars !== input : null, empty: !o.answer });
  }
  const rng = mulberry32(81403);
  const pickN = (arr, k) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
  const items = [];
  for (const r of real) items.push({ kind: 'real', slug: r.slug, image: r.slug, ...render(r.input, r.runAt), changed: r.changed, empty: r.empty });
  for (const r of pickN(real.filter((x) => x.runAt.size > 5), 6)) {
    const n = [...r.input].length, runs = [...r.runAt.values()]; const pos = new Set();
    while (pos.size < runs.length) pos.add(Math.floor(rng() * (n - 1)));
    const m = new Map([...pos].sort((a, b) => a - b).map((p, i) => [p, runs[i]]));
    items.push({ kind: 'shuffled', slug: r.slug, image: r.slug, ...render(r.input, m) });
  }
  const wp = pickN(real, 8);
  for (let k = 0; k < 4; k++) { const t = wp[k], im = wp[k + 4]; items.push({ kind: 'wrong-page', slug: t.slug, image: im.slug, ...render(t.input, t.runAt) }); }
  for (const it of items) it.id = crypto.createHash('sha256').update(`${it.kind}|${it.slug}|${it.image}|81403`).digest('hex').slice(0, 10);
  const order = pickN(items, items.length);
  fs.writeFileSync(PK, JSON.stringify({ arm: ARM, items: order }, null, 1));
  console.log('packet', order.length, order.reduce((a, x) => ((a[x.kind] = (a[x.kind] || 0) + 1), a), {}));
}

function opus(prompt, img) {
  return new Promise((resolve) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zhp-judge-')); fs.copyFileSync(img, path.join(cwd, 'page.jpg'));
    const t0 = Date.now();
    const p = spawn('/root/.local/bin/claude', ['-p', '--model', 'opus', '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'], { cwd });
    let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const killer = setTimeout(() => p.kill('SIGKILL'), 480_000);
    p.on('close', (code) => { clearTimeout(killer); fs.rmSync(cwd, { recursive: true, force: true }); let j = {}; try { j = JSON.parse(out); } catch { /* */ } resolve({ code, text: j.result ?? '', err: err.slice(0, 400), seconds: (Date.now() - t0) / 1000, num_turns: j.num_turns ?? null, limit: /usage limit|rate limit|limit reached/i.test(err + (j.is_error ? j.result || '' : '')) }); });
    p.stdin.end(prompt);
  });
}
const parse = (t) => { const s = String(t || ''); const a = s.indexOf('{'), b = s.lastIndexOf('}'); try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; } };

if (CMD === 'run') {
  const P = JSON.parse(fs.readFileSync(PK, 'utf8')); const OUT = path.join(PRIV, 'judge'); fs.mkdirSync(OUT, { recursive: true });
  const q = P.items.filter((it) => !fs.existsSync(path.join(OUT, `${it.id}.json`))); let stop = false;
  await Promise.all(Array.from({ length: +argOf('conc', 4) }, async () => {
    while (q.length && !stop) {
      const it = q.shift(); let r, j = null, tries = 0;
      while (tries < 2 && !j) { r = await opus(PROMPT(it.text), path.join(PRIV, `${it.image}.jpg`)); tries++; if (r.limit) { stop = true; break; } j = parse(r.text); }
      if (stop) { console.error('LIMIT: stopping'); break; }
      fs.writeFileSync(path.join(OUT, `${it.id}.json`), JSON.stringify({ id: it.id, verdict: j, raw: j ? undefined : r.text, seconds: r.seconds, tries, turns: r.num_turns }));
      console.log(it.id, j ? 'ok' : 'UNPARSED', r.seconds.toFixed(0) + 's');
    }
  }));
  console.log(stop ? 'STOPPED' : 'done');
}

if (CMD === 'score') {
  const P = JSON.parse(fs.readFileSync(PK, 'utf8')); const OUT = path.join(PRIV, 'judge');
  const rows = P.items.map((it) => { const f = path.join(OUT, `${it.id}.json`); const v = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; const nf = v?.verdict?.not_fine || [];
    const valid = nf.filter((x) => x && Number.isInteger(+x.n) && +x.n >= 1 && +x.n <= it.n);
    return { id: it.id, kind: it.kind, slug: it.slug, image: it.image, breaks: it.n, changed: it.changed ?? null, judged: !!v?.verdict, matches_image: v?.verdict?.matches_image ?? null,
      harmful: valid.filter((x) => x.rating === 'harmful').length, harmful_ocr: valid.filter((x) => x.rating === 'harmful' && x.ocr_caused).length, debatable: valid.filter((x) => x.rating === 'debatable').length, seconds: v?.seconds ?? null }; });
  const real = rows.filter((r) => r.kind === 'real' && r.judged), sh = rows.filter((r) => r.kind === 'shuffled' && r.judged), wp = rows.filter((r) => r.kind === 'wrong-page' && r.judged);
  const shPass = sh.filter((r) => r.harmful >= 1).length, wpPass = wp.filter((r) => r.matches_image === false).length;
  const gate = shPass >= 5 && wpPass >= 3;
  const hp = real.filter((r) => r.harmful >= 1).length, hpNoOcr = real.filter((r) => r.harmful - r.harmful_ocr >= 1).length;
  const tb = real.reduce((s, r) => s + r.breaks, 0);
  const sum = (k) => real.reduce((s, r) => s + r[k], 0);
  const out = { arm: P.arm, judged: rows.filter((r) => r.judged).length, of: rows.length,
    controls: { shuffled_flagged: `${shPass}/${sh.length}`, shuffled_harmful_median: sh.map((r) => r.harmful / Math.max(1, r.breaks)).sort((a, b) => a - b)[sh.length >> 1], wrong_page_caught: `${wpPass}/${wp.length}`, real_said_mismatch: real.filter((r) => r.matches_image === false).length, gate_pass: gate },
    real: { pages: real.length, breaks: tb, pages_with_harmful: hp, pages_with_harmful_ci: wilson(hp, real.length).map((x) => Math.round(x * 1000) / 1000), pages_with_harmful_not_ocr: hpNoOcr, harmful_breaks: sum('harmful'), harmful_ocr_caused: sum('harmful_ocr'), debatable_breaks: sum('debatable'), harmful_per_100_breaks: Math.round(1000 * sum('harmful') / tb) / 10, debatable_per_100_breaks: Math.round(1000 * sum('debatable') / tb) / 10, median_seconds: real.map((r) => r.seconds).sort((a, b) => a - b)[real.length >> 1] },
    rule_3_pass: gate ? hp <= 3 : null, rows };
  console.log(JSON.stringify(out, null, 1));
}

#!/usr/bin/env node
// PRIOR ART: merge-precision.mjs here judges PROPOSED merge groups (up to 4 books per id) and is the source of the
// verdict classes and lean claude -p flags; it cannot sample live clusters or plant errors. gap-validation-cluster-audit.mjs
// and work-grouping-check.mjs audit USTC work_cluster_id and the phase-11 graph, not books.work_id (#8291).
//
// How many live multi-book work_id clusters hold more than one work, per way the cluster was made? Read-only.
// usage (S = a scratch dir):
//   node --env-file=.env.production.local overmerge-audit.mjs frame <live-books.jsonl> S     # routes, populations, draw
//   node overmerge-audit.mjs candidates <live-books.jsonl> S                                  # planted + control candidates to read
//   node overmerge-audit.mjs judge <live-books.jsonl> S <planted.jsonl> [--conc 3]            # blind, resumable; exit 3 = usage limit
//   node overmerge-audit.mjs planted S <planted.jsonl>                                        # the gate: read this BEFORE any rate
//   node overmerge-audit.mjs readlist <live-books.jsonl> S                                    # second-read packet, route-blind
//   node overmerge-audit.mjs score S <second-read.jsonl>                                      # confirmed rates per route
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { claudeSubscriptionEnv } from '../../lib/claude-cli-env.mjs';

const SEED = 'overmerge-8291-2026-11-07';
const DRAW = { model_second_judged: 100, model_unjudged: 100, title_author: 100, wikidata_catalogue: 100, kanripo: 50, legacy_seed: 50, rule_merge: 50 };
const TOPUP_6PLUS = { model_second_judged: 25, model_unjudged: 25, title_author: 25 }; // the 6+ band of these is thin in a uniform draw
const MAX_TITLES = 40, PER = 6;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const ord = (a, b) => (a.h < b.h ? -1 : 1);
const band = n => (n === 2 ? '2' : n <= 5 ? '3-5' : '6+');
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const appendJsonl = (w, r) => w.write(JSON.stringify(r) + '\n');
function loadClusters(f) {
  const m = new Map();
  for (const b of readJsonl(f)) if (b.work_id) { if (!m.has(b.work_id)) m.set(b.work_id, []); m.get(b.work_id).push(b); }
  return m;
}
const wilson = (k, n, z = 1.96) => { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+((c - m) / d * 100).toFixed(1), +((c + m) / d * 100).toFixed(1)]; };

// work_id_merges alone does not identify a model merge: 1,987 of 3,239 model-merged clusters have no llm row
// (llm-verify-work-merges.mjs --apply writes the books and no row), and 461 of the 1,733 rows are not from a model at all.
function routeOf(id, bs, winners) {
  const set = winners.get(id);
  if (set?.has('llm')) return 'model_second_judged';
  if (bs.some(b => b.work_id_source === 'work-merge:llm-verified')) return 'model_unjudged';
  if (set) return 'rule_merge';
  if (/^kr:/.test(id)) return 'kanripo';
  if (/^(Q\d|catalog:)/.test(id)) return 'wikidata_catalogue';
  if (/^local:/.test(id)) return 'title_author';
  return 'legacy_seed';
}

async function frame(booksF, S) {
  const { MongoClient } = await import('mongodb');
  const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
  const rows = await mc.db(process.env.MONGODB_DB || 'bookstore').collection('work_id_merges').find({}).toArray();
  await mc.close();
  // winners inherit the class of every loser that was itself a winner earlier
  const direct = new Map(), into = new Map();
  for (const r of rows) {
    const w = r.winner || r.survivor, srcs = (r.sources || []).join(' ');
    const cls = /llm-verify/.test(srcs) ? 'llm' : 'rule';
    if (!direct.has(w)) direct.set(w, new Set()); direct.get(w).add(cls);
    for (const l of [...(r.losers || []), ...(Array.isArray(r.retired) ? r.retired : [])]) { if (!into.has(w)) into.set(w, new Set()); into.get(w).add(l); }
  }
  const winners = new Map();
  const closure = (w, seen = new Set()) => { if (seen.has(w)) return new Set(); seen.add(w); const o = new Set(direct.get(w) || []); for (const l of into.get(w) || []) for (const c of closure(l, seen)) o.add(c); return o; };
  for (const w of direct.keys()) winners.set(w, closure(w));

  const clusters = loadClusters(booksF);
  const pop = {}, all = [];
  let liveBooks = 0, noId = 0;
  for (const b of readJsonl(booksF)) { liveBooks++; if (!b.work_id) noId++; }
  for (const [id, bs] of clusters) {
    if (bs.length < 2) continue;
    const route = routeOf(id, bs, winners), n = bs.length;
    all.push({ id, route, n, h: sha(`${SEED}:draw:${id}`) });
    const p = pop[route] ||= { clusters: 0, books: 0, bands: { 2: { clusters: 0, books: 0 }, '3-5': { clusters: 0, books: 0 }, '6+': { clusters: 0, books: 0 } } };
    p.clusters++; p.books += n; p.bands[band(n)].clusters++; p.bands[band(n)].books += n;
  }
  const sample = [];
  for (const route of Object.keys(DRAW)) {
    const r = all.filter(c => c.route === route).sort(ord);
    const uni = r.slice(0, DRAW[route]);
    sample.push(...uni.map(c => ({ ...c, topup: false })));
    const need = (TOPUP_6PLUS[route] || 0) - uni.filter(c => c.n > 5).length;
    if (need > 0) sample.push(...r.slice(DRAW[route]).filter(c => c.n > 5).slice(0, need).map(c => ({ ...c, topup: true })));
  }
  fs.writeFileSync(`${S}/frame.json`, JSON.stringify({ seed: SEED, liveBooks, noId, distinctIds: clusters.size, multiBookClusters: all.length, mergeRows: rows.length, pop, draw: DRAW, topup: TOPUP_6PLUS, modelRows: [...winners.values()].filter(s => s.has('llm')).length }, null, 1));
  fs.writeFileSync(`${S}/all-clusters.jsonl`, all.map(c => JSON.stringify(c)).join('\n') + '\n');
  fs.writeFileSync(`${S}/sample.jsonl`, sample.map(c => JSON.stringify(c)).join('\n') + '\n');
  console.log(`seed ${SEED}; live books ${liveBooks} (${noId} no work_id); ids ${clusters.size}; 2+ book clusters ${all.length}`);
  for (const [route, p] of Object.entries(pop)) { const s = sample.filter(c => c.route === route); console.log(`${route.padEnd(22)} population ${String(p.clusters).padStart(5)} clusters ${String(p.books).padStart(6)} books | sampled ${s.filter(c => !c.topup).length} uniform + ${s.filter(c => c.topup).length} 6+ top-up | bands ${JSON.stringify(p.bands)}`); }
}

const STOP = new Set('the and for with from der die das und von zur zum des del della dello dei degli delle les los las une uns ein eine einer sive seu cum sur par pour que qui per quae qui eius ejus suis apud sub ad in de et ex of on to a an la le el il al du en het een vol tom band pars liber libri book part volume tomus'.split(' '));
const toks = t => new Set((t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(w => (w.length > 2 || /\p{Script=Han}/u.test(w)) && !STOP.has(w)));
const jacc = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
const VOLISH = /\b(vol|vols|volume|tom|tome|tomus|band|bd|pars|part|teil|book|liber|buch|livre|libro|nr|no)\b\.?|卷|[(（][一二三四五六七八九十]+[)）]|\bi{1,3}\b|\b\d+\b/i;
const line = b => `"${(b.title || '').replace(/\s+/g, ' ').slice(0, 260)}" | ${b.author || ''} | ${b.published ?? b.year ?? '?'} | ${b.language || '?'} | ${b.pages_count}pp | ${b.id}`;

function candidates(booksF, S) {
  const clusters = loadClusters(booksF), sample = new Set(readJsonl(`${S}/sample.jsonl`).map(c => c.id));
  const byAuthor = new Map();
  for (const [id, bs] of clusters) {
    if (sample.has(id) || bs.length > 3 || /^kr:/.test(id)) continue;
    const au = new Set(bs.map(b => b.author_id)); if (au.size !== 1 || !bs[0].author_id || /unknown|anon/i.test(bs[0].author_id)) continue;
    if (bs.some(b => !b.title || b.pages_count < 8) || new Set(bs.map(b => b.language)).size !== 1) continue;
    if (!byAuthor.has(bs[0].author_id)) byAuthor.set(bs[0].author_id, []);
    byAuthor.get(bs[0].author_id).push({ id, bs, tok: toks(bs.map(b => b.title).join(' ')) });
  }
  const easy = [], hard = [];
  for (const [au, ws] of byAuthor) {
    if (ws.length < 2 || ws.length > 400) continue;
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const a = ws[i], b = ws[j], h = sha(`${SEED}:plant:${a.id}|${b.id}`);
      if (a.bs[0].language !== b.bs[0].language) continue;
      const J = jacc(a.tok, b.tok);
      if (J === 0 && a.tok.size >= 2 && b.tok.size >= 2) easy.push({ au, a: a.id, b: b.id, J, h });
      else if (J >= 0.3 && J <= 0.75 && !a.bs.concat(b.bs).some(x => VOLISH.test(x.title))) hard.push({ au, a: a.id, b: b.id, J: +J.toFixed(2), h });
    }
  }
  // one pair per author, so a prolific author cannot fill the key
  const onePer = l => { const seen = new Set(); return l.sort(ord).filter(p => !seen.has(p.au) && seen.add(p.au)); };
  const show = (p) => `\n#${p.h.slice(0, 8)} ${p.kind} J=${p.J} author=${p.au}\n  A ${p.a}\n${clusters.get(p.a).map(line).map(l => '    ' + l).join('\n')}\n  B ${p.b}\n${clusters.get(p.b).map(line).map(l => '    ' + l).join('\n')}`;
  const E = onePer(easy).slice(0, 60).map(p => ({ ...p, kind: 'easy' })), H = onePer(hard).slice(0, 160).map(p => ({ ...p, kind: 'hard' }));
  fs.writeFileSync(`${S}/plant-candidates.json`, JSON.stringify([...E, ...H]));
  fs.writeFileSync(`${S}/plant-candidates.txt`, [...E, ...H].map(show).join('\n'));
  const all = readJsonl(`${S}/all-clusters.jsonl`).filter(c => c.route === 'model_second_judged' && !sample.has(c.id) && c.n <= 8).map(c => ({ ...c, h: sha(`${SEED}:control:${c.id}`) })).sort(ord).slice(0, 45);
  fs.writeFileSync(`${S}/control-candidates.txt`, all.map(c => `\n#${c.id}\n${clusters.get(c.id).map(line).map(l => '  ' + l).join('\n')}`).join('\n'));
  console.log(`easy pairs ${easy.length} (one per author ${E.length}), hard pairs ${hard.length} (${H.length}), control candidates ${all.length}`);
}

// Every distinct title, not the first 4 per id. Books sharing a title collapse to one line with their years.
function describe(bs, key) {
  const m = new Map();
  for (const b of bs) { const t = (b.title || '(no title)').replace(/\s+/g, ' ').trim(); if (!m.has(t)) m.set(t, []); m.get(t).push(b); }
  let items = [...m.entries()];
  const distinct = items.length, capped = distinct > MAX_TITLES;
  if (capped) items = items.map(e => ({ e, h: sha(`${SEED}:cap:${key}:${e[0]}`) })).sort(ord).slice(0, MAX_TITLES).map(x => x.e);
  const lines = items.map(([t, l], i) => {
    const uniq = f => [...new Set(l.map(f).filter(Boolean))].slice(0, 5).join('; ');
    const disp = (l[0].display_title || '').replace(/\s+/g, ' ').trim();
    return `  T${i + 1}: "${t.slice(0, 300)}"${disp && disp !== t && !t.startsWith(disp.replace(/\s*\.\.\.$/, '')) ? ` [also shown as "${disp.slice(0, 120)}"]` : ''} | ${uniq(b => b.author) || '?'} | ${uniq(b => b.published ?? b.year) || '?'} | ${uniq(b => b.language) || '?'} | ${l.length > 1 ? `${l.length} books, ` : ''}${l.map(b => b.pages_count).slice(0, 4).join('/')}pp`;
  });
  return { text: lines.join('\n'), distinct, shown: items.length, capped, shownTitles: items.map(e => e[0]) };
}

const RULES = `You are a rare-books cataloguer auditing a library's work records. Each GROUP below is every book currently filed as ONE work (FRBR sense). Lines are the distinct titles under it: title | author | year | language | pages.
Give each GROUP exactly one verdict, the most severe that applies, in this order:
- contains_different_work: at least one book is a different work from the rest (a different text by the same author, or an unrelated text).
- contains_container: at least one book is an anthology or collected works that includes the work, a commentary on it by someone else, or an excerpt from it.
- contains_volume_or_part: all one work, but some book is only one volume, part or book of it, or different volumes of a set sit together.
- all_same_work: every book is an edition, printing, copy, manuscript witness or translation of the same work.
- unsure: the records do not let you decide.
These differences do NOT make a different work on their own: spelling variants; Latin case endings (Opera / Operum / Operibus); a title translated into another language, or an English gloss beside the original title; reprints, later editions and revised editions; title-page wording, a long title beside a short one, added dedications, editors or prefaces.
These DO: a title naming a different subject or a different treatise, even when the author is the same and even when the wording is close (two works can share a generic head such as "Commentarii", "Observationes", "Institutiones").
Judge from the records only. Prefer unsure over a confident wrong call. Output ONLY a JSON array: [{"group":"<id>","verdict":"<verdict>","odd":["T3"],"why":"<15 words max>"}], where odd lists the title lines that do not belong (empty if none).`;
const runClaude = prompt => new Promise(res => {
  const c = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', 'You are a careful rare-books cataloguer. Answer only with the requested JSON array.'], { stdio: ['pipe', 'pipe', 'pipe'], env: claudeSubscriptionEnv() });
  let o = ''; c.stdout.on('data', d => { o += d; }); const kill = setTimeout(() => c.kill('SIGTERM'), 6 * 60 * 1000);
  c.on('close', () => { clearTimeout(kill); res(o); }); c.stdin.end(prompt);
});

async function judge(booksF, S, plantedF, conc) {
  const clusters = loadClusters(booksF);
  const items = readJsonl(`${S}/sample.jsonl`).map(c => ({ key: `real:${c.id}`, kind: 'real', bs: clusters.get(c.id) }));
  for (const p of readJsonl(plantedF)) {
    const bs = p.kind === 'control' ? clusters.get(p.work_id) : [...clusters.get(p.a), ...clusters.get(p.b)];
    if (!bs) throw new Error(`planted row no longer live: ${JSON.stringify(p)}`);
    items.push({ key: p.kind === 'control' ? `control:${p.work_id}` : `plant:${p.a}|${p.b}`, kind: p.kind, bs });
  }
  const outF = `${S}/judged.jsonl`;
  const done = new Set(fs.existsSync(outF) ? readJsonl(outF).map(r => r.key) : []);
  const todo = items.filter(i => !done.has(i.key)).map(i => ({ ...i, h: sha(`${SEED}:order:${i.key}`) })).sort(ord);
  console.log(`${items.length} clusters; ${done.size} done; ${todo.length} to judge`);
  const batches = []; for (let i = 0; i < todo.length; i += PER) batches.push(todo.slice(i, i + PER));
  const w = fs.createWriteStream(outF, { flags: 'a' }); let bi = 0, fails = 0;
  async function worker() {
    while (bi < batches.length) {
      const n = bi++, b = batches[n], ids = b.map(i => `G${sha(`${SEED}:gid:${i.key}`).slice(0, 6)}`);
      const ds = b.map(i => describe(i.bs, i.key));
      const prompt = `${RULES}\n\n${b.map((_, i) => `GROUP ${ids[i]} (${b[i].bs.length} books, ${ds[i].distinct} distinct titles${ds[i].capped ? `; showing a random ${ds[i].shown}` : ''})\n${ds[i].text}`).join('\n\n')}`;
      let parsed = null;
      for (let a = 0; a < 2 && !parsed; a++) {
        const o = await runClaude(prompt);
        try {
          const env = JSON.parse(o), txt = env.result || '';
          if ((env.is_error || !txt.includes('[')) && /limit|quota|usage/i.test(txt)) { console.error('LIMIT', txt.slice(0, 200)); await new Promise(r => w.end(r)); process.exit(3); }
          parsed = JSON.parse(txt.slice(txt.search(/\[\s*\{/), txt.lastIndexOf(']') + 1));
        } catch { console.error('parse fail', o.slice(0, 200)); }
      }
      if (!parsed) { fails++; continue; }
      b.forEach((it, i) => {
        const j = parsed.find(x => x.group === ids[i]); if (!j) { fails++; return; }
        const odd = (j.odd || []).map(t => ds[i].shownTitles[+String(t).replace(/\D/g, '') - 1]).filter(Boolean);
        appendJsonl(w, { key: it.key, kind: it.kind, nBooks: it.bs.length, distinct: ds[i].distinct, capped: ds[i].capped, shown: ds[i].shown, verdict: j.verdict, odd, why: j.why });
      });
      console.log(`batch ${n + 1}/${batches.length}`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  await new Promise(r => w.end(r));
  console.log('done fails=' + fails);
}

// The gate #8291 sets: under 90% caught on planted different-work clusters, stop.
// Caught = the verdict sends the cluster to the second read (different work or container); the strict figure is printed beside it.
function planted(S, plantedF) {
  const J = new Map(readJsonl(`${S}/judged.jsonl`).map(r => [r.key, r]));
  const out = {};
  for (const p of readJsonl(plantedF)) {
    const key = p.kind === 'control' ? `control:${p.work_id}` : `plant:${p.a}|${p.b}`, r = J.get(key);
    if (!r) continue;
    const o = out[p.kind] ||= { n: 0, verdicts: {} }; o.n++; o.verdicts[r.verdict] = (o.verdicts[r.verdict] || 0) + 1;
    if (p.kind !== 'control' && !['contains_different_work', 'contains_container'].includes(r.verdict)) console.log(`MISSED ${p.kind}: ${key} -> ${r.verdict}: ${r.why}`);
    if (p.kind === 'control' && r.verdict !== 'all_same_work') console.log(`CONTROL FLAGGED: ${key} -> ${r.verdict}: ${r.why}`);
  }
  const pl = ['easy', 'hard'].map(k => out[k] || { n: 0, verdicts: {} });
  const strict = pl.reduce((s, o) => s + (o.verdicts.contains_different_work || 0), 0), flagged = strict + pl.reduce((s, o) => s + (o.verdicts.contains_container || 0), 0), n = pl[0].n + pl[1].n;
  console.log(JSON.stringify(out));
  console.log(`planted caught (different work or container): ${flagged}/${n} = ${(100 * flagged / n).toFixed(1)}% [${wilson(flagged, n).join('–')}]; strict (different work only): ${strict}/${n} = ${(100 * strict / n).toFixed(1)}%`);
  const c = out.control; if (c) console.log(`controls: ${c.verdicts.all_same_work || 0}/${c.n} all_same_work; different-work false alarms ${c.verdicts.contains_different_work || 0}/${c.n}`);
  console.log(flagged / n < 0.9 ? 'GATE FAILED: under 90%, rates are not quotable' : 'gate passed');
}

// Second-read packet: real clusters only, no route shown, in hash order, whole clusters with book ids.
function readlist(booksF, S) {
  const clusters = loadClusters(booksF), J = readJsonl(`${S}/judged.jsonl`).filter(r => r.kind === 'real');
  const pick = (v, cap) => { const l = J.filter(r => r.verdict === v).map(r => ({ ...r, h: sha(`${SEED}:read:${r.key}`) })).sort(ord); return cap ? l.slice(0, cap) : l; };
  const list = [...pick('contains_different_work'), ...pick('contains_container'), ...pick('unsure'), ...pick('all_same_work', 30), ...pick('contains_volume_or_part', 20)].map(r => ({ ...r, h: sha(`${SEED}:readorder:${r.key}`) })).sort(ord);
  const text = list.map(r => { const id = r.key.slice(5); return `\n## ${id} — judge: ${r.verdict}${r.capped ? ` (capped ${r.shown}/${r.distinct})` : ''}; ${r.why}${r.odd?.length ? ` | odd: ${r.odd.map(o => o.slice(0, 70)).join(' ; ')}` : ''}\n${clusters.get(id).map(line).map(l => '  ' + l).join('\n')}`; });
  fs.writeFileSync(`${S}/second-read-packet.md`, text.join('\n') + '\n');
  fs.writeFileSync(`${S}/second-read-keys.json`, JSON.stringify(list.map(r => ({ key: r.key, verdict: r.verdict }))));
  const t = {}; for (const r of list) t[r.verdict] = (t[r.verdict] || 0) + 1;
  console.log(`second read: ${list.length} clusters`, t, `of ${J.length} real`);
}

// label: different_work | container | volume_or_part | same | undecided. bar: clear | arguable. evidence: record | ocr | image.
function score(S, readF) {
  const frameJ = JSON.parse(fs.readFileSync(`${S}/frame.json`, 'utf8'));
  const sample = new Map(readJsonl(`${S}/sample.jsonl`).map(c => [c.id, c]));
  const J = new Map(readJsonl(`${S}/judged.jsonl`).filter(r => r.kind === 'real').map(r => [r.key.slice(5), r]));
  const read = new Map(readJsonl(readF).map(r => [r.id, r]));
  const row = (id) => { const j = J.get(id), r = read.get(id); return { id, ...sample.get(id), verdict: j?.verdict, label: r?.label ?? null, bar: r?.bar ?? null, evidence: r?.evidence ?? null, note: r?.note ?? null }; };
  const rows = [...sample.keys()].filter(id => J.has(id)).map(row);
  const isDW = r => r.label === 'different_work' && (r.bar === 'clear' || r.bar == null), isDWany = r => r.label === 'different_work', isCont = r => r.label === 'container';
  const pc = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');
  const res = {};
  for (const route of Object.keys(DRAW)) {
    const all = rows.filter(r => r.route === route), uni = all.filter(r => !r.topup), P = frameJ.pop[route];
    if (!P) continue;
    const kW = uni.filter(isDWany).length, kS = uni.filter(isDW).length, kC = uni.filter(isCont).length;
    // per book: post-stratified by size band, with the 6+ top-up, weighted to population books
    let bookEst = 0, bookN = 0; const bands = {};
    for (const b of ['2', '3-5', '6+']) {
      const inB = all.filter(r => band(r.n) === b), bk = inB.reduce((s, r) => s + r.n, 0), bad = inB.filter(isDWany).reduce((s, r) => s + r.n, 0);
      bands[b] = { pop: P.bands[b].clusters, sampled: inB.length, differentWork: inB.filter(isDWany).length, rate: pc(inB.filter(isDWany).length, inB.length), wilson: wilson(inB.filter(isDWany).length, inB.length) };
      if (bk) { bookEst += P.bands[b].books * bad / bk; bookN += P.bands[b].books; }
    }
    // cluster bootstrap for the book rate (1,000 resamples within band, seeded); Wilson does not apply to a clustered rate
    let x = parseInt(sha(`${SEED}:boot:${route}`).slice(0, 8), 16); const rnd = () => { x = Math.imul(x ^ (x >>> 15), 1 | x) + 0x6D2B79F5; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const boots = [];
    for (let i = 0; i < 1000; i++) {
      let e = 0, tot = 0;
      for (const b of ['2', '3-5', '6+']) { const inB = all.filter(r => band(r.n) === b); if (!inB.length) continue; let bk = 0, bad = 0; for (let j = 0; j < inB.length; j++) { const r = inB[Math.floor(rnd() * inB.length)]; bk += r.n; if (isDWany(r)) bad += r.n; } e += P.bands[b].books * bad / bk; tot += P.bands[b].books; }
      boots.push(e / tot);
    }
    boots.sort((a, b) => a - b);
    res[route] = { popClusters: P.clusters, popBooks: P.books, sampledUniform: uni.length, topup: all.length - uni.length,
      differentWork: kW, differentWorkRate: pc(kW, uni.length), differentWorkWilson: wilson(kW, uni.length), estClusters: Math.round(P.clusters * kW / (uni.length || 1)),
      clearOnly: kS, clearOnlyRate: pc(kS, uni.length), container: kC, containerRate: pc(kC, uni.length), plusContainer: pc(kW + kC, uni.length), plusContainerWilson: wilson(kW + kC, uni.length),
      volumeOrPartJudged: uni.filter(r => r.verdict === 'contains_volume_or_part').length, volumeOrPartRead: uni.filter(r => r.label === 'volume_or_part').length,
      undecided: uni.filter(r => r.label === 'undecided').length, unread: uni.filter(r => !r.label).length,
      bookRate: bookN ? `${(100 * bookEst / bookN).toFixed(1)}%` : '—', bookBoot: [+(boots[25] * 100).toFixed(1), +(boots[975] * 100).toFixed(1)], bands };
  }
  fs.writeFileSync(`${S}/score.json`, JSON.stringify(res, null, 1));
  // the list: different work first, then container; an edition with added pieces is a container at bar arguable
  fs.writeFileSync(`${S}/confirmed.jsonl`, ['different_work', 'container'].flatMap(k => rows.filter(r => r.label === k).sort(ord)).map(r => JSON.stringify({ work_id: r.id, route: r.route, topup: r.topup, n_books: r.n, kind: r.label, bar: r.bar, evidence: r.evidence, judge: r.verdict, note: r.note })).join('\n') + '\n');
  console.log(JSON.stringify(res, null, 1));
  // judge against the second read
  const cross = {}; for (const r of rows.filter(r => r.label)) { const k = `${r.verdict} -> ${r.label}`; cross[k] = (cross[k] || 0) + 1; }
  console.log(cross);
  console.log('verdict totals', rows.reduce((o, r) => { o[r.verdict] = (o[r.verdict] || 0) + 1; return o; }, {}));
}

const [,, cmd, a, b, c] = process.argv;
const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
if (cmd === 'frame') await frame(a, b);
else if (cmd === 'candidates') candidates(a, b);
else if (cmd === 'judge') await judge(a, b, c, +opt('conc', 3));
else if (cmd === 'planted') planted(a, b);
else if (cmd === 'readlist') readlist(a, b);
else if (cmd === 'score') score(a, b);
else { console.error('usage: see the header'); process.exit(2); }

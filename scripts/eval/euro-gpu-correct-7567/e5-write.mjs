#!/usr/bin/env node
// PRIOR ART: write-back.mjs (this directory, E2: the best judged read per page, the #7522 pick rule, the prompt rebuilt
// and hash-checked, laid out for cli-ocr.mjs apply) and scripts/eval/ocr-per-call-7522/judge.mjs (the sealed `claude -p`
// Opus call: Read only, no MCP, no session, API keys stripped). E5 adds the E3 guards between the pick and the write:
// scripts/lib/correction-diff-guard.mjs (long-s pass; negation / number / expansion changes held for an image check).
/**
 * e5-write.mjs — #7567 E5 useful output: each judged page's best judged read, guarded, laid out for cli-ocr.mjs apply.
 *
 *   node --env-file=… e5-write.mjs plan    J=<e5 dir>   picks + long-s pass + diff flags vs the STORED text → <J>/write/plan.json
 *   node --env-file=… e5-write.mjs confirm J=<e5 dir> [--jobs=3]   blind Opus image check of every flag → <J>/write/confirm/<slug>.json
 *   node --env-file=… e5-write.mjs layout  J=<e5 dir> --out=DIR     verdicts applied; apply-ready reads in DIR
 *
 * PICK (#7522 / E2): a candidate is a writable arm the judge saw (a, a2, c: agy Flash low WITH the image) whose text is
 * its own (not shared with L, the stored text); clean = usable with no omission, addition, bleed or order error; it
 * must beat L inside the same judge call (L not clean, or both clean and fewer misreads). Fewest misreads wins; ties
 * c, a, a2. Ties with L keep L (nothing written).
 * GUARDS (E3), on the pick, against what readers have now (L): the long-s pass (never-word f-forms; ſ folded when L has
 * none), then correctionDiffs(L, pick). Every flag goes to one image check per page, shown blind as "reading 1 / 2" in a
 * seeded order: the pick's change stays where the check gives it the pick, goes back to L's words where it gives it L,
 * and the page is held when any flag is undecided (both wrong, cannot tell, no answer).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { contentHash } from '../../lib/write-provenance.mjs';
import { correctionDiffs, applyDiffVerdicts, longSPass } from '../../lib/correction-diff-guard.mjs';

const MODE = process.argv[2];
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J; if (!J) { console.error('J=<e5 dir> required'); process.exit(2); }
const W = path.join(J, 'write'); fs.mkdirSync(path.join(W, 'confirm'), { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const jl = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id, r]));
const panel = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(J, 'panel.json'), 'utf8')).pages.map((p) => [p.slug, p]));
const ORDER = ['c', 'a', 'a2'];
const DRAFT_OF = { a: 'L', a2: 'L', c: 'X' };
const clean = (v) => v && v.usable && !v.omissions?.length && !v.additions?.length && !v.cross_page_bleed?.length && !v.order_errors?.length;
function draftText(t) {  // e2-correct.mjs draftText, unchanged
  t = String(t || '').replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  if (/<HistoricalDocument|<Metadata>/.test(t)) {
    t = t.replace(/<Metadata>[\s\S]*?<\/Metadata>/g, '').replace(/<\/(Line|Paragraph|Heading|PageNumber|Header|Footer)>/g, '\n')
      .replace(/<[^>\n]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n\s*\n\s*\n+/g, '\n\n')
      .split('\n').map((l) => l.trim()).join('\n');
  }
  return t.trim();
}

if (MODE === 'plan') {
  const key = JSON.parse(fs.readFileSync(path.join(J, 'judge-key.json'), 'utf8'));
  const L = jl(path.join(J, 'drafts', 'L.jsonl'));
  const verdicts = {};
  const od = path.join(J, 'judge-run', 'judge', 'out');
  for (const f of fs.readdirSync(od)) { const r = JSON.parse(fs.readFileSync(path.join(od, f), 'utf8')); if (r.verdict) verdicts[r.page_id] = r.verdict.versions; }
  const plan = {}; const stats = { judged: 0, picked: 0, by_arm: {}, flags: { negation: 0, number: 0, expansion: 0 }, pages_flagged: 0, long_s_tells: 0, long_s_folded_pages: 0 };
  for (const [slug, k] of Object.entries(key)) {
    const v = verdicts[slug]; if (!v) continue; stats.judged++;
    const sLab = Object.entries(k.labels).find(([, arms]) => arms.includes('L'))?.[0];
    const sv = sLab ? v[sLab] : null;
    let best = null;
    for (const [lab, arms] of Object.entries(k.labels)) {
      if (lab === sLab) continue;
      const a = ORDER.find((x) => arms.includes(x)); if (!a) continue;
      const c = v[lab]; if (!clean(c)) continue;
      if (!(!sv || !clean(sv) || c.misreads.length < sv.misreads.length)) continue;
      const cand = { arm: a, label: lab, misreads: c.misreads.length, stored_clean: !!clean(sv), stored_misreads: sv ? sv.misreads.length : null };
      if (!best || cand.misreads < best.misreads || (cand.misreads === best.misreads && ORDER.indexOf(a) < ORDER.indexOf(best.arm))) best = cand;
    }
    if (!best) continue;
    const p = panel[slug]; const stored = L[slug].text;
    const r = JSON.parse(fs.readFileSync(path.join(J, 'arms', best.arm, `${slug}.json`), 'utf8'));
    const ls = longSPass(r.text, { lang: p.lang, convention: stored });
    const { flags } = correctionDiffs(stored, ls.text, { lang: p.lang });
    plan[slug] = { ...best, page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, lang: p.lang, read_sha256: sha(r.text), guarded_sha256: sha(ls.text),
      long_s: { tells: ls.tells, folded: ls.folded }, flags };
    fs.writeFileSync(path.join(W, `${slug}.guarded.txt`), ls.text);
    stats.picked++; stats.by_arm[best.arm] = (stats.by_arm[best.arm] || 0) + 1; stats.long_s_tells += ls.tells.length; stats.long_s_folded_pages += ls.folded > 0;
    if (flags.length) stats.pages_flagged++; for (const f of flags) stats.flags[f.kind]++;
  }
  fs.writeFileSync(path.join(W, 'plan.json'), JSON.stringify({ stats, plan }, null, 1));
  console.log(JSON.stringify(stats));
} else if (MODE === 'confirm') {
  const { plan } = JSON.parse(fs.readFileSync(path.join(W, 'plan.json'), 'utf8'));
  const L = jl(path.join(J, 'drafts', 'L.jsonl'));
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete env[k];
  const todo = Object.entries(plan).filter(([s, x]) => x.flags.length && !fs.existsSync(path.join(W, 'confirm', `${s}.json`)));
  console.log(`${todo.length} pages to confirm`);
  let stop = null;
  const call = (prompt, cwd) => new Promise((res) => {
    const t0 = Date.now();
    const ch = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.stdin.end(prompt);
    const timer = setTimeout(() => ch.kill('SIGKILL'), 15 * 60 * 1000);
    ch.on('close', () => { clearTimeout(timer); let j = {}; try { j = JSON.parse(out); } catch { /* */ } res({ text: String(j.result ?? ''), is_error: !!j.is_error, err: (err || out).slice(-300), secs: (Date.now() - t0) / 1000, usage: j.usage ?? null }); });
  });
  const worker = async () => {
    while (todo.length && !stop) {
      const [slug, x] = todo.shift(); const p = panel[slug];
      const guarded = fs.readFileSync(path.join(W, `${slug}.guarded.txt`), 'utf8');
      const rng = (i) => parseInt(sha(`7567e5c${slug}${i}`).slice(0, 8), 16) % 2;
      const items = x.flags.map((f) => { const swap = rng(f.i) === 1; return { i: f.i, swap, r1: swap ? f.context_next : f.context_draft, r2: swap ? f.context_draft : f.context_next, d1: swap ? f.next : f.draft, d2: swap ? f.draft : f.next }; });
      const prompt = `You are checking a few places in a transcription of one printed page against the page image. The book: ${p.title} (${p.year}). Open the page image with the Read tool: this.jpg (in the current directory). Read the relevant lines closely.

At each place below, two readings of the same stretch of text disagree (the differing words are given after "differs:"; an empty side means that reading has no words there). Decide which reading is what the page actually prints at that place: answer "1", "2", "both wrong" (the page prints something else) or "cannot tell" (illegible or not found). Spelling conventions (long s as s, u/v, i/j, expanded abbreviations) are not differences.

${items.map((it, n) => `PLACE ${n + 1}\n  reading 1: «${it.r1}»   differs: «${it.d1}»\n  reading 2: «${it.r2}»   differs: «${it.d2}»`).join('\n\n')}

Reply with ONE JSON object and nothing else: {"answers":{${items.map((_, n) => `"${n + 1}":"1|2|both wrong|cannot tell"`).join(',')}}}`;
      const cwd = path.join(W, 'cwd', slug); fs.rmSync(cwd, { recursive: true, force: true }); fs.mkdirSync(cwd, { recursive: true });
      fs.copyFileSync(path.join(J, 'img', `${slug}.jpg`), path.join(cwd, 'this.jpg'));
      let r, ans = null;
      for (let at = 0; at < 2 && !ans; at++) {
        r = await call(prompt, cwd);
        if (/usage limit|limit reached|hit your limit|out of extra usage/i.test(r.text + r.err)) { stop = r.text || r.err; break; }
        try { const s = r.text; ans = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)).answers; } catch { ans = null; }
      }
      fs.rmSync(cwd, { recursive: true, force: true });
      if (stop) break;
      const verdicts = items.map((it, n) => { const a = String(ans?.[String(n + 1)] ?? '').trim(); const pickIs = it.swap ? '1' : '2';
        return { i: it.i, answer: a, winner: a === pickIs ? 'next' : (a === '1' || a === '2') ? 'draft' : 'undecided' }; });
      fs.writeFileSync(path.join(W, 'confirm', `${slug}.json`), JSON.stringify({ slug, guarded_sha256: sha(guarded), items, verdicts, raw: r.text, secs: r.secs, usage: r.usage }, null, 1));
      console.log(`  ${slug}: ${verdicts.map((v) => v.winner[0]).join('')}`);
    }
  };
  await Promise.all(Array.from({ length: Number(arg('jobs', '3')) }, worker));
  if (stop) { console.error(`STOPPED: ${String(stop).slice(0, 200)}`); process.exit(3); }
} else if (MODE === 'layout') {
  const OUT = arg('out'); if (!OUT) { console.error('--out required'); process.exit(2); }
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const { plan } = JSON.parse(fs.readFileSync(path.join(W, 'plan.json'), 'utf8'));
  const L = jl(path.join(J, 'drafts', 'L.jsonl')); const X = jl(path.join(J, 'drafts', 'X.jsonl'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const agyVersion = spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout?.trim() || null;
  const refused = {}; const laid = []; const guard = { kept: 0, reverted: 0, held: 0, long_s_tells: 0 };
  for (const [slug, x] of Object.entries(plan)) {
    const book = await db.collection('books').findOne({ id: x.book_id }, { projection: { 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'pipeline_auto.held': 1 } });
    if (book?.pipeline_auto?.status === 'held' || book?.pipeline_auto?.hold || book?.pipeline_auto?.held) { refused[slug] = 'book held'; continue; }
    let text = fs.readFileSync(path.join(W, `${slug}.guarded.txt`), 'utf8');
    let g = { flags: x.flags.length, kept: 0, reverted: 0 };
    if (x.flags.length) {
      const cf = path.join(W, 'confirm', `${slug}.json`);
      if (!fs.existsSync(cf)) { refused[slug] = 'diff flags not checked against the image'; continue; }
      const conf = JSON.parse(fs.readFileSync(cf, 'utf8'));
      if (conf.guarded_sha256 !== sha(text)) { refused[slug] = 'the image check was made on another text'; continue; }
      const r = applyDiffVerdicts(L[slug].text, text, x.flags, conf.verdicts);
      if (r.text == null) { refused[slug] = `held: ${r.undecided} change(s) the image check could not decide`; guard.held++; continue; }
      text = r.text; g = { flags: x.flags.length, kept: r.kept, reverted: r.reverted }; guard.kept += r.kept; guard.reverted += r.reverted;
    }
    guard.long_s_tells += x.long_s.tells.length;
    const rec = JSON.parse(fs.readFileSync(path.join(J, 'arms', x.arm, `${slug}.json`), 'utf8'));
    if (rec.outcome !== 'corrected') { refused[slug] = `outcome ${rec.outcome}`; continue; }
    const T = fs.readFileSync(path.join(J, 'e2', 'prompts', `${x.arm}-${rec.template_hash}.txt`), 'utf8');
    const draft = DRAFT_OF[x.arm] === 'L' ? draftText(L[slug].text) : draftText(X[slug].text);
    const sent = `${T.split('{draft}').join(draft).split('{draft2}').join('')} @./page.jpg`;
    if (sha(sent).slice(0, 16) !== rec.sent_hash) { refused[slug] = 'prompt sent cannot be reconstructed'; continue; }
    const img = fs.readFileSync(path.join(J, 'img', `${slug}.jpg`));
    const pid = x.page_id;
    fs.writeFileSync(path.join(OUT, `${pid}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${pid}.prompt.txt`), sent);
    fs.writeFileSync(path.join(OUT, `${pid}.meta.json`), JSON.stringify({
      page_id: pid, book_id: x.book_id, page_number: x.page_number, exit: 0, wrapper: null, cli: 'agy', cli_version: agyVersion, model: rec.model,
      started_at: new Date(Date.parse(rec.finished_at) - (rec.secs || 0) * 1000).toISOString(), finished_at: rec.finished_at,
      image_sha256: sha(img), image_bytes: img.length, image_url: panel[slug].served_image,
      prompt_sent_file: `${pid}.prompt.txt`, prompt_sent_hash: contentHash(sent), chars: text.length,
      eval_pick: { issue: 7567, stage: 'E5', arm: x.arm, draft: x.arm === 'c' ? `${X[slug].engine} (GPU, gex45)` : `stored ${L[slug].model}`, misreads: x.misreads, stored_clean: x.stored_clean, stored_misreads: x.stored_misreads,
        read_sha256: x.read_sha256, long_s_pass: x.long_s, diff_guard: g },
    }, null, 1));
    laid.push(pid);
  }
  await c.close();
  fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify({ id: '6ac02220413a82637da889bb', name: 'Standard OCR', version: '19.1', hash: '9d8f959e053491362b2c4acec1e20c9a' }));
  fs.writeFileSync(path.join(W, 'layout.json'), JSON.stringify({ laid, refused, guard }, null, 1));
  console.log(JSON.stringify({ picked: Object.keys(plan).length, laid: laid.length, refused: Object.keys(refused).length, guard }));
} else { console.error('mode: plan | confirm | layout'); process.exit(2); }

#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-per-call-7522/pick-best.mjs (#7522: per page the best Opus-judged read — usable, no
// omission, addition, bleed or order error, then fewest misreads — laid out for `cli-ocr.mjs apply`). Its reads were made
// by `cli-ocr.mjs read`, so their metas already had apply's shape; these were made by e2-correct.mjs (agy) and by #6740's
// Opus corrector, so this writes that shape, with each read's exact prompt rebuilt and hash-checked against its record.
/**
 * write-back.mjs — #7567 useful output (Derek, inbox 2026-10-27T21:15Z): for each panel page that is one of OUR pages,
 * the best judged read, written through cli-ocr.mjs apply with every guard, and only when it beats the stored OCR.
 *
 *   node --env-file=<main>/.env.production.local write-back.mjs --out=<dir>     then
 *   node --env-file=… scripts/batch/cli-ocr.mjs apply --out=<dir> --reason="…" [--apply]
 *
 * Pick, per page, inside each judge call (S, the stored OCR, is in both of a page's packets):
 *   clean = usable, and no omission, addition, cross-page bleed or order error;
 *   a candidate is any WRITABLE arm the judge saw — agy with the image (a a2 b c d e) or Opus (f); never a no-image arm,
 *   never a bare GPU draft (no transcription header) — whose text is the arm's own (a label shared with S is not new);
 *   it BEATS S when it is clean and S is not, or both are clean and it has fewer misreads.
 *   The page's pick is the beating candidate with the fewest misreads (ties: lite packet, then a, a2, f, b, c, d, e).
 * Refused before apply: a book under a pipeline hold, a page whose served image is not the image the read saw
 * (image-check.py corr < 0.95), a page edited by a person.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { contentHash } from '../../lib/write-provenance.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J || '/root/jobs/euro-gpu-correct-7567';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = arg('out'); if (!OUT) { console.error('--out required'); process.exit(2); }
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const PC = '/root/jobs/pareto-chains-6740';
const ORDER = ['a', 'a2', 'f', 'b', 'c', 'd', 'e'];
const WRITABLE = new Set(ORDER);
const crypto = await import('node:crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const panel = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, 'panel.json'), 'utf8')).pages.map((p) => [p.slug, p]));
const jl = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id || r.slug, r]));
const S = jl(path.join(J, 'drafts', 'S.jsonl'));
const IMG = jl(path.join(J, 'image-check.jsonl'));
const key = JSON.parse(fs.readFileSync(path.join(J, 'judge-key.json'), 'utf8'));
const verdicts = {};
for (const f of fs.readdirSync(path.join(J, 'judge-run', 'judge', 'out'))) { const r = JSON.parse(fs.readFileSync(path.join(J, 'judge-run', 'judge', 'out', f), 'utf8')); if (r.verdict) verdicts[r.page_id] = r.verdict.versions; }

const clean = (v) => v && v.usable && !v.omissions?.length && !v.additions?.length && !v.cross_page_bleed?.length && !v.order_errors?.length;
const choice = {};
for (const [name, k] of Object.entries(key)) {
  const v = verdicts[name]; if (!v) continue;
  const p = panel[k.slug]; if (!S[k.slug]?.sl_page_id) continue;            // not one of our pages
  const sLab = Object.entries(k.labels).find(([, arms]) => arms.includes('S'))?.[0];
  const sv = sLab ? v[sLab] : null;                                          // S missing = stored OCR empty / not shown
  for (const [lab, arms] of Object.entries(k.labels)) {
    if (lab === sLab) continue;
    const arm = ORDER.find((a) => arms.includes(a)); if (!arm) continue;
    const c = v[lab]; if (!clean(c)) continue;
    const beats = !sv || !clean(sv) || c.misreads.length < sv.misreads.length;
    if (!beats) continue;
    const cand = { arm, group: k.group, misreads: c.misreads.length, s_clean: !!clean(sv), s_misreads: sv ? sv.misreads.length : null, s_shown: !!sv };
    const cur = choice[k.slug];
    const better = !cur || cand.misreads < cur.misreads || (cand.misreads === cur.misreads && (cand.group === 'lite' && cur.group !== 'lite' || (cand.group === cur.group && ORDER.indexOf(cand.arm) < ORDER.indexOf(cur.arm))));
    if (better) choice[k.slug] = cand;
  }
}

// Holds, edits and image identity, read before anything is laid out.
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const refused = {};
const TEMPLATES = {};
const tpl = (arm, h) => { const f = path.join(J, 'e2', 'prompts', `${arm}-${h}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const draftsOf = (arm) => ({ a: ['L'], a2: ['L'], b: ['G'], c: ['X'], d: ['G', 'X'], e: [] }[arm]);
const DR = {}; const draft = (e) => (DR[e] ??= Object.fromEntries(Object.entries(jl(path.join(J, 'drafts', `${e}.jsonl`))).map(([k, r]) => [k, r.text])));
function draftText(t) {  // e2-correct.mjs draftText, unchanged
  t = String(t || '').replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  if (/<HistoricalDocument|<Metadata>/.test(t)) {
    t = t.replace(/<Metadata>[\s\S]*?<\/Metadata>/g, '').replace(/<\/(Line|Paragraph|Heading|PageNumber|Header|Footer)>/g, '\n')
      .replace(/<[^>\n]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n\s*\n\s*\n+/g, '\n\n')
      .split('\n').map((l) => l.trim()).join('\n');
  }
  return t.trim();
}
const agyVersion = (await import('node:child_process')).spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout?.trim() || null;
const OPUS_PROMPT = fs.readFileSync(path.join(PC, 'corr', 'prompts', 'opus-0e94c1082ca6e456.txt'), 'utf8');
let laid = 0;
for (const [slug, ch] of Object.entries(choice)) {
  const p = panel[slug], s = S[slug];
  const page = await db.collection('pages').findOne({ id: s.sl_page_id }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.updated_at': 1 } });
  const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1 } });
  if (book?.pipeline_auto?.status === 'held' || book?.pipeline_auto?.hold) { refused[slug] = 'book held'; continue; }
  if (page.ocr?.edited_by || page.ocr?.source === 'manual') { refused[slug] = 'human-edited'; continue; }
  if (!(IMG[slug]?.corr >= 0.95)) { refused[slug] = `served image is not the read's image (corr ${IMG[slug]?.corr})`; continue; }
  const imgBuf = fs.readFileSync(path.join(J, 'img', `${slug}.jpg`));
  let text, meta;
  if (ch.arm === 'f') {
    const r = JSON.parse(fs.readFileSync(path.join(PC, 'corr', 'gemini-3.1-flash-lite>claude-opus-5-5+claude-cli', p.pc_stratum, `${slug}.json`), 'utf8'));
    if (r.outcome !== 'corrected') { refused[slug] = `opus outcome ${r.outcome}: the text is the lite draft, not a read`; continue; }
    if (contentHash(OPUS_PROMPT) !== r.prompt_sent_hash) { refused[slug] = 'opus prompt cannot be reconstructed'; continue; }
    text = r.text;
    // the CLI version #6740's run recorded in its stream-json transcripts (system init `claude_code_version`)
    const trs = fs.readdirSync(path.join(PC, 'corr', 'transcripts')).filter((f) => f.includes(slug) && f.includes('claude'));
    const ver = trs.map((f) => fs.readFileSync(path.join(PC, 'corr', 'transcripts', f), 'utf8').match(/"claude_code_version":"([^"]+)"/)?.[1]).find(Boolean);
    if (!ver) { refused[slug] = 'opus transcript has no CLI version'; continue; }
    meta = { cli: 'claude', cli_version: ver, model: r.model, started_at: r.started_at, finished_at: r.finished_at, prompt_text: OPUS_PROMPT, read_note: '#6740 lite→Opus correction (correct.mjs instruction, d01.txt + p01.jpg)' };
  } else {
    const r = JSON.parse(fs.readFileSync(path.join(J, 'e2', ch.arm, `${slug}.json`), 'utf8'));
    if (r.outcome !== 'corrected' && r.outcome !== 'read') { refused[slug] = `outcome ${r.outcome}`; continue; }
    const T = tpl(ch.arm, r.template_hash); if (!T) { refused[slug] = 'template file missing'; continue; }
    const ds = draftsOf(ch.arm).map((e) => (e === 'L' ? draft('L')[slug] : draftText(draft(e)[slug])));
    const sent = `${T.split('{draft}').join(ds[0] ?? '').split('{draft2}').join(ds[1] ?? '')} @./page.jpg`;
    if (sha(sent).slice(0, 16) !== r.sent_hash) { refused[slug] = 'prompt sent cannot be reconstructed'; continue; }
    text = r.text;
    meta = { cli: 'agy', cli_version: agyVersion, model: r.model, started_at: new Date(Date.parse(r.finished_at) - (r.secs || 0) * 1000).toISOString(), finished_at: r.finished_at, prompt_text: sent, read_note: `#7567 E2 arm ${ch.arm}` };
  }
  const key2 = page.id;
  fs.writeFileSync(path.join(OUT, `${key2}.txt`), text);
  fs.writeFileSync(path.join(OUT, `${key2}.prompt.txt`), meta.prompt_text);
  fs.writeFileSync(path.join(OUT, `${key2}.meta.json`), JSON.stringify({
    page_id: page.id, book_id: page.book_id, page_number: page.page_number, exit: 0, wrapper: null, cli: meta.cli, cli_version: meta.cli_version,
    model: meta.model, started_at: meta.started_at, finished_at: meta.finished_at, image_sha256: sha(imgBuf), image_bytes: imgBuf.length, image_url: IMG[slug].served_image,   // the served image image-check.py compared (corr >= 0.95)
   
    prompt_sent_file: `${key2}.prompt.txt`, prompt_sent_hash: contentHash(meta.prompt_text), chars: text.length,
    eval_pick: { issue: 7567, arm: ch.arm, packet: ch.group, misreads: ch.misreads, stored_clean: ch.s_clean, stored_misreads: ch.s_misreads, stored_shown: ch.s_shown, note: meta.read_note, image_corr_served: IMG[slug]?.corr },
  }, null, 1));
  laid++;
}
await c.close();
fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify({ id: '6ac02220413a82637da889bb', name: 'Standard OCR', version: '19.1', hash: '9d8f959e053491362b2c4acec1e20c9a' }));
fs.writeFileSync(path.join(J, 'write-choice.json'), JSON.stringify({ choice, refused }, null, 1));
const byArm = {}; for (const ch of Object.values(choice)) byArm[ch.arm] = (byArm[ch.arm] || 0) + 1;
console.log(JSON.stringify({ library_packets_judged: Object.keys(key).filter((n) => S[key[n].slug]?.sl_page_id && verdicts[n]).length, picked: Object.keys(choice).length, laid_out: laid, refused, by_arm: byArm }));

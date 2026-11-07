#!/usr/bin/env node
// PRIOR ART: scripts/eval/euro-gpu-correct-7567/write-back.mjs (#7567: per panel page that is ours, the best judged
// read laid out for `cli-ocr.mjs apply`, prompts rebuilt and hash-checked, held / human-edited / image-mismatch pages
// refused). Copied and changed for this job's arms: C2 (#7567 template, draft X), D (d-diff.mjs, its --dump-sent
// prompts), Od (o-read.mjs, its saved prompts). And one thing that file did not need: #7567 already rewrote 91 of
// these pages, so the stored OCR is compared by TEXT against the versions the judge saw, and a page whose stored text
// is none of them is refused (the judge never saw what it would replace).
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local write-back.mjs --set=test --out=<dir>
 *   node --env-file=… scripts/batch/cli-ocr.mjs apply --out=<dir> --reason="…" [--apply]
 * Pick per page: a candidate (C2, D, Od) is clean (usable; no omission, addition, bleed or order error) and BEATS the
 * stored text's own verdict in the same call (stored not clean, or both clean and fewer misreads). Fewest misreads
 * wins; ties D, C2, Od. The stored text must equal a judged version (S, or an arm #7567 wrote: O/f, C).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { contentHash } from '../../lib/write-provenance.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J || '/root/jobs/gpu-flash-vs-opus-7263'; const E = '/root/jobs/euro-gpu-correct-7567';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SET = arg('set', 'test'); const OUT = arg('out'); if (!OUT) { console.error('--out required'); process.exit(2); }
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const ORDER = ['D', 'C2', 'Od'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const jl = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id || r.slug, r]));
const S = jl(path.join(E, 'drafts', 'S.jsonl')); const IMG = jl(path.join(E, 'image-check.jsonl'));
const key = JSON.parse(fs.readFileSync(path.join(J, `judge-${SET}`, 'key.json'), 'utf8'));
const textOf = {};  // slug -> label -> text, from the packets the judge saw
const verdicts = {};
for (const s of Object.keys(key.pages)) {
  const pf = path.join(J, `judge-${SET}`, 'judge', 'packets', `${s}.json`); const of = path.join(J, `judge-${SET}`, 'judge', 'out', `${s}.json`);
  if (!fs.existsSync(pf) || !fs.existsSync(of)) continue;
  const v = JSON.parse(fs.readFileSync(of, 'utf8')).verdict; if (!v) continue;
  verdicts[s] = v.versions; textOf[s] = Object.fromEntries(JSON.parse(fs.readFileSync(pf, 'utf8')).versions.map((x) => [x.label, x.text]));
}
const clean = (v) => v && v.usable && !v.omissions?.length && !v.additions?.length && !v.cross_page_bleed?.length && !v.order_errors?.length;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const choice = {}; const refused = {};
const tplC = fs.readFileSync(path.join(HERE, '..', 'euro-gpu-correct-7567', 'prompts', 'agy-0601ef30e816f7a7.txt'), 'utf8');
function draftText(t) {  // e2-correct.mjs draftText, unchanged
  t = String(t || '').replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  if (/<HistoricalDocument|<Metadata>/.test(t)) {
    t = t.replace(/<Metadata>[\s\S]*?<\/Metadata>/g, '').replace(/<\/(Line|Paragraph|Heading|PageNumber|Header|Footer)>/g, '\n')
      .replace(/<[^>\n]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n\s*\n\s*\n+/g, '\n\n')
      .split('\n').map((l) => l.trim()).join('\n');
  }
  return t.trim();
}
const X = Object.fromEntries(Object.entries(jl(path.join(J, 'drafts', 'X.jsonl'))).map(([k, r]) => [k, draftText(r.text)]));
const sentD = path.join(J, 'sent-D-r1');
const agyVersion = spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout?.trim() || null;
const claudeVersion = spawnSync('/root/.local/bin/claude', ['--version'], { encoding: 'utf8' }).stdout?.trim().split(' ')[0] || null;
let laid = 0;
for (const [s, k] of Object.entries(key.pages)) {
  const v = verdicts[s]; if (!v || !S[s]?.sl_page_id) continue;          // judged, and one of our pages
  const page = await db.collection('pages').findOne({ id: S[s].sl_page_id }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.updated_at': 1 } });
  if (!page) { refused[s] = 'page not found'; continue; }
  const stored = String(page.ocr?.data || '').trim();
  const sLab = Object.entries(textOf[s]).find(([, t]) => t.trim() === stored)?.[0];
  if (stored && !sLab) { refused[s] = 'stored OCR is none of the judged versions'; continue; }
  const sv = sLab ? v[sLab] : null;
  let best = null;
  for (const [lab, arms] of Object.entries(k.labels)) {
    if (lab === sLab) continue;
    const arm = ORDER.find((a) => arms.includes(a)); if (!arm) continue;
    const cv = v[lab]; if (!clean(cv)) continue;
    if (!(!sv || !clean(sv) || cv.misreads.length < sv.misreads.length)) continue;
    const cand = { arm, label: lab, misreads: cv.misreads.length, stored_label_arms: sLab ? k.labels[sLab] : null, stored_clean: !!clean(sv), stored_misreads: sv ? sv.misreads.length : null };
    if (!best || cand.misreads < best.misreads || (cand.misreads === best.misreads && ORDER.indexOf(arm) < ORDER.indexOf(best.arm))) best = cand;
  }
  if (!best) continue;
  const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1 } });
  if (book?.pipeline_auto?.status === 'held' || book?.pipeline_auto?.hold) { refused[s] = 'book held'; continue; }
  if (page.ocr?.edited_by || page.ocr?.source === 'manual') { refused[s] = 'human-edited'; continue; }
  if (!(IMG[s]?.corr >= 0.95)) { refused[s] = `served image is not the read's image (corr ${IMG[s]?.corr})`; continue; }
  const imgBuf = fs.readFileSync(path.join(J, 'img', `${s}.jpg`));
  let r, sent, meta;
  if (best.arm === 'Od') {
    r = JSON.parse(fs.readFileSync(path.join(J, 'O', `${s}.json`), 'utf8'));
    sent = fs.readFileSync(path.join(J, 'O', 'prompts', `${r.sent_hash}.txt`), 'utf8');
    if (sha(sent).slice(0, 16) !== r.sent_hash || r.image_sha256 !== sha(imgBuf)) { refused[s] = 'Od prompt or image cannot be matched'; continue; }
    meta = { cli: 'claude', cli_version: claudeVersion, read_note: '#7263 arm O-direct (o-read.mjs: live OCR prompt + callInstruction(1), p01.jpg)' };
  } else {
    r = JSON.parse(fs.readFileSync(path.join(J, 'e2', best.arm === 'D' ? 'D-r1' : 'c2', `${s}.json`), 'utf8'));
    sent = best.arm === 'D' ? fs.readFileSync(path.join(sentD, `${s}.txt`), 'utf8') : `${tplC.split('{draft}').join(X[s] ?? '')} @./page.jpg`;
    if (sha(sent).slice(0, 16) !== r.sent_hash) { refused[s] = 'prompt sent cannot be reconstructed'; continue; }
    meta = { cli: 'agy', cli_version: agyVersion, read_note: `#7263 arm ${best.arm}` };
  }
  if (!['corrected', 'read'].includes(r.outcome)) { refused[s] = `outcome ${r.outcome}`; continue; }
  if (r.text.trim() !== textOf[s][best.label].trim()) { refused[s] = 'read text is not the judged text'; continue; }
  const id = page.id;
  fs.writeFileSync(path.join(OUT, `${id}.txt`), r.text);
  fs.writeFileSync(path.join(OUT, `${id}.prompt.txt`), sent);
  fs.writeFileSync(path.join(OUT, `${id}.meta.json`), JSON.stringify({
    page_id: id, book_id: page.book_id, page_number: page.page_number, exit: 0, wrapper: null, cli: meta.cli, cli_version: meta.cli_version, model: r.model,
    started_at: new Date(Date.parse(r.finished_at) - (r.secs || 0) * 1000).toISOString(), finished_at: r.finished_at,
    image_sha256: sha(imgBuf), image_bytes: imgBuf.length, image_url: IMG[s].served_image,
    prompt_sent_file: `${id}.prompt.txt`, prompt_sent_hash: contentHash(sent), chars: r.text.length,
    eval_pick: { issue: 7263, arm: best.arm, misreads: best.misreads, stored_clean: best.stored_clean, stored_misreads: best.stored_misreads, stored_is: best.stored_label_arms, note: meta.read_note, image_corr_served: IMG[s]?.corr },
  }, null, 1));
  choice[s] = best; laid++;
}
await c.close();
fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify({ id: '6ac02220413a82637da889bb', name: 'Standard OCR', version: '19.1', hash: '9d8f959e053491362b2c4acec1e20c9a' }));
fs.writeFileSync(path.join(J, 'write-choice.json'), JSON.stringify({ choice, refused }, null, 1));
const byArm = {}; for (const ch of Object.values(choice)) byArm[ch.arm] = (byArm[ch.arm] || 0) + 1;
console.log(JSON.stringify({ laid_out: laid, refused, by_arm: byArm }));

#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-ditto-restore-5274/judge.mjs — the blind Opus judge this follows: its prompt, conventions,
// verdict words and swap controls are kept verbatim. It takes at most three labels (X/Y/Z) and asks every pairwise
// preference; the #5274 pilot compares up to six arms on one page, so this variant takes A–F and asks the verdicts only
// (pairwise gained/lost are computed from the verdicts and the marks scoring, not asked).
/**
 * judge-multi.mjs — blind Opus judge over the pilot's arms. Files only; no Mongo.
 *   JOB_SCRATCH=… node scripts/batch/zh-ditto-5274/judge-multi.mjs P0,OC,SC,FL,FR [--dir=judge5] [--conc=3]
 * Arms: P0 the stored Paddle text · OC Opus correct (s1 / s10 per-call 10) · SC Sonnet correct (s1-sonnet / s10-sonnet)
 *       FL agy flash-low correct · FM agy flash-medium correct · FR Opus fresh read (no draft).
 * Pages: $P/w/pages.json (pilot.mjs judge-prep: the 70 scored pages, image = the Archive's file), then 5 swap controls
 * (seed 52741): one arm's text replaced by another page's text of that arm. Writes $P/w/<dir>/<slug>.json and key.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { claudeCall } from '../claude-ocr.mjs';

const P = path.join(process.env.JOB_SCRATCH, 'pilot'); const W = path.join(P, 'w');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = path.join(W, arg('dir', 'judge-multi'));
const ARMS = (process.argv[2] || '').split(','); const CONC = Number(arg('conc', 3));
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, ARMS.length);
const r = makeRng(5274);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const ARM_DIR = { OC: { s1: 's1', s10: 's10' }, SC: { s1: 's1-sonnet', s10: 's10-sonnet' }, FL: 'a-flash-low', FM: 'a-flash-med', FR: 'a-fresh' };
/** The text the arm serves for page p: a correction's text, or the draft when it answered UNCHANGED; null when no answer. */
export function armText(arm, p) {
  const stored = fs.readFileSync(path.join(P, p.per_call === 's10' ? 's10' : 's1', 'stored', `${p.page_id}.txt`), 'utf8');
  if (arm === 'P0') return stored;
  const d = ARM_DIR[arm]; const dir = path.join(P, typeof d === 'string' ? d : d[p.per_call === 's10' ? 's10' : 's1'], 'reads');
  let meta; try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.page_id}.meta.json`), 'utf8')); } catch { return null; }
  if (arm === 'FR') return fs.existsSync(path.join(dir, `${p.page_id}.txt`)) ? fs.readFileSync(path.join(dir, `${p.page_id}.txt`), 'utf8') : null;
  if (meta.outcome === 'unchanged') return stored;
  if (meta.outcome !== 'corrected') return null;
  return fs.readFileSync(path.join(dir, `${p.page_id}.txt`), 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pages = JSON.parse(fs.readFileSync(path.join(W, 'pages.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const items = pages.map((p) => ({ uid: p.slug, p, order: shuffle(ARMS) }));
  const r2 = makeRng(52741); const zero = pages.filter((p) => p.set === 'zero');
  for (let i = 0; i < 5; i++) {
    const p = zero[Math.floor(r2() * zero.length)]; let o; do { o = zero[Math.floor(r2() * zero.length)]; } while (o === p);
    items.push({ uid: `swap${i}-${p.slug}`, p, order: shuffle(ARMS), swap: { arm: ARMS[i % ARMS.length], from: o.slug, other: o } });
  }
  fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(Object.fromEntries(items.map((x) => [x.uid, { labels: Object.fromEntries(LABELS.map((l, i) => [l, x.order[i]])), swap: x.swap ? { arm: x.swap.arm, from: x.swap.from } : null }])), null, 1));
  const prompt = `You are a careful reader of Classical Chinese. You judge ${LABELS.length} transcriptions of the SAME page, labelled ${LABELS.join(', ')}, against the page image. You do not know where any of them came from; do not guess. Open ./page.jpg and ${LABELS.map((l) => `./${l}.txt`).join(', ')} with the Read tool (the only tool you may use).

The page is from a Qing court rhyme or word dictionary. Conventions: vertical columns read top to bottom, right to left. A traditional ↔ simplified or variant-form (異體字) substitution of the SAME character is minor. Added modern punctuation is minor. A different character that changes the word, a dropped or doubled column, or columns read out of order so the text runs in the wrong sequence, is material. Interlinear small-character commentary (雙行小注) dropped is an omission. In this kind of book a short thin vertical stroke in a character cell is a ditto mark standing for a character of the entry's headword: it is part of the text.

Metadata tags (<header>, <page-num> …) are part of a transcription; judge them, but layout and tag differences alone are minor.

Per transcription, a verdict:
- misleading — a reader is misled about what the page says: a meaning change (a wrong word, number, name or negation that changes the sense), an omitted passage (a line or more of the page's text missing), or another leaf's text served as this one's.
- flawed — errors, but the gist is right: spelling, single letters, punctuation, normalisation that does not change the sense.
- sound — faithful to the page.
With the verdict, list up to 5 defects: the words as transcribed (quote), what the page has (print), and material (true when it changes or drops meaning). Also not_this_leaf (true when it is another leaf's text, not a misread).

Reply with one JSON object and nothing else:
{${LABELS.map((l) => `"${l}":{"verdict":"misleading|flawed|sound","not_this_leaf":false,"defects":[{"quote":"…","print":"…","material":true}]}`).join(',')},"why":"one or two lines, quoting the decisive words"}`;
  const done = (u) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `${u}.json`), 'utf8')).verdict; } catch { return null; } };
  const todo = items.filter((x) => !done(x.uid)); let i = 0, stop = null;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < todo.length && !stop) {
      const x = todo[i++];
      const texts = x.order.map((arm) => armText(arm, x.swap?.arm === arm ? x.swap.other : x.p));
      if (texts.some((t) => t == null)) { console.log(x.uid, 'SKIP: an arm has no text yet'); continue; }
      const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'zhjm-'));
      fs.copyFileSync(path.join(W, 'img/ia', `${x.p.slug}.jpg`), path.join(dir, 'page.jpg'));
      texts.forEach((t, k) => fs.writeFileSync(path.join(dir, `${LABELS[k]}.txt`), t));
      let v = null, res = null;
      for (let t = 0; t < 2 && !v; t++) {
        res = await claudeCall(prompt, 'opus', dir);
        if (res.cls === 'usage_limit') { stop = res.err; break; }
        try { v = JSON.parse(String(res.text).match(/\{[\s\S]*\}/)[0]); if (LABELS.some((l) => !v[l]?.verdict)) v = null; } catch { /* retried once */ }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      fs.writeFileSync(path.join(OUT, `${x.uid}.json`), JSON.stringify({ uid: x.uid, verdict: v, model: res?.model, usage: res?.usage, secs: res?.secs, raw: v ? undefined : String(res?.text).slice(0, 1000) }, null, 1));
      console.log(x.uid, v ? LABELS.map((l) => `${x.order[LABELS.indexOf(l)]}=${v[l]?.verdict}`).join(' ') : 'NO ANSWER');
    }
  }));
  if (stop) { console.error('STOPPED', stop); process.exit(3); }
}

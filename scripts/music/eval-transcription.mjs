#!/usr/bin/env node
/**
 * Score a candidate music transcription (ABC) against a reference (ABC).
 *
 * PRIOR ART: scripts/eval/ (OCR/translation scorecards) — text metrics (CER,
 * chrF) are the wrong instrument for notation: a transcription can be
 * character-perfect ABC and musically wrong, or differ in every character
 * (transposed, re-spelled) and be musically identical. This scores the MUSIC
 * abcjs would play, not the text. Spec: .claude/docs/shaker-letteral-notation.md
 * asks for pitch and rhythm scored separately; .claude/docs/music-notation.md
 * defines the metrics.
 *
 * Metrics (all normalised edit distances — 0 is perfect, lower is better):
 *   pitch_ner     MIDI pitch sequence            (absolute; wrong if transposed)
 *   interval_ner  successive-interval sequence   (transposition-invariant — the
 *                 right one for unpitched sources like Shaker letteral notation)
 *   rhythm_ner    duration sequence (whole-note units, quantised to 1/64)
 *   note_ner      (pitch, duration) pairs — the joint error
 *   lyric_wer     lyric syllables, when both sides carry w: lines
 * Multi-voice tunes are scored voice-by-voice in order, then pooled by
 * reference note count.
 *
 * Usage:
 *   node scripts/music/eval-transcription.mjs --candidate cand.abc --reference ref.abc
 *   node scripts/music/eval-transcription.mjs --candidate cand.abc --page <page_id>
 *       (reference = the VERIFIED row for that page in music_transcriptions;
 *        needs MONGODB_URI, e.g. node --env-file=.env.production.local …)
 *   node scripts/music/eval-transcription.mjs --batch runs.jsonl
 *       (one {id, candidate_abc, reference_abc | page_id} per line → one JSON
 *        result per line — the shape a model-comparison leaderboard reads)
 * Add --json for machine output. Exit code 0 always; the numbers are the verdict.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const abcjs = require('abcjs');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k) => args.includes(k);

/** Note events per voice, from the same flattening the in-reader player uses. */
export function notesFromAbc(abc) {
  const tune = abcjs.parseOnly(abc)[0];
  if (!tune || !tune.lines?.length) throw new Error('ABC did not parse to a tune');
  const audio = tune.setUpAudio();
  const voices = audio.tracks
    .map((t) => t.filter((e) => e.cmd === 'note').map((e) => ({
      pitch: e.pitch,
      duration: Math.round(e.duration * 64) / 64,
    })))
    .filter((v) => v.length > 0);
  return { voices, warnings: tune.warnings || [], lyrics: lyricsFromTune(tune) };
}

function lyricsFromTune(tune) {
  const syl = [];
  for (const line of tune.lines) for (const staff of line.staff || []) for (const voice of staff.voices || [])
    for (const el of voice) if (el.el_type === 'note' && el.lyric) for (const l of el.lyric)
      if (l.syllable) syl.push(l.syllable.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''));
  return syl.filter(Boolean);
}

export function editDistance(a, b, eq = (x, y) => x === y) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (eq(a[i - 1], b[j - 1]) ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const ner = (cand, ref, eq) => (ref.length === 0 ? (cand.length === 0 ? 0 : 1) : editDistance(cand, ref, eq) / ref.length);
const intervals = (v) => v.slice(1).map((n, i) => n.pitch - v[i].pitch);
const r4 = (x) => +x.toFixed(4);

export function scoreVoices(cand, ref) {
  const k = Math.max(cand.length, ref.length);
  const per = [];
  for (let i = 0; i < k; i++) {
    const c = cand[i] || [], r = ref[i] || [];
    per.push({
      voice: i + 1,
      ref_notes: r.length,
      cand_notes: c.length,
      pitch_ner: r4(ner(c.map((n) => n.pitch), r.map((n) => n.pitch))),
      interval_ner: r4(ner(intervals(c), intervals(r))),
      rhythm_ner: r4(ner(c.map((n) => n.duration), r.map((n) => n.duration))),
      note_ner: r4(ner(c, r, (x, y) => x.pitch === y.pitch && x.duration === y.duration)),
    });
  }
  const total = per.reduce((s, v) => s + v.ref_notes, 0) || 1;
  const pooled = {};
  for (const key of ['pitch_ner', 'interval_ner', 'rhythm_ner', 'note_ner']) {
    pooled[key] = r4(per.reduce((s, v) => s + v[key] * (v.ref_notes || 1), 0) / total);
  }
  return { pooled, per_voice: per };
}

export function evaluate(candidateAbc, referenceAbc) {
  const c = notesFromAbc(candidateAbc), r = notesFromAbc(referenceAbc);
  const out = scoreVoices(c.voices, r.voices);
  if (c.lyrics.length && r.lyrics.length) out.pooled.lyric_wer = r4(ner(c.lyrics, r.lyrics));
  out.candidate_warnings = c.warnings.length;
  out.reference_warnings = r.warnings.length;
  return out;
}

async function referenceForPage(pageId) {
  const { MongoClient } = require('mongodb');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set (node --env-file=.env.production.local …)');
  const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    const row = await client.db('bookstore').collection('music_transcriptions')
      .findOne({ status: 'verified', $or: [{ page_id: pageId }, { spans_pages: pageId }] }, { projection: { abc: 1 } });
    if (!row) throw new Error(`no VERIFIED transcription for page ${pageId} — drafts are not ground truth`);
    return row.abc;
  } finally {
    await client.close();
  }
}

async function main() {
  const results = [];
  if (opt('--batch')) {
    for (const line of fs.readFileSync(opt('--batch'), 'utf8').split('\n').filter(Boolean)) {
      const job = JSON.parse(line);
      try {
        const ref = job.reference_abc ?? (await referenceForPage(job.page_id));
        results.push({ id: job.id ?? job.page_id, ...evaluate(job.candidate_abc, ref) });
      } catch (e) {
        results.push({ id: job.id ?? job.page_id, error: e.message });
      }
    }
  } else {
    if (!opt('--candidate')) throw new Error('usage: --candidate cand.abc (--reference ref.abc | --page <page_id>) | --batch runs.jsonl');
    const cand = fs.readFileSync(opt('--candidate'), 'utf8');
    const ref = opt('--reference') ? fs.readFileSync(opt('--reference'), 'utf8') : await referenceForPage(opt('--page'));
    results.push({ id: opt('--candidate'), ...evaluate(cand, ref) });
  }
  if (flag('--json') || opt('--batch')) {
    for (const r of results) console.log(JSON.stringify(r));
    return;
  }
  for (const r of results) {
    if (r.error) { console.log(`${r.id}: ERROR ${r.error}`); continue; }
    console.log(r.id);
    for (const [k, v] of Object.entries(r.pooled)) console.log(`  ${k.padEnd(13)} ${v}`);
    if (r.per_voice.length > 1) {
      for (const v of r.per_voice) console.log(`  voice ${v.voice}: pitch ${v.pitch_ner} interval ${v.interval_ner} rhythm ${v.rhythm_ner} (${v.cand_notes}/${v.ref_notes} notes)`);
    }
    if (r.candidate_warnings) console.log(`  candidate ABC parsed with ${r.candidate_warnings} warning(s)`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) main().catch((e) => { console.error(e.message); process.exit(1); });

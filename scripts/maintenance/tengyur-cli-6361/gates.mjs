#!/usr/bin/env node
// PRIOR ART: the rules are production's, imported, not rewritten: translationReasoningLeak / refusableReasoningLeak
// (scripts/lib/page-integrity.mjs, method reasoning-leak v1), cliChatterReason (scripts/lib/cli-chatter.mjs, what
// cli-translate.mjs apply refuses), the driver's own refusal regex (refusal-empty's translation twin), and the write
// door's cleaning + health predicates (translate-core writePageTranslation). scripts/audit/translation-reasoning-leak.mjs
// walks stored pages in Mongo; these texts are files not yet written, so this applies the same rules to the files.
//
// #6361 stage 2, step 2: per-volume gates on the staged English, before anything is written. Files + a snapshot only.
//   - reasoning-leak and refusal/empty/chatter detectors: count per volume (the gate is 0 left unrecorded: every hit
//     is listed in skip.jsonl and refused at apply)
//   - length ratio: translationProse(English) / sourceProse(OCR) per page (source ≥ 100 chars); the staged volume
//     median (applicable pages only) must sit inside the STORED draft's observed p5–p95 for the same volume
//   - plan-mode replies (PLAN_MODE below): listed and refused, like the detector hits
//   - tags: the English as the door will store it (sanitizeTranslationTags → guard → unwrap), and the door's health
//     predicates on that text, so a page the door would refuse is known now
//
//   node scripts/maintenance/tengyur-cli-6361/gates.mjs --run=/root/tengyur-cli-6361 \
//     --stored=$JOB_SCRATCH/stored-before.jsonl.gz --out=$JOB_SCRATCH/gates
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sanitizeTranslationTags, guardTranslationText, assessTranslationHealth } from '../../lib/translate-core.mjs';
import { unwrapHiddenTranslation } from '../../lib/hidden-translation.mjs';
import { strayScriptVerdict } from '../../lib/stray-script.mjs';
import { translationReasoningLeak, refusableReasoningLeak, sourceProse, translationProse } from '../../lib/page-integrity.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const W = arg('run', '/root/tengyur-cli-6361');
const OUT = arg('out');
const STORED = arg('stored');
if (!OUT || !STORED) throw new Error('--out and --stored are required');
fs.mkdirSync(OUT, { recursive: true });
const REFUSAL = /^\s*(I'?m sorry|I am sorry|I cannot|I can'?t|I am unable|I'?m unable|I will not|I won'?t)\b/i; // driver.mjs
const BLOCK_MSG = "This request was blocked by Gemini's filters";
const MIN_SRC = 100;
// Found in stage 2 (2026-10-10): in plan mode the CLI often answers with a plan written to a file it then deletes
// ("Please review the implementation plan in [translation_plan.md](file:///root/.gemini/...)"), sometimes followed
// by part of a translation. cliChatterReason catches the ones that OPEN that way; this catches the rest. Such a reply
// is not a translation of the page, so the page is refused and listed, never trimmed into one.
const PLAN_MODE = /file:\/\/\/|\.gemini\/|implementation plan|translation_plan|plan\.md|(?:please (?:review|confirm|let me know|approve)|let me know (?:if|whether)|would you like (?:me )?to|once (?:you )?approv|output contract|\/plan\b|the user(?:'s)? (?:prompt|request|instruction)|my (?:task|instructions)|the prompt (?:says|asks|requires))/i;

const stored = new Map(zlib.gunzipSync(fs.readFileSync(STORED)).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.page_id, r]; }));
const manifest = fs.readFileSync(path.join(W, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

const vols = new Map();
const skip = fs.createWriteStream(path.join(OUT, 'skip.jsonl'));
const ratios = fs.createWriteStream(path.join(OUT, 'ratios.jsonl'));
for (const m of manifest) {
  const v = vols.get(m.vol) ?? vols.set(m.vol, { vol: m.vol, section: m.section, book_id: m.book_id, pages: 0, staged: 0, failed: 0, leak_headline: 0, leak_mild: 0, refusal: 0, chatter: 0, plan_mode: 0, applicable: 0, empty: 0, door_refuse: {}, tags_changed: 0, tags_not_idempotent: 0, human_edited: 0, no_stored_english: 0, stagedR: [], storedR: [] }).get(m.vol);
  v.pages++;
  const s = stored.get(m.page_id);
  const tr = s?.translation || {};
  if (tr.source === 'manual' || tr.edited_by) v.human_edited++;
  if (!tr.data) v.no_stored_english++;
  if (m.status !== 'staged') { v.failed++; skip.write(JSON.stringify({ page_id: m.page_id, vol: m.vol, page_number: m.page_number, reason: `stage1-failed:${m.last_class}` }) + '\n'); continue; }
  v.staged++;
  const raw = (JSON.parse(fs.readFileSync(path.join(W, 'out', `${m.page_id}.json`), 'utf8')).agy.response || '').trim();
  const reasons = [];
  const leak = translationReasoningLeak(raw);
  if (refusableReasoningLeak(raw)) { v.leak_headline++; reasons.push(`reasoning-leak:${leak.kind}:${leak.phrase.slice(0, 60)}`); } else if (leak) v.leak_mild++;
  if (REFUSAL.test(raw) || raw.includes(BLOCK_MSG)) { v.refusal++; reasons.push('refusal'); }
  const chat = cliChatterReason(raw);
  if (chat) { v.chatter++; reasons.push(`chatter:${chat}`); }
  const plan = raw.match(PLAN_MODE);
  if (plan) { v.plan_mode++; reasons.push(`plan-mode:${plan[0].slice(0, 40)}`); }
  const sanitized = sanitizeTranslationTags(raw);
  if (sanitized !== raw) v.tags_changed++;
  if (sanitizeTranslationTags(sanitized) !== sanitized) v.tags_not_idempotent++;
  // The door's own sequence (writePageTranslation): sanitize → guard → unwrap → stray script → health.
  let clean = unwrapHiddenTranslation({ ocr: s?.ocr, tr: guardTranslationText(sanitized), type: s?.page_type }).text;
  const stray = strayScriptVerdict(clean, { ocr: s?.ocr, language: 'Tibetan' });
  clean = stray.text;
  if (translationProse(clean).length < 20) { v.empty++; reasons.push('empty'); }
  const health = assessTranslationHealth(s?.ocr, clean, { lang: 'Tibetan' });
  if (!health.healthy) { v.door_refuse[health.reason] = (v.door_refuse[health.reason] || 0) + 1; reasons.push(`door:${health.reason}`); }
  else if (stray.refuse) { v.door_refuse['stray-script'] = (v.door_refuse['stray-script'] || 0) + 1; reasons.push('door:stray-script'); }
  if (reasons.length) skip.write(JSON.stringify({ page_id: m.page_id, vol: m.vol, page_number: m.page_number, reason: reasons.join('; ') }) + '\n');
  const src = sourceProse(s?.ocr || '').length;
  if (!reasons.length) v.applicable++;
  if (src >= MIN_SRC && !reasons.length) {
    const a = translationProse(clean).length / src;
    const b = tr.data ? translationProse(tr.data).length / src : null;
    v.stagedR.push(a); if (b != null) v.storedR.push(b);
    ratios.write(JSON.stringify({ page_id: m.page_id, vol: m.vol, page_number: m.page_number, src, staged: r3(a), stored: r3(b) }) + '\n');
  }
}
skip.end(); ratios.end();

const table = [...vols.values()].sort((a, b) => a.vol - b.vol).map((v) => {
  const lo = q(v.storedR, 0.05), hi = q(v.storedR, 0.95), med = q(v.stagedR, 0.5);
  const stMin = q(v.storedR, 0), stMax = q(v.storedR, 1);
  const outside = v.stagedR.filter((x) => x < stMin || x > stMax).length;
  const { stagedR, storedR, ...rest } = v;
  const unrecorded = 0; // every detector hit above went to skip.jsonl
  return {
    ...rest, ratio_pages: stagedR.length,
    staged_ratio_median: r3(med), staged_ratio_p5: r3(q(stagedR, 0.05)), staged_ratio_p95: r3(q(stagedR, 0.95)),
    stored_ratio_median: r3(q(storedR, 0.5)), stored_ratio_p5: r3(lo), stored_ratio_p95: r3(hi), stored_ratio_min: r3(stMin), stored_ratio_max: r3(stMax),
    staged_pages_outside_stored_min_max: outside,
    gate_ratio: med != null && lo != null && med >= lo && med <= hi,
    gate_detectors: unrecorded === 0,
  };
});
const all = { volumes: table.length, pass_ratio: table.filter((t) => t.gate_ratio).length, pass_detectors: table.filter((t) => t.gate_detectors).length,
  totals: Object.fromEntries(['pages', 'staged', 'failed', 'leak_headline', 'leak_mild', 'refusal', 'chatter', 'plan_mode', 'applicable', 'empty', 'tags_changed', 'tags_not_idempotent', 'human_edited', 'no_stored_english', 'staged_pages_outside_stored_min_max'].map((k) => [k, table.reduce((s, t) => s + t[k], 0)])),
  door_refuse: table.reduce((acc, t) => { for (const [k, n] of Object.entries(t.door_refuse)) acc[k] = (acc[k] || 0) + n; return acc; }, {}) };
fs.writeFileSync(path.join(OUT, 'gates.json'), JSON.stringify({ at: new Date().toISOString(), min_src_chars: MIN_SRC, ...all, table }, null, 1));
console.log(JSON.stringify(all, null, 1));
for (const t of table) console.log(`vol ${t.vol} ${t.section.padEnd(10)} staged ${t.staged} failed ${t.failed} leak ${t.leak_headline}/${t.leak_mild} ref ${t.refusal} chat ${t.chatter} plan ${t.plan_mode} ok ${t.applicable} empty ${t.empty} door ${JSON.stringify(t.door_refuse)} ratio staged ${t.staged_ratio_median} stored ${t.stored_ratio_median} [${t.stored_ratio_p5}–${t.stored_ratio_p95}] out ${t.staged_pages_outside_stored_min_max} ${t.gate_ratio && t.gate_detectors ? 'PASS' : 'FAIL'}`);

#!/usr/bin/env node
/**
 * J1 prompt emitter for the #2885(b) alignment gold.  READ-ONLY.
 *
 * J1 is the INDEPENDENT judge: one unprimed Claude subagent per pair, each shown
 * ONLY the two records' neutral metadata (never the matcher_tier / guards / stratum
 * / work_id in the hidden scoring key), free to WebSearch/WebFetch, returning a
 * strict same-work y/n JSON. This script deterministically renders those per-pair
 * prompts so the run is reproducible and no prompt is hand-crafted; the orchestrator
 * (Claude Code main loop, or the ft-verify skill) spawns one subagent per emitted
 * prompt and collects the JSON into:
 *   scripts/eval/results/ft-alignment-verdicts-j1-<date>.json
 *     [{ pair_id, same: true|false|"uncertain", basis, reason, sources }]
 *
 * Target selection (which pairs need J1):
 *   --kind link|cocluster|split   restrict to one kind
 *   --tier demote_candidate|needs_review   (link only)
 *   --hard-only                   only pairs J0 left unresolved (same:null)
 *   default: every pair J0 did not resolve (the 'hard' set)
 *
 * Output: scripts/eval/results/ft-alignment-j1-prompts-<date>.json
 *   [{ pair_id, kind, prompt }]
 *
 * Usage: node scripts/eval/ft-alignment-j1-prompts.mjs [--date D] [--kind link --tier demote_candidate] [--hard-only]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const arg = (f) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const DATE = arg('--date') || new Date().toISOString().slice(0, 10);
const KIND = arg('--kind');
const TIER = arg('--tier');
const HARD_ONLY = process.argv.includes('--hard-only');

const gold = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, `ft-alignment-gold-${DATE}.json`), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, `ft-alignment-scoringkey-${DATE}.json`), 'utf8'));
const autoPath = path.join(RESULTS_DIR, `ft-alignment-verdicts-auto-${DATE}.json`);
const auto = fs.existsSync(autoPath) ? JSON.parse(fs.readFileSync(autoPath, 'utf8')) : [];
const resolvedByJ0 = new Set(auto.filter((v) => v.same === true || v.same === false).map((v) => v.pair_id));

const INSTRUCTIONS = `You are judging whether two bibliographic records describe THE SAME UNDERLYING WORK (the same text/composition), ignoring edition, printing, volume-set packaging, or the language of a given copy.

Rules:
- A translation and its source-language original of the SAME text = SAME work.
- A different VOLUME or PART or numbered book of a multi-volume set = DIFFERENT work (Vol. 1 of an Opera Omnia is not the same work as Vol. 2, nor as the whole Opera).
- A namesake author (same surname, different person) = DIFFERENT work.
- A distinct composition that merely shares a title-word = DIFFERENT work.
- An anthology / collected-works container is NOT "the same work" as one specific text inside it, unless the record clearly IS that single text.
- Use WebSearch / WebFetch only if the metadata is insufficient to decide.
- If you genuinely cannot decide, return "uncertain" — do not guess.

Return ONLY a single-line JSON object, no prose around it:
{"pair_id":"<id>","same":true|false|"uncertain","basis":"metadata|web","reason":"<=200 chars","sources":["<url>", ...]}`;

const rec = (r) => {
  if (r.type === 'catalog_row') {
    return `  english_title: ${r.english_title ?? ''}\n  canonical_work: ${r.canonical_work ?? ''}\n  author: ${r.author ?? ''}\n  translator: ${r.translator ?? ''}\n  year: ${r.pub_year ?? ''}\n  source_language: ${r.source_language ?? ''}\n  completeness: ${r.completeness ?? ''}`;
  }
  return `  title: ${r.title ?? ''}\n  author: ${r.author ?? ''}\n  language: ${r.language ?? ''}\n  original_language: ${r.original_language ?? ''}`;
};

const targets = gold.manifest.filter((p) => {
  const k = key[p.pair_id];
  if (KIND && p.kind !== KIND) return false;
  if (TIER && k.matcher_tier !== TIER) return false;
  if (HARD_ONLY && resolvedByJ0.has(p.pair_id)) return false;
  return true;
});

const prompts = targets.map((p) => ({
  pair_id: p.pair_id,
  kind: p.kind,
  prompt: `${INSTRUCTIONS}\n\npair_id: ${p.pair_id}\n\nRECORD A:\n${rec(p.left)}\n\nRECORD B:\n${rec(p.right)}\n`,
}));

const outPath = path.join(RESULTS_DIR, `ft-alignment-j1-prompts-${DATE}.json`);
fs.writeFileSync(outPath, JSON.stringify(prompts, null, 2));
console.log(`Emitted ${prompts.length} J1 prompts (kind=${KIND || 'any'}, tier=${TIER || 'any'}, hard-only=${HARD_ONLY}).`);
console.log(`Wrote ${outPath}`);
console.log('Spawn ONE unprimed subagent per prompt; collect verdict JSON into ft-alignment-verdicts-j1-' + DATE + '.json');

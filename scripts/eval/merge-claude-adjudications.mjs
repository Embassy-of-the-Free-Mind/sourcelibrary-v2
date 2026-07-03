#!/usr/bin/env node
/**
 * merge-claude-adjudications.mjs — join Claude Tier-2 adjudication verdicts with
 * the frozen gold-standard sample into a score-ready label file.
 *
 * The AI verdicts are the "AI-adjudicated" layer; a human then verifies/overrides
 * (see ft-gold-annotator-brief.md). This produces ft-gold-labels-claude.json in the
 * SAME schema score-gold-standard.mjs reads, so the AI layer yields a provisional
 * estimate immediately and seeds the human verification pass.
 *
 * USAGE:
 *   node scripts/eval/merge-claude-adjudications.mjs \
 *     [raw=scripts/output/ft-claude-verdicts-raw.json] \
 *     [cands=scripts/output/ft-gold-candidates.json] \
 *     [out=scripts/output/ft-gold-labels-claude.json]
 */
import fs from 'fs';
const arg = (k, d) => { const a = process.argv.slice(2).find(x => x.startsWith(k + '=')); return a ? a.split('=')[1] : d; };
const rawP = arg('raw', 'scripts/output/ft-claude-verdicts-raw.json');
const candP = arg('cands', 'scripts/output/ft-gold-candidates.json');
const outP = arg('out', 'scripts/output/ft-gold-labels-claude.json');

const raw = JSON.parse(fs.readFileSync(rawP, 'utf8'));
const cands = JSON.parse(fs.readFileSync(candP, 'utf8')).candidates;
const byId = Object.fromEntries(cands.map(c => [c.i, c]));

const labels = raw.map(r => {
  const c = byId[r.i] || {};
  const sources = (r.sources_checked || []).join('; ');
  const notes = `${r.notes || ''}${sources ? `  [sources: ${sources}]` : ''}${r.evidence_strength ? `  [evidence: ${r.evidence_strength}]` : ''}`.trim();
  return {
    i: r.i, t: c.t || '', l: c.l || '', stratum: c.stratum || 'NA', stratum_pop: c.stratum_pop || 0,
    verdict: r.verdict, prior: r.prior || '', conf: r.conf || '', notes,
    evidence_strength: r.evidence_strength || '', tool_uses: r.tool_uses ?? null,
    ai: c.ai || null, // prior lite/sonnet hints, if any
    source: 'claude_tier2_adjudication', human_verified: false,
  };
});

const missing = raw.filter(r => !byId[r.i]).map(r => r.i);
const out = { annotator: 'claude-tier2', exported_at: null, n: labels.length,
  note: 'AI-adjudicated layer (Claude Sonnet, web-grounded). Human verification pending — see ft-gold-annotator-brief.md.',
  labels };
fs.writeFileSync(outP, JSON.stringify(out, null, 2));

const fam = {}; for (const l of labels) (fam[l.stratum] = fam[l.stratum] || []).push(l.verdict);
console.error(`Merged ${labels.length} adjudications -> ${outP}`);
if (missing.length) console.error(`  WARNING: ${missing.length} raw ids not in candidates: ${missing.join(', ')}`);
const dist = {}; for (const l of labels) dist[l.verdict] = (dist[l.verdict] || 0) + 1;
console.error('  Verdict distribution:', JSON.stringify(dist));
const flagged = labels.filter(l => (l.tool_uses ?? 9) <= 1);
if (flagged.length) console.error(`  ${flagged.length} knowledge-only (<=1 tool call) — prioritize for human verification: ${flagged.map(l => (l.t||'').slice(0,30)).join(' | ')}`);

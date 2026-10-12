#!/usr/bin/env node
// PRIOR ART: the cost tables in scripts/eval/experiments/2026-10-11-paddle-stale-english-retranslate-6388.md (calls ÷
// sustained CLI rate) and 2026-10-12-paddle-zh-table-opus-reread-pilot-6388.md (Opus s/page). Neither has a quota
// bound for Claude or the thinking Gemini models; this adds both and the flag-rule volumes from coverage.json.
//
// #6561 lane projection: weeks to run each arm over (a) the pages a flag rule picks and (b) the whole Paddle lane.
//   node project.mjs   (cwd = $JOB_SCRATCH/w; reads score.json, coverage.json, meter.json) → projection.json
import fs from 'node:fs';
import { median } from '../ground-truth-5935/lib.mjs';

const LANE = 1568108;           // Paddle pages (the #6388 detector census, re-run live by the pilot)
const S = JSON.parse(fs.readFileSync('score.json', 'utf8'));
const cov = JSON.parse(fs.readFileSync('coverage.json', 'utf8'));
const M = JSON.parse(fs.readFileSync('meter.json', 'utf8'));   // measured quota inputs, see the write-up
const HOURS_WEEK = 168;

// seconds per page per arm, over every page the arm read (sets A and B)
const secs = {};
for (const arm of ['opus-correct', 'opus-redo', 'pro-correct', 'flashhigh-correct']) {
  secs[arm] = { all: median(S.pages.map((p) => p.arms[arm]).filter((a) => a?.secs != null).map((a) => a.secs)),
    A: median(S.pages.filter((p) => p.stratum === 'A').map((p) => p.arms[arm]).filter((a) => a?.secs != null).map((a) => a.secs)),
    B: median(S.pages.filter((p) => p.stratum !== 'A').map((p) => p.arms[arm]).filter((a) => a?.secs != null).map((a) => a.secs)) };
}
secs['flashlow-second'] = { B: median(S.pages.map((p) => p.signals.flashlow_secs).filter((x) => x != null)) };

// pages per week, the lower of: throughput at STREAMS calls in flight, and the measured quota bound (null = not measured)
const STREAMS = 2;
const perWeek = (arm, s) => {
  const thr = (STREAMS * 3600 / s) * HOURS_WEEK;
  const q = M.quota_pages_per_week[arm] ?? null;
  return { throughput: Math.round(thr), quota_bound: q, pages_per_week: Math.round(q == null ? thr : Math.min(thr, q)), binding: q != null && q < thr ? 'quota' : 'throughput' };
};

// flag-rule volumes over the lane (shares from coverage.json's 200-book sample)
const h = cov.dice_hist; const tot = cov.paddle_pages;
const below = (t) => Object.entries(h).filter(([k]) => +k < t - 1e-9).reduce((a, [, v]) => a + v, 0) / tot;
const rules = {
  'table detector (gate AND shape)': 4379,
  'qa_screen dice < 0.80': Math.round(below(0.80) * LANE),
  'qa_screen dice < 0.85': Math.round(below(0.85) * LANE),
  'qa_screen dice < 0.90': Math.round(below(0.90) * LANE),
  'no trusted qa_screen (not screened)': Math.round(((tot - cov.qa_screened) / tot) * LANE),
  'whole lane': LANE,
};
const out = { lane: LANE, streams: STREAMS, secs, meter: M, rules, weeks: {} };
for (const arm of ['opus-correct', 'opus-redo', 'pro-correct', 'flashhigh-correct']) {
  const pw = perWeek(arm, secs[arm].B);   // set B speed: the bulk case
  out.weeks[arm] = { ...pw, secs_per_page: secs[arm].B, by_rule: Object.fromEntries(Object.entries(rules).map(([k, n]) => [k, +(n / pw.pages_per_week).toFixed(1)])) };
  if (M.accounts?.[arm]) out.weeks[arm].by_rule_all_accounts = Object.fromEntries(Object.entries(rules).map(([k, n]) => [k, +(n / (pw.binding === 'quota' ? pw.quota_bound * M.accounts[arm] : pw.pages_per_week)).toFixed(1)]));
}
const fl = perWeek('flashlow-second', secs['flashlow-second'].B);
out.second_read_whole_lane_weeks = +(LANE / Math.min(fl.throughput, M.flashlow_sustained_per_hour * HOURS_WEEK)).toFixed(1);
fs.writeFileSync('projection.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));

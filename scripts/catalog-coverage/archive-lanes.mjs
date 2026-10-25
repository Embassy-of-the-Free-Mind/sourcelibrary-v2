#!/usr/bin/env node
// PRIOR ART: /etc/sourcelibrary/archive-lanes.conf (the hand-kept, per-box lane list this replaces:
//   on the box only, so no session could read or review it, and nothing checked a rate);
//   scripts/catalog-coverage/archive-lanes-revive.sh (starts lanes; now reads this);
//   scripts/lib/lanes.mjs (the pipeline LANE registry: which code paths do work, not which hosts
//   an archiver drains at what rate).
//
// archive-lanes — read the archiver host-lane table (archive-lanes.json, #5448 step 4).
//
//   node scripts/catalog-coverage/archive-lanes.mjs --conf [--box l7a]
//       one `<name>|<page concurrency>|<archive-acquired args>` line per lane on this box, the
//       format archive-lanes-revive.sh reads.
//   node scripts/catalog-coverage/archive-lanes.mjs --list
//       every lane, every box.
//
// The box is ARCHIVE_LANES_BOX, else the hostname the job wrapper uses (claude-job.sh HOST block):
// earthai-l7a → l7a, gex45-1 → gex45, earthai-live → cloudlayer, anything else → main.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TABLE_PATH = path.join(HERE, 'archive-lanes.json');

/** The image host whose rate waits on BSB's reply (#5448): no table lane may touch it. */
export const FROZEN_HOSTS = Object.freeze(['api.digitale-sammlungen.de']);

export function loadLaneTable(file = TABLE_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function thisBox(env = process.env, hostname = os.hostname()) {
  if (env.ARCHIVE_LANES_BOX) return env.ARCHIVE_LANES_BOX;
  if (hostname === 'earthai-l7a') return 'l7a';
  if (hostname === 'gex45-1') return 'gex45';
  if (hostname === 'earthai-live') return 'cloudlayer';
  return 'main';
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const PROVIDER = /^[a-z0-9_-]+$/;
const FLAGS = new Set(['--gallica-openapi', '--lazy-only']);

/**
 * Every problem with the table, as strings (empty = valid). `domainLimitOf(host)` is the host's
 * DOMAIN_LIMITS rate (iiif-utils getDomainLimit), injected so this file stays import-free.
 */
export function laneTableProblems(table, { domainLimitOf } = {}) {
  const out = [];
  const lanes = Array.isArray(table?.lanes) ? table.lanes : [];
  if (lanes.length === 0) out.push('no lanes');
  const budget = table?.box_page_budget ?? {};
  const names = new Set();
  const hostOwner = new Map();
  const perBox = {};
  for (const l of lanes) {
    const who = `lane ${l?.name}`;
    if (!NAME.test(l?.name ?? '')) out.push(`${who}: name must be kebab-case`);
    if (names.has(l.name)) out.push(`${who}: duplicate name`);
    names.add(l.name);
    if (!(l.box in budget)) out.push(`${who}: box '${l.box}' has no page budget`);
    if (!Array.isArray(l.hosts) || l.hosts.length === 0 || !l.hosts.every(h => HOST.test(h))) out.push(`${who}: hosts must be a non-empty list of hostnames`);
    if (!Array.isArray(l.providers) || l.providers.length === 0 || !l.providers.every(p => PROVIDER.test(p))) out.push(`${who}: providers must be a non-empty list of image_source.provider tags`);
    if (!Number.isInteger(l.page_concurrency) || l.page_concurrency < 1 || l.page_concurrency > 4) out.push(`${who}: page_concurrency must be 1..4`);
    for (const f of l.flags ?? []) if (!FLAGS.has(f)) out.push(`${who}: unknown flag ${f}`);
    for (const h of l.hosts ?? []) {
      if (FROZEN_HOSTS.includes(h)) out.push(`${who}: ${h} is frozen (MDZ rate waits on BSB's reply, #5448)`);
      if (hostOwner.has(h)) out.push(`${who}: host ${h} already belongs to lane ${hostOwner.get(h)} (one host, one lane)`);
      else hostOwner.set(h, l.name);
    }
    const rate = l.rate ?? {};
    if (Object.keys(rate).length === 0) out.push(`${who}: give every host a rate`);
    for (const h of l.hosts ?? []) if (h !== 'gallica.bnf.fr' && !(h in rate)) out.push(`${who}: no rate for ${h}`);
    for (const [h, r] of Object.entries(rate)) {
      if (!HOST.test(h) || !(Number.isFinite(r) && r > 0)) { out.push(`${who}: bad rate ${h}=${r}`); continue; }
      if (FROZEN_HOSTS.includes(h)) out.push(`${who}: ${h} is frozen`);
      const lim = domainLimitOf?.(h);
      if (lim != null && r > lim) out.push(`${who}: rate ${h}=${r} is above its DOMAIN_LIMITS ${lim} — raising a rate is a DOMAIN_LIMITS change made on evidence`);
    }
    perBox[l.box] = (perBox[l.box] ?? 0) + (l.page_concurrency || 0);
  }
  for (const [box, n] of Object.entries(perBox)) {
    if (budget[box] != null && n > budget[box]) out.push(`box ${box}: ${n} pages in flight over its budget of ${budget[box]}`);
  }
  return out;
}

/** The archive-acquired.ts flags for one lane. */
export function laneArgs(lane) {
  const rates = Object.entries(lane.rate ?? {}).map(([h, r]) => `${h}=${r}`).join(',');
  return [
    `--providers ${lane.providers.join(',')}`,
    `--hosts ${lane.hosts.join(',')}`,
    ...(rates ? [`--host-rate ${rates}`] : []),
    ...(lane.flags ?? []),
  ].join(' ');
}

/** `<name>|<page concurrency>|<args>` lines for every lane on `box`. */
export function confLines(table, box) {
  return table.lanes.filter(l => l.box === box).map(l => `${l.name}|${l.page_concurrency}|${laneArgs(l)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const table = loadLaneTable();
  const bi = argv.indexOf('--box');
  const box = bi > -1 ? argv[bi + 1] : thisBox();
  if (argv.includes('--conf')) {
    for (const line of confLines(table, box)) console.log(line);
  } else if (argv.includes('--list')) {
    for (const l of table.lanes) console.log(`${l.box.padEnd(6)} ${l.name.padEnd(12)} ${l.page_concurrency} ${laneArgs(l)}`);
  } else {
    console.error('usage: archive-lanes.mjs --conf [--box <box>] | --list');
    process.exit(2);
  }
}

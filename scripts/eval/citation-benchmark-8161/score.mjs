#!/usr/bin/env node
/**
 * Scores runs.jsonl as a funnel, per engine and stratum: answered with the web → we surfaced in what it
 * read → it opened one of our pages → it linked us. The split says where to work: nothing surfaced means
 * search indexes do not know us; surfaced and not linked means it saw us and chose someone else.
 *
 * Counted per QUESTION as well as per run, since two runs of one question are not independent.
 * Other domains are tallied too. That is the detector's positive control (it has to fire on someone)
 * and it gives the scale: a rate of zero means little until you see who was cited instead.
 *
 * Usage: node score.mjs <out-dir> [--check-links]
 *
 * PRIOR ART: scripts/eval/mcp-trigger-8154/run.mjs scores only whether a tool was called; scripts/audit/librarian-citation-gauge.ts judges our own Librarian's links, not outside assistants.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const OUT = resolve(process.argv[2]);
const CHECK_LINKS = process.argv.includes('--check-links');
const OURS = /(?:^|\.)sourcelibrary\.org$/i;
const URL_RE = /https?:\/\/[^\s"'<>)\]}\\]+/g;
const FETCHER_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const SEARCH_TOOLS = new Set(['WebSearch', 'search_web']);
const OPEN_TOOLS = new Set(['WebFetch', 'read_url_content', 'open_browser_url', 'read_browser_page', 'browser_subagent']);

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const clean = (u) => u.replace(/[.,;:!?*`_]+$/, '');
const isOurs = (u) => OURS.test(host(u));

/** Tool calls in a raw stream, as { name, input }, for either CLI's event shape. */
function toolCalls(raw) {
  const calls = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    for (const c of ev.message?.content ?? []) {
      if (c?.type === 'tool_use') calls.push({ name: c.name, input: JSON.stringify(c.input ?? {}) });
    }
    const su = ev.step_update;
    if (su?.state === 'DONE' && su.step_type === 'tool' && su.tool_name) {
      calls.push({ name: su.tool_name, input: JSON.stringify(su.tool_info?.parameters ?? {}) });
    }
  }
  return calls;
}

/** What Claude's tools returned. agy's stream carries tool calls and no tool output, so "surfaced" cannot be read for it. */
function toolResultText(raw) {
  const parts = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'user' && ev.tool_use_result !== undefined) parts.push(JSON.stringify(ev.tool_use_result));
    else if (ev.type === 'user') parts.push(JSON.stringify(ev.message?.content ?? ''));
  }
  return parts.join('\n');
}

/** Gemini links through a Google grounding redirect that hides the real address. Resolved once, here. */
const groundingCache = new Map();
async function resolveGrounding(url) {
  if (!/vertexaisearch\.cloud\.google\.com/.test(url)) return url;
  if (groundingCache.has(url)) return groundingCache.get(url);
  let target = null;
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    target = res.headers.get('location');
    await res.body?.cancel();
  } catch { /* counted below as unresolved */ }
  groundingCache.set(url, target || `unresolved:${url}`);
  return groundingCache.get(url);
}

const rows = [];
for (const l of readFileSync(join(OUT, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  const raw = existsSync(join(OUT, 'raw', r.raw)) ? readFileSync(join(OUT, 'raw', r.raw), 'utf8') : '';
  const calls = toolCalls(raw);
  const opened = calls.filter((c) => OPEN_TOOLS.has(c.name));
  const shell = calls.filter((c) => c.name === 'run_command');
  const ourOpens = [...opened, ...shell].map((c) => c.input).filter((i) => /sourcelibrary\.org/i.test(i));
  const literalUrls = [...new Set((r.answer.match(URL_RE) || []).map(clean))];
  const answerUrls = [...new Set(await Promise.all(literalUrls.map(resolveGrounding)))];
  const results = toolResultText(raw);
  rows.push({
    engine: r.engine,
    id: r.id,
    stratum: r.stratum,
    rep: r.rep,
    code: r.code,
    answered: r.answer.trim().length > 0,
    searches: calls.filter((c) => SEARCH_TOOLS.has(c.name)).length,
    opens: opened.length,
    tools: [...new Set(calls.map((c) => c.name))],
    shell_calls: shell.length,
    surfaced: r.engine === 'agy' ? null : /sourcelibrary\.org/i.test(results),
    surfaced_hosts: [...new Set(results.match(/[a-z0-9-]*\.?sourcelibrary\.org/gi) || [])].map((h) => h.toLowerCase()),
    opened_us: opened.some((c) => /sourcelibrary\.org/i.test(c.input)),
    used_our_search: ourOpens.some((i) => /sourcelibrary\.org\/(api\/)?search/i.test(i)),
    read_llms: ourOpens.some((i) => /sourcelibrary\.org\/llms/i.test(i)),
    our_opens: ourOpens.map((i) => (i.match(URL_RE) || [i.slice(0, 120)])[0]),
    linked_us: answerUrls.some(isOurs),
    linked_source: answerUrls.some((u) => isOurs(u) && /^\/(book|q)\//.test(new URL(u).pathname)),
    named_us: /source ?library/i.test(r.answer),
    our_urls: answerUrls.filter(isOurs),
    unresolved: answerUrls.filter((u) => u.startsWith('unresolved:')).length,
    domains: [...new Set(answerUrls.map(host).filter(Boolean))],
  });
}

// Whether each link we were given opens, as an assistant's fetcher.
const linkStatus = {};
if (CHECK_LINKS) {
  for (const url of new Set(rows.flatMap((r) => r.our_urls))) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': FETCHER_UA }, signal: AbortSignal.timeout(30_000) });
      linkStatus[url] = res.status;
      await res.body?.cancel();
    } catch (e) { linkStatus[url] = `error: ${e.name}`; }
  }
  for (const r of rows) r.dead_links = r.our_urls.filter((u) => linkStatus[u] !== 200);
}

const pct = (k, n) => (n ? `${k}/${n} (${Math.round((100 * k) / n)}%)` : '0/0');
const summary = {};
const lines = ['engine\tstratum\truns\tanswered\tused search\tsurfaced us\topened us\tour search\tllms.txt\tlinked us\tlinked a book or page\tnamed us\tquestions linking us (any run)\tA-vs-A disagree\tshell runs\tunresolved links'];
for (const engine of [...new Set(rows.map((r) => r.engine))]) {
  for (const stratum of ['topic', 'work', 'modern', 'pointed']) {
    const set = rows.filter((r) => r.engine === engine && r.stratum === stratum);
    if (!set.length) continue;
    const ids = [...new Set(set.map((r) => r.id))];
    const linkedIds = ids.filter((id) => set.some((r) => r.id === id && r.linked_us));
    const surfacedIds = ids.filter((id) => set.some((r) => r.id === id && r.surfaced));
    const paired = ids.map((id) => set.filter((r) => r.id === id)).filter((p) => p.length === 2);
    const disagree = paired.filter(([a, b]) => a.linked_us !== b.linked_us).length;
    const n = set.length;
    const count = (f) => set.filter(f).length;
    summary[`${engine}/${stratum}`] = {
      runs: n,
      answered: count((r) => r.answered),
      used_search: count((r) => r.searches > 0),
      surfaced: engine === 'agy' ? null : count((r) => r.surfaced),
      questions_surfaced: engine === 'agy' ? null : surfacedIds.length,
      opened: count((r) => r.opened_us),
      used_our_search: count((r) => r.used_our_search),
      read_llms: count((r) => r.read_llms),
      linked: count((r) => r.linked_us),
      linked_source: count((r) => r.linked_source),
      named: count((r) => r.named_us),
      questions: ids.length,
      questions_linking: linkedIds.length,
      paired: paired.length,
      a_vs_a_disagree: disagree,
      shell_runs: count((r) => r.shell_calls > 0),
      unresolved_links: set.reduce((sum, r) => sum + r.unresolved, 0),
    };
    lines.push([
      engine, stratum, n, count((r) => r.answered), count((r) => r.searches > 0),
      engine === 'agy' ? 'not measurable' : pct(count((r) => r.surfaced), n),
      pct(count((r) => r.opened_us), n), count((r) => r.used_our_search), count((r) => r.read_llms),
      pct(count((r) => r.linked_us), n), pct(count((r) => r.linked_source), n), pct(count((r) => r.named_us), n),
      pct(linkedIds.length, ids.length), `${disagree}/${paired.length}`,
      count((r) => r.shell_calls > 0), set.reduce((sum, r) => sum + r.unresolved, 0),
    ].join('\t'));
  }
}

const domainTally = {};
for (const engine of [...new Set(rows.map((r) => r.engine))]) {
  const tally = {};
  for (const r of rows.filter((x) => x.engine === engine && ['topic', 'work'].includes(x.stratum))) {
    for (const d of r.domains) tally[d] = (tally[d] || 0) + 1;
  }
  domainTally[engine] = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 15);
}

writeFileSync(join(OUT, 'scored.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify({ summary, domainTally, linkStatus }, null, 1)}\n`);
console.log(lines.join('\n'));
console.log('\nmost-linked domains, topic + work, runs linking:');
for (const [engine, tally] of Object.entries(domainTally)) console.log(engine, tally.map(([d, n]) => `${d} ${n}`).join(', '));
if (CHECK_LINKS) console.log('\nour links:', JSON.stringify(linkStatus, null, 1));

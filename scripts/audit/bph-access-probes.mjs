#!/usr/bin/env node
/**
 * bph-access-probes: is the Embassy's collection still open to readers and closed to cheap copying?
 *
 * PRIOR ART: scripts/workers/attack-canary.mjs — the same idea for the site-wide edge rules, one
 * book page per row, paging on every failed run. It does not look at the embed, the tenant API,
 * the text export or the image host, and answers only pass or block, where the export's answer is
 * "how much of the book". edge-crawl-alert.mjs --canary proves the crawl brake only. Pattern for
 * state and paging: scripts/audit/pipeline-hold-drift.mjs.
 *
 * WHY (#8098). The protection is three layers, two of them outside this repo's tests, and a change
 * to any of them can silently defeat the others. "must-pass" rows are the positive controls: a rule
 * that starts refusing readers is a broken defence too, and the Embassy's visitors are who this serves.
 *
 * Plain HTTP, about 30 requests, no Mongo, no secrets. A real browser walk is a separate check
 * (scripts/audit/bph-reader-walk.mjs); these rows cover what headers alone can prove. It cannot
 * test a real search crawler, since this box is not one: check those from the logs.
 *
 * States per row: ok | FAIL | known-open (a gap named on the private issue, no page) | unknown (a
 * page budget or network answer that says nothing about the rule, no page, keeps the last state).
 * Pages only when the set of failing rows changes, once when it clears, and once after a week of unknown rows. Exit 1 on FAIL, 2 if
 * nothing could be measured.
 *
 * Usage: node scripts/audit/bph-access-probes.mjs [--no-push] [--json]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ntfyPost } from '../lib/ntfy-send.mjs';

const NO_PUSH = process.argv.includes('--no-push');
const JSON_OUT = process.argv.includes('--json');
const NTFY_TOPIC = process.env.BPH_PROBES_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';
const STATE_FILE = process.env.BPH_PROBES_STATE || '/var/lib/sourcelibrary/bph-access-probes.json';

// Twelve-page books, so a daily run costs little of this address's anonymous page budget.
const BPH = {
  id: '697a3055e5f7054dcf9cc423',
  slug: 'copy-of-the-mandate-of-gustavus-adolphus-anonymous',
  pages: 12,
  firstPage: '697a312549e417de6912bae3',
};
const OTHER = { id: '695931d4b91a6184ea9433a8', pages: 10 };
const APEX = 'https://sourcelibrary.org';
const SUB = 'https://bph.sourcelibrary.org';
const IMG = 'https://images.sourcelibrary.org';
const BLIND_RUNS = 7;

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const CLAUDE_USER = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const SCRIPT = 'python-requests/2.32';
const HINTS = { 'sec-ch-ua': '"Google Chrome";v="155", "Chromium";v="155", "Not.A/Brand";v="24"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"' };
// What a reader's browser sends from inside a frame on another site: no cookie, no Referer.
const FRAME = { ...HINTS, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };
const FETCHED = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };

const EMBED_BOOK = `${APEX}/embed/bph/book/${BPH.slug}`;
const TEXT = `${APEX}/api/books/${BPH.id}/text?format=json`;
const IMAGE_MASTER = process.env.BPH_PROBES_MASTER || `${IMG}/archived/69c897d66c6f3cc53c85c922/1.jpg`;

/** expect: refuse | pass | part (a clamped book) | whole | absent (no hidden rows) | robots */
const ROWS = [
  // Refused on the reading surfaces.
  { name: 'plain HTTP library, embed home', url: `${APEX}/embed/bph`, ua: SCRIPT, expect: 'refuse' },
  { name: 'plain HTTP library, embed book', url: EMBED_BOOK, ua: SCRIPT, expect: 'refuse' },
  { name: 'plain HTTP library, subdomain', url: `${SUB}/`, ua: SCRIPT, expect: 'refuse' },
  { name: 'plain HTTP library, tenant API', url: `${APEX}/api/bph/books/${BPH.id}`, ua: SCRIPT, expect: 'refuse' },
  { name: 'Chrome name without client hints, embed home', url: `${APEX}/embed/bph`, ua: CHROME, expect: 'refuse' },
  { name: 'Chrome name without client hints, embed book', url: EMBED_BOOK, ua: CHROME, expect: 'refuse' },
  { name: 'Chrome name without client hints, subdomain', url: `${SUB}/`, ua: CHROME, expect: 'refuse' },
  { name: 'search crawler name from another address, embed', url: `${APEX}/embed/bph`, ua: GOOGLEBOT, expect: 'refuse' },
  { name: 'search crawler name from another address, subdomain', url: `${SUB}/`, ua: GOOGLEBOT, expect: 'refuse' },
  { name: 'plain HTTP library, page API', url: `${APEX}/api/pages/${BPH.firstPage}`, ua: SCRIPT, expect: 'refuse' },
  { name: 'plain HTTP library, page batch', url: `${APEX}/api/pages/batch`, method: 'POST', body: { ids: [BPH.firstPage] }, ua: SCRIPT, expect: 'refuse' },
  // The export hands over part of the book, and is never kept in a shared cache.
  { name: 'text export, plain HTTP library', url: TEXT, ua: SCRIPT, expect: 'part', total: BPH.pages },
  { name: 'text export, declared AI crawler', url: TEXT, ua: GPTBOT, expect: 'part', total: BPH.pages },
  { name: 'text export, search crawler name from another address', url: TEXT, ua: GOOGLEBOT, expect: 'part', total: BPH.pages },
  { name: 'text export, hidden rows', url: `${TEXT}&from=-50&to=0`, ua: FIREFOX, headers: FETCHED, expect: 'absent' },
  // The image host.
  // plain: a crawler asks for the bare URL, and a query string would step around a 404 cached at the edge.
  { name: 'image host publishes its robots.txt', url: `${IMG}/robots.txt`, ua: SCRIPT, expect: 'robots', plain: true, knownOpen: 'cached 404 not purged yet' },
  { name: 'image master, plain HTTP library', url: IMAGE_MASTER, ua: SCRIPT, expect: 'refuse', method: 'HEAD', knownOpen: 'edge rule not applied yet' },
  // Must pass: the people this is for.
  { name: 'must pass: Chrome in the Embassy frame, embed home', url: `${APEX}/embed/bph`, ua: CHROME, headers: FRAME, expect: 'pass' },
  { name: 'must pass: Chrome in the Embassy frame, embed book', url: EMBED_BOOK, ua: CHROME, headers: FRAME, expect: 'pass' },
  { name: 'must pass: Firefox in the Embassy frame', url: EMBED_BOOK, ua: FIREFOX, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }, expect: 'pass' },
  { name: 'must pass: Safari in the Embassy frame', url: EMBED_BOOK, ua: SAFARI, expect: 'pass' },
  { name: 'must pass: Chrome on the subdomain', url: `${SUB}/`, ua: CHROME, headers: HINTS, expect: 'pass' },
  { name: 'must pass: Safari on the subdomain', url: `${SUB}/`, ua: SAFARI, expect: 'pass' },
  { name: 'must pass: policy page for any client', url: `${APEX}/robots.txt`, ua: SCRIPT, expect: 'pass' },
  { name: 'must pass: reader gets the whole text', url: TEXT, ua: CHROME, headers: { ...HINTS, ...FETCHED }, expect: 'whole', total: BPH.pages },
  { name: 'must pass: assistant reads a book outside the collection whole', url: `${APEX}/api/books/${OTHER.id}/text?format=json`, ua: CLAUDE_USER, expect: 'whole', total: OTHER.pages },
  { name: 'must pass: reader in the frame calls the tenant API', url: `${APEX}/api/bph/books/${BPH.id}`, ua: CHROME, headers: { ...HINTS, ...FETCHED }, expect: 'pass' },
  // Straight after the reader above: refused only while the edge has not kept the reader's copy.
  { name: 'plain HTTP library, tenant API after a reader', url: `${APEX}/api/bph/books/${BPH.id}`, ua: SCRIPT, expect: 'refuse' },
  { name: 'must pass: image host answers a reader', url: IMAGE_MASTER, method: 'HEAD', ua: CHROME, headers: { ...HINTS, referer: `${APEX}/`, 'sec-fetch-dest': 'image', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' }, expect: 'pass' },
];

async function pageCount(res) {
  try {
    const j = await res.json();
    return Array.isArray(j.pages) ? j.pages : null;
  } catch { return null; }
}

function isRefused(res) {
  return (res.headers.get('cf-mitigated') || '').toLowerCase() === 'challenge' || res.status === 403;
}

async function probe(row) {
  const sep = row.url.includes('?') ? '&' : '?';
  const url = row.plain ? row.url : `${row.url}${sep}_canary=bph-access`;
  const headers = { 'user-agent': row.ua, ...(row.headers || {}), ...(row.body ? { 'content-type': 'application/json' } : {}) };
  let res;
  try {
    res = await fetch(url, { method: row.method || 'GET', headers, body: row.body ? JSON.stringify(row.body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    return { got: `network: ${e.name}`, state: 'unknown' };
  }
  const answer = (got, ok) => ({ got, state: ok ? 'ok' : 'FAIL', status: res.status, cache: res.headers.get('cf-cache-status') });
  if (res.status === 429) { await res.arrayBuffer().catch(() => {}); return { got: '429 budget', state: 'unknown', status: 429 }; }
  if (res.status >= 500) { await res.arrayBuffer().catch(() => {}); return { got: `http ${res.status}`, state: 'unknown', status: res.status }; }

  const refused = isRefused(res);
  switch (row.expect) {
    case 'refuse': {
      await res.arrayBuffer().catch(() => {});
      return answer(refused ? 'refused' : `answered ${res.status}`, refused);
    }
    case 'pass': {
      await res.arrayBuffer().catch(() => {});
      return answer(refused ? 'refused' : `answered ${res.status}`, !refused && res.status < 400);
    }
    case 'part':
    case 'whole': {
      if (refused) return answer('refused', row.expect === 'part');
      const pages = await pageCount(res);
      if (!pages) return answer(`no pages, ${res.status}`, row.expect === 'part' && res.status < 500);
      const whole = pages.length >= row.total;
      const shared = res.headers.get('cf-cache-status') === 'HIT';
      if (shared) return answer(`${pages.length}/${row.total} from a shared cache`, false);
      return answer(`${pages.length}/${row.total}`, row.expect === 'whole' ? whole : !whole);
    }
    case 'absent': {
      const pages = (await pageCount(res)) || [];
      const hidden = pages.filter((p) => p.page_number < 1).length;
      return answer(`${hidden} hidden`, hidden === 0);
    }
    case 'robots': {
      const text = await res.text().catch(() => '');
      return answer(res.status === 200 ? `${text.length} bytes` : `http ${res.status}`, res.status === 200 && /Disallow:\s*\/deepzoom\//.test(text));
    }
    default:
      return { got: 'bad row', state: 'FAIL' };
  }
}

function readState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { failing: [] }; } }
function writeState(st) {
  try { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(st)); }
  catch (e) { console.error(`[bph-access-probes] state not saved: ${e.message}`); }
}

const results = [];
for (const row of ROWS) {
  let r = await probe(row);
  // One retry: a single answer from a busy edge should not page anyone.
  if (r.state === 'FAIL') { await new Promise((ok) => setTimeout(ok, 5000)); r = await probe(row); }
  if (row.knownOpen && r.state === 'FAIL') r = { ...r, state: 'known-open' };
  results.push({ name: row.name, expect: row.expect, ...r });
}

const failing = results.filter((r) => r.state === 'FAIL').map((r) => r.name);
const unknown = results.filter((r) => r.state === 'unknown');
const measured = results.length - unknown.length;
if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), failing, results }));
else {
  for (const r of results) console.log(`${r.state.padEnd(10)} ${r.name.padEnd(64)} want ${r.expect.padEnd(6)} got ${r.got}`);
  console.log(`[bph-access-probes] ${new Date().toISOString()} ${results.filter((r) => r.state === 'ok').length} ok, ${failing.length} failing, ${results.filter((r) => r.state === 'known-open').length} known open, ${unknown.length} unknown`);
}

const prev = new Set(readState().failing || []);
const fresh = failing.filter((n) => !prev.has(n));
const unknownNames = new Set(unknown.map((r) => r.name));
// An unknown row keeps its last state, so a budget answer neither clears nor repeats a page.
const carried = [...prev].filter((n) => unknownNames.has(n));
const nowFailing = [...new Set([...failing, ...carried])];
const cleared = prev.size > 0 && nowFailing.length === 0;
// A row that cannot be measured has not passed. A week of the same silence pages once.
const prevState = readState();
const unknownRuns = unknown.length ? (prevState.unknownRuns || 0) + 1 : 0;
if (measured) writeState({ at: new Date().toISOString(), failing: nowFailing, unknownRuns });
if (!NO_PUSH && unknownRuns === BLIND_RUNS) {
  await ntfyPost(NTFY_TOPIC, { method: 'POST', headers: { Title: `BPH access: ${unknown.length} row(s) unmeasured for ${BLIND_RUNS} runs`, Tags: 'shield' }, body: 'Probably this address has used its page budget. Run scripts/audit/bph-access-probes.mjs --no-push. #8098' }).catch((e) => console.error(`[bph-access-probes] ntfy failed: ${e.message}`));
}
if (!NO_PUSH && (fresh.length || cleared)) {
  const readerHit = fresh.filter((n) => n.startsWith('must pass'));
  try {
    await ntfyPost(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        Title: cleared ? 'BPH access probes clear' : readerHit.length ? `BPH access: ${readerHit.length} reader check(s) failing` : `BPH access: ${fresh.length} protection check(s) changed`,
        Priority: readerHit.length ? 'high' : 'default',
        Tags: 'shield',
      },
      body: cleared ? 'Every BPH access row answers as expected again.' : `${fresh.length} row(s) changed. Run scripts/audit/bph-access-probes.mjs --no-push for the rows. #8098`,
    });
  } catch (e) {
    console.error(`[bph-access-probes] ntfy failed: ${e.message}`);
  }
}
process.exit(!measured ? 2 : failing.length ? 1 : 0);

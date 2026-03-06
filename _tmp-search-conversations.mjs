#!/usr/bin/env node
/**
 * Search Claude Code conversation history.
 *
 * Usage:
 *   node _tmp-search-conversations.mjs "search term"
 *   node _tmp-search-conversations.mjs --topic pipeline
 *   node _tmp-search-conversations.mjs --date 2026-02-19
 *   node _tmp-search-conversations.mjs --week          # last 7 days
 *   node _tmp-search-conversations.mjs --project sourcelibrary "import"
 *   node _tmp-search-conversations.mjs --read <session-id>   # read full session
 *   node _tmp-search-conversations.mjs --stats          # project/topic stats
 */

import { readdir, readFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

const PROJECTS_DIR = '/Users/dereklomas/.claude/projects';

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    if (['week', 'stats'].includes(key)) {
      flags[key] = true;
    } else {
      flags[key] = args[++i];
    }
  } else {
    positional.push(args[i]);
  }
}

const query = positional.join(' ').toLowerCase();

// ── Read mode: dump a full conversation ──
if (flags.read) {
  await readSession(flags.read);
  process.exit(0);
}

// ── Stats mode ──
if (flags.stats) {
  await showStats();
  process.exit(0);
}

// ── Search mode ──
const projectDirs = (await readdir(PROJECTS_DIR)).filter(d => !d.startsWith('.'));
const results = [];

for (const projDir of projectDirs) {
  const projPath = join(PROJECTS_DIR, projDir);
  const projName = projDir.replace(/^-Users-dereklomas-?/, '') || '(home)';

  if (flags.project && !projName.includes(flags.project)) continue;

  let entries;
  try { entries = await readdir(projPath); } catch { continue; }

  const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'));

  for (const file of jsonlFiles) {
    const id = file.replace('.jsonl', '');
    const filepath = join(projPath, file);

    // Quick date filter before reading content
    if (flags.date || flags.week) {
      try {
        const fStat = await stat(filepath);
        const fileDate = fStat.mtime.toISOString().split('T')[0];
        if (flags.date && !fileDate.startsWith(flags.date)) continue;
        if (flags.week) {
          const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
          if (fileDate < weekAgo) continue;
        }
      } catch { continue; }
    }

    // Search within conversation
    const match = await searchConversation(filepath, id, projName, query, flags.topic);
    if (match) results.push(match);
  }
}

// Sort by relevance (match count) then date
results.sort((a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  return (b.date || '').localeCompare(a.date || '');
});

if (results.length === 0) {
  console.log('No matches found.');
  process.exit(0);
}

console.log(`Found ${results.length} matching conversations:\n`);

for (const r of results.slice(0, 30)) {
  const topicStr = r.topics.length > 0 ? ` [${r.topics.join(', ')}]` : '';
  const projTag = r.project !== 'sourcelibrary' ? ` (${r.project})` : '';
  console.log(`\x1b[1m${r.date}\x1b[0m \x1b[2m${r.id.slice(0, 8)}\x1b[0m${projTag}${topicStr}`);
  if (r.firstMsg) console.log(`  ${r.firstMsg.slice(0, 120)}`);
  if (r.matchedLines.length > 0) {
    for (const line of r.matchedLines.slice(0, 3)) {
      console.log(`  \x1b[33m> ${line.slice(0, 150)}\x1b[0m`);
    }
  }
  console.log(`  \x1b[2mTo read: node _tmp-search-conversations.mjs --read ${r.id.slice(0, 8)}\x1b[0m`);
  console.log();
}

if (results.length > 30) {
  console.log(`... and ${results.length - 30} more matches`);
}

// ── Functions ──

async function searchConversation(filepath, id, project, query, topicFilter) {
  const rl = createInterface({ input: createReadStream(filepath), crlfDelay: Infinity });

  let firstTimestamp = null;
  let firstUserMsg = null;
  let matchedLines = [];
  let score = 0;
  let topics = new Set();
  let userMsgCount = 0;

  for await (const line of rl) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.timestamp && !firstTimestamp) firstTimestamp = entry.timestamp;

    const role = entry.type || entry.message?.role || entry.role;
    const text = extractText(entry);

    if (role === 'user' || entry.message?.role === 'user') {
      userMsgCount++;
      if (!firstUserMsg && text && text.length > 5 && !isSystemMsg(text)) {
        firstUserMsg = text.slice(0, 200).replace(/\n/g, ' ').trim();
      }
    }

    if (!text) continue;
    const lower = text.toLowerCase();

    // Topic detection (lightweight)
    detectTopicsLite(lower, topics);

    // Query matching
    if (query && lower.includes(query)) {
      score++;
      // Extract the matching line context
      const idx = lower.indexOf(query);
      const start = Math.max(0, idx - 50);
      const end = Math.min(text.length, idx + query.length + 100);
      const snippet = text.slice(start, end).replace(/\n/g, ' ').trim();
      if (matchedLines.length < 5) matchedLines.push(snippet);
    }
  }

  if (userMsgCount < 1) return null;

  // Topic filter
  if (topicFilter && !topics.has(topicFilter)) return null;

  // Must match query or be in date/topic-only mode
  if (query && score === 0) return null;
  if (!query && !topicFilter && !flags.date && !flags.week) return null;

  // Score boost for topic match
  if (topicFilter && topics.has(topicFilter)) score += 5;
  if (!query) score = 1; // normalize for date/topic browsing

  return {
    id,
    project,
    date: firstTimestamp ? new Date(firstTimestamp).toISOString().split('T')[0] : 'unknown',
    firstMsg: firstUserMsg,
    topics: [...topics],
    matchedLines,
    score,
  };
}

function extractText(entry) {
  const c = entry.message?.content || entry.content;
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x.type === 'text').map(x => x.text).join(' ');
  return '';
}

function isSystemMsg(text) {
  const t = text.trim();
  if (t.startsWith('<system-reminder>') || t.startsWith('[Request interrupted')) return true;
  if (t.includes('This session is being continued')) return true;
  return false;
}

function detectTopicsLite(t, topics) {
  if (t.includes('pipeline') && (t.includes('cron') || t.includes('phase'))) topics.add('pipeline');
  if (t.includes('batch-ocr') || t.includes('batch_ocr')) topics.add('batch-ocr');
  if (t.includes('translat') && (t.includes('batch') || t.includes('lambda'))) topics.add('translation');
  if (t.includes('gallery') || t.includes('image-extraction')) topics.add('gallery');
  if (t.includes('tweet') || t.includes('social-post')) topics.add('social');
  if (t.includes('edition') && t.includes('doi')) topics.add('editions');
  if (t.includes('lambda') && (t.includes('deploy') || t.includes('worker'))) topics.add('lambda');
  if (t.includes('hetzner')) topics.add('hetzner');
  if (t.includes('mcp') && t.includes('server')) topics.add('mcp');
  if (t.includes('shwep')) topics.add('shwep');
  if (t.includes('import') && (t.includes('ia') || t.includes('gallica'))) topics.add('import');
  if (t.includes('chapter') && t.includes('extract')) topics.add('chapters');
  if (t.includes('search') && (t.includes('unified') || t.includes('index'))) topics.add('search');
  if (t.includes('entity') || t.includes('encyclopedia')) topics.add('entities');
  if (t.includes('email') && t.includes('resend')) topics.add('email');
}

async function readSession(partialId) {
  // Find the session file
  const projectDirs = (await readdir(PROJECTS_DIR)).filter(d => !d.startsWith('.'));

  for (const projDir of projectDirs) {
    const projPath = join(PROJECTS_DIR, projDir);
    let entries;
    try { entries = await readdir(projPath); } catch { continue; }

    const match = entries.find(e => e.endsWith('.jsonl') && e.startsWith(partialId));
    if (!match) continue;

    const projName = projDir.replace(/^-Users-dereklomas-?/, '') || '(home)';
    console.log(`\x1b[1mSession: ${match.replace('.jsonl', '')}\x1b[0m`);
    console.log(`Project: ${projName}\n`);

    const rl = createInterface({ input: createReadStream(join(projPath, match)), crlfDelay: Infinity });

    let msgNum = 0;
    for await (const line of rl) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      const role = entry.type || entry.message?.role || entry.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const text = extractText(entry);
      if (!text || text.length < 3) continue;
      if (isSystemMsg(text)) continue;

      msgNum++;
      const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
      const roleLabel = role === 'user' ? '\x1b[36mUser\x1b[0m' : '\x1b[32mClaude\x1b[0m';

      console.log(`--- ${roleLabel} ${ts} ---`);
      // Truncate very long messages
      const display = text.length > 2000 ? text.slice(0, 2000) + '\n... (truncated)' : text;
      console.log(display);
      console.log();
    }

    console.log(`\n(${msgNum} messages)`);
    return;
  }

  console.log(`No session found matching "${partialId}"`);
}

async function showStats() {
  const indexPath = join(PROJECTS_DIR, '-Users-dereklomas-sourcelibrary/memory/conversation-index-sourcelibrary.md');
  try {
    const content = await readFile(indexPath, 'utf8');

    // Extract topics section
    const topicsMatch = content.match(/## Topics\n\n([\s\S]*?)\n---/);
    if (topicsMatch) {
      console.log('\x1b[1mSource Library Topics:\x1b[0m');
      console.log(topicsMatch[1]);
    }

    // Count by month
    const months = {};
    const monthRegex = /### (\d{4}-\d{2})/g;
    let m;
    while ((m = monthRegex.exec(content)) !== null) {
      const month = m[1];
      // Count entries after this header until next header
      const start = m.index;
      const nextHeader = content.indexOf('### ', start + 1);
      const section = nextHeader > -1 ? content.slice(start, nextHeader) : content.slice(start);
      const count = (section.match(/^\*\*/gm) || []).length;
      months[month] = count;
    }

    console.log('\x1b[1mSessions by month:\x1b[0m');
    for (const [month, count] of Object.entries(months)) {
      const bar = '█'.repeat(Math.ceil(count / 5));
      console.log(`  ${month}  ${String(count).padStart(3)} ${bar}`);
    }
  } catch {
    console.log('No index found. Run _tmp-index-conversations.mjs first.');
  }
}

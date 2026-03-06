#!/usr/bin/env node
/**
 * Index ALL Claude Code conversations across ALL projects.
 * Extracts: date, first user message, key topics, files modified, commits made.
 * Outputs: global index + per-project summaries.
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

const PROJECTS_DIR = '/Users/dereklomas/.claude/projects';
const OUTPUT_DIR = '/Users/dereklomas/.claude/projects/-Users-dereklomas-sourcelibrary/memory';

// Skip these in first user message detection
const SYSTEM_PREFIXES = [
  '[Request interrupted',
  '<system-reminder>',
  '<system>',
  '<task-notification>',
  '<teammate-message',
  '<local-command',
];

function isSystemMessage(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 3) return true;
  if (SYSTEM_PREFIXES.some(p => t.startsWith(p))) return true;
  if (t.includes('This session is being continued from a previous conversation')) return true;
  if (t.startsWith('Implement the following plan:')) return true;
  return false;
}

function extractText(entry) {
  if (entry.message?.content) {
    const c = entry.message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter(x => x.type === 'text').map(x => x.text).join(' ');
  }
  if (entry.content) {
    const c = entry.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter(x => x.type === 'text').map(x => x.text).join(' ');
  }
  return '';
}

function isUserMessage(entry) {
  return entry.type === 'user' || entry.message?.role === 'user' || entry.role === 'user';
}

function isAssistantMessage(entry) {
  return entry.type === 'assistant' || entry.message?.role === 'assistant' || entry.role === 'assistant';
}

// Topic detection from actual content (not system context)
function detectTopics(text, topics) {
  const t = text.toLowerCase();
  if (t.includes('image-extraction') || t.includes('image_extraction') || t.includes('extract images') || t.includes('detected_images')) topics.add('image-extraction');
  if ((t.includes('batch-ocr') || t.includes('batch_ocr') || t.includes('batch ocr')) && !t.includes('docs/batch')) topics.add('batch-ocr');
  if (t.includes('translat') && (t.includes('batch') || t.includes('lambda') || t.includes('queue') || t.includes('fifo'))) topics.add('translation');
  if (t.includes('pipeline') && (t.includes('cron') || t.includes('post-import') || t.includes('phase') || t.includes('status'))) topics.add('pipeline');
  if (t.includes('gallery') && (t.includes('image') || t.includes('page') || t.includes('sync') || t.includes('schema'))) topics.add('gallery');
  if (t.includes('tweet') || t.includes('social-post') || t.includes('social_post')) topics.add('social');
  if (t.includes('/api/import') || t.includes('ia_identifier') || t.includes('reimport') || t.includes('gallica')) topics.add('import');
  if (t.includes('split') && (t.includes('detect') || t.includes('crop') || t.includes('spread'))) topics.add('split-detection');
  if (t.includes('archive') && (t.includes('image') || t.includes('blob') || t.includes('hetzner'))) topics.add('archiving');
  if (t.includes('edition') && (t.includes('publish') || t.includes('doi') || t.includes('zenodo'))) topics.add('editions');
  if (t.includes('search') && (t.includes('unified') || t.includes('query') || t.includes('text index'))) topics.add('search');
  if (t.includes('entity') || t.includes('encyclopedia')) topics.add('entities');
  if (t.includes('chapter') && (t.includes('extract') || t.includes('section'))) topics.add('chapters');
  if (t.includes('enrich') && (t.includes('summary') || t.includes('index') || t.includes('metadata'))) topics.add('enrichment');
  if (t.includes('lambda') && (t.includes('deploy') || t.includes('worker') || t.includes('processor') || t.includes('zip'))) topics.add('lambda');
  if (t.includes('thumbnail') && (t.includes('blob') || t.includes('generate') || t.includes('fix') || t.includes('stale'))) topics.add('thumbnails');
  if (t.includes('analytics') && (t.includes('dashboard') || t.includes('pageview') || t.includes('usage') || t.includes('track'))) topics.add('analytics');
  if (t.includes('mcp') && (t.includes('server') || t.includes('tool') || t.includes('npm') || t.includes('cli'))) topics.add('mcp');
  if (t.includes('vercel --prod') || (t.includes('vercel') && t.includes('deploy') && !t.includes('vercel.json'))) topics.add('deploy');
  if (t.includes('hetzner') && (t.includes('server') || t.includes('script') || t.includes('archive'))) topics.add('hetzner');
  if (t.includes('prompt') && (t.includes('ocr') || t.includes('version') || t.includes('v5') || t.includes('v6'))) topics.add('prompts');
  if (t.includes('quality') && (t.includes('scor') || t.includes('audit') || t.includes('qa'))) topics.add('quality');
  if (t.includes('schema.org') || t.includes('structured-data') || t.includes('json-ld')) topics.add('seo');
  if (t.includes('metadata') && (t.includes('enrich') || t.includes('catalog') || t.includes('ustc'))) topics.add('metadata');
  if ((t.includes('email') || t.includes('resend') || t.includes('mailing')) && (t.includes('send') || t.includes('broadcast') || t.includes('digest'))) topics.add('email');
  if (t.includes('shwep')) topics.add('shwep');
  if (t.includes('hydration') || t.includes('hydrat')) topics.add('hydration');
  if (t.includes('reader') && (t.includes('page') || t.includes('translation') || t.includes('notes'))) topics.add('reader');
  if ((t.includes('homepage') || t.includes('hero section') || t.includes('landing page')) && !t.includes('homepage dropdown')) topics.add('homepage');
  if (t.includes('style') && (t.includes('css') || t.includes('tailwind') || t.includes('color') || t.includes('font'))) topics.add('styling');
  if (t.includes('write-processor') || t.includes('write queue') || t.includes('writer lambda')) topics.add('write-queue');
  if (t.includes('collection') && (t.includes('showcase') || t.includes('featured') || t.includes('curate') || t.includes('shwep collection') || t.includes('collection page'))) topics.add('collections');
  if (t.includes('kdp') || t.includes('kindle') || t.includes('amazon') || t.includes('print on demand')) topics.add('kdp');
  // Cross-project topics (only specific enough to be useful)
  if (t.includes('quantum') && (t.includes('circuit') || t.includes('qubit') || t.includes('inspire'))) topics.add('quantum');
  if (t.includes('card') && (t.includes('deck') || t.includes('tarot'))) topics.add('cards');
  if (t.includes('codevibing') || t.includes('session replay')) topics.add('codevibing');
  if (t.includes('oura') || t.includes('sleep') || t.includes('hrv')) topics.add('health');
}

async function processConversation(filepath) {
  const rl = createInterface({
    input: createReadStream(filepath),
    crlfDelay: Infinity,
  });

  let firstUserMsg = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let userMsgCount = 0;
  let assistantMsgCount = 0;
  let filesEdited = new Set();
  let filesCreated = new Set();
  let commitMessages = [];
  let topics = new Set();
  let lineCount = 0;
  let userTexts = [];
  let assistantTexts = [];
  let cwd = null;

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Track working directory
    if (entry.cwd && !cwd) cwd = entry.cwd;

    // Track timestamps
    if (entry.timestamp) {
      if (!firstTimestamp) firstTimestamp = entry.timestamp;
      lastTimestamp = entry.timestamp;
    }

    if (isUserMessage(entry)) {
      userMsgCount++;
      const text = extractText(entry);
      if (text && text.length > 5) {
        userTexts.push(text);
        if (!firstUserMsg && !isSystemMessage(text)) {
          firstUserMsg = text.slice(0, 300).replace(/\n/g, ' ').trim();
        }
      }
    }

    if (isAssistantMessage(entry)) {
      assistantMsgCount++;
      const text = extractText(entry);
      if (text && text.length > 20) {
        assistantTexts.push(text.slice(0, 500));
      }
    }

    const lineStr = line;

    // File paths from tool calls
    const editMatch = lineStr.match(/"file_path"\s*:\s*"([^"]+)"/);
    if (editMatch) {
      const fp = editMatch[1].replace(/\/Users\/dereklomas\/[^/]+\//, '');
      if (lineStr.includes('"Edit"') || lineStr.includes('"edit"') || lineStr.includes('old_string')) {
        filesEdited.add(fp);
      }
      if (lineStr.includes('"Write"') || lineStr.includes('"write"')) {
        filesCreated.add(fp);
      }
    }

    // Git commits
    const commitMatch = lineStr.match(/git commit.*?-m\s*["']([^"']+)/);
    if (commitMatch) {
      commitMessages.push(commitMatch[1].slice(0, 120));
    }
  }

  // Topic detection on actual content only
  const combinedText = [...userTexts.slice(0, 20), ...assistantTexts.slice(0, 20)].join(' ');
  detectTopics(combinedText, topics);

  commitMessages = [...new Set(commitMessages)];

  // Calculate duration
  let durationMin = null;
  if (firstTimestamp && lastTimestamp) {
    durationMin = Math.round((new Date(lastTimestamp) - new Date(firstTimestamp)) / 60000);
  }

  return {
    firstUserMsg,
    firstTimestamp,
    lastTimestamp,
    durationMin,
    userMsgCount,
    assistantMsgCount,
    lineCount,
    cwd,
    filesEdited: [...filesEdited],
    filesCreated: [...filesCreated],
    commitMessages,
    topics: [...topics],
  };
}

// Process old-format conversations (pre-Feb 2026): UUID/tool-results/*.txt or UUID/session-memory/summary.md
async function processOldFormatConversation(dirPath, uuid) {
  const toolResultsDir = join(dirPath, uuid, 'tool-results');
  const sessionMemoryDir = join(dirPath, uuid, 'session-memory');
  let files = [];
  try {
    files = (await readdir(toolResultsDir)).filter(f => f.endsWith('.txt')).sort();
  } catch { /* no tool-results dir */ }

  // If no tool-results, try session-memory/summary.md
  let summaryTitle = null;
  let summaryText = null;
  try {
    const smContent = await readFile(join(sessionMemoryDir, 'summary.md'), 'utf8');
    // Extract title: first non-header, non-template, non-empty line after "# Session Title"
    const lines = smContent.split('\n');
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('#')) continue;
      if (line.startsWith('_')) continue;  // template instructions in italics
      if (line.length < 10) continue;
      summaryTitle = line;
      break;
    }
    summaryText = smContent;
  } catch { /* no summary */ }

  if (files.length === 0 && !summaryTitle) return null;

  // Get timestamps from file modification times (tool-results) or directory mtime
  let firstTimestamp = null;
  let lastTimestamp = null;

  if (files.length > 0) {
    for (const f of files) {
      const fPath = join(toolResultsDir, f);
      try {
        const fStat = await stat(fPath);
        const mtime = fStat.mtime.toISOString();
        if (!firstTimestamp || mtime < firstTimestamp) firstTimestamp = mtime;
        if (!lastTimestamp || mtime > lastTimestamp) lastTimestamp = mtime;
      } catch { /* skip */ }
    }
  } else {
    // Use directory mtime as best guess
    try {
      const dirStat = await stat(join(dirPath, uuid));
      firstTimestamp = dirStat.mtime.toISOString();
      lastTimestamp = firstTimestamp;
    } catch { /* skip */ }
    // Also check session-memory for better timestamps
    try {
      const smStat = await stat(join(sessionMemoryDir, 'summary.md'));
      lastTimestamp = smStat.mtime.toISOString();
    } catch { /* skip */ }
  }

  // Sample tool-result files for file paths and commits only
  const filesEdited = new Set();
  const filesCreated = new Set();
  const commitMessages = [];

  const sampled = files.slice(0, 50);
  for (const f of sampled) {
    try {
      const content = await readFile(join(toolResultsDir, f), 'utf8');
      const snippet = content.slice(0, 1500);
      const pathMatches = snippet.match(/src\/[^\s"',)]+\.(tsx?|jsx?|css|md)/g);
      if (pathMatches) pathMatches.forEach(p => filesEdited.add(p));
      const commitMatch = snippet.match(/git commit.*?-m\s*["']([^"']+)/);
      if (commitMatch) commitMessages.push(commitMatch[1].slice(0, 120));
    } catch { /* skip */ }
  }

  // If we have summary text, also extract file paths from it
  if (summaryText) {
    const smPaths = summaryText.match(/src\/[^\s"',)]+\.(tsx?|jsx?|css|md)/g);
    if (smPaths) smPaths.forEach(p => filesEdited.add(p));
  }

  // For old-format, infer topics from FILE PATHS only
  const topics = new Set();
  const filePathText = [...filesEdited].join(' ').toLowerCase();
  if (filePathText.includes('image-extraction') || filePathText.includes('detected_images') || filePathText.includes('gallery')) topics.add('gallery');
  if (filePathText.includes('batch-ocr') || filePathText.includes('batch_ocr')) topics.add('batch-ocr');
  if (filePathText.includes('translat')) topics.add('translation');
  if (filePathText.includes('pipeline') || filePathText.includes('cron')) topics.add('pipeline');
  if (filePathText.includes('import/')) topics.add('import');
  if (filePathText.includes('split')) topics.add('split-detection');
  if (filePathText.includes('edition')) topics.add('editions');
  if (filePathText.includes('search')) topics.add('search');
  if (filePathText.includes('entit') || filePathText.includes('encyclopedia')) topics.add('entities');
  if (filePathText.includes('chapter')) topics.add('chapters');
  if (filePathText.includes('analytics')) topics.add('analytics');
  if (filePathText.includes('social')) topics.add('social');
  if (filePathText.includes('thumbnail')) topics.add('thumbnails');
  if (filePathText.includes('lambda') || filePathText.includes('worker') || filePathText.includes('processor')) topics.add('lambda');
  if (filePathText.includes('prompts')) topics.add('prompts');
  if (filePathText.includes('process/route') || filePathText.includes('jobs/')) topics.add('pipeline');
  if (filePathText.includes('reader') || filePathText.includes('translationeditor') || filePathText.includes('notesrenderer')) topics.add('reader');

  // First user message — prefer summary title, then infer from file paths
  let firstUserMsg = null;
  if (summaryTitle) {
    firstUserMsg = `(summary: ${summaryTitle})`;
  } else {
    const allFilesStr = [...filesEdited].join(' ');
    const routeMatch = allFilesStr.match(/api\/[a-z][a-z0-9/-]+/);
    const componentMatch = allFilesStr.match(/components\/([A-Z][a-zA-Z]+)/);
    if (routeMatch || componentMatch) {
      const hints = [];
      if (routeMatch) hints.push(routeMatch[0]);
      if (componentMatch) hints.push(componentMatch[1]);
      firstUserMsg = `(inferred from tool results: ${hints.join(', ')})`;
    }
  }

  let durationMin = null;
  if (firstTimestamp && lastTimestamp) {
    durationMin = Math.round((new Date(lastTimestamp) - new Date(firstTimestamp)) / 60000);
  }

  return {
    firstUserMsg,
    firstTimestamp,
    lastTimestamp,
    durationMin,
    userMsgCount: 0,
    assistantMsgCount: 0,
    lineCount: files.length || 1, // at least 1 for session-memory-only
    cwd: null,
    filesEdited: [...filesEdited].slice(0, 20),
    filesCreated: [...filesCreated].slice(0, 10),
    commitMessages: [...new Set(commitMessages)],
    topics: [...topics],
    isOldFormat: true,
  };
}

function friendlyProjectName(dirName) {
  // "-Users-dereklomas-sourcelibrary" -> "sourcelibrary"
  return dirName.replace(/^-Users-dereklomas-?/, '') || '(home)';
}

async function main() {
  const projectDirs = (await readdir(PROJECTS_DIR))
    .filter(d => !d.startsWith('.'));

  console.log(`Found ${projectDirs.length} project directories`);

  const allResults = []; // { project, id, ...info }
  const projectStats = {}; // projectName -> { count, totalMsgs, dateRange }

  for (const projDir of projectDirs) {
    const projPath = join(PROJECTS_DIR, projDir);
    const projStat = await stat(projPath);
    if (!projStat.isDirectory()) continue;

    // Check for JSONL files (new format) and UUID dirs (old format)
    const jsonlFiles = [];
    const uuidDirs = [];

    let entries;
    try {
      entries = await readdir(projPath);
    } catch {
      continue;
    }

    for (const e of entries) {
      if (e.endsWith('.jsonl')) jsonlFiles.push(e);
      else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e)) {
        // UUID directory — old format only if no matching .jsonl exists
        if (!entries.includes(`${e}.jsonl`)) {
          const hasToolResults = await stat(join(projPath, e, 'tool-results')).then(s => s.isDirectory()).catch(() => false);
          const hasSessionMemory = await stat(join(projPath, e, 'session-memory')).then(s => s.isDirectory()).catch(() => false);
          if (hasToolResults || hasSessionMemory) uuidDirs.push(e);
        }
      }
    }

    jsonlFiles.sort();

    if (jsonlFiles.length === 0 && uuidDirs.length === 0) continue;

    const projName = friendlyProjectName(projDir);
    const formatNote = uuidDirs.length > 0 ? ` (${jsonlFiles.length} jsonl + ${uuidDirs.length} old)` : '';
    console.log(`  ${projName}: ${jsonlFiles.length + uuidDirs.length} conversations${formatNote}...`);

    let projConvCount = 0;
    let projMsgCount = 0;
    let projFirstDate = null;
    let projLastDate = null;

    // Process JSONL files (new format)
    for (const file of jsonlFiles) {
      const id = file.replace('.jsonl', '');
      try {
        const info = await processConversation(join(projPath, file));
        if (info.lineCount < 3) continue;

        allResults.push({ project: projName, projectDir: projDir, id, ...info });
        projConvCount++;
        projMsgCount += info.userMsgCount + info.assistantMsgCount;

        if (info.firstTimestamp) {
          if (!projFirstDate || info.firstTimestamp < projFirstDate) projFirstDate = info.firstTimestamp;
          if (!projLastDate || info.firstTimestamp > projLastDate) projLastDate = info.firstTimestamp;
        }
      } catch (err) {
        // skip silently
      }
    }

    // Process old-format UUID directories
    for (const uuid of uuidDirs) {
      try {
        const info = await processOldFormatConversation(projPath, uuid);
        if (!info) continue;

        allResults.push({ project: projName, projectDir: projDir, id: uuid, ...info });
        projConvCount++;

        if (info.firstTimestamp) {
          if (!projFirstDate || info.firstTimestamp < projFirstDate) projFirstDate = info.firstTimestamp;
          if (!projLastDate || info.firstTimestamp > projLastDate) projLastDate = info.firstTimestamp;
        }
      } catch {
        // skip silently
      }
    }

    if (projConvCount > 0) {
      projectStats[projName] = {
        count: projConvCount,
        totalMessages: projMsgCount,
        firstDate: projFirstDate ? new Date(projFirstDate).toISOString().split('T')[0] : '?',
        lastDate: projLastDate ? new Date(projLastDate).toISOString().split('T')[0] : '?',
      };
    }
  }

  // Sort all results by timestamp (newest first)
  allResults.sort((a, b) => {
    if (!a.firstTimestamp && !b.firstTimestamp) return 0;
    if (!a.firstTimestamp) return 1;
    if (!b.firstTimestamp) return -1;
    return b.firstTimestamp.localeCompare(a.firstTimestamp);
  });

  console.log(`\nTotal: ${allResults.length} conversations across ${Object.keys(projectStats).length} projects`);

  // ── Build global index ──
  let md = `# Claude Code Conversation Index\n\n`;
  md += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  md += `Total: ${allResults.length} conversations across ${Object.keys(projectStats).length} projects\n\n`;

  // Project summary table
  md += `## Projects\n\n`;
  md += `| Project | Sessions | Messages | First | Last |\n`;
  md += `|---------|----------|----------|-------|------|\n`;
  const sortedProjects = Object.entries(projectStats).sort((a, b) => b[1].count - a[1].count);
  for (const [name, stats] of sortedProjects) {
    md += `| ${name} | ${stats.count} | ${stats.totalMessages} | ${stats.firstDate} | ${stats.lastDate} |\n`;
  }
  md += `\n`;

  // Topic index (global)
  const topicIndex = {};
  for (const r of allResults) {
    for (const t of r.topics) {
      if (!topicIndex[t]) topicIndex[t] = [];
      topicIndex[t].push(r.id);
    }
  }

  md += `## Topics\n\n`;
  const sortedTopics = Object.entries(topicIndex).sort((a, b) => b[1].length - a[1].length);
  for (const [topic, ids] of sortedTopics) {
    md += `- **${topic}** (${ids.length})\n`;
  }
  md += `\n---\n\n`;

  // Conversation list — grouped by month
  md += `## Conversations\n\n`;

  let currentMonth = '';
  for (const r of allResults) {
    const date = r.firstTimestamp
      ? new Date(r.firstTimestamp).toISOString().split('T')[0]
      : 'unknown';
    const month = date.slice(0, 7);

    if (month !== currentMonth) {
      currentMonth = month;
      md += `### ${month}\n\n`;
    }

    const topicStr = r.topics.length > 0 ? ` [${r.topics.join(', ')}]` : '';
    const msgStr = r.isOldFormat
      ? `${r.lineCount} tool-results`
      : `${r.userMsgCount}u/${r.assistantMsgCount}a`;
    const durStr = r.durationMin ? ` ${r.durationMin}m` : '';
    const projTag = r.project !== 'sourcelibrary' ? ` **${r.project}**` : '';
    const oldTag = r.isOldFormat ? ' *old-fmt*' : '';
    const firstMsg = r.firstUserMsg
      ? r.firstUserMsg.slice(0, 150).replace(/[|]/g, '\\|')
      : '(no user message)';

    md += `**${date}** \`${r.id.slice(0, 8)}\` (${msgStr}${durStr})${projTag}${oldTag}${topicStr}\n`;
    md += `> ${firstMsg}\n`;

    if (r.commitMessages.length > 0) {
      md += `> Commits: ${r.commitMessages.slice(0, 3).join('; ')}\n`;
    }

    const keyFiles = [...new Set([...r.filesEdited, ...r.filesCreated])].slice(0, 5);
    if (keyFiles.length > 0) {
      md += `> Files: ${keyFiles.join(', ')}\n`;
    }

    md += `\n`;
  }

  await writeFile(join(OUTPUT_DIR, 'conversation-index.md'), md);

  // ── Also write a sourcelibrary-only index (for focused searches) ──
  const SL_PROJECTS = new Set([
    'sourcelibrary', 'sourcelibrary-v2', 'sourcelibrary-backend', 'sourcelibrary-frontend',
    'sourcelibrary-v2-tools-test-images', 'sourcelibrary-v2-mcp-server', 'sourcelibrary-astrologuy',
  ]);
  const slResults = allResults.filter(r => SL_PROJECTS.has(r.project));
  let slMd = `# Source Library Conversation Index\n\n`;
  slMd += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  slMd += `Total: ${slResults.length} conversations\n\n`;

  // SL topic index
  const slTopicIndex = {};
  for (const r of slResults) {
    for (const t of r.topics) {
      if (!slTopicIndex[t]) slTopicIndex[t] = [];
      slTopicIndex[t].push(r.id);
    }
  }
  slMd += `## Topics\n\n`;
  const slSortedTopics = Object.entries(slTopicIndex).sort((a, b) => b[1].length - a[1].length);
  for (const [topic, ids] of slSortedTopics) {
    slMd += `- **${topic}** (${ids.length})\n`;
  }
  slMd += `\n---\n\n`;

  slMd += `## Conversations\n\n`;
  let slMonth = '';
  for (const r of slResults) {
    const date = r.firstTimestamp
      ? new Date(r.firstTimestamp).toISOString().split('T')[0]
      : 'unknown';
    const month = date.slice(0, 7);
    if (month !== slMonth) {
      slMonth = month;
      slMd += `### ${month}\n\n`;
    }
    const topicStr = r.topics.length > 0 ? ` [${r.topics.join(', ')}]` : '';
    const msgStr = r.isOldFormat
      ? `${r.lineCount} tool-results`
      : `${r.userMsgCount}u/${r.assistantMsgCount}a`;
    const durStr = r.durationMin ? ` ${r.durationMin}m` : '';
    const oldTag = r.isOldFormat ? ' *old-fmt*' : '';
    const firstMsg = r.firstUserMsg
      ? r.firstUserMsg.slice(0, 150).replace(/[|]/g, '\\|')
      : '(no user message)';

    const slProjTag = (r.project !== 'sourcelibrary' && r.project !== 'sourcelibrary-v2') ? ` **${r.project}**` : '';
    slMd += `**${date}** \`${r.id.slice(0, 8)}\` (${msgStr}${durStr})${slProjTag}${oldTag}${topicStr}\n`;
    slMd += `> ${firstMsg}\n`;
    if (r.commitMessages.length > 0) {
      slMd += `> Commits: ${r.commitMessages.slice(0, 3).join('; ')}\n`;
    }
    const keyFiles = [...new Set([...r.filesEdited, ...r.filesCreated])].slice(0, 5);
    if (keyFiles.length > 0) {
      slMd += `> Files: ${keyFiles.join(', ')}\n`;
    }
    slMd += `\n`;
  }

  await writeFile(join(OUTPUT_DIR, 'conversation-index-sourcelibrary.md'), slMd);

  // Print summary
  console.log(`\nWritten:`);
  console.log(`  ${join(OUTPUT_DIR, 'conversation-index.md')} (${allResults.length} conversations, all projects)`);
  console.log(`  ${join(OUTPUT_DIR, 'conversation-index-sourcelibrary.md')} (${slResults.length} conversations, sourcelibrary only)`);
  console.log(`\nProjects: ${sortedProjects.map(([n, s]) => `${n}(${s.count})`).join(', ')}`);
  console.log(`Topics: ${sortedTopics.map(([t, ids]) => `${t}(${ids.length})`).join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });

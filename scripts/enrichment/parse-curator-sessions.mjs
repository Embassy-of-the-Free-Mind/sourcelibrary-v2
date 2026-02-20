#!/usr/bin/env node
/**
 * Parse Claude Code conversation logs into browsable curator research sessions.
 *
 * Reads JSONL files from ~/.claude/projects/-Users-dereklomas-sourcelibrary/,
 * extracts conversational content, classifies curator sessions, and stores in MongoDB.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/parse-curator-sessions.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/parse-curator-sessions.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/parse-curator-sessions.mjs --file UUID
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/parse-curator-sessions.mjs --threshold 2
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// ── Config ──────────────────────────────────────────────────────────
const JSONL_DIR = path.join(
  process.env.HOME,
  '.claude/projects/-Users-dereklomas-sourcelibrary'
);
const MAX_MESSAGE_CHARS = 5000;
const MIN_MESSAGES = 4; // skip trivially short sessions

// ── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const idx = args.indexOf('--limit');
  return idx >= 0 ? parseInt(args[idx + 1]) : 0;
})();
const FILE_FILTER = (() => {
  const idx = args.indexOf('--file');
  return idx >= 0 ? args[idx + 1] : null;
})();
const THRESHOLD = (() => {
  const idx = args.indexOf('--threshold');
  return idx >= 0 ? parseInt(args[idx + 1]) : 3;
})();

// ── Tradition keywords for theme detection ──────────────────────────
const TRADITION_THEMES = {
  alchemy: ['alchemy', 'alchemical', 'alchimia', 'philosopher\'s stone', 'transmutation', 'chrysopoeia'],
  hermetica: ['hermetica', 'hermetic', 'hermes trismegistus', 'corpus hermeticum', 'emerald tablet'],
  kabbalah: ['kabbalah', 'kabbalistic', 'cabala', 'sephiroth', 'zohar', 'sefer'],
  demonology: ['demonology', 'demon', 'grimoire', 'goetia', 'necromancy', 'conjur'],
  astrology: ['astrology', 'astrolog', 'horoscope', 'zodiac', 'natal chart', 'jyotish'],
  rosicrucianism: ['rosicrucian', 'fama fraternitatis', 'chemical wedding'],
  neoplatonism: ['neoplatonism', 'neoplatonic', 'plotinus', 'proclus', 'ficino'],
  magic: ['magic', 'magical', 'theurgy', 'ritual magic', 'natural magic', 'occult philosophy'],
  divination: ['divination', 'geomancy', 'scrying', 'oracle', 'augury'],
  mysticism: ['mysticism', 'mystic', 'contemplat', 'visionary', 'theologia'],
  medicine: ['medicine', 'medical', 'paracelsus', 'iatrochemic', 'pharmacop'],
  natural_philosophy: ['natural philosophy', 'natura', 'physics', 'cosmolog'],
  theology: ['theology', 'theological', 'bible', 'quran', 'religious'],
  science_fiction: ['science fiction', 'sci-fi', 'utopia', 'dystopia'],
  mythology: ['mythology', 'mytholog', 'myth'],
  philosophy: ['philosophy', 'philosophi', 'metaphysic'],
};

// ── Extract text from a message content block ───────────────────────
function extractUserText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const texts = [];
  for (const block of content) {
    if (typeof block === 'string') {
      texts.push(block);
    } else if (typeof block === 'object' && block !== null) {
      if (block.type === 'text') {
        const text = block.text || '';
        // Skip system reminders and skill loading prompts
        if (text.includes('<system-reminder>')) continue;
        if (text.startsWith('Base directory for this skill:')) continue;
        texts.push(text);
      }
      // Skip tool_result, tool_use, image blocks
    }
  }
  return texts.join('\n').trim();
}

function extractAssistantText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const texts = [];
  for (const block of content) {
    if (typeof block === 'string') {
      texts.push(block);
    } else if (typeof block === 'object' && block !== null) {
      if (block.type === 'text') {
        texts.push(block.text || '');
      }
      // Skip tool_use, thinking blocks
    }
  }
  return texts.join('\n').trim();
}

// ── Parse a single JSONL file ───────────────────────────────────────
function parseJsonlFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const messages = [];
  let firstTimestamp = null;
  let lastTimestamp = null;

  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const type = obj.type;
    if (!type || type === 'file-history-snapshot' || type === 'progress' ||
        type === 'queue-operation' || type === 'system' || type === 'pr-link') {
      continue;
    }

    const timestamp = obj.timestamp || obj.message?.timestamp;

    if (type === 'user') {
      const msg = obj.message || {};
      const content = msg.content;
      const text = extractUserText(content);

      // Skip noise
      if (!text) continue;
      if (text === '[Request interrupted by user]') continue;
      if (text === '[Request interrupted by user for tool use]') continue;
      if (text.length < 2) continue;

      if (!firstTimestamp && timestamp) firstTimestamp = timestamp;
      if (timestamp) lastTimestamp = timestamp;

      messages.push({
        role: 'user',
        text: text.slice(0, MAX_MESSAGE_CHARS),
        timestamp: timestamp || '',
        index: messages.length,
      });
    } else if (type === 'assistant') {
      const msg = obj.message || {};
      const content = msg.content;
      const text = extractAssistantText(content);

      if (!text || text.length < 2) continue;

      if (!firstTimestamp && timestamp) firstTimestamp = timestamp;
      if (timestamp) lastTimestamp = timestamp;

      messages.push({
        role: 'assistant',
        text: text.slice(0, MAX_MESSAGE_CHARS),
        timestamp: timestamp || '',
        index: messages.length,
      });
    }
  }

  // Collapse consecutive same-role messages
  const collapsed = [];
  for (const msg of messages) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.role === msg.role) {
      const combined = prev.text + '\n\n' + msg.text;
      prev.text = combined.slice(0, MAX_MESSAGE_CHARS);
      if (!prev.timestamp && msg.timestamp) prev.timestamp = msg.timestamp;
    } else {
      collapsed.push({ ...msg, index: collapsed.length });
    }
  }

  return { messages: collapsed, firstTimestamp, lastTimestamp };
}

// ── Classify a session ──────────────────────────────────────────────
function classifySession(messages) {
  const allText = messages.map(m => m.text).join(' ').toLowerCase();
  const firstUserText = (messages.find(m => m.role === 'user')?.text || '').toLowerCase();

  // Score curator relevance
  let score = 0;

  // +3: first user message contains curator/acquisition language
  if (/curator|acquire|find books|import books|library-curator/.test(firstUserText)) {
    score += 3;
  }

  // +2: book evaluation language
  if (/\b(score|thematic fit|edition|evaluate|acquisition|candidate)\b/.test(allText)) {
    score += 2;
  }

  // +2: mentions specific traditions
  const detectedThemes = [];
  for (const [theme, keywords] of Object.entries(TRADITION_THEMES)) {
    if (keywords.some(kw => allText.includes(kw))) {
      detectedThemes.push(theme);
    }
  }
  if (detectedThemes.length >= 1) score += 2;

  // +1: mentions archive/library names
  if (/gallica|archive\.org|internet archive|bodleian|mdz|bavarian|hathitrust|e-rara|wellcome|hab wolfenb/.test(allText)) {
    score += 1;
  }

  // +1: contains import API patterns
  if (/post \/api\/import|\/api\/import\/|imported.*book|import.*from/.test(allText)) {
    score += 1;
  }

  // +1: mentions specific historical figures/authors common in esoteric texts
  if (/paracelsus|agrippa|ficino|dee|kircher|fludd|boehme|bruno|trithemius|lull|bacon|plotinus/.test(allText)) {
    score += 1;
  }

  // Determine session type
  let sessionType = 'mixed';
  if (/gap analysis|coverage|what.*missing|what.*don.t have|collection gaps/.test(allText)) {
    sessionType = 'gap_analysis';
  } else if (/import|acquire|find.*books|search.*for.*books|discover/.test(firstUserText)) {
    sessionType = 'acquisition';
  } else if (/research|investigate|explore|analyze|study/.test(firstUserText)) {
    sessionType = 'research';
  }

  return { score, themes: detectedThemes, sessionType };
}

// ── Extract book references ─────────────────────────────────────────
function extractBookRefs(messages) {
  const allText = messages.map(m => m.text).join('\n');
  const bookIds = new Set();

  // Match 24-char hex strings (MongoDB ObjectIds)
  const idMatches = allText.match(/\b[a-f0-9]{24}\b/g) || [];
  for (const id of idMatches) {
    bookIds.add(id);
  }

  // Match sourcelibrary.org/book/ URLs
  const urlMatches = allText.match(/sourcelibrary\.org\/book\/([a-f0-9]{24})/g) || [];
  for (const url of urlMatches) {
    const id = url.match(/([a-f0-9]{24})/)?.[1];
    if (id) bookIds.add(id);
  }

  return [...bookIds];
}

// ── Generate title from first user message ──────────────────────────
function generateTitle(messages) {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'Untitled Session';

  let text = firstUser.text
    .replace(/^(agent\s+)?curator\s*/i, '')
    .replace(/^\/curator\s*/i, '')
    .trim();

  // Clean up and truncate
  const firstLine = text.split('\n')[0];
  if (firstLine.length > 120) return firstLine.slice(0, 117) + '...';
  return firstLine || 'Untitled Session';
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('Parse Curator Sessions');
  console.log('='.repeat(60));
  console.log(`Source: ${JSONL_DIR}`);
  console.log(`Threshold: ${THRESHOLD}`);
  console.log(`Dry run: ${DRY_RUN}`);
  if (FILE_FILTER) console.log(`File filter: ${FILE_FILTER}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);
  console.log();

  // Find JSONL files
  let files = fs.readdirSync(JSONL_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(JSONL_DIR, f));

  if (FILE_FILTER) {
    files = files.filter(f => path.basename(f).startsWith(FILE_FILTER));
  }

  console.log(`Found ${files.length} JSONL files`);

  // Parse all files
  const sessions = [];
  let skippedShort = 0;
  let skippedScore = 0;

  for (const file of files) {
    const uuid = path.basename(file, '.jsonl');
    const { messages, firstTimestamp, lastTimestamp } = parseJsonlFile(file);

    if (messages.length < MIN_MESSAGES) {
      skippedShort++;
      continue;
    }

    const { score, themes, sessionType } = classifySession(messages);

    if (score < THRESHOLD) {
      skippedScore++;
      continue;
    }

    const bookIdCandidates = extractBookRefs(messages);
    const wordCount = messages.reduce((sum, m) => sum + m.text.split(/\s+/).length, 0);

    const startDate = firstTimestamp ? new Date(firstTimestamp) : new Date();
    const endDate = lastTimestamp ? new Date(lastTimestamp) : startDate;
    const durationMs = endDate.getTime() - startDate.getTime();

    sessions.push({
      id: uuid,
      title: generateTitle(messages),
      date: startDate.toISOString(),
      date_end: endDate.toISOString(),
      duration_minutes: Math.max(1, Math.round(durationMs / 60000)),
      themes,
      session_type: sessionType,
      curator_score: score,
      message_count: messages.length,
      word_count: wordCount,
      books_imported: [], // filled after DB lookup
      books_discussed: [], // filled after DB lookup
      messages,
      source_file: path.basename(file),
      created_at: startDate.toISOString(),
      _book_id_candidates: bookIdCandidates,
    });

    if (LIMIT && sessions.length >= LIMIT) break;
  }

  console.log(`Parsed: ${sessions.length} curator sessions`);
  console.log(`Skipped (too short): ${skippedShort}`);
  console.log(`Skipped (below threshold): ${skippedScore}`);
  console.log();

  // Sort by date descending
  sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Print summary
  for (const s of sessions) {
    console.log(
      `  [${s.curator_score}] ${s.session_type.padEnd(12)} ${s.date.slice(0, 10)}  ${s.message_count.toString().padStart(4)} msgs  ${s.themes.slice(0, 3).join(', ').padEnd(30)}  ${s.title.slice(0, 60)}`
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log('DRY RUN — no database writes');
    // Print theme distribution
    const themeCounts = {};
    for (const s of sessions) {
      for (const t of s.themes) {
        themeCounts[t] = (themeCounts[t] || 0) + 1;
      }
    }
    console.log('\nTheme distribution:');
    for (const [theme, count] of Object.entries(themeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${theme}: ${count}`);
    }
    process.exit(0);
  }

  // Connect to MongoDB
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  // Look up book IDs
  console.log('Looking up book references...');
  const allCandidateIds = [...new Set(sessions.flatMap(s => s._book_id_candidates))];

  let bookMap = {};
  if (allCandidateIds.length > 0) {
    const books = await db.collection('books')
      .find(
        { id: { $in: allCandidateIds } },
        { projection: { id: 1, title: 1, author: 1, year: 1 } }
      )
      .toArray();
    bookMap = Object.fromEntries(books.map(b => [b.id, b]));
    console.log(`  Found ${books.length} matching books from ${allCandidateIds.length} candidate IDs`);
  }

  // Resolve book refs
  for (const session of sessions) {
    const refs = [];
    for (const id of session._book_id_candidates) {
      const book = bookMap[id];
      if (book) {
        refs.push({
          book_id: book.id,
          title: book.title || 'Untitled',
          author: book.author,
          year: book.year,
        });
      }
    }

    // Check assistant text for "Imported:" patterns
    const assistantText = session.messages
      .filter(m => m.role === 'assistant')
      .map(m => m.text)
      .join('\n');

    const importedMatches = assistantText.match(/[Ii]mported[:\s]+[""]?([^"""\n]{5,80})[""]?/g) || [];
    for (const match of importedMatches) {
      const title = match.replace(/^[Ii]mported[:\s]+[""]?/, '').replace(/[""]$/, '').trim();
      if (title && !refs.some(r => r.title === title)) {
        refs.push({ title });
      }
    }

    // All found books go into books_discussed; those mentioned near "import" go into books_imported
    session.books_discussed = refs;
    session.books_imported = refs.filter(r => r.book_id); // only confirmed DB matches

    delete session._book_id_candidates;
  }

  // Upsert into MongoDB using bulkWrite for performance
  console.log(`\nWriting ${sessions.length} sessions to curator_sessions collection...`);
  const collection = db.collection('curator_sessions');

  const ops = sessions.map(session => ({
    updateOne: {
      filter: { id: session.id },
      update: { $set: session },
      upsert: true,
    },
  }));

  let inserted = 0;
  let updated = 0;
  // Process in batches of 10 to avoid oversized requests
  for (let i = 0; i < ops.length; i += 10) {
    const batch = ops.slice(i, i + 10);
    const result = await collection.bulkWrite(batch);
    inserted += result.upsertedCount || 0;
    updated += result.modifiedCount || 0;
    process.stdout.write(`  Batch ${Math.floor(i / 10) + 1}/${Math.ceil(ops.length / 10)}\r`);
  }
  console.log();

  console.log(`  Inserted: ${inserted}, Updated: ${updated}`);

  // Ensure indexes
  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ date: -1 });
  await collection.createIndex({ curator_score: -1 });
  await collection.createIndex({ themes: 1 });
  await collection.createIndex({ session_type: 1 });
  console.log('  Indexes ensured');

  await client.close();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

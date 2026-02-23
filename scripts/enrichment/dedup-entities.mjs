#!/usr/bin/env node

/**
 * Entity Deduplication Script
 *
 * Identifies duplicate entities using pattern matching and Gemini AI,
 * then creates canonical alias mappings in the `entity_aliases` collection.
 *
 * The sync routes use these aliases to merge variant names into canonical entities.
 *
 * Phase 1: Pattern-based dedup (St./Saint, parenthetical, case variants)
 * Phase 2: AI-assisted dedup for ambiguous cases
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/dedup-entities.mjs
 *
 * Options:
 *   --min-books=N     Minimum book count for entities to consider (default: 2)
 *   --dry-run         Show merges without writing
 *   --phase=1|2|all   Which phase to run (default: all)
 *   --limit=N         Max merge groups to process in phase 2 (default: 100)
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

// --- Config ---
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const MIN_BOOKS = parseInt(args['min-books'] || '2');
const DRY_RUN = args['dry-run'] === 'true';
const PHASE = args.phase || 'all';
const LIMIT = parseInt(args.limit || '100');
const MODEL = 'gemini-3-flash-preview';

const API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!API_KEY && (PHASE === '2' || PHASE === 'all')) {
  console.error('Missing GEMINI_API_KEY for phase 2');
  process.exit(1);
}

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

// --- Pattern-based dedup rules ---

/**
 * Normalize a name for comparison.
 * Returns a canonical key that groups equivalent names together.
 *
 * CONSERVATIVE: Only handles clear-cut patterns where merging is always safe.
 * Ambiguous cases (parentheticals with proper names, title+name combos) go to Phase 2 (AI).
 */
function normalizeForDedup(name, type) {
  let n = name.trim();

  // Lowercase for comparison
  let key = n.toLowerCase();

  // Only strip SAFE parentheticals — descriptive tags that don't disambiguate
  // Safe: "(Biblical)", "(the Philosopher)", "(referred to as 'the Philosopher')", "(mentioned)"
  // Unsafe: "(Maimonides)", "(of Aegina)", "(Pseudo-Aristotle)" — different entity
  const parenMatch = key.match(/\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    // Whitelist of safe descriptive patterns
    const isSafe =
      /^(the |a |an )/i.test(inner) ||                     // "the Philosopher", "the Elder"
      /^(biblical|holy|ancient|modern|metaphorical)/i.test(inner) || // single descriptive word
      /^(referenced|mentioned|quoted|cited)/i.test(inner) || // "referenced via..."
      /^(national|terrestrial)/i.test(inner) ||             // "National Library"
      /^(as the |as a )/i.test(inner);                      // "as the center..."

    // Block patterns that likely disambiguate different entities
    const isDisambiguating =
      /^(of |from |in |at )/i.test(inner) ||  // locative: "of Aegina", "from Alexandria"
      /^(pseudo-)/i.test(inner) ||            // "Pseudo-Aristotle"
      /^[A-Z][a-z]+$/.test(name.match(/\(([^)]+)\)/)?.[1]?.trim() || ''); // single proper name like "(Maimonides)"

    if (isSafe && !isDisambiguating) {
      key = key.replace(/\s*\([^)]*\)\s*$/, '').trim();
    }
  }

  // Normalize Saint/St./St prefixes (always safe)
  key = key.replace(/^(saint|st\.?)\s+/i, 'saint ');

  // Normalize "The" article prefix (always safe)
  key = key.replace(/^the\s+/i, '');

  // Normalize case variations of JESUS CHRIST etc
  // (case-insensitive key already handles this)

  // Collapse whitespace
  key = key.replace(/\s+/g, ' ').trim();

  return key;
}

/**
 * Find groups of entities that share the same normalized key.
 */
function findPatternDuplicates(entities) {
  const groups = new Map(); // normalized_key -> entity[]

  for (const entity of entities) {
    const key = `${entity.type}:${normalizeForDedup(entity.name, entity.type)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entity);
  }

  // Only return groups with 2+ entities
  return Array.from(groups.entries())
    .filter(([, entities]) => entities.length > 1)
    .map(([key, entities]) => ({
      key,
      entities: entities.sort((a, b) => b.book_count - a.book_count),
    }));
}

/**
 * Choose canonical name for a group:
 * - Prefer the form with the most books (most common usage)
 * - For Saint/St groups, prefer "Saint" over "St."
 * - For parenthetical groups, prefer without parenthetical
 */
function chooseCanonical(entities) {
  // Sort by book_count desc, then by name length desc (prefer fuller names)
  const sorted = [...entities].sort((a, b) => {
    if (b.book_count !== a.book_count) return b.book_count - a.book_count;
    return b.name.length - a.name.length;
  });

  let canonical = sorted[0].name;

  // Special cases: prefer "Saint" over "St."
  const saintForm = entities.find(e => /^Saint\s/i.test(e.name));
  const stForm = entities.find(e => /^St\.?\s/i.test(e.name));
  if (saintForm && stForm) {
    canonical = saintForm.name;
  }

  // Prefer form WITHOUT parenthetical if a non-parenthetical form has decent coverage
  const withParen = entities.filter(e => /\([^)]+\)/.test(e.name));
  const withoutParen = entities.filter(e => !/\([^)]+\)/.test(e.name));
  if (withParen.length > 0 && withoutParen.length > 0) {
    // Use the most popular non-parenthetical form
    const bestWithout = withoutParen.sort((a, b) => b.book_count - a.book_count)[0];
    canonical = bestWithout.name;
  }

  return canonical;
}

// --- Phase 2: AI-assisted dedup ---

function buildAIPrompt(candidates) {
  const list = candidates.map((group, i) => {
    const entities = group.entities.map(e =>
      `  "${e.name}" [${e.type}] (${e.book_count} books, ${e.total_mentions} mentions)`
    ).join('\n');
    return `Group ${i + 1}:\n${entities}`;
  }).join('\n\n');

  return `You are helping deduplicate an entity database from a library of rare Western esoteric texts (15th-18th century).

Below are groups of entities that MIGHT be duplicates. For each group, decide:
1. Are these truly the same entity? (Consider that "Mercury" the planet and "Mercury" the alchemical principle are DIFFERENT entities)
2. If yes, what should the canonical name be?
3. What are all the alias forms?

Groups to evaluate:
${list}

Respond with a JSON array. Each element:
- "group": group number (1-based)
- "is_duplicate": boolean — true if they refer to the same real-world entity
- "canonical_name": string — the best canonical name (null if not duplicate)
- "aliases": string[] — all variant names INCLUDING the canonical (null if not duplicate)
- "reasoning": string — brief explanation

Return ONLY the JSON array.`;
}

async function callGemini(prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      });

      const text = response.text?.trim();
      if (!text) throw new Error('Empty response');

      const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      if (attempt < retries) {
        const delay = attempt * 2000;
        console.warn(`  Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// --- Main ---
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const entitiesCol = db.collection('entities');
  const aliasesCol = db.collection('entity_aliases');

  // Ensure indexes on alias collection
  await aliasesCol.createIndex({ alias_lower: 1, type: 1 }, { unique: true });
  await aliasesCol.createIndex({ canonical_name: 1, type: 1 });

  console.log(`\n=== Entity Deduplication ===`);
  console.log(`Min books: ${MIN_BOOKS}`);
  console.log(`Phase: ${PHASE}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  // Fetch all entities above threshold
  const entities = await entitiesCol.find({ book_count: { $gte: MIN_BOOKS } })
    .sort({ book_count: -1 })
    .project({ name: 1, type: 1, book_count: 1, total_mentions: 1 })
    .toArray();

  console.log(`Entities above ${MIN_BOOKS} books: ${entities.length}\n`);

  // Check existing aliases
  const existingAliases = await aliasesCol.countDocuments();
  console.log(`Existing alias mappings: ${existingAliases}\n`);

  let totalMerged = 0;

  // --- Phase 1: Pattern-based ---
  if (PHASE === '1' || PHASE === 'all') {
    console.log('--- Phase 1: Pattern-based dedup ---\n');

    const groups = findPatternDuplicates(entities);
    console.log(`Found ${groups.length} duplicate groups\n`);

    for (const group of groups) {
      const canonical = chooseCanonical(group.entities);
      const aliases = group.entities.map(e => e.name).filter(n => n !== canonical);
      const totalBooks = group.entities.reduce((s, e) => s + e.book_count, 0);

      console.log(`  MERGE: ${canonical}`);
      for (const alias of aliases) {
        const e = group.entities.find(x => x.name === alias);
        console.log(`    <- "${alias}" (${e.book_count} books)`);
      }
      console.log(`    Total: ${totalBooks} books combined\n`);

      if (!DRY_RUN) {
        // Write alias mappings
        for (const alias of aliases) {
          try {
            await aliasesCol.updateOne(
              { alias_lower: alias.toLowerCase(), type: group.entities[0].type },
              {
                $set: {
                  alias_name: alias,
                  alias_lower: alias.toLowerCase(),
                  canonical_name: canonical,
                  type: group.entities[0].type,
                  source: 'pattern',
                  updated_at: new Date(),
                },
                $setOnInsert: {
                  created_at: new Date(),
                },
              },
              { upsert: true }
            );
          } catch (err) {
            if (err.code === 11000) {
              console.log(`    (alias "${alias}" already mapped)`);
            } else {
              throw err;
            }
          }
        }
        totalMerged += aliases.length;
      }
    }

    console.log(`Phase 1: ${groups.length} groups, ${DRY_RUN ? 'would create' : 'created'} ${groups.reduce((s, g) => s + g.entities.length - 1, 0)} alias mappings\n`);
  }

  // --- Phase 2: AI-assisted ---
  if ((PHASE === '2' || PHASE === 'all') && ai) {
    console.log('--- Phase 2: AI-assisted dedup ---\n');

    // Find potential duplicates by looking at similar names
    // Strategy: group entities that share a significant word
    const wordGroups = new Map(); // word -> entity[]

    for (const entity of entities) {
      // Skip entities already handled by phase 1 patterns
      const normalized = normalizeForDedup(entity.name, entity.type);

      // Extract significant words (3+ chars, not common words)
      const stopWords = new Set(['the', 'and', 'for', 'from', 'with', 'that', 'this', 'his', 'her', 'its']);
      const words = entity.name.toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !stopWords.has(w));

      for (const word of words) {
        const key = `${entity.type}:${word}`;
        if (!wordGroups.has(key)) {
          wordGroups.set(key, []);
        }
        const group = wordGroups.get(key);
        // Avoid adding the same entity twice
        if (!group.find(e => e.name === entity.name)) {
          group.push(entity);
        }
      }
    }

    // Filter to groups with 2+ entities that aren't already pattern-matched
    const patternKeys = new Set(
      findPatternDuplicates(entities).flatMap(g =>
        g.entities.map(e => `${e.type}:${e.name}`)
      )
    );

    // Check existing aliases to skip already-resolved groups
    const existingAliasDocs = await aliasesCol.find().toArray();
    const resolvedNames = new Set(existingAliasDocs.map(a => `${a.type}:${a.alias_lower}`));

    const aiCandidates = [];
    const seenPairs = new Set();

    for (const [key, group] of wordGroups) {
      if (group.length < 2 || group.length > 6) continue;

      // Skip if all entities in group are already pattern-matched to each other
      const unresolved = group.filter(e =>
        !resolvedNames.has(`${e.type}:${e.name.toLowerCase()}`)
      );
      if (unresolved.length < 2) continue;

      // Create a stable key for this pair to avoid duplicates
      const pairKey = unresolved.map(e => e.name).sort().join('|||');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      aiCandidates.push({ entities: unresolved });
    }

    console.log(`Found ${aiCandidates.length} candidate groups for AI review`);

    // Process in batches of 20
    const batchSize = 20;
    let processed = 0;
    let aiMerged = 0;

    for (let i = 0; i < Math.min(aiCandidates.length, LIMIT); i += batchSize) {
      const batch = aiCandidates.slice(i, i + batchSize);
      console.log(`\nAI batch ${Math.floor(i / batchSize) + 1}: ${batch.length} groups`);

      try {
        const prompt = buildAIPrompt(batch);
        const results = await callGemini(prompt);

        if (!Array.isArray(results)) {
          console.error('  Invalid AI response');
          continue;
        }

        for (const result of results) {
          const idx = result.group - 1;
          if (idx < 0 || idx >= batch.length) continue;

          if (result.is_duplicate && result.canonical_name && result.aliases) {
            const group = batch[idx];
            const type = group.entities[0].type;

            console.log(`  MERGE: ${result.canonical_name} (${result.reasoning})`);
            for (const alias of result.aliases) {
              if (alias === result.canonical_name) continue;
              console.log(`    <- "${alias}"`);

              if (!DRY_RUN) {
                try {
                  await aliasesCol.updateOne(
                    { alias_lower: alias.toLowerCase(), type },
                    {
                      $set: {
                        alias_name: alias,
                        alias_lower: alias.toLowerCase(),
                        canonical_name: result.canonical_name,
                        type,
                        source: 'ai',
                        reasoning: result.reasoning,
                        updated_at: new Date(),
                      },
                      $setOnInsert: {
                        created_at: new Date(),
                      },
                    },
                    { upsert: true }
                  );
                  aiMerged++;
                } catch (err) {
                  if (err.code !== 11000) throw err;
                }
              }
            }
          }
        }

        processed += batch.length;
        console.log(`  Progress: ${processed}/${Math.min(aiCandidates.length, LIMIT)}`);

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`  Batch error: ${err.message}`);
      }
    }

    console.log(`\nPhase 2: ${processed} groups reviewed, ${aiMerged} alias mappings ${DRY_RUN ? 'would be created' : 'created'}\n`);
    totalMerged += aiMerged;
  }

  // --- Summary ---
  const finalAliasCount = await aliasesCol.countDocuments();
  console.log(`\n=== Done ===`);
  console.log(`Total alias mappings: ${finalAliasCount}`);
  console.log(`New mappings this run: ${DRY_RUN ? '(dry run)' : totalMerged}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

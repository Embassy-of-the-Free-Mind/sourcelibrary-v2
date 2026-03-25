#!/usr/bin/env node
/**
 * Export all prompts from MongoDB to versioned git files in prompts/
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/export-prompts-to-git.mjs
 */

import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const PROMPTS_DIR = join(import.meta.dirname, '..', 'prompts');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').replace(/^-+/, '');
}

function contentHash(content) {
  return createHash('md5').update(content).digest('hex');
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const prompts = await db.collection('prompts')
    .find({})
    .sort({ name: 1, version: 1 })
    .toArray();

  console.log(`Found ${prompts.length} prompts in DB`);

  for (const prompt of prompts) {
    const type = prompt.type || 'ocr';
    const slug = slugify(prompt.name);
    const version = prompt.version || 0;
    const dir = join(PROMPTS_DIR, type);
    mkdirSync(dir, { recursive: true });

    const filename = `${slug}-v${version}.md`;
    const filepath = join(dir, filename);
    const hash = contentHash(prompt.content);

    const frontmatter = [
      '---',
      `name: "${prompt.name}"`,
      `type: ${type}`,
      `version: ${version}`,
      `is_default: ${!!prompt.is_default}`,
      `content_hash: ${hash}`,
      `db_id: ${prompt._id.toString()}`,
      `created_at: ${prompt.created_at ? new Date(prompt.created_at).toISOString() : 'unknown'}`,
      ...(prompt.description ? [`description: "${prompt.description}"`] : []),
      '---',
      '',
    ].join('\n');

    writeFileSync(filepath, frontmatter + prompt.content);
    console.log(`  ${type}/${filename} (${hash.slice(0, 8)})`);
  }

  await client.close();
  console.log(`\nExported ${prompts.length} prompts to ${PROMPTS_DIR}/`);
}

main().catch(err => { console.error(err); process.exit(1); });

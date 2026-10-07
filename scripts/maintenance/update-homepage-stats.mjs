#!/usr/bin/env node
/**
 * Compute homepage stats and cache them in system_config.
 * The computation lives in scripts/lib/homepage-stats.mjs (shared with prewarm-browse.mjs).
 * Run periodically (e.g. daily cron) or manually.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/update-homepage-stats.mjs
 */
import { MongoClient } from 'mongodb';
import { writeHomepageStats } from '../lib/homepage-stats.mjs';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = await MongoClient.connect(uri);
const stats = await writeHomepageStats(client.db('bookstore'));
console.log('Homepage stats updated:', stats);
await client.close();

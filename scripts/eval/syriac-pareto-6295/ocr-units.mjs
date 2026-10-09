#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/production-prompt.mjs (getProductionOcrPrompt — used as is); scripts/batch/bulk-reocr-local.mjs
// (production's OCR request shape, mirrored in run-batch.mjs --kind ocr). This only writes the units file.
/**
 * ocr-units.mjs — read-only, $0. One OCR unit per sealed #6295 page: the LIVE production OCR prompt and the
 * same page image every Kraken arm read. Writes <work>/ocr-units.jsonl and records the prompt version + hash.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/syriac-pareto-6295/ocr-units.mjs --work <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../../lib/mongo.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';
const W = process.argv[process.argv.indexOf('--work') + 1];
const pages = JSON.parse(fs.readFileSync(path.join(W, 'seal', 'pages.json'), 'utf8'));
let p; await withMongo(async (db) => { p = await getProductionOcrPrompt(db); });
const units = pages.map((pg) => ({ uid: pg.slug, prompt: p.text, image: path.join(W, 'seal', 'pages', pg.slug, 'image.jpg'), max_out: 16384 }));
fs.writeFileSync(path.join(W, 'ocr-units.jsonl'), units.map((u) => JSON.stringify(u)).join('\n') + '\n');
fs.writeFileSync(path.join(W, 'ocr-prompt.json'), JSON.stringify({ version: p.version, name: p.name, content_hash: p.content_hash, chars: p.text.length }, null, 1));
console.log(units.length, 'units; prompt', p.name, p.version, p.content_hash);

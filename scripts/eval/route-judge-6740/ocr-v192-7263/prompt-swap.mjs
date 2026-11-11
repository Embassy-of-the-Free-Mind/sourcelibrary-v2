// PRIOR ART: scripts/eval/router-confirm/readonly-mongo.mjs (makes a reader read-only; imported here, it does not swap
// a prompt) and `read --instruction-file` in scripts/batch/cli-ocr.mjs (APPENDS to the live prompt, so it cannot offer
// new values inside the prompt's own page-type list).
//
// Preloaded into `cli-ocr.mjs read` (`node --import=<this>`) for the #7263 prompt arm: every Mongo write throws, and
// with OCR_PROMPT_FILE set, the default-OCR-prompt row comes back with that file's text. So both arms run the same lane
// code byte for byte and the prompt is the only difference; prompt-ref.json in each arm's directory says which it sent.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Collection } from 'mongodb';
import '../../router-confirm/readonly-mongo.mjs';

const FILE = process.env.OCR_PROMPT_FILE;
if (FILE) {
  const content = fs.readFileSync(FILE, 'utf8');
  const hash = createHash('md5').update(content).digest('hex');
  const findOne = Collection.prototype.findOne;
  Collection.prototype.findOne = async function swapped(filter, ...rest) {
    const row = await findOne.call(this, filter, ...rest);
    if (this.collectionName !== 'prompts' || filter?.type !== 'ocr' || !filter?.is_default || !row) return row;
    return { ...row, content, content_hash: hash, version: process.env.OCR_PROMPT_VERSION ?? `file:${hash}` };
  };
}

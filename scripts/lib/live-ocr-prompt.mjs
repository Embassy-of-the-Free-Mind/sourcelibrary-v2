// PRIOR ART: scripts/eval/lib/production-prompt.mjs `getProductionOcrPrompt` (the same query, but an EVAL helper
// that always fills the auto-detect language slot and returns no prompt `_id`); `getOcrPromptFromDb` in
// scripts/workers/pipeline-orchestrator.mjs (the pipeline's loader, not importable: the orchestrator runs on import);
// the inline copy that was in scripts/batch/cli-ocr.mjs. This is that inline copy, moved so that cli-ocr.mjs (Gemini
// through `agy`) and claude-ocr.mjs (Opus through `claude`) send the same live prompt and differ only in the slot.
import path from 'node:path';
import { createHash } from 'node:crypto';
/**
 * The live default OCR prompt from the `prompts` collection, with its `{language_instruction}` slot filled.
 * Returns `base` (the text, before any per-call image instruction) and `ref` (what the provenance block cites).
 */
export const AUTO_DETECT_LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';

/** md5 of the raw template, before the slot is filled: what `prompts.content_hash` holds (src/lib/prompts.ts). */
export const promptContentHash = (content) => createHash('md5').update(content).digest('hex');

export async function liveOcrPrompt(db, languageInstruction = AUTO_DETECT_LANGUAGE_INSTRUCTION) {
  const prompt = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');
  return {
    base: prompt.content.replace('{language_instruction}', languageInstruction).replace('{language}', ''),
    ref: { id: prompt._id?.toString(), name: prompt.name, version: String(prompt.version ?? ''), hash: prompt.content_hash ?? null },
  };
}

/**
 * A candidate OCR prompt read from a file (`cli-ocr.mjs read --prompt-file=F`, #8567), in place of the live default:
 * the same slot filling, and a `ref` of the same shape. `hash` is computed exactly as the `prompts` row's
 * `content_hash` is, so a read made on the file and one made on the same text once installed as a prompt version cite
 * the same hash. There is no prompt row yet, so `id` is null and `version` names the file.
 */
export function fileOcrPrompt(content, file, languageInstruction = AUTO_DETECT_LANGUAGE_INSTRUCTION) {
  if (!content?.trim()) throw new Error(`prompt file ${file} is empty`);
  if (!content.includes('{language_instruction}')) throw new Error(`prompt file ${file} has no {language_instruction} slot: it is not an OCR prompt template`);
  const hash = promptContentHash(content);
  return {
    base: content.replace('{language_instruction}', languageInstruction).replace('{language}', ''),
    ref: { id: null, name: `prompt file ${path.basename(file)}`, version: `file:${hash.slice(0, 12)}`, hash, file: path.basename(file) },
  };
}

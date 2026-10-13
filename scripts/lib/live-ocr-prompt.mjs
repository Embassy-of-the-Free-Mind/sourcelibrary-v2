// PRIOR ART: scripts/eval/lib/production-prompt.mjs `getProductionOcrPrompt` (the same query, but an EVAL helper
// that always fills the auto-detect language slot and returns no prompt `_id`); `getOcrPromptFromDb` in
// scripts/workers/pipeline-orchestrator.mjs (the pipeline's loader, not importable: the orchestrator runs on import);
// the inline copy that was in scripts/batch/cli-ocr.mjs. This is that inline copy, moved so that cli-ocr.mjs (Gemini
// through `agy`) and claude-ocr.mjs (Opus through `claude`) send the same live prompt and differ only in the slot.
/**
 * The live default OCR prompt from the `prompts` collection, with its `{language_instruction}` slot filled.
 * Returns `base` (the text, before any per-call image instruction) and `ref` (what the provenance block cites).
 */
export const AUTO_DETECT_LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';

export async function liveOcrPrompt(db, languageInstruction = AUTO_DETECT_LANGUAGE_INSTRUCTION) {
  const prompt = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');
  return {
    base: prompt.content.replace('{language_instruction}', languageInstruction).replace('{language}', ''),
    ref: { id: prompt._id?.toString(), name: prompt.name, version: String(prompt.version ?? ''), hash: prompt.content_hash ?? null },
  };
}

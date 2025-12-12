import { GoogleGenerativeAI } from '@google/generative-ai';
import { DEFAULT_PROMPTS } from './types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function performOCR(
  imageUrl: string,
  language: string,
  previousPageOcr?: string,
  customPrompt?: string
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  let prompt = (customPrompt || DEFAULT_PROMPTS.ocr).replace('{language}', language);

  if (previousPageOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousPageOcr.slice(0, 2000)}...`;
  }

  // Fetch the image
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');
  const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  return result.response.text();
}

export async function performTranslation(
  ocrText: string,
  sourceLanguage: string,
  targetLanguage: string,
  previousPageTranslation?: string,
  customPrompt?: string
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  let prompt = (customPrompt || DEFAULT_PROMPTS.translation)
    .replace('{source_language}', sourceLanguage)
    .replace('{target_language}', targetLanguage);

  prompt += `\n\n**Text to translate:**\n${ocrText}`;

  if (previousPageTranslation) {
    prompt += `\n\n**Previous page translation for continuity:**\n${previousPageTranslation.slice(0, 2000)}...`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function generateSummary(
  translatedText: string,
  previousPageSummary?: string,
  customPrompt?: string
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  let prompt = customPrompt || DEFAULT_PROMPTS.summary;
  prompt += `\n\n**Translated text:**\n${translatedText}`;

  if (previousPageSummary) {
    prompt += `\n\n**Previous page summary for context:**\n${previousPageSummary}`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function processPageComplete(
  imageUrl: string,
  language: string,
  targetLanguage: string,
  previousPage?: {
    ocr?: string;
    translation?: string;
    summary?: string;
  },
  customPrompts?: {
    ocr?: string;
    translation?: string;
    summary?: string;
  }
): Promise<{
  ocr: string;
  translation: string;
  summary: string;
}> {
  // Step 1: OCR
  const ocr = await performOCR(
    imageUrl,
    language,
    previousPage?.ocr,
    customPrompts?.ocr
  );

  // Step 2: Translation
  const translation = await performTranslation(
    ocr,
    language,
    targetLanguage,
    previousPage?.translation,
    customPrompts?.translation
  );

  // Step 3: Summary
  const summary = await generateSummary(
    translation,
    previousPage?.summary,
    customPrompts?.summary
  );

  return { ocr, translation, summary };
}

import { GoogleGenerativeAI } from '@google/generative-ai';
import { DEFAULT_PROMPTS } from './types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Use gemini-2.0-flash (GA as of 2025)
const VISION_MODEL = 'gemini-2.0-flash';
const TEXT_MODEL = 'gemini-2.0-flash';

export async function performOCR(
  imageUrl: string,
  language: string,
  previousPageOcr?: string,
  customPrompt?: string
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  console.log('Starting OCR for image:', imageUrl);
  console.log('API Key present:', !!process.env.GEMINI_API_KEY);

  const model = genAI.getGenerativeModel({ model: VISION_MODEL });

  let prompt = (customPrompt || DEFAULT_PROMPTS.ocr).replace('{language}', language);

  if (previousPageOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousPageOcr.slice(0, 2000)}...`;
  }

  // Fetch the image
  console.log('Fetching image...');
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');
  const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
  console.log('Image fetched, size:', imageBuffer.byteLength, 'mimeType:', mimeType);

  console.log('Calling Gemini API...');
  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ]);
    console.log('Gemini API response received');
    return result.response.text();
  } catch (geminiError) {
    console.error('Gemini API error:', geminiError);
    throw new Error(`Gemini API error: ${geminiError instanceof Error ? geminiError.message : 'Unknown error'}`);
  }
}

export async function performTranslation(
  ocrText: string,
  sourceLanguage: string,
  targetLanguage: string,
  previousPageTranslation?: string,
  customPrompt?: string
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

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
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

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

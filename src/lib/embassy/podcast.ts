/**
 * Podcast generation from research notebooks.
 *
 * Two-stage pipeline:
 *   1. Gemini Flash writes a two-host conversation script from notebook findings
 *   2. Gemini TTS voices it with multi-speaker support
 *
 * Audio stored on R2, metadata in MongoDB (embassy_threads.podcast).
 */

import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';
import { storagePut, r2Url } from '@/lib/storage';
import { ObjectId } from 'mongodb';

const SCRIPT_MODEL = 'gemini-3-flash-preview';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// Two hosts for the podcast
const HOST_A = 'Elena';
const HOST_B = 'Marcus';
const VOICE_A = 'Kore';    // Female voice
const VOICE_B = 'Puck';    // Male voice

interface NotebookFinding {
  quote: string;
  note?: string;
  source: {
    bookId: string;
    bookTitle: string;
    bookAuthor: string;
    bookSlug?: string;
    pageNumber: number;
  };
}

interface PodcastResult {
  audioUrl: string;
  script: string;
  duration?: number;
}

/**
 * Generate a podcast-style Audio Overview from research notebook findings.
 */
export async function generatePodcast(
  threadId: string,
  topic: string,
  findings: NotebookFinding[],
): Promise<PodcastResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });

  // Stage 1: Generate the conversation script
  const script = await generateScript(ai, topic, findings);

  // Stage 2: Convert script to audio via Gemini TTS
  const audioBuffer = await generateAudio(ai, script);

  // Stage 3: Upload to R2
  const key = `podcasts/${threadId}-${Date.now()}.wav`;
  const { url } = await storagePut(key, audioBuffer, {
    contentType: 'audio/wav',
  });

  // Stage 4: Save metadata to thread
  const db = await getDb();
  await db.collection('embassy_threads').updateOne(
    { _id: new ObjectId(threadId) },
    {
      $set: {
        podcast: {
          audioUrl: url,
          r2Key: key,
          generatedAt: new Date(),
          topic,
          findingCount: findings.length,
        },
      },
    },
  );

  return { audioUrl: url, script };
}

/**
 * Stage 1: Generate a two-host conversation script from findings.
 */
async function generateScript(
  ai: GoogleGenAI,
  topic: string,
  findings: NotebookFinding[],
): Promise<string> {
  const findingsText = findings
    .map((f, i) => {
      let entry = `Finding ${i + 1}: "${f.quote}"`;
      entry += `\n  — ${f.source.bookTitle} by ${f.source.bookAuthor}, Page ${f.source.pageNumber}`;
      if (f.note) entry += `\n  Analyst note: ${f.note}`;
      return entry;
    })
    .join('\n\n');

  const prompt = `You are a scriptwriter for a scholarly podcast called "Source Library Deep Dive." Write a natural two-person conversation between ${HOST_A} (lead host, enthusiastic and knowledgeable) and ${HOST_B} (co-host, asks good questions and makes connections).

## Topic: ${topic}

## Source material (verbatim quotes from rare books, 15th-18th century):

${findingsText}

## Guidelines:
- This is a 3-5 minute podcast episode (roughly 600-900 words of dialogue)
- Open with a brief, engaging hook about the topic — don't say "welcome to the show"
- Weave the actual quotes from the sources into the conversation naturally — paraphrase some, quote others directly
- Always name the book and author when citing: "In Agrippa's Three Books of Occult Philosophy..."
- ${HOST_A} drives the narrative arc; ${HOST_B} asks clarifying questions and draws connections
- End with a thought-provoking takeaway, not a summary
- Tone: two scholars at a coffee shop, genuinely excited about what they've found
- Do NOT use sound effects, music cues, or stage directions
- Format each line as: SpeakerName: dialogue text

## Output format:
Write ONLY the dialogue, one line per speaker turn. Example:
${HOST_A}: So I've been digging into something fascinating...
${HOST_B}: Oh? What did you find?`;

  const response = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: prompt,
    config: { temperature: 0.8 },
  });

  const text = response.text;
  if (!text) throw new Error('Script generation returned empty response');
  return text;
}

/**
 * Stage 2: Convert a two-host script to audio via Gemini multi-speaker TTS.
 */
async function generateAudio(
  ai: GoogleGenAI,
  script: string,
): Promise<Buffer> {
  const prompt = `TTS the following conversation between ${HOST_A} and ${HOST_B}:\n\n${script}`;

  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: prompt,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: HOST_A,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: VOICE_A },
              },
            },
            {
              speaker: HOST_B,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: VOICE_B },
              },
            },
          ],
        },
      },
    } as Record<string, unknown>,
  });

  // Extract base64-encoded PCM audio from response
  const candidate = response.candidates?.[0];
  const part = candidate?.content?.parts?.[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inlineData = (part as any)?.inlineData;
  if (!inlineData?.data) {
    throw new Error('TTS returned no audio data');
  }

  const pcmData = Buffer.from(inlineData.data, 'base64');

  // Wrap raw PCM in a WAV header (24kHz, 16-bit, mono)
  return createWavBuffer(pcmData, 24000, 1, 16);
}

/**
 * Create a WAV file buffer from raw PCM data.
 */
function createWavBuffer(
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);           // fmt chunk size
  header.writeUInt16LE(1, 20);            // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

/**
 * Get existing podcast metadata for a thread.
 */
export async function getPodcastForThread(threadId: string): Promise<{
  audioUrl: string;
  generatedAt: Date;
  topic: string;
  findingCount: number;
} | null> {
  const db = await getDb();
  const thread = await db.collection('embassy_threads').findOne(
    { _id: new ObjectId(threadId) },
    { projection: { podcast: 1 } },
  );
  return thread?.podcast || null;
}

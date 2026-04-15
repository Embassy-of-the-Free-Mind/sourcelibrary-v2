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
const VOICE_A = 'Kore';    // Female scholarly voice
const VOICE_B = 'Puck';    // Male scholarly voice

// Gemini TTS audio tags for natural delivery
const AUDIO_TAG_GUIDE = `
Audio delivery tags (use sparingly for naturalness):
- [laughs] — brief, genuine laughter at a surprising discovery
- [enthusiasm] — when revealing something exciting
- [thoughtful] — when considering a complex idea
- [whispers] — for dramatic effect when quoting something secret or forbidden
- Short affirmations: "Mm-hmm", "Right", "Exactly", "Oh interesting"
- Disfluencies: "I mean...", "So like...", "Wait, actually..."
- False starts: beginning a thought, pausing, restarting with better framing
`.trim();

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
          script,
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
 *
 * Multi-pass pipeline (inspired by NotebookLM's internal process):
 *   Pass 1: Generate a draft script
 *   Pass 2: Critique and revise for naturalness, pacing, and citation quality
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

  // Pass 1: Draft script
  const draftPrompt = `You are a scriptwriter for "Source Library Deep Dive," a scholarly podcast about rare books and the Western esoteric tradition. Write a natural two-person conversation between ${HOST_A} (lead host, enthusiastic and deeply knowledgeable) and ${HOST_B} (co-host, asks sharp questions and draws unexpected connections).

## Topic: ${topic}

## Source material (verbatim quotes from rare books, 15th-18th century):

${findingsText}

## Guidelines:
- This is a 3-5 minute podcast episode (roughly 600-900 words of dialogue)
- Open with an engaging hook — jump straight into why this matters, don't say "welcome to the show"
- **Cite sources in speech naturally:** "In Agrippa's Three Books of Occult Philosophy, on page 42, he writes..." or "Ficino puts it beautifully in De Voluptate..." — always name the book and author, mention page numbers when quoting directly
- Weave actual quotes into conversation — paraphrase some, read others aloud with gravity
- ${HOST_A} drives the narrative arc and reveals findings; ${HOST_B} reacts genuinely, asks clarifying questions, and connects ideas across sources
- **Sound like real people:** Include natural disfluencies — "I mean...", "Wait, actually...", "Hmm", false starts, brief laughter at surprising discoveries, short affirmations ("Right", "Exactly", "Oh that's fascinating")
- ${HOST_B} should occasionally interrupt or finish ${HOST_A}'s thought
- End with a thought-provoking insight or open question, not a summary
- Tone: two scholars at a wine bar, genuinely excited about what they've found in old books

${AUDIO_TAG_GUIDE}

## Output format:
Write ONLY the dialogue, one line per speaker turn:
${HOST_A}: So I've been digging into something fascinating...
${HOST_B}: Oh? What did you find?`;

  const draftResponse = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: draftPrompt,
    config: { temperature: 0.85 },
  });

  const draft = draftResponse.text;
  if (!draft) throw new Error('Script draft returned empty response');

  // Pass 2: Critique and revise
  const critiquePrompt = `You are a podcast director reviewing a script for "Source Library Deep Dive." Your job is to make it sound MORE natural and engaging, not less.

## Original script:
${draft}

## Critique checklist — fix these issues:
1. **Robotic turns:** If any line sounds like an AI wrote it (too formal, too complete, no hesitation), rewrite it with natural speech patterns. Real people don't speak in perfect paragraphs.
2. **Missing reactions:** After a surprising quote or revelation, ${HOST_B} should react before ${HOST_A} continues. Add brief interjections: "Wait, really?", "Hmm, that's...", "[laughs] Of course they did."
3. **Citation quality:** Every direct quote MUST name the book and author. Page numbers should be mentioned naturally: "on page 42" or "a few pages later." If a citation is vague, make it specific.
4. **Pacing:** The opening should grab attention in the first 2 lines. The middle should build. The ending should land with weight, not trail off.
5. **Audio tags:** Add [enthusiasm], [thoughtful], [laughs], or [whispers] where they'd enhance delivery. Use sparingly — max 6-8 tags total.
6. **Length:** Keep it at 600-900 words. Cut filler if it's too long, add depth if too short.

## Output:
Write the REVISED script only. Same format (SpeakerName: dialogue), no commentary.`;

  const revisedResponse = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: critiquePrompt,
    config: { temperature: 0.7 },
  });

  const revised = revisedResponse.text;
  if (!revised) throw new Error('Script revision returned empty response');
  return revised;
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
  script?: string;
} | null> {
  const db = await getDb();
  const thread = await db.collection('embassy_threads').findOne(
    { _id: new ObjectId(threadId) },
    { projection: { podcast: 1 } },
  );
  return thread?.podcast || null;
}

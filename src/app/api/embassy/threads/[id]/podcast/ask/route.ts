import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { storagePut } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SCRIPT_MODEL = 'gemini-3-flash-preview';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/**
 * POST /api/embassy/threads/[id]/podcast/ask
 * Interactive podcast mode: user asks a question, Elena and Marcus answer in character.
 * Returns { script, audioUrl } — a short voiced exchange (~30-60s).
 *
 * Body: { question: string, format?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
  }

  const { id } = await params;
  const body = await request.json();
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: 'No question provided' }, { status: 400 });
  }

  const db = await getDb();

  // Load the podcast script and notebook for context
  const thread = await db.collection('embassy_threads').findOne(
    { _id: new ObjectId(id) },
    { projection: { podcasts: 1, podcast: 1, title: 1 } },
  );
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const podcastData = thread.podcasts?.['deep-dive'] || thread.podcast;
  const existingScript = podcastData?.script || '';
  const topic = podcastData?.topic || thread.title || 'this topic';

  // Load notebook findings for source grounding
  const notebook = await db.collection('research_notebooks').findOne({
    threadId: new ObjectId(id),
  });
  const findingsContext = notebook?.findings?.slice(0, 5).map((f: { quote: string; source: { bookTitle: string; bookAuthor: string; pageNumber: number } }) =>
    `"${f.quote.slice(0, 200)}" — ${f.source.bookTitle} by ${f.source.bookAuthor}, p.${f.source.pageNumber}`,
  ).join('\n') || '';

  const ai = new GoogleGenAI({ apiKey });

  // Generate in-character response
  const scriptPrompt = `You are writing a brief exchange for a scholarly podcast called "Source Library Deep Dive." A listener has paused the episode to ask a question. Elena and Marcus answer IN CHARACTER — same warm, scholarly tone as the episode.

## Episode topic: ${topic}

## The listener asks: "${question}"

## Source material available (quote from if relevant):
${findingsContext}

## Context from the episode so far:
${existingScript.slice(-1500)}

## Guidelines:
- 3-6 speaker turns total (very short — 60-120 words)
- Elena and Marcus react naturally: "Oh, great question!" / "Hmm, that's interesting..."
- Ground the answer in the sources when possible — cite book and author
- If the question goes beyond what's in the sources, say so honestly
- Keep their personality: Elena is enthusiastic and knowledgeable, Marcus asks sharp follow-ups
- Include [thoughtful] or [enthusiasm] tags sparingly (max 2)

## Output: ONLY dialogue, one line per turn:
Elena: [enthusiasm] Oh, I love that question...
Marcus: Yeah, and actually...`;

  const scriptResponse = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: scriptPrompt,
    config: { temperature: 0.8 },
  });

  const script = scriptResponse.text;
  if (!script) {
    return NextResponse.json({ error: 'Failed to generate response' }, { status: 500 });
  }

  // Generate audio
  try {
    const ttsResponse = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: `TTS the following conversation between Elena and Marcus:\n\n${script}`,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: 'Elena', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
              { speaker: 'Marcus', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            ],
          },
        },
      } as Record<string, unknown>,
    });

    const candidate = ttsResponse.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inlineData = (part as any)?.inlineData;

    if (inlineData?.data) {
      const pcmData = Buffer.from(inlineData.data, 'base64');

      // WAV header
      const sampleRate = 24000, channels = 1, bitsPerSample = 16;
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + pcmData.length, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(channels, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
      header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
      header.writeUInt16LE(bitsPerSample, 34);
      header.write('data', 36);
      header.writeUInt32LE(pcmData.length, 40);
      const wavBuffer = Buffer.concat([header, pcmData]);

      // Upload to R2
      const key = `podcasts/interactive/${id}-${Date.now()}.wav`;
      const { url } = await storagePut(key, wavBuffer, { contentType: 'audio/wav' });

      return NextResponse.json({ script, audioUrl: url });
    }
  } catch (err) {
    console.error('[podcast/ask] TTS failed, returning text only:', err);
  }

  // Fallback: return script without audio
  return NextResponse.json({ script, audioUrl: null });
}

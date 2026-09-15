/**
 * Podcast generation from research notebooks.
 *
 * Pipeline:
 *   1. Gemini Flash writes a script (format-specific) from notebook findings
 *   2. Gemini TTS voices it (multi-speaker or single-speaker)
 *
 * Formats:
 *   - deep-dive: Two hosts discuss findings in depth (default)
 *   - brief: Single narrator, 2-minute key points
 *   - critique: Critical analysis of the sources
 *   - guided-reading: Commentary track for reading alongside the text
 *
 * Audio stored on R2, metadata in MongoDB (embassy_threads.podcast).
 */

import { GoogleGenAI } from '@google/genai';
import { logAiUsage } from '@/lib/log-ai-usage';
import { getDb } from '@/lib/mongodb';
import { storagePut } from '@/lib/storage';
import { ObjectId } from 'mongodb';

const SCRIPT_MODEL = 'gemini-3-flash-preview';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// Voices
const HOST_A = 'Elena';
const HOST_B = 'Marcus';
const NARRATOR = 'Elena';
const VOICE_A = 'Kore';
const VOICE_B = 'Puck';

export type PodcastFormat = 'deep-dive' | 'brief' | 'critique' | 'guided-reading';

export const PODCAST_FORMATS: Record<PodcastFormat, { label: string; description: string; icon: string }> = {
  'deep-dive': { label: 'Deep Dive', description: 'Two hosts explore your findings in depth', icon: 'conversation' },
  'brief': { label: 'The Brief', description: '2-minute summary of key discoveries', icon: 'lightning' },
  'critique': { label: 'The Critique', description: 'Critical analysis of sources and arguments', icon: 'magnifier' },
  'guided-reading': { label: 'Guided Reading', description: 'Commentary track for reading alongside the text', icon: 'book' },
};

// Gemini TTS audio tags for natural delivery
const AUDIO_TAG_GUIDE = `
Audio delivery tags (use VERY sparingly — at most 2-3 in the whole script):
- [thoughtful] — when weighing a complex idea
- Short affirmations: "Mm-hmm", "Right", "I see"
Do NOT use [enthusiasm], [laughs], or [whispers]. No gasps, no breathless reactions —
the register is a well-produced history documentary, not a reaction video.
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

export interface PodcastResult {
  audioUrl: string;
  script: string;
  format: PodcastFormat;
  duration?: number;
}

/** A curated source book linked from an episode (no quotes — links only). */
export interface PodcastSource {
  bookId: string;
  slug?: string;
  title: string;
  author?: string;
  origin?: string;
}

export interface PodcastMetadata {
  audioUrl: string;
  r2Key: string;
  script: string;
  format: PodcastFormat;
  generatedAt: Date;
  topic: string;
  findingCount: number;
  published?: boolean;
  /** ISO 639 language of the episode audio (e.g. 'es'); defaults to English. */
  language?: string;
  /** Curated source books, used when no research-notebook findings exist. */
  sources?: PodcastSource[];
}

/**
 * Generate a podcast from research notebook findings.
 */
export async function generatePodcast(
  threadId: string,
  topic: string,
  findings: NotebookFinding[],
  format: PodcastFormat = 'deep-dive',
): Promise<PodcastResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });

  // Stage 1: Generate the script
  const script = await generateScript(ai, topic, findings, format);

  // Stage 2: Convert script to audio via Gemini TTS
  const isMultiSpeaker = format === 'deep-dive' || format === 'critique';
  const audioBuffer = await generateAudio(ai, script, isMultiSpeaker);

  // Stage 3: Upload to R2
  const key = `podcasts/${threadId}-${format}-${Date.now()}.mp3`;
  const { url } = await storagePut(key, audioBuffer, {
    contentType: 'audio/mpeg',
  });

  // Stage 4: Save metadata to thread
  const db = await getDb();
  await db.collection('embassy_threads').updateOne(
    { _id: new ObjectId(threadId) },
    {
      $set: {
        [`podcasts.${format}`]: {
          audioUrl: url,
          r2Key: key,
          script,
          format,
          generatedAt: new Date(),
          topic,
          findingCount: findings.length,
        } satisfies PodcastMetadata,
      },
    },
  );

  return { audioUrl: url, script, format };
}

// ── Script Generation ────────────────────────────────────────────────

function formatFindings(findings: NotebookFinding[]): string {
  return findings
    .map((f, i) => {
      let entry = `Finding ${i + 1}: "${f.quote}"`;
      entry += `\n  — ${f.source.bookTitle} by ${f.source.bookAuthor}, Page ${f.source.pageNumber}`;
      if (f.note) entry += `\n  Analyst note: ${f.note}`;
      return entry;
    })
    .join('\n\n');
}

async function generateScript(
  ai: GoogleGenAI,
  topic: string,
  findings: NotebookFinding[],
  format: PodcastFormat,
): Promise<string> {
  const findingsText = formatFindings(findings);

  const promptFn = FORMAT_PROMPTS[format];
  const draftPrompt = promptFn(topic, findingsText, findings);

  // Pass 1: Draft
  const draftStartedAt = Date.now();
  const draftResponse = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: draftPrompt,
    config: { temperature: format === 'brief' ? 0.6 : 0.85 },
  });
  recordPodcastUsage(SCRIPT_MODEL, draftResponse.usageMetadata, draftStartedAt);

  const draft = draftResponse.text;
  if (!draft) throw new Error('Script draft returned empty response');

  // Pass 2: Critique and revise (skip for brief — it's short enough)
  if (format === 'brief') return draft;

  const critiquePrompt = buildCritiquePrompt(draft, format);
  const revisedStartedAt = Date.now();
  const revisedResponse = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: critiquePrompt,
    config: { temperature: 0.7 },
  });
  recordPodcastUsage(SCRIPT_MODEL, revisedResponse.usageMetadata, revisedStartedAt);

  return revisedResponse.text || draft;
}

/**
 * Record what a podcast generation call cost (#4599).
 *
 * Podcast script and TTS calls are admin-triggered and low-volume, but they run
 * on the most expensive models we use and they were writing no usage row at all.
 * `logAiUsage` is the request-path store (Mongo `ai_usage`), same as the
 * librarian and explain; it is fire-and-forget and never fails the request.
 */
function recordPodcastUsage(
  model: string,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined,
  startedAt: number,
): void {
  logAiUsage({
    feature: 'podcast',
    model,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    ms: Date.now() - startedAt,
    ok: true,
  });
}

// ── Format-Specific Prompts ──────────────────────────────────────────

const FORMAT_PROMPTS: Record<PodcastFormat, (topic: string, findings: string, raw: NotebookFinding[]) => string> = {
  'deep-dive': (topic, findings) => `You are a scriptwriter for "Source Library Deep Dive," a scholarly podcast about rare books and the Western esoteric tradition. Write a natural two-person conversation between ${HOST_A} (lead host, clear and deeply knowledgeable) and ${HOST_B} (co-host, asks the grounding questions a curious newcomer would ask).

## Topic: ${topic}

## Source material (verbatim quotes from rare books, 15th-18th century):

${findings}

## Guidelines:
- This is a 3-5 minute podcast episode (roughly 600-900 words of dialogue)
- **Anchor the subject in its time within the first minute:** who the author was, where and when the work appeared, and what was happening around it. A listener who knows nothing should have a real grasp of the work by the end — the episode is a summary first, a conversation second
- Open by situating, not by gushing — no "welcome to the show," and no breathless hook
- **Cite sources in speech naturally:** "In Agrippa's Three Books of Occult Philosophy, on page 42, he writes..." — always name the book and author, mention page numbers when quoting directly
- Weave actual quotes into conversation — paraphrase some, read others aloud with gravity
- ${HOST_A} carries the narrative arc; ${HOST_B} asks clarifying questions ("Two worlds meaning what?", "Did anyone push back at the time?") and keeps the explanation honest
- Sound like real people, but measured: an occasional "Hmm" or brief false start is fine; avoid stacked exclamations, superlatives ("incredible", "wild", "I love that"), and reaction-video energy
- End with why the work matters — its place in history — not an artificial cliffhanger
- Tone: a well-produced history documentary; two knowledgeable colleagues, engaged but never breathless. Let the material carry the weight

${AUDIO_TAG_GUIDE}

## Output format:
Write ONLY the dialogue, one line per speaker turn:
${HOST_A}: So I've been digging into something fascinating...
${HOST_B}: Oh? What did you find?`,

  'brief': (topic, findings) => `You are a narrator for "Source Library Briefing," delivering concise scholarly summaries. Write a single-narrator script for ${NARRATOR}.

## Topic: ${topic}

## Source material:

${findings}

## Guidelines:
- This is a 1-2 minute briefing (roughly 200-350 words)
- Open with a single compelling sentence that frames the topic
- Hit 3-4 key points from the findings, citing book and author for each
- Quote one passage verbatim — the most striking one
- Close with one sentence on why this matters or what it connects to
- Tone: confident, clear, like a museum audio guide for a scholar
- No filler, no hedging, no "in this episode we'll explore..."

${AUDIO_TAG_GUIDE}

## Output format:
Write ONLY the narration as a single block of text for ${NARRATOR}:
${NARRATOR}: [the full narration]`,

  'critique': (topic, findings) => `You are a scriptwriter for "Source Library Critical Review." Write a two-person conversation where ${HOST_A} presents findings and ${HOST_B} plays devil's advocate — questioning interpretations, pointing out gaps, challenging assumptions.

## Topic: ${topic}

## Source material:

${findings}

## Guidelines:
- This is a 3-5 minute episode (roughly 600-900 words)
- ${HOST_A} presents each finding enthusiastically
- ${HOST_B} pushes back constructively: "But isn't that a common trope?", "How do we know this isn't just...", "The dating on that source is questionable..."
- The critique should be scholarly, not dismissive — ${HOST_B} respects the material but wants rigor
- Still cite sources precisely — book, author, page
- End with what remains compelling AFTER the critique — what survives scrutiny
- Include moments where ${HOST_B} concedes: "Actually, that's a strong point..."

${AUDIO_TAG_GUIDE}

## Output format:
Write ONLY the dialogue, one line per speaker turn:
${HOST_A}: I want to look at something that challenges the standard narrative...
${HOST_B}: [thoughtful] Alright, I'm listening. But I'm skeptical.`,

  'guided-reading': (_topic, findings, raw) => {
    // For guided reading, we organize by page order
    const sorted = [...raw].sort((a, b) => {
      if (a.source.bookId !== b.source.bookId) return a.source.bookTitle.localeCompare(b.source.bookTitle);
      return a.source.pageNumber - b.source.pageNumber;
    });
    const sortedText = sorted
      .map((f, i) => {
        let entry = `Finding ${i + 1}: "${f.quote}"`;
        entry += `\n  — ${f.source.bookTitle} by ${f.source.bookAuthor}, Page ${f.source.pageNumber}`;
        if (f.note) entry += `\n  Note: ${f.note}`;
        return entry;
      })
      .join('\n\n');

    return `You are a narrator for "Source Library Guided Reading," creating a commentary track that readers listen to while reading alongside the original text. Write narration for ${NARRATOR}.

## Source material (in page order):

${sortedText}

## Guidelines:
- This is a 4-6 minute guided reading (roughly 500-800 words)
- Address the listener directly: "Turn to page 42...", "Now look at this passage...", "Notice how Agrippa shifts his argument here..."
- For each finding, give context BEFORE the quote: what to look for, what the author is doing
- Then read or paraphrase the key passage
- Then explain what it means — historical context, connections to other works, why it matters
- Pace for someone actually turning pages — leave natural pauses between sections
- Tone: a knowledgeable guide in a rare book library, pointing things out as you walk through
- Group findings by book, moving through pages in order
- End with a synthesis: what these passages reveal when read together

${AUDIO_TAG_GUIDE}

## Output format:
Write ONLY the narration for ${NARRATOR}:
${NARRATOR}: Let's open to page twelve...`;
  },
};

function buildCritiquePrompt(draft: string, format: PodcastFormat): string {
  const speakers = format === 'deep-dive' || format === 'critique'
    ? `${HOST_A} and ${HOST_B}`
    : NARRATOR;

  return `You are a podcast director reviewing a script. Your job is to make it sound MORE natural and engaging.

## Original script:
${draft}

## Critique checklist:
1. **Robotic turns:** If any line sounds like an AI wrote it (too formal, too complete, no hesitation), rewrite it with natural speech patterns.
2. **Gushing:** Remove breathless superlatives, stacked exclamations, and fan reactions ("incredible!", "wild", "I love that"). A measured "that's a striking claim" beats an "[enthusiasm] Exactly!". The register is a history documentary, not a reaction video.
3. **Citation quality:** Every direct quote MUST name the book and author. Page numbers mentioned naturally.
4. **Pacing:** Opening situates the subject in 1-2 lines. Middle builds. Ending lands with weight.
5. **Audio tags:** At most 2-3 [thoughtful] tags in the whole script. Strip any [enthusiasm], [laughs], or [whispers].
6. **Length:** Keep within the target word count. Cut filler, add depth.

## Output:
Write the REVISED script only. Same format (${speakers}), no commentary.`;
}

// ── Audio Generation ─────────────────────────────────────────────────

async function generateAudio(
  ai: GoogleGenAI,
  script: string,
  multiSpeaker: boolean,
): Promise<Buffer> {
  const config: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
    speechConfig: multiSpeaker
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: HOST_A, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_A } } },
              { speaker: HOST_B, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_B } } },
            ],
          },
        }
      : {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE_A },
          },
        },
  };

  const styleNote = 'Style: calm, measured, thoughtful — a well-produced history documentary. Engaged but never breathless or gushing.';
  const prompt = multiSpeaker
    ? `TTS the following conversation between ${HOST_A} and ${HOST_B}. ${styleNote}\n\n${script}`
    : `TTS the following narration by ${NARRATOR}. ${styleNote}\n\n${script}`;

  const ttsStartedAt = Date.now();
  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: prompt,
    config,
  });
  recordPodcastUsage(TTS_MODEL, response.usageMetadata, ttsStartedAt);

  const candidate = response.candidates?.[0];
  const part = candidate?.content?.parts?.[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inlineData = (part as any)?.inlineData;
  if (!inlineData?.data) {
    throw new Error('TTS returned no audio data');
  }

  const pcmData = Buffer.from(inlineData.data, 'base64');
  return encodePcmToMp3(pcmData, 24000);
}

/**
 * Encode raw 16-bit PCM to MP3 using lamejs (pure JS, works on serverless).
 */
export function encodePcmToMp3(pcmData: Buffer, sampleRate: number): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lamejs = require('../vendor/lamejs-bundle');
  const mp3enc = new lamejs.Mp3Encoder(1, sampleRate, 128);
  const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);

  const mp3Parts: Buffer[] = [];
  const CHUNK = 1152; // lamejs processes in chunks of 1152 samples
  for (let i = 0; i < samples.length; i += CHUNK) {
    const chunk = samples.subarray(i, i + CHUNK);
    const mp3buf = mp3enc.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Parts.push(Buffer.from(mp3buf));
    }
  }
  const flush = mp3enc.flush();
  if (flush.length > 0) {
    mp3Parts.push(Buffer.from(flush));
  }

  return Buffer.concat(mp3Parts);
}

// ── Query helpers ────────────────────────────────────────────────────

export async function getPodcastForThread(
  threadId: string,
  format?: PodcastFormat,
): Promise<PodcastMetadata | null> {
  const db = await getDb();
  const thread = await db.collection('embassy_threads').findOne(
    { _id: new ObjectId(threadId) },
    { projection: { podcasts: 1, podcast: 1 } },
  );
  if (!thread) return null;

  // New schema: podcasts.{format}
  if (thread.podcasts) {
    if (format) return thread.podcasts[format] || null;
    // Return first available
    for (const f of ['deep-dive', 'brief', 'critique', 'guided-reading'] as PodcastFormat[]) {
      if (thread.podcasts[f]) return thread.podcasts[f];
    }
  }

  // Legacy schema: podcast (single)
  if (thread.podcast) {
    return { ...thread.podcast, format: 'deep-dive' };
  }

  return null;
}

export async function getAllPodcastsForThread(
  threadId: string,
): Promise<Record<string, PodcastMetadata>> {
  const db = await getDb();
  const thread = await db.collection('embassy_threads').findOne(
    { _id: new ObjectId(threadId) },
    { projection: { podcasts: 1, podcast: 1 } },
  );
  if (!thread) return {};

  const result: Record<string, PodcastMetadata> = {};

  if (thread.podcasts) {
    for (const [f, data] of Object.entries(thread.podcasts)) {
      if (data) result[f] = data as PodcastMetadata;
    }
  }

  // Legacy migration
  if (thread.podcast && !result['deep-dive']) {
    result['deep-dive'] = { ...thread.podcast, format: 'deep-dive' as PodcastFormat };
  }

  return result;
}

/**
 * Get all published podcast episodes across all threads (for RSS feed).
 */
export async function getPublishedEpisodes(limit = 50): Promise<Array<{
  threadId: string;
  threadTitle: string;
  creatorName: string;
  language: string;
  podcast: PodcastMetadata;
}>> {
  const db = await getDb();

  // Find threads with published podcasts
  const threads = await db.collection('embassy_threads')
    .find({
      $or: [
        { 'podcasts.deep-dive.published': true },
        { 'podcasts.brief.published': true },
        { 'podcasts.critique.published': true },
        { 'podcasts.guided-reading.published': true },
      ],
    })
    .sort({ 'podcasts.deep-dive.generatedAt': -1 })
    .limit(limit)
    .project({ title: 1, creatorName: 1, language: 1, podcasts: 1 })
    .toArray();

  const episodes: Array<{
    threadId: string;
    threadTitle: string;
    creatorName: string;
    language: string;
    podcast: PodcastMetadata;
  }> = [];

  for (const thread of threads) {
    for (const format of ['deep-dive', 'brief', 'critique', 'guided-reading']) {
      const p = thread.podcasts?.[format];
      if (p?.published) {
        episodes.push({
          threadId: thread._id.toString(),
          threadTitle: thread.title || p.topic,
          creatorName: thread.creatorName || 'Anonymous',
          language: thread.language || p.language || 'en',
          podcast: p,
        });
      }
    }
  }

  return episodes.sort((a, b) =>
    new Date(b.podcast.generatedAt).getTime() - new Date(a.podcast.generatedAt).getTime(),
  );
}

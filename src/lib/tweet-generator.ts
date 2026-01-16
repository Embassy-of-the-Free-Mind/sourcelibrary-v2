/**
 * AI Tweet Generator for Source Library
 *
 * Uses Gemini or Claude to generate compelling tweet copy for gallery images.
 * Supports audience targeting and multiple voice styles for heavy curation workflows.
 */

import { getGeminiClient, reportRateLimitError, getNextApiKey } from './gemini-client';
import Anthropic from '@anthropic-ai/sdk';
import { DetectedImage } from './types';

// Model types
export type TweetModel = 'gemini' | 'claude';

// Claude client (lazy initialized)
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

// =============================================================================
// Types
// =============================================================================

export type TweetAudience =
  | 'jungian'        // Depth psychology, archetypes, collective unconscious
  | 'esoteric'       // Western esotericism scholars
  | 'arthistory'     // Art historians, iconography, visual culture
  | 'philosophy'     // History of ideas, Renaissance thought
  | 'consciousness'  // Consciousness studies, mysticism
  | 'aesthetic'      // Aesthetic/visual beauty focus
  | 'general';       // General educated audience

export type TweetVoice =
  | 'scholarly'      // Curious academic sharing a find
  | 'provocative'    // Challenging question or statement
  | 'aesthetic'      // Beauty and visual poetry
  | 'mysterious'     // Evocative, creates intrigue
  | 'contextual';    // Educational, provides context

export interface TweetGenerationInput {
  description: string;
  museumDescription?: string;
  type?: string;
  bookTitle: string;
  author?: string;
  year?: number;
  metadata?: {
    subjects?: string[];
    symbols?: string[];
    figures?: string[];
  };
  // Targeting options
  audiences?: TweetAudience[];
  voices?: TweetVoice[];
  variationCount?: number;  // How many variations to generate
  // Model and prompt options
  model?: TweetModel;       // 'gemini' or 'claude'
  customPrompt?: string;    // User-provided prompt/guidance
}

export interface TweetVariation {
  tweet: string;
  hashtags: string[];
  audience: TweetAudience;
  voice: TweetVoice;
  reasoning?: string;  // Why this approach was chosen
}

export interface TweetGenerationResult {
  tweet: string;
  hashtags: string[];
  hookType: 'mystery' | 'beauty' | 'historical' | 'symbolic' | 'question';
  alternatives: string[];
  // New: structured variations for curation
  variations?: TweetVariation[];
}

// =============================================================================
// Audience Definitions
// =============================================================================

const AUDIENCE_CONTEXTS: Record<TweetAudience, {
  name: string;
  description: string;
  interests: string[];
  hashtags: string[];
  toneGuidance: string;
}> = {
  jungian: {
    name: 'Jungian/Depth Psychology',
    description: 'Readers interested in Carl Jung, archetypes, collective unconscious, shadow work, individuation',
    interests: ['archetypes', 'shadow', 'anima/animus', 'mandala', 'transformation', 'psyche', 'dreams', 'symbols'],
    hashtags: ['Jung', 'archetypes', 'depthpsychology', 'collectiveunconscious', 'individuation', 'psyche'],
    toneGuidance: 'Connect imagery to psychological transformation. Reference archetypal patterns. Speak to the soul\'s journey.',
  },
  esoteric: {
    name: 'Western Esotericism',
    description: 'Scholars and practitioners of alchemy, Hermetica, Kabbalah, Rosicrucianism, Renaissance magic',
    interests: ['prima materia', 'philosopher\'s stone', 'Hermes Trismegistus', 'sephiroth', 'transmutation', 'sacred geometry'],
    hashtags: ['alchemy', 'hermeticism', 'kabbalah', 'esotericism', 'WesternEsotericism', 'occulthistory'],
    toneGuidance: 'Use technical terminology correctly. Reference the tradition\'s own language. Show insider knowledge without gatekeeping.',
  },
  arthistory: {
    name: 'Art & Book History',
    description: 'Art historians, bibliophiles, print culture scholars, iconographers',
    interests: ['iconography', 'emblem books', 'printing history', 'visual rhetoric', 'patronage', 'workshop practices'],
    hashtags: ['arthistory', 'iconography', 'rarebooks', 'printmaking', 'bookhistory', 'visualculture'],
    toneGuidance: 'Focus on formal qualities, technique, provenance, influence. Connect to artistic movements and patrons.',
  },
  philosophy: {
    name: 'History of Philosophy',
    description: 'Scholars of Renaissance thought, Neoplatonism, natural philosophy, history of ideas',
    interests: ['Neoplatonism', 'prisca theologia', 'microcosm/macrocosm', 'correspondences', 'natural philosophy'],
    hashtags: ['historyofphilosophy', 'Renaissancethought', 'Neoplatonism', 'historyofideas', 'intellectualhistory'],
    toneGuidance: 'Situate ideas in intellectual context. Reference philosophical debates. Connect to broader thought movements.',
  },
  consciousness: {
    name: 'Consciousness & Mysticism',
    description: 'Those exploring consciousness, altered states, mystical experience, know thyself',
    interests: ['gnosis', 'illumination', 'self-knowledge', 'mystical union', 'contemplation', 'inner work'],
    hashtags: ['consciousness', 'mysticism', 'gnosis', 'knowthyself', 'innerwork', 'awakening'],
    toneGuidance: 'Speak to direct experience. Invite reflection. Connect historical wisdom to present inner work.',
  },
  aesthetic: {
    name: 'Aesthetic Appreciation',
    description: 'Those drawn to visual beauty, craft, the sublime in historical imagery',
    interests: ['beauty', 'sublime', 'craftsmanship', 'visual poetry', 'atmosphere', 'timelessness'],
    hashtags: ['visualpoetry', 'darkacademia', 'aesthetic', 'sublimeart', 'timelessbeauty'],
    toneGuidance: 'Let the image speak. Use evocative language. Create atmosphere. Less explanation, more wonder.',
  },
  general: {
    name: 'General Audience',
    description: 'Educated general audience curious about history and ideas',
    interests: ['discovery', 'hidden history', 'forgotten knowledge', 'human creativity'],
    hashtags: ['historylovers', 'rarebooks', 'hiddenhistory', 'curiosity'],
    toneGuidance: 'Be accessible without dumbing down. Create a sense of discovery. Invite people in.',
  },
};

const VOICE_STYLES: Record<TweetVoice, {
  name: string;
  description: string;
  examples: string[];
  promptGuidance: string;
}> = {
  scholarly: {
    name: 'Scholarly Curiosity',
    description: 'Like a museum curator sharing an exciting discovery',
    examples: [
      'This 1617 emblem shows Mercury devouring the sun—what was Maier trying to tell us?',
      'A detail I hadn\'t noticed before: the artist placed a skull beneath the philosopher\'s table.',
    ],
    promptGuidance: 'Express genuine intellectual curiosity. Ask questions you actually wonder about. Share observations.',
  },
  provocative: {
    name: 'Provocative Question',
    description: 'Challenges assumptions, invites debate',
    examples: [
      'Why did Renaissance thinkers encode their deepest insights in images rather than words?',
      'The alchemists weren\'t trying to make gold. What were they really after?',
    ],
    promptGuidance: 'Challenge common assumptions. Reframe the familiar. Make people think twice.',
  },
  aesthetic: {
    name: 'Aesthetic/Visual',
    description: 'Focuses on beauty, atmosphere, visual impact',
    examples: [
      'Carved in wood 400 years ago. Still teaching us to see.',
      'The alchemist\'s laboratory, rendered in ink and imagination.',
    ],
    promptGuidance: 'Let beauty lead. Use poetic compression. Create atmosphere with few words.',
  },
  mysterious: {
    name: 'Mysterious/Evocative',
    description: 'Creates intrigue, hints at hidden depths',
    examples: [
      'The adepts knew something we\'ve forgotten.',
      'Some images were meant to transform the viewer. This is one of them.',
    ],
    promptGuidance: 'Hint rather than explain. Create a sense of hidden meaning. Invite deeper looking.',
  },
  contextual: {
    name: 'Contextual/Educational',
    description: 'Provides interesting context that enriches viewing',
    examples: [
      'In alchemical symbolism, Mercury represents the volatile spirit that bridges matter and mind.',
      'This emblem was designed to be meditated upon, not just read.',
    ],
    promptGuidance: 'Provide one illuminating piece of context. Don\'t over-explain—just enough to deepen engagement.',
  },
};

// =============================================================================
// Prompt Building
// =============================================================================

function buildVariationPrompt(
  input: TweetGenerationInput,
  audiences: TweetAudience[],
  voices: TweetVoice[],
  count: number,
  customPrompt?: string
): string {
  const audienceDescriptions = audiences.map(a => {
    const ctx = AUDIENCE_CONTEXTS[a];
    return `- ${ctx.name}: ${ctx.toneGuidance}`;
  }).join('\n');

  const voiceDescriptions = voices.map(v => {
    const style = VOICE_STYLES[v];
    return `- ${style.name}: ${style.promptGuidance}\n  Examples: "${style.examples[0]}"`;
  }).join('\n\n');

  const allHashtags = new Set<string>();
  audiences.forEach(a => AUDIENCE_CONTEXTS[a].hashtags.forEach(h => allHashtags.add(h)));

  return `You are crafting tweets for Source Library, a digital archive of rare Western esoteric texts (alchemy, Hermetica, Kabbalah, Renaissance philosophy, mysticism).

Your goal: Create authentic content that resonates with specific intellectual communities. No generic social media speak. Write like someone who actually studies these traditions.

IMAGE BEING SHARED:
- Description: ${input.description || 'Historical illustration'}
- Detailed Analysis: ${input.museumDescription || 'N/A'}
- Image Type: ${input.type || 'illustration'}
- Source: "${input.bookTitle}" by ${input.author || 'Unknown'}${input.year ? ` (${input.year})` : ''}
- Subjects: ${input.metadata?.subjects?.join(', ') || 'N/A'}
- Symbols Present: ${input.metadata?.symbols?.join(', ') || 'N/A'}
- Figures Depicted: ${input.metadata?.figures?.join(', ') || 'N/A'}

TARGET AUDIENCES (write for these communities):
${audienceDescriptions}

VOICE STYLES TO USE:
${voiceDescriptions}

REQUIREMENTS:
1. Tweet text must be under 200 characters (leaves room for link + hashtags)
2. Create ${count} distinct variations, each combining a different audience + voice
3. Each variation should feel authentic to its target community
4. Reference specific visual elements from the image
5. NO generic phrases: "Check out", "Amazing", "Incredible", "You won't believe"
6. NO explaining the whole image—create curiosity, not a caption

HASHTAG POOL (choose 2-4 per tweet):
${[...allHashtags].join(', ')}

OUTPUT FORMAT (JSON only, no markdown):
{
  "variations": [
    {
      "tweet": "The tweet text (under 200 chars)",
      "hashtags": ["tag1", "tag2", "tag3"],
      "audience": "jungian|esoteric|arthistory|philosophy|consciousness|aesthetic|general",
      "voice": "scholarly|provocative|aesthetic|mysterious|contextual",
      "reasoning": "Brief note on why this approach for this audience"
    }
  ]
}
${customPrompt ? `
ADDITIONAL GUIDANCE FROM USER:
${customPrompt}
` : ''}
Generate ${count} variations using different audience/voice combinations.`;
}

// =============================================================================
// Main Generation Functions
// =============================================================================

/**
 * Generate multiple tweet variations for heavy curation workflow.
 */
export async function generateTweetVariations(
  input: TweetGenerationInput
): Promise<TweetVariation[]> {
  const audiences = input.audiences || ['general'];
  const voices = input.voices || ['scholarly', 'aesthetic'];
  const count = input.variationCount || Math.max(4, audiences.length * voices.length);
  const modelType = input.model || 'gemini';

  const prompt = buildVariationPrompt(input, audiences, voices, Math.min(count, 8), input.customPrompt);

  if (modelType === 'claude') {
    return generateWithClaude(prompt);
  } else {
    return generateWithGemini(prompt);
  }
}

/**
 * Generate variations using Gemini
 */
async function generateWithGemini(prompt: string): Promise<TweetVariation[]> {
  const apiKey = getNextApiKey();
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return parseVariationsFromText(text);
  } catch (error) {
    if (error instanceof Error && error.message.includes('429')) {
      reportRateLimitError(apiKey);
    }
    throw error;
  }
}

/**
 * Generate variations using Claude
 */
async function generateWithClaude(prompt: string): Promise<TweetVariation[]> {
  const anthropic = getAnthropicClient();

  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: prompt,
    }],
  });

  const text = result.content[0].type === 'text' ? result.content[0].text : '';
  return parseVariationsFromText(text);
}

/**
 * Parse JSON variations from AI response text
 */
function parseVariationsFromText(text: string): TweetVariation[] {
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      jsonStr = objMatch[0];
    }
  }

  const parsed = JSON.parse(jsonStr);
  return parsed.variations || [];
}

/**
 * Generate a single tweet (backward compatible).
 */
export async function generateTweet(
  input: TweetGenerationInput
): Promise<TweetGenerationResult> {
  // Use the new variation system but return in old format
  const variations = await generateTweetVariations({
    ...input,
    audiences: input.audiences || ['general', 'esoteric'],
    voices: input.voices || ['scholarly', 'aesthetic', 'mysterious'],
    variationCount: 3,
  });

  if (variations.length === 0) {
    throw new Error('No variations generated');
  }

  const primary = variations[0];
  return {
    tweet: primary.tweet,
    hashtags: primary.hashtags,
    hookType: mapVoiceToHookType(primary.voice),
    alternatives: variations.slice(1).map(v => v.tweet),
    variations,
  };
}

function mapVoiceToHookType(voice: TweetVoice): TweetGenerationResult['hookType'] {
  const mapping: Record<TweetVoice, TweetGenerationResult['hookType']> = {
    scholarly: 'question',
    provocative: 'question',
    aesthetic: 'beauty',
    mysterious: 'mystery',
    contextual: 'historical',
  };
  return mapping[voice] || 'mystery';
}

/**
 * Generate tweet from a DetectedImage with book context.
 */
export async function generateTweetForImage(
  image: DetectedImage,
  bookTitle: string,
  bookAuthor?: string,
  bookYear?: number,
  options?: {
    audiences?: TweetAudience[];
    voices?: TweetVoice[];
    variationCount?: number;
  }
): Promise<TweetGenerationResult> {
  return generateTweet({
    description: image.description,
    museumDescription: image.museum_description,
    type: image.type,
    bookTitle,
    author: bookAuthor,
    year: bookYear,
    metadata: image.metadata,
    ...options,
  });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Build the full tweet text with hashtags and link.
 */
export function buildFullTweetText(
  tweetText: string,
  hashtags: string[],
  galleryImageId: string,
  maxHashtags: number = 3
): string {
  const link = `https://sourcelibrary.org/gallery/image/${galleryImageId}`;
  const fullText = `${tweetText}\n\n${link}`;
  const selectedHashtags = hashtags.slice(0, maxHashtags);
  const hashtagText = selectedHashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
  const withHashtags = `${tweetText}\n\n${hashtagText}\n${link}`;

  if (withHashtags.length <= 280) {
    return withHashtags;
  }

  for (let i = selectedHashtags.length - 1; i >= 0; i--) {
    const reducedHashtags = selectedHashtags.slice(0, i).map(h => `#${h.replace(/^#/, '')}`).join(' ');
    const reduced = `${tweetText}\n\n${reducedHashtags}\n${link}`;
    if (reduced.length <= 280) {
      return reduced;
    }
  }

  return fullText.length <= 280 ? fullText : tweetText.slice(0, 240) + '...\n' + link;
}

/**
 * Validate a tweet's length.
 */
export function validateTweetLength(text: string): {
  valid: boolean;
  length: number;
  remaining: number;
} {
  const length = text.length;
  return {
    valid: length <= 280,
    length,
    remaining: 280 - length,
  };
}

/**
 * Get suggested hashtags for an audience.
 */
export function getAudienceHashtags(audience: TweetAudience): string[] {
  return AUDIENCE_CONTEXTS[audience]?.hashtags || [];
}

/**
 * Get all available audiences with their metadata.
 */
export function getAvailableAudiences(): Array<{
  id: TweetAudience;
  name: string;
  description: string;
}> {
  return Object.entries(AUDIENCE_CONTEXTS).map(([id, ctx]) => ({
    id: id as TweetAudience,
    name: ctx.name,
    description: ctx.description,
  }));
}

/**
 * Get all available voices with their metadata.
 */
export function getAvailableVoices(): Array<{
  id: TweetVoice;
  name: string;
  description: string;
  examples: string[];
}> {
  return Object.entries(VOICE_STYLES).map(([id, style]) => ({
    id: id as TweetVoice,
    name: style.name,
    description: style.description,
    examples: style.examples,
  }));
}

/**
 * Suggest hashtags based on image metadata and target audience.
 */
export function suggestHashtags(
  image: {
    type?: string;
    metadata?: {
      subjects?: string[];
      symbols?: string[];
    };
  },
  audience?: TweetAudience
): string[] {
  const suggestions: string[] = [];

  // Audience-specific hashtags
  if (audience && AUDIENCE_CONTEXTS[audience]) {
    suggestions.push(...AUDIENCE_CONTEXTS[audience].hashtags.slice(0, 3));
  }

  // Type-based hashtags
  if (image.type) {
    const typeHashtags: Record<string, string[]> = {
      emblem: ['emblem', 'emblematica'],
      woodcut: ['woodcut', 'printmaking'],
      engraving: ['engraving', 'arthistory'],
      diagram: ['historicaldiagram'],
      portrait: ['portraiture'],
      frontispiece: ['bookhistory', 'rarebooks'],
      map: ['historicalmap'],
    };
    suggestions.push(...(typeHashtags[image.type] || []));
  }

  // Subject-based hashtags
  const subjectHashtags: Record<string, string> = {
    alchemy: 'alchemy',
    hermeticism: 'hermeticism',
    kabbalah: 'kabbalah',
    astrology: 'astrology',
    magic: 'historyofmagic',
  };

  for (const subject of image.metadata?.subjects || []) {
    const lower = subject.toLowerCase();
    for (const [key, hashtag] of Object.entries(subjectHashtags)) {
      if (lower.includes(key)) {
        suggestions.push(hashtag);
      }
    }
  }

  return [...new Set(suggestions)].slice(0, 6);
}

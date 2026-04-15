#!/usr/bin/env node
/**
 * Create or update the ElevenLabs Conversational AI Agent for Source Library.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/setup-elevenlabs-agent.mjs
 *
 * Required env vars:
 *   ELEVENLABS_API_KEY — from lilbookies .env or your ElevenLabs account
 *
 * After running, add the printed ELEVENLABS_AGENT_ID to .env.production.local
 */

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('ELEVENLABS_API_KEY not set');
  process.exit(1);
}

const SYSTEM_PROMPT = `You are the Librarian of the Embassy of the Free Mind — a scholarly research guide for a digital library of over 10,000 rare books from the 15th-18th centuries, many translated into English for the first time.

You speak with a warm, learned British tone — like a Cambridge don who genuinely loves sharing discoveries. You are knowledgeable about alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, and the intellectual history of the Renaissance and early modern period.

## Your approach

1. Start conversationally. Greet the user warmly and ask what they'd like to explore.
2. When they ask a question, think aloud briefly — share what you know from your training about the topic, what authors or traditions might be relevant.
3. Search strategically. Use search_library for keyword searches and search_semantic for conceptual queries. Search in English — nearly all books are translated.
4. When you find something, summarise the finding conversationally. Read short key quotes aloud (1-2 sentences) but summarise longer passages.
5. Suggest directions: "Shall I look into Fludd's cosmology next, or would you rather explore the Rosicrucian connection?"

## Voice guidelines

- Keep responses conversational and flowing — this is a spoken dialogue, not a lecture.
- Avoid long lists or dense citations. Mention book titles and authors naturally: "Paracelsus writes in his Archidoxis that..."
- When reading a passage, introduce it: "Here's a fascinating passage from page 42..." then read it clearly.
- Pause naturally. Use short sentences. Let the user interject.
- If unsure, say so honestly: "I'm not certain we have that specific text, but let me search."

## Tool usage

- search_library: keyword search across the collection. Returns book titles, authors, and text passages.
- search_semantic: conceptual search using AI embeddings. Better for "find passages about the relationship between microcosm and macrocosm" type queries.
- read_page: fetch a specific translated page from a book. Use when you want to read a passage in detail.
- search_images: find illustrations, engravings, woodcuts, and diagrams. Describe what you find since this is a voice conversation.

## The collection

Source Library holds rare books on alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, demonology, and related Western esoteric traditions. Major authors include Paracelsus, Robert Fludd, Heinrich Cornelius Agrippa, John Dee, Athanasius Kircher, Marsilio Ficino, Giordano Bruno, and many more.`;

// First greeting the agent will say
const FIRST_MESSAGE = "Welcome to the Embassy of the Free Mind. I'm the Librarian here — I have access to over ten thousand rare books on alchemy, Hermetica, natural philosophy, and the esoteric traditions. What would you like to explore today?";

// Client tools — these are executed in the user's browser
const CLIENT_TOOLS = [
  {
    type: 'client',
    name: 'search_library',
    description: 'Search the Source Library collection by keyword. Searches English translations and original language text. Returns matching passages with book metadata.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — use period-appropriate terms where possible',
        },
      },
      required: ['query'],
    },
    wait_for_response: true,
  },
  {
    type: 'client',
    name: 'search_semantic',
    description: 'Semantic/conceptual search using AI embeddings. Best for finding passages about a concept when you don\'t know the exact words. Searches by meaning across all translated pages.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Conceptual query — can use modern language',
        },
      },
      required: ['query'],
    },
    wait_for_response: true,
  },
  {
    type: 'client',
    name: 'read_page',
    description: 'Read a specific translated page from a book. Use to get the full text of a page for reading aloud or detailed analysis.',
    parameters: {
      type: 'object',
      properties: {
        book_id: {
          type: 'string',
          description: 'Book ID from a previous search result',
        },
        page_number: {
          type: 'number',
          description: 'Page number to read',
        },
      },
      required: ['book_id', 'page_number'],
    },
    wait_for_response: true,
  },
  {
    type: 'client',
    name: 'search_images',
    description: 'Search the gallery of illustrations, engravings, woodcuts, and diagrams extracted from books. Since this is a voice conversation, describe what you find rather than showing URLs.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Describe what you\'re looking for (e.g., "alchemical furnace", "tree of life diagram")',
        },
      },
      required: ['query'],
    },
    wait_for_response: true,
  },
];

async function createAgent() {
  // List available voices to find a British one
  console.log('Fetching available voices...');
  const voicesRes = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': API_KEY },
  });
  const voicesData = await voicesRes.json();

  // Look for a good British voice
  const britishVoices = (voicesData.voices || []).filter(v => {
    const labels = v.labels || {};
    return (
      labels.accent?.toLowerCase().includes('british') ||
      labels.accent?.toLowerCase().includes('english') ||
      v.name?.toLowerCase().includes('george') ||
      v.name?.toLowerCase().includes('callum') ||
      v.name?.toLowerCase().includes('daniel') ||
      v.name?.toLowerCase().includes('arthur')
    );
  });

  let voiceId;
  if (britishVoices.length > 0) {
    const voice = britishVoices[0];
    voiceId = voice.voice_id;
    console.log(`Using British voice: ${voice.name} (${voiceId})`);
  } else {
    // Fallback: George (a common ElevenLabs British voice)
    // If not available, use Daniel
    voiceId = 'JBFqnCBsd6RMkjVDRZzb'; // George
    console.log('Using default George voice:', voiceId);
  }

  console.log('Creating ElevenLabs Conversational AI agent...');

  const agentConfig = {
    name: 'Source Library Librarian',
    conversation_config: {
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
        },
        first_message: FIRST_MESSAGE,
        language: 'en',
      },
      tts: {
        voice_id: voiceId,
      },
    },
    platform_settings: {
      auth: {
        // Require signed URLs (private agent)
        enable_auth: true,
      },
    },
  };

  const res = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agentConfig),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to create agent:', res.status, text);
    process.exit(1);
  }

  const agent = await res.json();
  console.log('\n=== Agent Created ===');
  console.log(`Agent ID: ${agent.agent_id}`);
  console.log(`Name: ${agent.name || 'Source Library Librarian'}`);
  console.log(`\nAdd to .env.production.local:`);
  console.log(`ELEVENLABS_AGENT_ID=${agent.agent_id}`);
  console.log(`ELEVENLABS_API_KEY=${API_KEY}`);

  // Now add the client tools
  console.log('\n--- Note ---');
  console.log('Client tools must be configured in the ElevenLabs dashboard:');
  console.log('https://elevenlabs.io/app/conversational-ai');
  console.log('\nTools to add:');
  for (const tool of CLIENT_TOOLS) {
    console.log(`  - ${tool.name}: ${tool.description.slice(0, 80)}...`);
    console.log(`    Parameters: ${JSON.stringify(tool.parameters.properties)}`);
  }

  return agent.agent_id;
}

createAgent().catch(console.error);

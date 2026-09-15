/**
 * Bare-greeting short-circuit for the Librarian.
 *
 * PRIOR ART: src/lib/anon-gate.ts — meters WHO may ask; nothing decides whether
 * a message is worth an agentic turn at all. src/lib/embassy/librarian.ts
 * answers "Hello" today with a full Gemini turn (~13K tokens, 1.5 tool rounds).
 *
 * Why: a bot opened 3,106 "Hello" threads in a week (Aug 22–29 2026, one every
 * ~8s overnight), each a full agentic turn — ~40M tokens for a wave (#4704).
 * A real visitor who says "hello" wants the desk to say hello back and invite a
 * question, not to watch six searches run. So a bare greeting gets a canned
 * welcome with no model call, and the thread it opens stays out of the Recent
 * feed (there is nothing in it to read).
 *
 * Strict by design: only messages made ENTIRELY of greeting words match. "Hello,
 * who was Ficino?" is a question and goes to the model.
 */
import type { Locale } from '@/lib/locale-path';

const GREETING_WORDS = new Set([
  // en
  'hello', 'hi', 'hey', 'hiya', 'yo', 'greetings', 'good', 'morning', 'afternoon',
  'evening', 'there', 'librarian', 'test', 'testing', 'ping',
  // es / pt / it / fr / de / nl
  'hola', 'buenos', 'buenas', 'dias', 'días', 'tardes', 'noches', 'olá', 'ola', 'oi',
  'ciao', 'salve', 'buongiorno', 'buonasera', 'bonjour', 'bonsoir', 'salut',
  'hallo', 'guten', 'tag', 'morgen', 'abend', 'servus', 'hoi', 'goedemorgen',
  'goedemiddag', 'goedenavond', 'dag',
  // zh / ja / ko / ru / ar (single-token greetings)
  '你好', '您好', '嗨', 'こんにちは', 'こんばんは', 'おはよう', '안녕', '안녕하세요',
  'привет', 'здравствуйте', 'مرحبا', 'سلام',
]);

/** True when the message is nothing but a greeting (or a "test"). */
export function isBareGreeting(message: string): boolean {
  const words = message
    .toLowerCase()
    // Strip punctuation, emoji, and symbols — keep letters (any script), digits, spaces.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every(w => GREETING_WORDS.has(w));
}

const WELCOME: Record<Locale, string> = {
  en: 'Welcome to the reading room. I can find passages, page references, and illustrations across the collection — alchemy, Hermetica, Kabbalah, astrology, natural philosophy, and more.\n\nAsk me about an author, a work, or an idea — for example *"Where does Agrippa discuss the celestial harmony?"* or *"Show me the earliest emblem of the green lion."*',
  es: 'Bienvenido a la sala de lectura. Puedo encontrar pasajes, referencias de página e ilustraciones en toda la colección: alquimia, Hermetica, Cábala, astrología, filosofía natural y más.\n\nPregúntame por un autor, una obra o una idea — por ejemplo *"¿Dónde trata Agripa la armonía celeste?"* o *"Muéstrame el emblema más antiguo del león verde."*',
};

/** The canned welcome for a bare greeting, in the reader's chrome language. */
export function greetingReply(lang: Locale = 'en'): string {
  return WELCOME[lang] ?? WELCOME.en;
}

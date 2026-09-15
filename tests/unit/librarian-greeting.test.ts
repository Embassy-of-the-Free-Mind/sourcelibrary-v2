import { describe, it, expect } from 'vitest';
import { isBareGreeting, greetingReply } from '@/lib/embassy/greeting';

// A bot opened 3,106 "Hello" threads in a week, each a full Gemini turn
// (#4704). A bare greeting now gets a canned welcome with no model call. The
// detector must be STRICT: anything with a question in it goes to the model.
describe('isBareGreeting', () => {
  it('matches bare greetings across scripts and punctuation', () => {
    for (const m of ['Hello', 'hello!', 'Hi there', 'HEY', 'hola', 'Buenos días', 'Hallo',
      'bonjour', 'ciao', '你好', 'こんにちは', 'привет', 'test', 'hello librarian', 'Good morning', ' hi 👋 ']) {
      expect(isBareGreeting(m), m).toBe(true);
    }
  });

  it('does not match anything with a question or a topic in it', () => {
    for (const m of ['Hello, who was Ficino?', 'What is the Emerald Tablet?', 'Hermes', 'hi, alchemy',
      'good morning, I am looking for Paracelsus', 'Tetraëder', '18', 'Numerology of 8!', '', '   ']) {
      expect(isBareGreeting(m), m).toBe(false);
    }
  });

  it('caps at four words so a long greeting-shaped sentence still reaches the model', () => {
    expect(isBareGreeting('hello hello hello hello hello')).toBe(false);
  });
});

describe('greetingReply', () => {
  it('answers in the chrome language and falls back to English', () => {
    expect(greetingReply('es')).toMatch(/Bienvenido/);
    expect(greetingReply('en')).toMatch(/Welcome/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(greetingReply('fr' as any)).toMatch(/Welcome/);
  });
});

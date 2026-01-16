import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * API Key rotation for Gemini to handle rate limits
 *
 * Set multiple API keys in environment variables:
 * - GEMINI_API_KEY (primary)
 * - GEMINI_API_KEY_2, GEMINI_API_KEY_3, etc. (additional keys)
 */

// Parse all available API keys from environment
function getApiKeys(): string[] {
  const keys: string[] = [];

  // Primary key
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }

  // Additional numbered keys (2-10)
  for (let i = 2; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) {
      keys.push(key);
    }
  }

  return keys;
}

// Track which key to use next (simple round-robin)
let currentKeyIndex = 0;

// Track rate limit errors per key
const keyErrors: Map<string, { count: number; lastError: number }> = new Map();

// Cooldown period after rate limit (60 seconds)
const RATE_LIMIT_COOLDOWN_MS = 60000;

/**
 * Get the next available API key using round-robin rotation
 * Skips keys that recently hit rate limits
 */
export function getNextApiKey(): string {
  const keys = getApiKeys();

  if (keys.length === 0) {
    throw new Error('No GEMINI_API_KEY configured');
  }

  if (keys.length === 1) {
    return keys[0];
  }

  const now = Date.now();
  let attempts = 0;

  // Try to find a key that isn't in cooldown
  while (attempts < keys.length) {
    const key = keys[currentKeyIndex];
    const keyId = key.slice(-8); // Last 8 chars for logging
    const errorInfo = keyErrors.get(keyId);

    // Rotate to next key for next call
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;

    // Check if this key is in cooldown
    if (errorInfo && (now - errorInfo.lastError) < RATE_LIMIT_COOLDOWN_MS) {
      console.log(`[Gemini] Key ...${keyId} in cooldown, trying next`);
      attempts++;
      continue;
    }

    // Clear old error info
    if (errorInfo && (now - errorInfo.lastError) >= RATE_LIMIT_COOLDOWN_MS) {
      keyErrors.delete(keyId);
    }

    return key;
  }

  // All keys in cooldown, use the one with oldest error
  console.warn('[Gemini] All keys in cooldown, using oldest');
  return keys[currentKeyIndex];
}

/**
 * Report a rate limit error for a key
 */
export function reportRateLimitError(apiKey: string): void {
  const keyId = apiKey.slice(-8);
  const existing = keyErrors.get(keyId) || { count: 0, lastError: 0 };
  keyErrors.set(keyId, {
    count: existing.count + 1,
    lastError: Date.now(),
  });
  console.warn(`[Gemini] Rate limit hit for key ...${keyId} (${existing.count + 1} times)`);
}

/**
 * Get a GoogleGenerativeAI instance with the next available key
 */
export function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = getNextApiKey();
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Get API key stats for debugging
 */
export function getKeyStats(): { totalKeys: number; inCooldown: number } {
  const keys = getApiKeys();
  const now = Date.now();
  let inCooldown = 0;

  for (const key of keys) {
    const keyId = key.slice(-8);
    const errorInfo = keyErrors.get(keyId);
    if (errorInfo && (now - errorInfo.lastError) < RATE_LIMIT_COOLDOWN_MS) {
      inCooldown++;
    }
  }

  return { totalKeys: keys.length, inCooldown };
}

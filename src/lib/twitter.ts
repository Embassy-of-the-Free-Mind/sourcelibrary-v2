/**
 * Twitter API Client for Source Library Social Media
 *
 * Handles authentication, media upload, and tweet posting.
 * Uses twitter-api-v2 library for API v2 + v1.1 media upload.
 */

import { TwitterApi, TweetV2PostTweetResult } from 'twitter-api-v2';

// Singleton client instance
let twitterClient: TwitterApi | null = null;

/**
 * Get or create the Twitter API client.
 * Throws if credentials are not configured.
 */
export function getTwitterClient(): TwitterApi {
  if (twitterClient) return twitterClient;

  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error(
      'Twitter API credentials not configured. ' +
        'Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, and TWITTER_ACCESS_SECRET in .env.local'
    );
  }

  twitterClient = new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken: accessToken,
    accessSecret: accessSecret,
  });

  return twitterClient;
}

/**
 * Check if Twitter credentials are configured.
 */
export function isTwitterConfigured(): boolean {
  return !!(
    process.env.TWITTER_API_KEY &&
    process.env.TWITTER_API_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_SECRET
  );
}

/**
 * Post a tweet with an attached image.
 *
 * @param text - Tweet text (max 280 chars including URL)
 * @param imageUrl - URL to the image to attach
 * @returns Object with tweetId and tweetUrl
 */
export async function postTweetWithMedia(
  text: string,
  imageUrl: string
): Promise<{ tweetId: string; tweetUrl: string }> {
  const client = getTwitterClient();

  // Fetch the image as a buffer
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

  // Determine MIME type
  let mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (contentType.includes('png')) mimeType = 'image/png';
  else if (contentType.includes('gif')) mimeType = 'image/gif';
  else if (contentType.includes('webp')) mimeType = 'image/webp';

  // Upload media to Twitter (uses v1.1 API)
  const mediaId = await client.v1.uploadMedia(imageBuffer, {
    mimeType,
  });

  // Post tweet with media (uses v2 API)
  const tweet: TweetV2PostTweetResult = await client.v2.tweet({
    text,
    media: { media_ids: [mediaId] },
  });

  const tweetId = tweet.data.id;

  // Get authenticated user to construct URL
  // Note: This requires additional API call, so we construct URL from the account name
  // If we don't have it, we use a generic format
  const tweetUrl = `https://twitter.com/i/status/${tweetId}`;

  return {
    tweetId,
    tweetUrl,
  };
}

/**
 * Post a text-only tweet (no media).
 *
 * @param text - Tweet text (max 280 chars)
 * @returns Object with tweetId and tweetUrl
 */
export async function postTweet(text: string): Promise<{ tweetId: string; tweetUrl: string }> {
  const client = getTwitterClient();

  const tweet = await client.v2.tweet({ text });

  return {
    tweetId: tweet.data.id,
    tweetUrl: `https://twitter.com/i/status/${tweet.data.id}`,
  };
}

/**
 * Delete a tweet by ID.
 *
 * @param tweetId - The ID of the tweet to delete
 */
export async function deleteTweet(tweetId: string): Promise<void> {
  const client = getTwitterClient();
  await client.v2.deleteTweet(tweetId);
}

/**
 * Get current rate limit status.
 * Note: Twitter API v2 has different rate limits for different endpoints.
 *
 * Free tier limits (approximate):
 * - 50 tweets per 24 hours
 * - 100 media uploads per month
 */
export async function getRateLimitInfo(): Promise<{
  canTweet: boolean;
  message: string;
}> {
  // Twitter API v2 doesn't have a dedicated rate limit endpoint
  // We track usage in our own database instead
  // This is a placeholder that always returns true
  // Real rate limiting is handled by tracking in social_config collection

  return {
    canTweet: true,
    message: 'Rate limit tracking handled by Source Library database',
  };
}

/**
 * Verify Twitter credentials are valid by making a test API call.
 */
export async function verifyCredentials(): Promise<{
  valid: boolean;
  username?: string;
  error?: string;
}> {
  try {
    const client = getTwitterClient();
    const me = await client.v2.me();

    return {
      valid: true,
      username: me.data.username,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

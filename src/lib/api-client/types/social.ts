/**
 * Social Media API types
 * Import domain types from @/lib/types for consistency
 */
import type {
  SocialPost,
  SocialTag,
  SocialConfig as SocialConfigBase
} from '@/lib/types';

// API-specific overrides for serialization
export interface SocialConfig extends Omit<SocialConfigBase, 'usage' | '_id' | 'updated_at'> {
  settings: {
    posts_per_day: number;
    posting_hours: number[];
    auto_post_enabled: boolean;
    min_gallery_quality: number;
  };
  usage: {
    tweets_today: number;
    tweets_this_month: number;
    last_tweet_at?: string;  // Serialized as string, not Date
  };
}

// API-specific types
export interface SocialCandidate {
  pageId: string;
  detectionIndex: number;
  galleryImageId: string;
  galleryQuality: number;
  shareabilityScore: number;
  description: string;
  type: string;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: number;
  croppedUrl: string;
  galleryUrl: string;
}

// API Response wrappers
export interface SocialPostsResponse {
  posts: SocialPost[];
  total: number;
}

export interface SocialTagsResponse {
  tags: SocialTag[];
  byAudience: Record<string, SocialTag[]>;
}

export interface SocialConfigResponse {
  config: SocialConfig;
  twitter?: {
    connected: boolean;
    username?: string;
  };
}

// API Request types
export interface GeneratePostRequest {
  imageId: string;
  audiences?: string[];
  voices?: string[];
  variationCount?: number;
  saveDraft?: boolean;
  model?: 'gemini' | 'claude';
  customPrompt?: string;
}

export interface TweetVariation {
  tweet: string;
  hashtags: string[];
  voice: string;
  audience: string;
  fullTweet?: string;
  charCount?: number;
}

export interface GeneratePostResponse {
  variations: TweetVariation[];
  image: SocialCandidate;
  croppedUrl: string;
  post?: SocialPost;
  // Backward compatibility
  tweet: string;
  fullTweet: string;
  hashtags: string[];
  hookType: string;
  alternatives: string[];
}

// Re-export for convenience
export type { SocialPost, SocialTag };

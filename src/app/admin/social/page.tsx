'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  RefreshCw,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  Edit2,
  Trash2,
  Plus,
  Settings,
  Image as ImageIcon,
  ListOrdered,
  History,
  Sparkles,
  ExternalLink,
  AlertCircle,
  Twitter,
  Heart,
  Star,
  AtSign,
  Users,
  Search,
} from 'lucide-react';

import { social, gallery, likes } from '@/lib/api-client';
import type { SocialConfig, SocialCandidate } from '@/lib/api-client/types/social';
import { SocialPost, SocialPostStatus } from '@/lib/types';

type TabId = 'browse' | 'queue' | 'history' | 'tags' | 'settings';

// Use API client types
type Config = SocialConfig;
type ImageCandidate = SocialCandidate;

interface PopularImage {
  galleryImageId: string;
  pageId: string;
  detectionIndex: number;
  likeCount: number;
  description: string;
  type: string;
  museumDescription?: string;
  croppedUrl: string;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: number;
}

type BrowseView = 'quality' | 'liked';

interface TweetVariation {
  tweet: string;
  hashtags: string[];
  audience: string;
  voice: string;
  reasoning?: string;
  fullTweet?: string;
  charCount?: number;
}

interface GeneratedTweet {
  tweet: string;
  fullTweet: string;
  hashtags: string[];
  hookType: string;
  alternatives: string[];
  variations?: TweetVariation[];
  image: ImageCandidate;
  croppedUrl: string;
  post?: SocialPost;
  error?: string;
}

interface AudienceOption {
  id: string;
  name: string;
  description: string;
}

interface VoiceOption {
  id: string;
  name: string;
  description: string;
  examples: string[];
}

interface ModelOption {
  id: string;
  name: string;
  description: string;
}

interface SocialTagItem {
  handle: string;
  name: string;
  audience: string;
  description?: string;
  followers?: number;
  relevance: string;
  active: boolean;
  priority: number;
}

const STATUS_COLORS: Record<SocialPostStatus, string> = {
  draft: 'text-gray-400',
  queued: 'text-amber-500',
  posted: 'text-green-500',
  failed: 'text-red-500',
};

const STATUS_ICONS: Record<SocialPostStatus, typeof Clock> = {
  draft: Edit2,
  queued: Clock,
  posted: CheckCircle,
  failed: XCircle,
};

export default function SocialAdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('browse');
  const [config, setConfig] = useState<Config | null>(null);
  const [twitterConnected, setTwitterConnected] = useState(false);
  const [twitterUsername, setTwitterUsername] = useState<string | null>(null);

  // Browse tab state
  const [browseView, setBrowseView] = useState<BrowseView>('quality');
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [popularImages, setPopularImages] = useState<PopularImage[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageCandidate | null>(null);
  const [selectedPopularImage, setSelectedPopularImage] = useState<PopularImage | null>(null);
  const [generatedTweet, setGeneratedTweet] = useState<GeneratedTweet | null>(null);
  const [generating, setGenerating] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ImageCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  // Audience/Voice targeting state
  const [availableAudiences, setAvailableAudiences] = useState<AudienceOption[]>([]);
  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>(['esoteric', 'jungian', 'consciousness', 'aesthetic']);
  const [selectedVoices, setSelectedVoices] = useState<string[]>(['scholarly', 'provocative', 'aesthetic', 'mysterious']);
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'claude'>('gemini');
  const [customPrompt, setCustomPrompt] = useState<string>('');

  // Variation editing state
  const [editingVariation, setEditingVariation] = useState<number | null>(null);
  const [editedTweet, setEditedTweet] = useState('');

  // Queue tab state
  const [queuedPosts, setQueuedPosts] = useState<SocialPost[]>([]);
  const [draftPosts, setDraftPosts] = useState<SocialPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);

  // History tab state
  const [postedPosts, setPostedPosts] = useState<SocialPost[]>([]);
  const [failedPosts, setFailedPosts] = useState<SocialPost[]>([]);

  // Settings tab state
  const [savingSettings, setSavingSettings] = useState(false);

  // Tags tab state
  const [socialTags, setSocialTags] = useState<Record<string, SocialTagItem[]>>({});
  const [loadingTags, setLoadingTags] = useState(false);
  const [selectedTagAudience, setSelectedTagAudience] = useState<string | null>(null);

  // Publishing state
  const [publishing, setPublishing] = useState<string | null>(null);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      const data = await social.config();
      setConfig(data.config);
      setTwitterConnected(data.twitter?.connected || false);
      setTwitterUsername(data.twitter?.username || null);
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  }, []);

  // Fetch available audiences, voices, and models
  const fetchAudiencesAndVoices = useCallback(async () => {
    try {
      const data = await social.getGenerationOptions();
      setAvailableAudiences(data.audiences || []);
      setAvailableVoices(data.voices || []);
      setAvailableModels(data.models || []);
    } catch (error) {
      console.error('Failed to fetch audiences/voices:', error);
    }
  }, []);

  // Fetch candidates
  const fetchCandidates = useCallback(async () => {
    setLoadingCandidates(true);
    try {
      const data = await social.candidates();
      setCandidates(data.candidates || []);
    } catch (error) {
      console.error('Failed to fetch candidates:', error);
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  // Fetch popular/liked images
  const fetchPopularImages = useCallback(async () => {
    setLoadingPopular(true);
    try {
      const data = await likes.getPopular<PopularImage>({ type: 'image', limit: 20, min_likes: 1 });
      setPopularImages(data.items || []);
    } catch (error) {
      console.error('Failed to fetch popular images:', error);
    } finally {
      setLoadingPopular(false);
    }
  }, []);

  // Fetch social tags
  const fetchTags = useCallback(async () => {
    setLoadingTags(true);
    try {
      const data = await social.tags();
      setSocialTags(data.byAudience || {});
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    } finally {
      setLoadingTags(false);
    }
  }, []);

  // Fetch posts
  const fetchPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const [queueData, draftData, postedData, failedData] = await Promise.all([
        social.posts(),
        social.posts(),
        social.posts(),
        social.posts(),
      ]);

      setQueuedPosts(queueData.posts || []);
      setDraftPosts(draftData.posts || []);
      setPostedPosts(postedData.posts || []);
      setFailedPosts(failedData.posts || []);
    } catch (error) {
      console.error('Failed to fetch posts:', error);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchConfig();
    fetchCandidates();
    fetchPopularImages();
    fetchPosts();
    fetchAudiencesAndVoices();
    fetchTags();
  }, [fetchConfig, fetchCandidates, fetchPopularImages, fetchPosts, fetchAudiencesAndVoices, fetchTags]);

  // Search gallery images
  const searchGallery = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await gallery.list({ query, limit: 20 });
      // Transform gallery results to ImageCandidate format
      const results: ImageCandidate[] = (data.items || []).map((img) => ({
        pageId: img.pageId,
        detectionIndex: img.detectionIndex,
        galleryImageId: `${img.pageId}-${img.detectionIndex}`,
        galleryQuality: img.galleryQuality || 0.8,
        shareabilityScore: 50,
        description: img.description,
        type: img.type || 'unknown',
        bookTitle: img.bookTitle,
        bookAuthor: img.author,
        bookYear: img.year,
        croppedUrl: img.imageUrl,
        galleryUrl: `/gallery/image/${img.pageId}-${img.detectionIndex}`,
      }));
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  };

  // Generate tweet for selected image
  const generateTweet = async (imageId: string) => {
    setGenerating(true);
    setGeneratedTweet(null);
    setEditingVariation(null);
    try {
      const data = await social.generate({
        imageId,
        audiences: selectedAudiences,
        voices: selectedVoices,
        variationCount: 6,
        saveDraft: false,
        model: selectedModel,
        customPrompt: customPrompt.trim() || undefined,
      });
      setGeneratedTweet(data);
    } catch (error) {
      console.error('Generation error:', error);
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  // Save draft
  const saveDraft = async (tweet: GeneratedTweet) => {
    try {
      await social.createPost({
        imageId: tweet.image.galleryImageId,
        tweet_text: tweet.tweet,
        hashtags: tweet.hashtags,
        status: 'draft',
      });
      setGeneratedTweet(null);
      setSelectedImage(null);
      setSelectedPopularImage(null);
      fetchPosts();
    } catch (error) {
      console.error('Save error:', error);
    }
  };

  // Save a specific variation as draft
  const saveVariationAsDraft = async (variation: TweetVariation, imageId: string) => {
    try {
      await social.createPost({
        imageId,
        tweet_text: variation.tweet,
        hashtags: variation.hashtags,
        status: 'draft',
      });
      alert('Saved to drafts!');
      fetchPosts();
    } catch (error) {
      console.error('Save error:', error);
    }
  };

  // Toggle audience selection
  const toggleAudience = (audienceId: string) => {
    setSelectedAudiences(prev =>
      prev.includes(audienceId)
        ? prev.filter(a => a !== audienceId)
        : [...prev, audienceId]
    );
  };

  // Toggle voice selection
  const toggleVoice = (voiceId: string) => {
    setSelectedVoices(prev =>
      prev.includes(voiceId)
        ? prev.filter(v => v !== voiceId)
        : [...prev, voiceId]
    );
  };

  // Add to queue
  const addToQueue = async (postId: string) => {
    try {
      await social.updatePost(postId, { status: 'queued' });
      fetchPosts();
    } catch (error) {
      console.error('Queue error:', error);
    }
  };

  // Publish now
  const publishNow = async (postId: string) => {
    setPublishing(postId);
    try {
      const data = await social.publishPost(postId) as { tweetUrl?: string };
      alert(`Posted! ${data.tweetUrl || ''}`);
      fetchPosts();
      fetchConfig();
    } catch (error) {
      console.error('Publish error:', error);
      alert(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setPublishing(null);
    }
  };

  // Update post
  const updatePost = async (postId: string, updates: { tweet_text?: string; hashtags?: string[] }) => {
    try {
      const res = await fetch(`/api/social/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        // Refresh posts
        fetchPosts();
      } else {
        alert('Failed to update post');
      }
    } catch (error) {
      console.error('Update error:', error);
      alert('Failed to update post');
    }
  };

  // Delete post
  const deletePost = async (postId: string) => {
    if (!confirm('Delete this post?')) return;

    try {
      await social.deletePost(postId);
      fetchPosts();
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  // Update settings
  const updateSettings = async (updates: Partial<Config['settings']>) => {
    setSavingSettings(true);
    try {
      await social.updateConfig({ settings: updates });
      fetchConfig();
    } catch (error) {
      console.error('Settings error:', error);
    } finally {
      setSavingSettings(false);
    }
  };

  // Toggle tag active status
  const toggleTagActive = async (handle: string, currentActive: boolean) => {
    try {
      await social.updateTag(handle, { active: !currentActive });
      fetchTags();
    } catch (error) {
      console.error('Error toggling tag:', error);
    }
  };

  // Delete tag
  const deleteTag = async (handle: string) => {
    if (!confirm(`Delete @${handle}?`)) return;
    try {
      await social.deleteTag(handle);
      fetchTags();
    } catch (error) {
      console.error('Error deleting tag:', error);
    }
  };

  const tabs: { id: TabId; label: string; icon: typeof ImageIcon }[] = [
    { id: 'browse', label: 'Browse & Generate', icon: ImageIcon },
    { id: 'queue', label: 'Queue', icon: ListOrdered },
    { id: 'history', label: 'History', icon: History },
    { id: 'tags', label: 'Tags', icon: AtSign },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Header */}
      <header className="border-b border-stone-800 bg-stone-900">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-stone-400 hover:text-white">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                  <Twitter className="w-5 h-5 text-sky-400" />
                  Social Media
                </h1>
                <p className="text-sm text-stone-400">Generate and schedule tweets</p>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-4 text-sm">
              {twitterConnected ? (
                <span className="flex items-center gap-2 text-green-500">
                  <CheckCircle className="w-4 h-4" />
                  @{twitterUsername}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-amber-500">
                  <AlertCircle className="w-4 h-4" />
                  Twitter not connected
                </span>
              )}

              {config && (
                <span className="text-stone-400">
                  {config.usage.tweets_today}/{config.settings.posts_per_day} today
                </span>
              )}

              <button
                onClick={() => {
                  fetchConfig();
                  fetchCandidates();
                  fetchPosts();
                }}
                className="p-2 rounded hover:bg-stone-800"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-t flex items-center gap-2 transition-colors ${activeTab === tab.id
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-400 hover:text-white hover:bg-stone-800/50'
                  }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Browse Tab */}
        {activeTab === 'browse' && (
          <div className="space-y-6">
            {/* Search Bar */}
            <div className="bg-stone-900 rounded-lg p-6 border border-stone-800">
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Search className="w-5 h-5 text-sky-400" />
                Search Source Library
              </h2>
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchGallery(searchQuery)}
                    placeholder="Search gallery images... (e.g., 'alchemical emblems', 'mercury', 'tree of life')"
                    className="w-full bg-stone-800 text-white rounded-lg px-4 py-3 border border-stone-700 focus:border-sky-500 outline-none"
                  />
                  {searching && (
                    <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 animate-spin" />
                  )}
                </div>
                <button
                  onClick={() => searchGallery(searchQuery)}
                  disabled={searching || !searchQuery.trim()}
                  className="px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg font-medium flex items-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
              </div>

              {/* Quick filters */}
              <div className="flex flex-wrap gap-2 mt-4">
                <span className="text-xs text-stone-500">Quick:</span>
                {['emblem', 'alchemy', 'hermetic', 'kabbalah', 'astrology', 'portrait'].map((term) => (
                  <button
                    key={term}
                    onClick={() => { setSearchQuery(term); searchGallery(term); }}
                    className="text-xs px-2 py-1 bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-white rounded"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Results / Browse Grid */}
              <div>
                {/* Show search results if searching, otherwise show browse options */}
                {searchResults.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-stone-400">
                        {searchResults.length} results for "{searchQuery}"
                      </p>
                      <button
                        onClick={() => { setSearchResults([]); setSearchQuery(''); }}
                        className="text-xs text-stone-500 hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {searchResults.map((result) => (
                        <button
                          key={result.galleryImageId}
                          onClick={() => {
                            setSelectedImage(result);
                            setSelectedPopularImage(null);
                            setGeneratedTweet(null);
                          }}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${selectedImage?.galleryImageId === result.galleryImageId
                            ? 'border-sky-500 ring-2 ring-sky-500/50'
                            : 'border-stone-700 hover:border-stone-500'
                            }`}
                        >
                          <img
                            src={result.croppedUrl}
                            alt={result.description}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                            <span className="text-xs text-white/80 line-clamp-2">
                              {result.description}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      {/* View Toggle */}
                      <div className="flex items-center rounded-lg p-1 bg-stone-800">
                        <button
                          onClick={() => setBrowseView('quality')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${browseView === 'quality'
                            ? 'bg-stone-700 text-white'
                            : 'text-stone-400 hover:text-white'
                            }`}
                        >
                          <Star className="w-4 h-4" />
                          Top Quality
                        </button>
                        <button
                          onClick={() => setBrowseView('liked')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${browseView === 'liked'
                            ? 'bg-stone-700 text-white'
                            : 'text-stone-400 hover:text-white'
                            }`}
                        >
                          <Heart className="w-4 h-4" />
                          Most Liked
                          {popularImages.length > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">
                              {popularImages.length}
                            </span>
                          )}
                        </button>
                      </div>
                      <button
                        onClick={browseView === 'quality' ? fetchCandidates : fetchPopularImages}
                        disabled={browseView === 'quality' ? loadingCandidates : loadingPopular}
                        className="text-sm text-stone-400 hover:text-white flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${(browseView === 'quality' ? loadingCandidates : loadingPopular) ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>

                    {/* Quality View */}
                    {browseView === 'quality' && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {candidates.map((candidate) => (
                          <button
                            key={candidate.galleryImageId}
                            onClick={() => {
                              setSelectedImage(candidate);
                              setSelectedPopularImage(null);
                              setGeneratedTweet(null);
                            }}
                            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${selectedImage?.galleryImageId === candidate.galleryImageId
                              ? 'border-sky-500 ring-2 ring-sky-500/50'
                              : 'border-stone-700 hover:border-stone-500'
                              }`}
                          >
                            <img
                              src={candidate.croppedUrl}
                              alt={candidate.description}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                              <span className="text-xs text-white/80 line-clamp-2">
                                {candidate.description}
                              </span>
                            </div>
                            <div className="absolute top-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-xs">
                              {Math.round(candidate.galleryQuality * 100)}%
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Liked View */}
                    {browseView === 'liked' && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {popularImages.length === 0 ? (
                          <div className="col-span-3 text-center py-12 text-stone-500">
                            <Heart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p>No liked images yet</p>
                            <p className="text-sm mt-1">
                              Images that visitors like will appear here
                            </p>
                          </div>
                        ) : (
                          popularImages.map((image) => (
                            <button
                              key={image.galleryImageId}
                              onClick={() => {
                                setSelectedPopularImage(image);
                                setSelectedImage(null);
                                setGeneratedTweet(null);
                              }}
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${selectedPopularImage?.galleryImageId === image.galleryImageId
                                ? 'border-red-500 ring-2 ring-red-500/50'
                                : 'border-stone-700 hover:border-stone-500'
                                }`}
                            >
                              <img
                                src={image.croppedUrl}
                                alt={image.description}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                <span className="text-xs text-white/80 line-clamp-2">
                                  {image.description}
                                </span>
                              </div>
                              <div className="absolute top-2 right-2 bg-red-500/80 px-1.5 py-0.5 rounded text-xs flex items-center gap-1">
                                <Heart className="w-3 h-3" />
                                {image.likeCount}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Generate Panel */}
              <div className="bg-stone-900 rounded-lg p-4 border border-stone-800 max-h-[calc(100vh-200px)] overflow-y-auto">
                {(selectedImage || selectedPopularImage) ? (
                  <div>
                    {/* Image Preview */}
                    <div className="flex items-start gap-4 mb-4">
                      <img
                        src={selectedImage?.croppedUrl || selectedPopularImage?.croppedUrl}
                        alt=""
                        className="w-20 h-20 rounded object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate">
                            {selectedImage?.bookTitle || selectedPopularImage?.bookTitle}
                          </h3>
                          {selectedPopularImage && (
                            <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded flex-shrink-0">
                              <Heart className="w-3 h-3" />
                              {selectedPopularImage.likeCount}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-stone-400 line-clamp-2">
                          {selectedImage?.description || selectedPopularImage?.description}
                        </p>
                      </div>
                    </div>

                    {!generatedTweet ? (
                      <div className="space-y-4">
                        {/* Audience Selection */}
                        <div>
                          <p className="text-xs text-stone-400 mb-2 uppercase tracking-wide">Target Audiences</p>
                          <div className="flex flex-wrap gap-1.5">
                            {availableAudiences.map((audience) => (
                              <button
                                key={audience.id}
                                onClick={() => toggleAudience(audience.id)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${selectedAudiences.includes(audience.id)
                                  ? 'bg-violet-600 text-white'
                                  : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                                  }`}
                                title={audience.description}
                              >
                                {audience.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Voice Selection */}
                        <div>
                          <p className="text-xs text-stone-400 mb-2 uppercase tracking-wide">Voice Styles</p>
                          <div className="flex flex-wrap gap-1.5">
                            {availableVoices.map((voice) => (
                              <button
                                key={voice.id}
                                onClick={() => toggleVoice(voice.id)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${selectedVoices.includes(voice.id)
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                                  }`}
                                title={voice.description}
                              >
                                {voice.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Model Selection */}
                        <div>
                          <p className="text-xs text-stone-400 mb-2 uppercase tracking-wide">AI Model</p>
                          <div className="flex gap-2">
                            {availableModels.map((model) => (
                              <button
                                key={model.id}
                                onClick={() => {
                                  if (model.id === 'gemini' || model.id === 'claude') {
                                    setSelectedModel(model.id);
                                  }
                                }}
                                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${selectedModel === model.id
                                  ? 'bg-sky-600 border-sky-500 text-white'
                                  : 'bg-stone-800 border-stone-700 text-stone-400 hover:bg-stone-700'
                                  }`}
                                title={model.description}
                              >
                                {model.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Custom Prompt */}
                        <div>
                          <p className="text-xs text-stone-400 mb-2 uppercase tracking-wide">
                            Custom Guidance <span className="text-stone-500">(optional)</span>
                          </p>
                          <textarea
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="Add specific direction: tone, themes to emphasize, style notes..."
                            className="w-full bg-stone-800 text-white text-sm rounded-lg p-3 border border-stone-700 focus:border-sky-500 outline-none resize-none placeholder:text-stone-500"
                            rows={3}
                          />
                        </div>

                        {/* Generate Button */}
                        <button
                          onClick={() => generateTweet(
                            selectedImage?.galleryImageId || selectedPopularImage?.galleryImageId || ''
                          )}
                          disabled={generating || selectedAudiences.length === 0 || selectedVoices.length === 0}
                          className="w-full py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-2"
                        >
                          {generating ? (
                            <>
                              <Sparkles className="w-4 h-4 animate-pulse" />
                              Generating {selectedAudiences.length * selectedVoices.length > 6 ? 6 : Math.min(6, selectedAudiences.length + selectedVoices.length)} variations...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              Generate Variations
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Header with regenerate */}
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-stone-400">
                            {generatedTweet.variations?.length || 1} variations generated
                          </p>
                          <button
                            onClick={() => generateTweet(
                              selectedImage?.galleryImageId || selectedPopularImage?.galleryImageId || ''
                            )}
                            className="text-xs text-stone-400 hover:text-white flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Regenerate
                          </button>
                        </div>

                        {/* Variation Cards */}
                        {generatedTweet.variations && generatedTweet.variations.length > 0 ? (
                          <div className="space-y-3">
                            {generatedTweet.variations.map((variation, i) => (
                              <div
                                key={i}
                                className="bg-stone-800 rounded-lg p-3 border border-stone-700 hover:border-stone-600 transition-colors"
                              >
                                {/* Audience/Voice tags */}
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-600/30 text-violet-300 uppercase">
                                    {variation.audience}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-300 uppercase">
                                    {variation.voice}
                                  </span>
                                  <span className="text-[10px] text-stone-500 ml-auto">
                                    {variation.charCount || variation.tweet.length}/200
                                  </span>
                                </div>

                                {/* Tweet text (editable) */}
                                {editingVariation === i ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={editedTweet}
                                      onChange={(e) => setEditedTweet(e.target.value)}
                                      className="w-full bg-stone-900 text-white text-sm rounded p-2 border border-stone-600 focus:border-sky-500 outline-none resize-none"
                                      rows={3}
                                      maxLength={200}
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => {
                                          variation.tweet = editedTweet;
                                          setEditingVariation(null);
                                        }}
                                        className="flex-1 py-1.5 bg-sky-600 hover:bg-sky-700 rounded text-xs"
                                      >
                                        Save Edit
                                      </button>
                                      <button
                                        onClick={() => setEditingVariation(null)}
                                        className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-xs"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <p
                                    className="text-sm text-white cursor-pointer hover:bg-stone-700/50 rounded p-1 -m-1"
                                    onClick={() => {
                                      setEditingVariation(i);
                                      setEditedTweet(variation.tweet);
                                    }}
                                    title="Click to edit"
                                  >
                                    {variation.tweet}
                                  </p>
                                )}

                                {/* Hashtags */}
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {variation.hashtags.map((tag) => (
                                    <span key={tag} className="text-sky-400 text-xs">
                                      #{tag}
                                    </span>
                                  ))}
                                </div>

                                {/* Reasoning (if available) */}
                                {variation.reasoning && (
                                  <p className="text-[10px] text-stone-500 mt-2 italic">
                                    {variation.reasoning}
                                  </p>
                                )}

                                {/* Actions */}
                                <div className="flex gap-2 mt-3 pt-2 border-t border-stone-700">
                                  <button
                                    onClick={() => saveVariationAsDraft(
                                      variation,
                                      selectedImage?.galleryImageId || selectedPopularImage?.galleryImageId || ''
                                    )}
                                    className="flex-1 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-xs flex items-center justify-center gap-1"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Save Draft
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingVariation(i);
                                      setEditedTweet(variation.tweet);
                                    }}
                                    className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-xs"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          /* Fallback to old format */
                          <div className="bg-stone-800 rounded-lg p-3">
                            <p className="text-white">{generatedTweet.tweet}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {generatedTweet.hashtags.map((tag) => (
                                <span key={tag} className="text-sky-400 text-sm">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => saveDraft(generatedTweet)}
                                className="flex-1 py-2 bg-stone-700 hover:bg-stone-600 rounded flex items-center justify-center gap-2"
                              >
                                <Plus className="w-4 h-4" />
                                Save Draft
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Clear button */}
                        <button
                          onClick={() => {
                            setGeneratedTweet(null);
                            setSelectedImage(null);
                            setSelectedPopularImage(null);
                          }}
                          className="w-full py-2 text-stone-400 hover:text-white text-sm"
                        >
                          Select Different Image
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-stone-500">
                    <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Select an image to generate tweets</p>
                    <p className="text-xs mt-2">Choose audiences and voices, then generate multiple variations</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="space-y-6">
            {/* Drafts */}
            <div>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-stone-400" />
                Drafts ({draftPosts.length})
              </h2>
              {draftPosts.length === 0 ? (
                <p className="text-stone-500">No drafts. Generate some tweets first.</p>
              ) : (
                <div className="grid gap-3">
                  {draftPosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onQueue={() => addToQueue(post.id)}
                      onPublish={() => publishNow(post.id)}
                      onDelete={() => deletePost(post.id)}
                      onUpdate={(updates) => updatePost(post.id, updates)}
                      publishing={publishing === post.id}
                      twitterConnected={twitterConnected}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Queued */}
            <div>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                Queued ({queuedPosts.length})
              </h2>
              {queuedPosts.length === 0 ? (
                <p className="text-stone-500">No posts in queue.</p>
              ) : (
                <div className="grid gap-3">
                  {queuedPosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onPublish={() => publishNow(post.id)}
                      onDelete={() => deletePost(post.id)}
                      onUpdate={(updates) => updatePost(post.id, updates)}
                      publishing={publishing === post.id}
                      twitterConnected={twitterConnected}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Posted */}
            <div>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Posted ({postedPosts.length})
              </h2>
              {postedPosts.length === 0 ? (
                <p className="text-stone-500">No posts yet.</p>
              ) : (
                <div className="grid gap-3">
                  {postedPosts.map((post) => (
                    <PostCard key={post.id} post={post} onDelete={() => deletePost(post.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* Failed */}
            {failedPosts.length > 0 && (
              <div>
                <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-500" />
                  Failed ({failedPosts.length})
                </h2>
                <div className="grid gap-3">
                  {failedPosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onPublish={() => publishNow(post.id)}
                      onDelete={() => deletePost(post.id)}
                      publishing={publishing === post.id}
                      twitterConnected={twitterConnected}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tags Tab */}
        {activeTab === 'tags' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium flex items-center gap-2">
                  <Users className="w-5 h-5 text-sky-400" />
                  Accounts to Tag
                </h2>
                <p className="text-sm text-stone-400 mt-1">
                  Twitter/X accounts per audience for @mentions in tweets
                </p>
              </div>
              <button
                onClick={fetchTags}
                disabled={loadingTags}
                className="text-sm text-stone-400 hover:text-white flex items-center gap-1"
              >
                <RefreshCw className={`w-4 h-4 ${loadingTags ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {/* Audience filter pills */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedTagAudience(null)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${selectedTagAudience === null
                  ? 'bg-sky-600 text-white'
                  : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                  }`}
              >
                All ({Object.values(socialTags).flat().length})
              </button>
              {Object.keys(socialTags).map((audience) => (
                <button
                  key={audience}
                  onClick={() => setSelectedTagAudience(audience)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all capitalize ${selectedTagAudience === audience
                    ? 'bg-sky-600 text-white'
                    : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                    }`}
                >
                  {audience} ({socialTags[audience]?.length || 0})
                </button>
              ))}
            </div>

            {/* Tags grid */}
            <div className="grid gap-3">
              {(selectedTagAudience
                ? socialTags[selectedTagAudience] || []
                : Object.values(socialTags).flat()
              ).map((tag) => (
                <div
                  key={tag.handle}
                  className={`bg-stone-900 rounded-lg p-4 border transition-all ${tag.active ? 'border-stone-700' : 'border-stone-800 opacity-50'
                    }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://twitter.com/${tag.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-sky-400 hover:underline flex items-center gap-1"
                        >
                          @{tag.handle}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <span className="text-xs px-2 py-0.5 rounded bg-stone-800 text-stone-400 capitalize">
                          {tag.audience}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-amber-900/50 text-amber-400">
                          P{tag.priority}
                        </span>
                      </div>
                      <p className="text-sm text-stone-300 mt-1">{tag.name}</p>
                      {tag.description && (
                        <p className="text-xs text-stone-500 mt-1">{tag.description}</p>
                      )}
                      <p className="text-xs text-stone-400 mt-2">{tag.relevance}</p>
                      {tag.followers && (
                        <p className="text-xs text-stone-500 mt-1">
                          {tag.followers.toLocaleString()} followers
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleTagActive(tag.handle, tag.active)}
                        className={`px-3 py-1 rounded text-xs ${tag.active
                          ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                          : 'bg-stone-700 text-stone-400 hover:bg-stone-600'
                          }`}
                      >
                        {tag.active ? 'Active' : 'Inactive'}
                      </button>
                      <button
                        onClick={() => deleteTag(tag.handle)}
                        className="p-1.5 rounded bg-stone-800 text-stone-400 hover:bg-red-900/50 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {Object.keys(socialTags).length === 0 && !loadingTags && (
              <div className="text-center py-12 text-stone-500">
                <AtSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No tags configured yet</p>
                <p className="text-sm mt-1">
                  Run: <code className="bg-stone-800 px-2 py-0.5 rounded">npx tsx scripts/seed-social-tags.ts</code>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && config && (
          <div className="max-w-xl space-y-6">
            <div className="bg-stone-900 rounded-lg p-4 border border-stone-800">
              <h2 className="text-lg font-medium mb-4">Posting Settings</h2>

              {/* Auto-post toggle */}
              <div className="flex items-center justify-between py-3 border-b border-stone-800">
                <div>
                  <p className="font-medium">Auto-posting</p>
                  <p className="text-sm text-stone-400">
                    Automatically post queued tweets at scheduled times
                  </p>
                </div>
                <button
                  onClick={() =>
                    updateSettings({ auto_post_enabled: !config.settings.auto_post_enabled })
                  }
                  disabled={savingSettings}
                  className={`px-4 py-2 rounded ${config.settings.auto_post_enabled
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-stone-700 hover:bg-stone-600'
                    }`}
                >
                  {config.settings.auto_post_enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              {/* Posts per day */}
              <div className="flex items-center justify-between py-3 border-b border-stone-800">
                <div>
                  <p className="font-medium">Posts per day</p>
                  <p className="text-sm text-stone-400">Maximum tweets per day</p>
                </div>
                <select
                  value={config.settings.posts_per_day}
                  onChange={(e) => updateSettings({ posts_per_day: parseInt(e.target.value) })}
                  className="bg-stone-800 border border-stone-700 rounded px-3 py-2"
                >
                  {[1, 2, 3, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              {/* Posting hours */}
              <div className="py-3 border-b border-stone-800">
                <p className="font-medium mb-2">Posting hours (UTC)</p>
                <p className="text-sm text-stone-400 mb-3">
                  Select hours when auto-posting should run
                </p>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                    <button
                      key={hour}
                      onClick={() => {
                        const current = config.settings.posting_hours;
                        const updated = current.includes(hour)
                          ? current.filter((h) => h !== hour)
                          : [...current, hour].sort((a, b) => a - b);
                        updateSettings({ posting_hours: updated });
                      }}
                      className={`w-10 h-10 rounded text-sm ${config.settings.posting_hours.includes(hour)
                        ? 'bg-sky-600'
                        : 'bg-stone-800 hover:bg-stone-700'
                        }`}
                    >
                      {hour}
                    </button>
                  ))}
                </div>
              </div>

              {/* Min quality */}
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">Minimum quality</p>
                  <p className="text-sm text-stone-400">
                    Only show images with quality above this threshold
                  </p>
                </div>
                <select
                  value={config.settings.min_gallery_quality}
                  onChange={(e) =>
                    updateSettings({ min_gallery_quality: parseFloat(e.target.value) })
                  }
                  className="bg-stone-800 border border-stone-700 rounded px-3 py-2"
                >
                  {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9].map((n) => (
                    <option key={n} value={n}>
                      {Math.round(n * 100)}%
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Usage Stats */}
            <div className="bg-stone-900 rounded-lg p-4 border border-stone-800">
              <h2 className="text-lg font-medium mb-4">Usage</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">{config.usage.tweets_today}</p>
                  <p className="text-sm text-stone-400">Tweets today</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{config.usage.tweets_this_month}</p>
                  <p className="text-sm text-stone-400">This month</p>
                </div>
              </div>
              {config.usage.last_tweet_at && (
                <p className="text-sm text-stone-500 mt-4">
                  Last tweet: {new Date(config.usage.last_tweet_at).toLocaleString()}
                </p>
              )}
            </div>

            {/* Twitter Connection */}
            <div className="bg-stone-900 rounded-lg p-4 border border-stone-800">
              <h2 className="text-lg font-medium mb-4">Twitter Connection</h2>
              {twitterConnected ? (
                <div className="flex items-center gap-3 text-green-500">
                  <CheckCircle className="w-5 h-5" />
                  <span>Connected as @{twitterUsername}</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-amber-500">
                    <AlertCircle className="w-5 h-5" />
                    <span>Not connected</span>
                  </div>
                  <p className="text-sm text-stone-400">
                    Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, and
                    TWITTER_ACCESS_SECRET in your environment variables.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Post Card Component with inline editing
function PostCard({
  post,
  onQueue,
  onPublish,
  onDelete,
  onUpdate,
  publishing,
  twitterConnected,
}: {
  post: SocialPost;
  onQueue?: () => void;
  onPublish?: () => void;
  onDelete?: () => void;
  onUpdate?: (updates: { tweet_text?: string; hashtags?: string[] }) => Promise<void>;
  publishing?: boolean;
  twitterConnected?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(post.tweet_text || '');
  const [editHashtags, setEditHashtags] = useState(post.hashtags?.join(', ') || '');
  const [saving, setSaving] = useState(false);
  const StatusIcon = STATUS_ICONS[post.status];

  const handleSave = async () => {
    if (!onUpdate) return;
    setSaving(true);
    try {
      await onUpdate({
        tweet_text: editText,
        hashtags: editHashtags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean),
      });
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const canEdit = post.status === 'draft' || post.status === 'queued';

  return (
    <div className="bg-stone-900 rounded-lg p-4 border border-stone-800 flex gap-4">
      <img
        src={post.image_data.cropped_url}
        alt=""
        className="w-20 h-20 rounded object-cover flex-shrink-0"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-sm resize-none"
                  rows={3}
                  placeholder="Tweet text..."
                />
                <input
                  type="text"
                  value={editHashtags}
                  onChange={(e) => setEditHashtags(e.target.value)}
                  className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs"
                  placeholder="hashtags (comma separated)"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setEditText(post.tweet_text || '');
                      setEditHashtags(post.hashtags?.join(', ') || '');
                      setIsEditing(false);
                    }}
                    className="text-xs px-2 py-1 bg-stone-700 hover:bg-stone-600 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => canEdit && onUpdate && setIsEditing(true)}
                className={canEdit && onUpdate ? 'cursor-pointer hover:bg-stone-800/50 rounded p-1 -m-1' : ''}
                title={canEdit && onUpdate ? 'Click to edit' : undefined}
              >
                <p className="font-medium text-sm line-clamp-2">{post.tweet_text || '(No text)'}</p>
                <p className="text-xs text-stone-500 mt-1">
                  {post.image_data.book_title}
                  {post.image_data.book_year && ` (${post.image_data.book_year})`}
                </p>
              </div>
            )}
          </div>
          <div className={`flex items-center gap-1 ${STATUS_COLORS[post.status]} flex-shrink-0`}>
            <StatusIcon className="w-4 h-4" />
            <span className="text-xs capitalize">{post.status}</span>
          </div>
        </div>

        {!isEditing && post.hashtags && post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {post.hashtags.map((tag) => (
              <span key={tag} className="text-sky-400 text-xs">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {post.error && <p className="text-xs text-red-400 mt-2">{post.error}</p>}

        {post.twitter_url && (
          <a
            href={post.twitter_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-400 hover:underline mt-2 inline-flex items-center gap-1"
          >
            View on Twitter <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {!isEditing && (
          <div className="flex gap-2 mt-3">
            {canEdit && onUpdate && (
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs px-3 py-1 bg-stone-700 hover:bg-stone-600 rounded flex items-center gap-1"
              >
                <Edit2 className="w-3 h-3" />
                Edit
              </button>
            )}
            {onQueue && post.status === 'draft' && (
              <button
                onClick={onQueue}
                className="text-xs px-3 py-1 bg-amber-600 hover:bg-amber-700 rounded"
              >
                Add to Queue
              </button>
            )}
            {onPublish && twitterConnected && (
              <button
                onClick={onPublish}
                disabled={publishing}
                className="text-xs px-3 py-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded flex items-center gap-1"
              >
                {publishing ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Posting...
                  </>
                ) : (
                  <>
                    <Send className="w-3 h-3" />
                    Post Now
                  </>
                )}
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="text-xs px-3 py-1 bg-stone-700 hover:bg-stone-600 rounded"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

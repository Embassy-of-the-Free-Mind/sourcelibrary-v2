/**
 * Pages API Types
 * Shared between API client and route handlers
 */
import type { Page } from '@/lib/types';

export interface PageOcrRequest {
  model?: string;
  prompt_id?: string;
  force?: boolean;
}

export interface PageOcrResponse {
  success: boolean;
  page: Page;
}

export interface PageTranslateRequest {
  model?: string;
  prompt_id?: string;
  force?: boolean;
}

export interface PageTranslateResponse {
  success: boolean;
  page: Page;
}

export interface PageUpdateRequest {
  ocr?: string;
  translation?: string;
  summary?: string;
  edited_by?: string;
}

export interface PageUpdateResponse {
  success: boolean;
  page: Page;
}

export interface PageSplitRequest {
  split_position: number;
}

export interface PageSplitResponse {
  success: boolean;
  left_page: Page;
  right_page: Page;
}

export interface PageDetectSplitResponse {
  isTwoPageSpread: boolean;
  confidence: 'high' | 'medium' | 'low';
  splitPosition: number;
  splitPositionPercent: number;
  hasTextAtSplit: boolean;
  textWarning?: string;
  metrics: {
    aspectRatio: number;
    gutterScore: number;
    maxDarkRunAtSplit: number;
    transitionsAtSplit: number;
    windowAvgDarkRun: number;
    windowAvgTransitions: number;
  };
}

/**
 * Split Detection Types
 */

export interface SplitDetectionResult {
  is_split: boolean;
  confidence: number;
  split_position?: number;
  reasoning?: string;
}

export interface BatchSplitDetectionResult {
  results: Array<{
    page_id: string;
    is_split: boolean;
    confidence: number;
    split_position?: number;
  }>;
}

export interface AutoSplitResult {
  success: boolean;
  left_page_id?: string;
  right_page_id?: string;
}

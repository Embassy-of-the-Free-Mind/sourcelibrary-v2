/**
 * Research Session Types
 * Types for browsable curator/research conversation logs
 */

export interface BookRef {
  book_id?: string;
  title: string;
  author?: string;
  year?: number;
}

export interface CuratorMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  index: number;
}

export interface CuratorSession {
  id: string;
  title: string;
  date: string;
  date_end: string;
  duration_minutes: number;
  themes: string[];
  session_type: 'acquisition' | 'research' | 'gap_analysis' | 'mixed';
  curator_score: number;
  message_count: number;
  word_count: number;
  books_imported: BookRef[];
  books_discussed: BookRef[];
  messages: CuratorMessage[];
  summary?: string;
  source_file: string;
  created_at: string;
}

export type CuratorSessionListItem = Omit<CuratorSession, 'messages'>;

export interface CuratorSessionListResponse {
  sessions: CuratorSessionListItem[];
  total: number;
  themes: string[];
  types: string[];
}

export interface CuratorSessionDetailResponse extends CuratorSession {
  total_messages: number;
  page: number;
  per_page: number;
}

export interface CuratorSessionListParams {
  theme?: string;
  type?: string;
  sort?: 'date' | 'score';
  limit?: number;
  offset?: number;
}

export interface CuratorSessionDetailParams {
  page?: number;
  per_page?: number;
}

export type BookshelfStatus = 'want_to_read' | 'reading' | 'completed';

export interface BookshelfEntry {
  visitor_id: string;
  book_id: string;
  status: BookshelfStatus;
  last_read_page_id: string | null;
  last_read_page_number: number | null;
  last_read_at: Date | null;
  added_at: Date;
  updated_at: Date;
}

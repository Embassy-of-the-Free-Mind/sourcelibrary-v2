/**
 * Categories API types
 */

export interface Category {
  id: string;
  name: string;
  description: string;
  icon: string; // Emoji Icon
  book_count: number;
}

export interface CategoriesResponse {
  categories: Category[];
}

export interface CategoryWithBooks {
  category: Category;
  books: any[]; // Books with categories
  total: number;
}

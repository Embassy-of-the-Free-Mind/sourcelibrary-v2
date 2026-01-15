import { apiClient } from './client';

/**
 * Upload API client
 * Handles file uploads to the server
 */
export const upload = {
  /**
   * Upload image files to a book
   *
   * @param bookId - The book ID to upload images to
   * @param files - Array of File objects to upload
   * @returns Promise with upload results
   */
  images: async (bookId: string, files: File[]): Promise<{
    success: boolean;
    pages: Array<{
      id: string;
      page_number: number;
      photo: string;
    }>;
    message: string;
  }> => {
    const formData = new FormData();
    formData.append('bookId', bookId);

    // Append all files
    files.forEach(file => {
      formData.append('files', file);
    });

    return await apiClient.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
};

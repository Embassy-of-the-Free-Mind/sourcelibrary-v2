import axios, { AxiosError, AxiosInstance } from 'axios';

// Create axios instance with defaults
export const apiClient: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Request interceptor - add headers automatically
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add visitor ID for anonymous tracking
    const visitorId = typeof window !== 'undefined' ? localStorage.getItem('visitor_id') : null;
    if (visitorId) {
      config.headers['X-Visitor-ID'] = visitorId;
    }

    // Add custom header (modify as needed)
    config.headers['X-Tenant-Slug'] = 'collections';

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle errors automatically
apiClient.interceptors.response.use(
  (response) => response.data, // Auto-unwrap data (response.data.data becomes response.data)
  (error: AxiosError) => {
    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      // TODO: Add auth redirect or token refresh logic
      console.error('Unauthorized - redirect to login');
      // window.location.href = '/auth/login';
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      throw new Error('You do not have permission to perform this action');
    }

    // Extract error message from response
    const message = (error.response?.data as any)?.error || error.message || 'Request failed';
    throw new Error(message);
  }
);

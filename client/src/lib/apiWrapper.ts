import { apiRequest as baseApiRequest } from "./queryClient";
import { isApiErrorResponse } from "@shared/errors";
import type { ApiSuccessResponse } from "@shared/errors";

/**
 * Wrapper function for API requests that automatically handles the new API response format
 * All API endpoints now return { success: true, data: ... } or { success: false, error: ... }
 * This wrapper ensures consistent data extraction across the application
 */
export async function apiRequest<T = any>(
  method: string,
  url: string,
  data?: unknown
): Promise<T> {
  const response = await baseApiRequest(method, url, data);
  const responseData = await response.json();
  
  // Handle new standardized API format
  if (responseData && typeof responseData === 'object' && 'success' in responseData) {
    if (responseData.success === true) {
      return (responseData as ApiSuccessResponse<T>).data;
    } else if (isApiErrorResponse(responseData)) {
      throw new Error(responseData.error.userMessage || responseData.error.message);
    }
  }
  
  // Fallback for old format (should not happen after refactoring)
  return responseData as T;
}

/**
 * Use this for queries that expect standardized API responses
 */
export function createApiQuery<T = any>(url: string) {
  return {
    queryKey: url.split('/').filter(Boolean),
    queryFn: async () => {
      const response = await baseApiRequest("GET", url);
      const data = await response.json();
      
      // Handle new standardized API format
      if (data && typeof data === 'object' && 'success' in data) {
        if (data.success === true) {
          return (data as ApiSuccessResponse<T>).data;
        } else if (isApiErrorResponse(data)) {
          throw new Error(data.error.userMessage || data.error.message);
        }
      }
      
      return data as T;
    }
  };
}
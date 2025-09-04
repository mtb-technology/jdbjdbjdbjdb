import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { AppError, ErrorType, ErrorLogger } from "@/lib/errors";
import { isApiErrorResponse, type ApiResponse } from "@shared/errors";
import { QUERY_CONFIG, API_CONFIG } from "@/lib/config";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorData;
    
    try {
      const responseText = await res.text();
      errorData = responseText ? JSON.parse(responseText) : null;
    } catch {
      errorData = null;
    }

    // Handle API error responses met onze standaard format
    if (errorData && isApiErrorResponse(errorData)) {
      const appError = new AppError(
        ErrorType.API_ERROR,
        errorData.error.code,
        errorData.error.message,
        errorData.error.userMessage,
        undefined,
        {
          statusCode: res.status,
          url: res.url,
          details: errorData.error.details
        }
      );
      ErrorLogger.logAndThrow(appError);
    }

    // Handle network errors
    if (res.status === 0 || res.status >= 500) {
      const appError = AppError.network(
        `Network error: ${res.status} ${res.statusText}`,
        'Er is een netwerkfout opgetreden. Controleer uw internetverbinding en probeer het opnieuw.',
        undefined,
        { statusCode: res.status, url: res.url }
      );
      ErrorLogger.logAndThrow(appError);
    }

    // Handle andere HTTP errors
    const message = errorData?.message || res.statusText || `HTTP ${res.status}`;
    const appError = AppError.api(
      `API error: ${res.status} ${message}`,
      'Er is een fout opgetreden bij het verwerken van uw verzoek.',
      undefined,
      { statusCode: res.status, url: res.url }
    );
    ErrorLogger.logAndThrow(appError);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    // Als het geen AppError is, converteer het dan
    if (!(error instanceof AppError)) {
      const appError = AppError.network(
        `Request failed: ${method} ${url}`,
        'Er kon geen verbinding worden gemaakt met de server.',
        error instanceof Error ? error : undefined,
        { method, url, data }
      );
      ErrorLogger.logAndThrow(appError);
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      const res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      const data = await res.json();
      
      // Extract data from API response if it follows our standard format
      if (data && typeof data === 'object' && 'success' in data && data.success === true) {
        return data.data;
      }
      
      return data;
    } catch (error) {
      // Convert to AppError if needed and log
      const appError = error instanceof AppError 
        ? error 
        : AppError.fromUnknown(error, { queryKey });
      
      ErrorLogger.log(appError);
      throw appError;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: QUERY_CONFIG.QUERIES.REFETCH_INTERVAL,
      refetchOnWindowFocus: QUERY_CONFIG.QUERIES.REFETCH_ON_WINDOW_FOCUS,
      staleTime: QUERY_CONFIG.QUERIES.STALE_TIME,
      gcTime: QUERY_CONFIG.QUERIES.CACHE_TIME,
      retry: QUERY_CONFIG.QUERIES.RETRY,
      retryDelay: QUERY_CONFIG.QUERIES.RETRY_DELAY,
    },
    mutations: {
      retry: QUERY_CONFIG.MUTATIONS.RETRY,
      gcTime: QUERY_CONFIG.MUTATIONS.CACHE_TIME,
    },
  },
});

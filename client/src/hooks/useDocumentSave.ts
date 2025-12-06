import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { TipTapContent } from '@shared/document-types';

interface UseDocumentSaveOptions {
  reportId: string;
  debounceMs?: number;
  onSaveSuccess?: () => void;
  onSaveError?: (error: Error) => void;
}

interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: Date | null;
  error: string | null;
}

export function useDocumentSave({
  reportId,
  debounceMs = 1500,
  onSaveSuccess,
  onSaveError,
}: UseDocumentSaveOptions) {
  const [saveState, setSaveState] = useState<SaveState>({
    status: 'idle',
    lastSavedAt: null,
    error: null,
  });

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const pendingContent = useRef<TipTapContent | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (content: TipTapContent) => {
      const response = await apiRequest(
        'PATCH',
        `/api/reports/${reportId}/document-state`,
        { documentState: content }
      );
      return response;
    },
    onMutate: () => {
      setSaveState(prev => ({ ...prev, status: 'saving', error: null }));
    },
    onSuccess: () => {
      setSaveState({
        status: 'saved',
        lastSavedAt: new Date(),
        error: null,
      });
      onSaveSuccess?.();

      // Reset to idle after 2 seconds
      setTimeout(() => {
        setSaveState(prev =>
          prev.status === 'saved' ? { ...prev, status: 'idle' } : prev
        );
      }, 2000);
    },
    onError: (error: Error) => {
      setSaveState({
        status: 'error',
        lastSavedAt: null,
        error: error.message || 'Opslaan mislukt',
      });
      onSaveError?.(error);
    },
  });

  const debouncedSave = useCallback((content: TipTapContent) => {
    pendingContent.current = content;

    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Set new timer
    debounceTimer.current = setTimeout(() => {
      if (pendingContent.current) {
        saveMutation.mutate(pendingContent.current);
        pendingContent.current = null;
      }
    }, debounceMs);
  }, [debounceMs, saveMutation]);

  const saveNow = useCallback((content: TipTapContent) => {
    // Clear any pending debounced save
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    pendingContent.current = null;

    saveMutation.mutate(content);
  }, [saveMutation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return {
    saveState,
    debouncedSave,
    saveNow,
    isSaving: saveMutation.isPending,
  };
}

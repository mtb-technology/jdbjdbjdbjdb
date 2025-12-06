/**
 * usePromptBackup Hook
 *
 * Handles import/export of prompt configurations.
 * Consolidates:
 * - handleBackup (lines 386-420)
 * - handleRestore (lines 422-485)
 * - Response extraction logic (lines 394, 462)
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import { extractApiData } from "@/types/settings.types";

interface BackupData {
  prompt_configs?: unknown[];
  [key: string]: unknown;
}

interface RestoreResult {
  message?: string;
}

interface UsePromptBackupReturn {
  handleBackup: () => Promise<void>;
  handleRestore: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function usePromptBackup(
  handleSave: () => Promise<void>,
  fileInputRef: React.RefObject<HTMLInputElement>,
  refetch: () => void
): UsePromptBackupReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Export current configuration as JSON file
   */
  const handleBackup = useCallback(async () => {
    try {
      // Save current changes first
      await handleSave();

      const response = await fetch("/api/prompts/backup");
      const responseData = await response.json();

      // Handle new API response format
      const data = extractApiData<BackupData>(responseData);

      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prompts-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "JSON geëxporteerd",
        description:
          "Prompt configuraties zijn geëxporteerd als JSON bestand. Upload dit bestand in productie om de configuraties te synchroniseren.",
      });
    } catch (error) {
      console.error("Backup failed:", error);
      toast({
        title: "Export mislukt",
        description: "Kon JSON bestand niet exporteren",
        variant: "destructive",
      });
    }
  }, [handleSave, toast]);

  /**
   * Validate backup file format
   */
  const isValidFormat = (data: unknown): data is BackupData => {
    // Check if it's an array or has prompt_configs array (both supported formats)
    if (Array.isArray(data)) return data.length > 0;
    if (data && typeof data === "object" && "prompt_configs" in data) {
      return Array.isArray((data as BackupData).prompt_configs) && (data as BackupData).prompt_configs!.length > 0;
    }
    return false;
  };

  /**
   * Import configuration from JSON file
   */
  const handleRestore = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        let data: unknown;

        // First, try to parse JSON with specific error handling
        try {
          data = JSON.parse(text);
        } catch {
          toast({
            title: "Ongeldig JSON bestand",
            description: "Het bestand bevat geen geldige JSON data. Upload een geldig export bestand.",
            variant: "destructive",
          });
          return;
        }

        // Basic client-side validation
        if (!isValidFormat(data)) {
          toast({
            title: "Ongeldig JSON bestand",
            description: "Het bestand bevat geen geldige prompt configuraties. Upload een geldig export bestand.",
            variant: "destructive",
          });
          return;
        }

        const response = await apiRequest("POST", "/api/prompts/restore", data);
        const responseData = await response.json();

        // Handle new API response format
        const result = extractApiData<RestoreResult>(responseData);

        toast({
          title: "Import geslaagd",
          description: result.message || "Prompt configuraties zijn geïmporteerd uit JSON bestand",
        });

        // Refresh the data
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.prompts.active() });
        refetch();
      } catch (error) {
        console.error("Restore failed:", error);
        toast({
          title: "Import mislukt",
          description: "Kon JSON bestand niet importeren. Controleer of het bestand geldig is.",
          variant: "destructive",
        });
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [toast, queryClient, refetch, fileInputRef]
  );

  return {
    handleBackup,
    handleRestore,
  };
}

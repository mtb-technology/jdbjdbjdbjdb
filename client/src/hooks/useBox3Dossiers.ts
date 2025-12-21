/**
 * useBox3Dossiers Hook
 *
 * Dossier management for Box 3 Validator.
 * Uses the V2 Blueprint data model.
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { Box3Blueprint, Box3Dossier, Box3GeneratedEmail } from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";
import { BOX3_CONSTANTS } from "@shared/constants";

// Light dossier type for list view
export interface Box3DossierLight {
  id: string;
  dossierNummer: string | null;
  clientName: string;
  clientEmail: string | null;
  status: string | null;
  taxYears: string[] | null;
  hasFiscalPartner: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// Full dossier with blueprint
export interface Box3DossierFull {
  dossier: Box3Dossier;
  blueprint: Box3Blueprint | null;
  blueprintVersion: number;
  generatedEmail: Box3GeneratedEmail | null;
  documents: Array<{
    id: string;
    filename: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: string | null;
    uploadedVia: string | null;
    classification: any;
    extractionSummary: string | null;
    extractedText: string | null;
    extractionStatus: string | null;
    extractionCharCount: number | null;
  }>;
}

interface UseBox3DossiersReturn {
  dossiers: Box3DossierLight[] | undefined;
  isLoading: boolean;
  refetchDossiers: () => void;
  loadDossier: (dossierId: string) => Promise<Box3DossierFull | null>;
  deleteDossier: (dossierId: string) => Promise<boolean>;
  addDocuments: (dossierId: string, files: PendingFile[]) => Promise<boolean>;
  updateStatus: (dossierId: string, status: string) => Promise<boolean>;
}

export function useBox3Dossiers(): UseBox3DossiersReturn {
  const { toast } = useToast();

  // Fetch dossiers list
  const { data: dossiers, refetch: refetchDossiers, isLoading } = useQuery<Box3DossierLight[]>({
    queryKey: QUERY_KEYS.box3.sessions(), // Keep query key for cache compatibility
    queryFn: async () => {
      const res = await fetch("/api/box3-validator/dossiers");
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.success ? data.data : data;
    },
    // Refresh more frequently if there are dossiers with uploading/processing status
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActiveProcessing = data?.some(
        d => d.status === 'uploading' || d.status === 'processing'
      );
      return hasActiveProcessing ? 3000 : 30000; // 3s when active, 30s otherwise
    },
  });

  // Load a specific dossier with blueprint
  const loadDossier = useCallback(async (dossierId: string): Promise<Box3DossierFull | null> => {
    try {
      const res = await fetch(`/api/box3-validator/dossiers/${dossierId}`);
      if (!res.ok) throw new Error("Failed to load dossier");

      const data = await res.json();
      return data.success ? data.data : data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Laden mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  // Delete a dossier
  const deleteDossier = async (dossierId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/box3-validator/dossiers/${dossierId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete dossier");

      toast({
        title: "Dossier verwijderd",
        description: "Het dossier is succesvol verwijderd.",
      });

      refetchDossiers();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Verwijderen mislukt",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  };

  // Add documents to existing dossier
  const addDocuments = async (
    dossierId: string,
    files: PendingFile[]
  ): Promise<boolean> => {
    // ✅ Client-side file size validation
    const oversizedFiles = files.filter(pf => pf.file.size > BOX3_CONSTANTS.MAX_FILE_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles
        .map(f => `${f.name} (${(f.file.size / 1024 / 1024).toFixed(1)}MB)`)
        .join(', ');
      toast({
        title: "Bestand(en) te groot",
        description: `Maximum grootte is ${BOX3_CONSTANTS.MAX_FILE_SIZE_MB}MB per bestand. Geweigerd: ${names}`,
        variant: "destructive",
      });
      return false;
    }

    try {
      const formData = new FormData();
      files.forEach((pf) => formData.append("files", pf.file, pf.name));

      // Timeout for AI processing (document extraction + merge)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BOX3_CONSTANTS.AI_TIMEOUT_MS);

      let res;
      try {
        res = await fetch(`/api/box3-validator/dossiers/${dossierId}/documents`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${res.status}`);
      }

      toast({
        title: "Documenten toegevoegd",
        description: `${files.length} document(en) toegevoegd en geëxtraheerd.`,
      });

      refetchDossiers();
      return true;
    } catch (error: unknown) {
      let message = "Kon documenten niet toevoegen.";
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          message = "Verzoek duurde te lang (timeout). Probeer met minder of kleinere bestanden.";
        } else {
          message = error.message;
        }
      }
      toast({
        title: "Toevoegen mislukt",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  };

  // Update dossier status
  const updateStatus = async (
    dossierId: string,
    status: string
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/box3-validator/dossiers/${dossierId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      toast({
        title: "Status bijgewerkt",
        description: `Dossier status is nu: ${status}`,
      });

      refetchDossiers();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Bijwerken mislukt",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    dossiers,
    isLoading,
    refetchDossiers,
    loadDossier,
    deleteDossier,
    addDocuments,
    updateStatus,
  };
}

// Re-export with old name for backwards compatibility during migration
/** @deprecated Use useBox3Dossiers instead */
export const useBox3Sessions = useBox3Dossiers;

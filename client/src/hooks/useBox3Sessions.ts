/**
 * useBox3Sessions Hook - V2
 *
 * Session/Dossier management for Box 3 Validator.
 * Uses the new V2 Blueprint data model.
 */

import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { Box3Blueprint, Box3Dossier } from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";

// Light session type for list view
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
  documents: Array<{
    id: string;
    filename: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: string | null;
    uploadedVia: string | null;
    classification: any;
    extractionSummary: string | null;
  }>;
}

interface UseBox3SessionsReturn {
  sessions: Box3DossierLight[] | undefined;
  isLoading: boolean;
  refetchSessions: () => void;
  loadSession: (sessionId: string) => Promise<Box3DossierFull | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  addDocuments: (sessionId: string, files: PendingFile[]) => Promise<boolean>;
  updateStatus: (sessionId: string, status: string) => Promise<boolean>;
}

export function useBox3Sessions(): UseBox3SessionsReturn {
  const { toast } = useToast();

  // Fetch dossiers list
  const { data: sessions, refetch: refetchSessions, isLoading } = useQuery<Box3DossierLight[]>({
    queryKey: QUERY_KEYS.box3.sessions(),
    queryFn: async () => {
      const res = await fetch("/api/box3-validator/dossiers");
      const data = await res.json();
      return data.success ? data.data : [];
    },
    refetchInterval: 30000,
  });

  // Load a specific dossier with blueprint
  const loadSession = async (sessionId: string): Promise<Box3DossierFull | null> => {
    try {
      const res = await fetch(`/api/box3-validator/dossiers/${sessionId}`);
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
  };

  // Delete a dossier
  const deleteSession = async (sessionId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/box3-validator/dossiers/${sessionId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete dossier");

      toast({
        title: "Dossier verwijderd",
        description: "Het dossier is succesvol verwijderd.",
      });

      refetchSessions();
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
    sessionId: string,
    files: PendingFile[]
  ): Promise<boolean> => {
    try {
      const formData = new FormData();
      files.forEach((pf) => formData.append("files", pf.file, pf.name));

      const res = await fetch(`/api/box3-validator/dossiers/${sessionId}/documents`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${res.status}`);
      }

      toast({
        title: "Documenten toegevoegd",
        description: `${files.length} document(en) toegevoegd.`,
      });

      refetchSessions();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
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
    sessionId: string,
    status: string
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/box3-validator/dossiers/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      toast({
        title: "Status bijgewerkt",
        description: `Dossier status is nu: ${status}`,
      });

      refetchSessions();
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
    sessions,
    isLoading,
    refetchSessions,
    loadSession,
    deleteSession,
    addDocuments,
    updateStatus,
  };
}

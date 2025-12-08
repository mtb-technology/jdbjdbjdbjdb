/**
 * useBox3Sessions Hook
 *
 * Session management for Box 3 Validator.
 * Handles fetching, loading, and deleting sessions.
 */

import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { Box3ValidatorSession, Box3ManualOverrides } from "@shared/schema";
import type { SessionLight, PendingFile } from "@/types/box3Validator.types";

interface UseBox3SessionsReturn {
  sessions: SessionLight[] | undefined;
  refetchSessions: () => void;
  loadSession: (sessionId: string) => Promise<Box3ValidatorSession | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  updateOverrides: (sessionId: string, overrides: Partial<Box3ManualOverrides>) => Promise<Box3ValidatorSession | null>;
  updateStatus: (sessionId: string, status: string, notes?: string) => Promise<Box3ValidatorSession | null>;
  addDocuments: (sessionId: string, files: PendingFile[], additionalText?: string) => Promise<Box3ValidatorSession | null>;
}

export function useBox3Sessions(): UseBox3SessionsReturn {
  const { toast } = useToast();

  // Fetch sessions list
  const { data: sessions, refetch: refetchSessions } = useQuery<SessionLight[]>({
    queryKey: QUERY_KEYS.box3.sessions(),
    queryFn: async () => {
      const res = await fetch("/api/box3-validator/sessions");
      const data = await res.json();
      return data.success ? data.data : [];
    },
    refetchInterval: 30000,
  });

  // Load a specific session
  const loadSession = async (
    sessionId: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Failed to load session");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      toast({
        title: "Sessie geladen",
        description: `Sessie voor ${session.clientName} is geladen.`,
      });

      return session;
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

  // Delete a session
  const deleteSession = async (sessionId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete session");

      toast({
        title: "Sessie verwijderd",
        description: "De sessie is succesvol verwijderd.",
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

  // Update manual overrides
  const updateOverrides = async (
    sessionId: string,
    overrides: Partial<Box3ManualOverrides>
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}/overrides`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });

      if (!res.ok) throw new Error("Failed to update overrides");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      toast({
        title: "Aanpassingen opgeslagen",
        description: "De handmatige correcties zijn opgeslagen.",
      });

      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Opslaan mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  };

  // Update dossier status
  const updateStatus = async (
    sessionId: string,
    dossierStatus: string,
    notes?: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierStatus, notes }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      toast({
        title: "Status bijgewerkt",
        description: `Dossier status is nu: ${dossierStatus}`,
      });

      refetchSessions();
      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Bijwerken mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  };

  // Add documents to existing session
  const addDocuments = async (
    sessionId: string,
    files: PendingFile[],
    additionalText?: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const formData = new FormData();
      files.forEach((pf) => formData.append("files", pf.file, pf.name));
      if (additionalText) {
        formData.append("additionalText", additionalText);
      }

      const res = await fetch(`/api/box3-validator/sessions/${sessionId}/add-documents`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data.session : data.session;

      toast({
        title: "Documenten toegevoegd",
        description: `${files.length} document(en) toegevoegd en opnieuw gevalideerd.`,
      });

      refetchSessions();
      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Toevoegen mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  };

  return {
    sessions,
    refetchSessions,
    loadSession,
    deleteSession,
    updateOverrides,
    updateStatus,
    addDocuments,
  };
}

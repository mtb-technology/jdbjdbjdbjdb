/**
 * useBox3Sessions Hook
 *
 * Session management for Box 3 Validator.
 * Handles fetching, loading, and deleting sessions.
 * Supports both legacy single-year and multi-year dossiers.
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
  updateOverrides: (sessionId: string, overrides: Partial<Box3ManualOverrides>, jaar?: string) => Promise<Box3ValidatorSession | null>;
  updateStatus: (sessionId: string, status: string, notes?: string) => Promise<Box3ValidatorSession | null>;
  addDocuments: (sessionId: string, files: PendingFile[], additionalText?: string, jaar?: string) => Promise<Box3ValidatorSession | null>;
  // Multi-year specific
  convertToMultiYear: (sessionId: string) => Promise<Box3ValidatorSession | null>;
  addYear: (sessionId: string, jaar: string) => Promise<Box3ValidatorSession | null>;
  revalidateYear: (sessionId: string, jaar: string, systemPrompt?: string) => Promise<Box3ValidatorSession | null>;
  // Email generation
  generateEmail: (sessionId: string, emailPrompt?: string) => Promise<{ onderwerp: string; body: string } | null>;
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

  // Update manual overrides (supports both legacy and multi-year)
  const updateOverrides = async (
    sessionId: string,
    overrides: Partial<Box3ManualOverrides>,
    jaar?: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      // Use year-specific endpoint for multi-year, otherwise legacy endpoint
      const url = jaar
        ? `/api/box3-validator/sessions/${sessionId}/years/${jaar}/overrides`
        : `/api/box3-validator/sessions/${sessionId}/overrides`;

      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });

      if (!res.ok) throw new Error("Failed to update overrides");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      toast({
        title: "Aanpassingen opgeslagen",
        description: jaar
          ? `Correcties voor ${jaar} opgeslagen.`
          : "De handmatige correcties zijn opgeslagen.",
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

  // Add documents to existing session (supports both legacy and multi-year)
  const addDocuments = async (
    sessionId: string,
    files: PendingFile[],
    additionalText?: string,
    jaar?: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const formData = new FormData();
      files.forEach((pf) => formData.append("files", pf.file, pf.name));
      if (additionalText) {
        formData.append("additionalText", additionalText);
      }

      // Use year-specific endpoint for multi-year, otherwise legacy endpoint
      const url = jaar
        ? `/api/box3-validator/sessions/${sessionId}/years/${jaar}/add-documents`
        : `/api/box3-validator/sessions/${sessionId}/add-documents`;

      const res = await fetch(url, {
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
        description: jaar
          ? `${files.length} document(en) toegevoegd aan ${jaar}.`
          : `${files.length} document(en) toegevoegd en opnieuw gevalideerd.`,
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

  // Convert session to multi-year format
  const convertToMultiYear = async (
    sessionId: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}/convert-to-multi-year`, {
        method: "POST",
      });

      if (!res.ok) throw new Error("Failed to convert to multi-year");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      toast({
        title: "Omgezet naar multi-year",
        description: "Het dossier ondersteunt nu meerdere belastingjaren.",
      });

      refetchSessions();
      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Omzetten mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  };

  // Add a year to multi-year session
  const addYear = async (
    sessionId: string,
    jaar: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}/years`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jaar }),
      });

      if (!res.ok) throw new Error("Failed to add year");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data : data;

      toast({
        title: "Jaar toegevoegd",
        description: `Belastingjaar ${jaar} is toegevoegd aan het dossier.`,
      });

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

  // Revalidate a specific year
  const revalidateYear = async (
    sessionId: string,
    jaar: string,
    systemPrompt?: string
  ): Promise<Box3ValidatorSession | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}/years/${jaar}/revalidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });

      if (!res.ok) throw new Error("Failed to revalidate year");

      const data = await res.json();
      const session: Box3ValidatorSession = data.success ? data.data.session : data.session;

      toast({
        title: "Hervalidatie voltooid",
        description: `Jaar ${jaar} is opnieuw gevalideerd.`,
      });

      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Hervalidatie mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  };

  /**
   * Generate email for entire dossier
   */
  const generateEmail = async (
    sessionId: string,
    emailPrompt?: string
  ): Promise<{ onderwerp: string; body: string } | null> => {
    try {
      const res = await fetch(`/api/box3-validator/sessions/${sessionId}/generate-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailPrompt }),
      });

      if (!res.ok) throw new Error("Failed to generate email");

      const data = await res.json();
      const email = data.success ? data.data.email : data.email;

      toast({
        title: "E-mail gegenereerd",
        description: "De concept e-mail is klaar.",
      });

      return email;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "E-mail generatie mislukt",
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
    convertToMultiYear,
    addYear,
    revalidateYear,
    generateEmail,
  };
}
